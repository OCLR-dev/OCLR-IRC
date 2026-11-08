import test, { mock } from 'node:test'
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
  let peer: net.Socket
  let after: ((line: string) => void) | undefined
  const server = net.createServer(socket => {
    peer = socket
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
  return {session, sent, peer: () => peer, target: () => ({roomId:9, roomEpoch:session.state.rooms.find(r => r.id === 9)!.epoch}), onLine(fn: (line: string) => void) {after=fn}, async close() {session.logout(); for (const socket of sockets) socket.destroy(); await new Promise<void>(r => server.close(() => r()))}}
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


test('room sync is triggered once by join and coalesced events, never by idle time or replies', async () => {
  const f=await fixture({roomRefreshMs:130})
  const count=()=>f.sent.filter(s=>s.line.endsWith(':!mp settings')).length
  const settled=()=>f.session.state.room?.referee==='listed' && !f.session.state.pending
  try {
    await until(()=>count()===1 && settled())
    await new Promise(r=>setTimeout(r,500))
    assert.equal(count(),1,'idle time and settings output must not re-arm a read')
    f.peer().write(':Someone PRIVMSG #mp_9 :Player joined in slot 1\n')
    await new Promise(r=>setTimeout(r,250))
    assert.equal(count(),1,'untrusted chat cannot trigger reads')
    f.peer().write(Array(10).fill(':BanchoBot PRIVMSG #mp_9 :Player joined in slot 1\n').join(''))
    await until(()=>count()===2 && settled())
    await new Promise(r=>setTimeout(r,400))
    assert.equal(count(),2,'event burst causes one read, without a periodic tail')
    f.session.openConversation({kind:'private',name:'Other'})
    f.peer().write(':BanchoBot PRIVMSG #mp_9 :Player left the game\n')
    await new Promise(r=>setTimeout(r,250))
    assert.equal(count(),2,'background room must not send scheduled reads')
    f.session.selectRoom(f.target())
    await until(()=>count()===3 && settled())
    f.session.suspend()
    await new Promise(r=>setTimeout(r,250))
    assert.equal(count(),3,'suspend stops scheduled reads')
    assert.equal(f.sent.filter(s=>s.line.endsWith(':!mp listrefs')).length,1,'room changes never repeat referee discovery')
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
    const echoes=f.session.state.messages.filter(m=>m.text==='!mp settings').length
    assert.equal((await f.session.chatBatch({...f.target(),text:'!mp settings'})).ok,true)
    assert.equal(f.session.state.messages.filter(m=>m.text==='!mp settings').length,echoes+1,'typed reads have only one local echo')
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


test('on-demand preview preparation shares reads and never refreshes an already fresh snapshot', async () => {
  const f=await fixture({roomRefreshMs:130})
  const count=()=>f.sent.filter(s=>s.line.endsWith(':!mp settings')).length
  try {
    await until(()=>count()===1 && f.session.state.room?.referee==='listed' && !f.session.state.pending)
    f.session.state.room!.syncState='stale'
    await Promise.all([f.session.prepareObservation(f.target()), f.session.prepareObservation(f.target())])
    assert.equal(count(),2)
    assert.ok(f.session.previewMp({...f.target(),intent:{kind:'map',beatmapId:'456'}}).token)
    await f.session.prepareObservation(f.target())
    assert.equal(count(),2)
  } finally {await f.close()}
})

test('a missing settings response stops after one attempt and requires a new explicit demand', async () => {
  const f=await fixture({roomRefreshMs:130})
  try {
    await until(()=>f.session.state.room?.referee==='listed' && !f.session.state.pending)
    // Room 10 deliberately has no valid settings response from this room-9 fixture.
    f.session.join('10')
    await until(()=>f.sent.some(s=>s.line==='PRIVMSG #mp_10 :!mp settings'))
    await until(()=>Boolean(f.session.state.error) && !f.session.state.pending)
    await new Promise(r=>setTimeout(r,500))
    assert.equal(f.sent.filter(s=>s.line==='PRIVMSG #mp_10 :!mp settings').length,1)
    assert.notEqual(f.session.state.room?.syncState,'complete')
  } finally {await f.close()}
})


test('room changes during a query discard the obsolete snapshot and coalesce a fresh read', async () => {
  const f=await fixture({roomRefreshMs:130})
  const count=()=>f.sent.filter(s=>s.line.endsWith(':!mp settings')).length
  try {
    await until(()=>count()===1 && f.session.state.room?.referee==='listed' && !f.session.state.pending)
    // Server-side pause keeps the next settings request in flight.
    f.peer().pause()
    await f.session.prepareObservation(f.target())
    f.session.requestQuery({...f.target(),kind:'settings'})
    await until(()=>f.session.state.pending==='settings')
    f.peer().write(':BanchoBot PRIVMSG #mp_9 :Player joined in slot 1\n')
    await until(()=>f.session.state.room?.syncState==='stale' && !f.session.state.pending)
    f.peer().resume()
    await until(()=>count()===3 && f.session.state.room?.syncState==='complete' && !f.session.state.pending)
    await new Promise(r=>setTimeout(r,400))
    assert.equal(count(),3,'obsolete reply and fresh reply must not create a query loop')
  } finally {await f.close()}
})


test('referee discovery survives operations and time; settings refreshes never repeat listrefs', async () => {
  const f=await fixture({roomRefreshMs:130})
  const count=(kind:string)=>f.sent.filter(s=>s.line.endsWith(':!mp '+kind)).length
  try {
    await until(()=>count('listrefs')===1 && f.session.state.room?.referee==='listed' && !f.session.state.pending)
    await until(()=>f.session.relayReady(f.target(),'!mp timer 30'))
    const now=performance.now.bind(performance)
    const clock=mock.method(performance,'now',()=>now()+61000)
    try {
      await f.session.prepareObservation(f.target())
      assert.equal(count('listrefs'),1,'elapsed time does not invalidate room-scoped referee discovery')
      f.session.relaySend({...f.target(),text:'!mp timer 30'})
      await until(()=>count('settings')===2 && f.session.state.room?.syncState==='complete' && !f.session.state.pending)
      assert.equal(f.session.state.room?.referee,'listed')
      assert.equal(count('listrefs'),1,'relay mutation only refreshes settings')
      f.session.state.room!.syncState='stale'
      await f.session.prepareObservation(f.target())
      assert.equal(count('listrefs'),1,'on-demand reads only refresh settings')
    } finally {clock.mock.restore()}
    f.session.requestQuery({...f.target(),kind:'listrefs'})
    await until(()=>count('listrefs')===2 && f.session.state.room?.referee==='listed' && !f.session.state.pending)
    f.session.suspend()
    assert.equal(f.session.state.room?.referee,'unknown','disconnect clears room-scoped referee discovery')
  } finally {await f.close()}
})
