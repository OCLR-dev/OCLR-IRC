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
async function fixture(timing: {roomRefreshMs?: number} = {}) {
  const sockets = new Set<net.Socket>(), sent: {line: string; time: number}[] = []
  let after: ((line: string) => void) | undefined
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket))
    const parser = new Lines()
    socket.on('data', data => { for (const line of parser.feed(data)) {
      sent.push({line, time: Date.now()})
      if (line.startsWith('USER ')) socket.write(':server 001 Example :Welcome\n')
      if (line.startsWith('JOIN ')) socket.write(`:Example!x JOIN :${line.slice(5)}\n`)
      if (line.endsWith(':!mp settings')) socket.write(':BanchoBot PRIVMSG #mp_9 :Room name: Synthetic, History: https://osu.ppy.sh/mp/9\n:BanchoBot PRIVMSG #mp_9 :Beatmap: https://osu.ppy.sh/b/75 Synthetic map\n:BanchoBot PRIVMSG #mp_9 :Team mode: TeamVs, Win condition: ScoreV2\n:BanchoBot PRIVMSG #mp_9 :Active mods: None\n:BanchoBot PRIVMSG #mp_9 :Players: 0\n')
      if (line.endsWith(':!mp listrefs')) socket.write(':BanchoBot PRIVMSG #mp_9 :Match referees: Example\n')
      after?.(line)
    } })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const session = new IrcSession(() => net.createConnection({host:'127.0.0.1', port:(server.address() as net.AddressInfo).port}), {floodMs:30, queryMs:100, retryBaseMs:20, loginMs:1000, ...timing})
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
    const overrides: unknown[]=[]
    f.session.on('manual-command', target=>overrides.push(target))
    const result = await f.session.chatBatch({...f.target(),text:'!mp map 3645174 0\r\nready\nQUIT'})
    assert.deepEqual(overrides,[f.target()])
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


test('current room settings and refs refresh automatically, pause on another conversation and stop offline', async () => {
  const f=await fixture({roomRefreshMs:130})
  const count=()=>f.sent.filter(s=>s.line.endsWith(':!mp settings')).length
  try {
    await until(()=>count()>=3 && f.session.state.room?.referee==='listed' && !f.session.state.pending)
    f.session.openConversation({kind:'private',name:'Other'})
    const before=count()
    await new Promise(r=>setTimeout(r,350))
    assert.equal(count(),before,'background room must not keep polling')
    f.session.selectRoom(f.target())
    await until(()=>count()>before)
    f.session.suspend()
    const stopped=count()
    await new Promise(r=>setTimeout(r,250))
    assert.equal(count(),stopped,'suspend must stop automatic reads')
  } finally {await f.close()}
})

test('automatic reads leave an active preview valid and typed settings use the collector once', async () => {
  const f=await fixture({roomRefreshMs:130})
  try {
    await until(()=>f.session.state.room?.referee==='listed' && !f.session.state.pending)
    await until(()=>f.session.relayReady(f.target(),'!mp map 3645174'))
    const preview=f.session.previewMp({...f.target(),intent:{kind:'map',beatmapId:'3645174'}})
    const reads=f.sent.filter(s=>s.line.endsWith(':!mp settings')).length
    await new Promise(r=>setTimeout(r,350))
    assert.equal(f.sent.filter(s=>s.line.endsWith(':!mp settings')).length,reads)
    f.session.executeMp({...f.target(),token:preview.token,reviewed:true})
    await until(()=>f.sent.some(s=>s.line.endsWith(':!mp map 3645174')))
    await until(()=>f.session.state.room?.referee==='listed' && !f.session.state.pending)
    const before=f.sent.filter(s=>s.line.endsWith(':!mp settings')).length
    assert.equal((await f.session.chatBatch({...f.target(),text:'!mp settings'})).ok,true)
    await until(()=>f.session.state.room?.binding==='verified' && !f.session.state.pending)
    assert.equal(f.sent.filter(s=>s.line.endsWith(':!mp settings')).length,before+1)
  } finally {await f.close()}
})


test('explicit reads queue behind shared flood control without dropping the request', async () => {
  const f=await fixture()
  try {
    await f.session.chatBatch({...f.target(),text:'hello'})
    f.session.requestQuery({...f.target(),kind:'settings'})
    await until(()=>f.sent.some(s=>s.line.endsWith(':!mp settings')) && f.session.state.room?.binding==='verified' && !f.session.state.pending)
    assert.equal(f.sent.filter(s=>s.line.endsWith(':!mp settings')).length,1)
    assert.throws(()=>f.session.requestQuery({...f.target(),roomEpoch:-1,kind:'settings'}))
    assert.throws(()=>f.session.requestQuery({...f.target(),kind:'start'}))
  } finally {await f.close()}
})
