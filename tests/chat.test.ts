import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { IrcSession } from '../src/main/irc.ts'
import { Lines } from '../src/main/protocol.ts'
import { chatLines } from '../src/shared/chat.ts'

async function until(check: () => boolean) {
  for (let i = 0; i < 300; i++) { if (check()) return; await new Promise(r => setTimeout(r, 5)) }
  throw new Error('Synthetic chat condition timed out')
}
async function fixture() {
  const sockets = new Set<net.Socket>(), sent: {line: string; time: number}[] = []
  let after: ((line: string) => void) | undefined
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket))
    const parser = new Lines()
    socket.on('data', data => { for (const line of parser.feed(data)) {
      sent.push({line, time: Date.now()})
      if (line.startsWith('USER ')) socket.write(':server 001 Example :Welcome\n')
      if (line.startsWith('JOIN ')) socket.write(`:Example!x JOIN :${line.slice(5)}\n`)
      if (line.endsWith(':!mp settings')) socket.write(':BanchoBot PRIVMSG #mp_9 :Room name: Synthetic, History: https://osu.ppy.sh/mp/9\n:BanchoBot PRIVMSG #mp_9 :Players: 0\n')
      if (line.endsWith(':!mp listrefs')) socket.write(':BanchoBot PRIVMSG #mp_9 :Match referees: Example\n')
      after?.(line)
    } })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const session = new IrcSession(() => net.createConnection({host:'127.0.0.1', port:(server.address() as net.AddressInfo).port}), {floodMs:30, queryMs:100, retryBaseMs:20, loginMs:1000})
  session.login({username:'Example', password:'SYNTHETIC_ONLY'})
  await until(() => session.state.connection === 'online')
  session.join('9')
  await until(() => Boolean(session.state.room?.joined && !session.state.pending))
  return {session, sent, target: () => ({roomId:9, roomEpoch:session.state.rooms.find(r => r.id === 9)!.epoch}), onLine(fn: (line: string) => void) {after=fn}, async close() {session.logout(); for (const socket of sockets) socket.destroy(); await new Promise<void>(r => server.close(() => r()))}}
}

test('chat commands and multiline drafts validate every line before creating any IRC frames', () => {
  assert.deepEqual(chatLines('!mp map 3645174 0\r\n!mp mods HD\n\nready', '#mp_9'), ['!mp map 3645174 0','!mp mods HD','ready'])
  assert.deepEqual(chatLines('hello\nQUIT', '#mp_9'), ['hello','QUIT'])
  for (const text of ['hello\n\x00QUIT','hello\n\t!mp close','\x01ACTION x\x01','a\n'+'測'.repeat(200),Array(11).fill('hello').join('\n'),'x'.repeat(6001)]) assert.throws(() => chatLines(text, '#mp_9'))
})

test('typed MP commands and multiline content are sent once to the fixed room with shared flood control', async () => {
  const f = await fixture()
  try {
    const result = await f.session.chatBatch({...f.target(),text:'!mp map 3645174 0\r\nready\nQUIT'})
    assert.equal(result.ok,true)
    await until(() => f.sent.some(s => s.line.endsWith(':QUIT')))
    const messages = f.sent.filter(s => /:(?:!mp map 3645174 0|ready|QUIT)$/.test(s.line))
    assert.deepEqual(messages.map(s => s.line),['PRIVMSG #mp_9 :!mp map 3645174 0','PRIVMSG #mp_9 :ready','PRIVMSG #mp_9 :QUIT'])
    assert.ok(messages.slice(1).every((s,i) => s.time-messages[i].time >= 25))
    assert.equal(f.sent.some(s => s.line==='QUIT'),false)
    assert.equal(f.session.state.messages.find(m => m.text==='!mp map 3645174 0')?.delivery,'unconfirmed')
    assert.equal(f.session.state.messages.find(m => m.text==='ready')?.delivery,'sent')
    const before=f.sent.length
    await assert.rejects(f.session.chatBatch({...f.target(),text:'valid\n'+'測'.repeat(200)}))
    assert.equal(f.sent.slice(before).some(s => s.line.endsWith(':valid')),false)
  } finally {await f.close()}
})

test('concurrent submissions are rejected and changing conversation retains only unsent lines', async () => {
  const f=await fixture()
  try {
    f.onLine(line => {if(line.endsWith(':first')) f.session.openConversation({kind:'private',name:'Other'})})
    const batch=f.session.chatBatch({...f.target(),text:'first\nsecond'})
    await assert.rejects(f.session.chatBatch({...f.target(),text:'duplicate'}),/正在傳送/)
    const result=await batch
    assert.equal(result.ok,false);assert.equal(result.remainingText,'second')
    assert.equal(f.sent.some(s => s.line.endsWith(':second') || s.line.endsWith(':duplicate')),false)
  } finally {await f.close()}
})

test('disconnect cancels remaining commands without replay on a new connection', async () => {
  const f=await fixture()
  try {
    f.onLine(line => {if(line.endsWith(':first')) f.session.suspend()})
    const result=await f.session.chatBatch({...f.target(),text:'first\n!mp start 5'})
    assert.equal(result.ok,false);assert.equal(result.remainingText,'!mp start 5')
    f.session.resume()
    await until(() => f.session.state.connection==='online')
    assert.equal(f.sent.some(s => s.line.endsWith(':!mp start 5')),false)
  } finally {await f.close()}
})

test('a transport failure consumes the attempted line as unknown and never retries it', async () => {
  const f=await fixture()
  try {
    const socket=(f.session as unknown as {socket:net.Socket}).socket, original=socket.write
    let attempts=0
    socket.write=(() => {attempts++;throw new Error('Synthetic write failure')}) as typeof socket.write
    const result=await f.session.chatBatch({...f.target(),text:'!mp map 3645174 0\nsecond'})
    socket.write=original
    assert.equal(result.ok,false);assert.equal(result.remainingText,'second');assert.equal(attempts,1)
    assert.equal(f.session.state.messages.at(-1)?.delivery,'unknown')
    assert.equal(f.sent.some(s => s.line.includes(':!mp map 3645174 0')),false)
  } finally {await f.close()}
})
