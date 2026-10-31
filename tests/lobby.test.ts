import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { IrcSession } from '../src/main/irc.ts'
import { Lines } from '../src/main/protocol.ts'
import { lobbyIntent, lobbyCommand } from '../src/shared/lobby-command.ts'
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn: () => boolean) { for (let i = 0; i < 400; i++) { if (fn()) return; await pause(10) } throw new Error('Plan timed out') }
async function fixture(mode = 'success') {
  let map = '123', mods = 'None', peer: net.Socket
  const sent: string[] = [], sockets = new Set<net.Socket>()
  const server = net.createServer(socket => {
    peer = socket; sockets.add(socket); socket.on('close', () => sockets.delete(socket)); const lines = new Lines()
    socket.on('data', chunk => { for (const line of lines.feed(chunk)) {
      sent.push(line)
      if (line.startsWith('USER ')) socket.write(':server 001 Example :welcome\n')
      if (line.startsWith('JOIN ')) socket.write(':server 366 Example #mp_9 :End\n')
      if (line.includes(':!mp map ')) {
        if (mode !== 'wrong-map') map = line.split(' ').at(-1)!
        if (mode === 'disconnect') { socket.destroy(); continue }
      }
      if (line.includes(':!mp mods ') && mode !== 'wrong-mods') mods = line.split(':!mp mods ')[1]
      if (line.endsWith(':!mp settings') && !(mode === 'timeout' && map === '456')) socket.write([
        'Room name: Synthetic, History: https://osu.ppy.sh/mp/9', `Beatmap: https://osu.ppy.sh/b/${map} Synthetic`, `Team mode: ${mode === 'solo' ? 'HeadToHead' : 'TeamVs'}, Win condition: ScoreV2`, `Active mods: ${mods}`, `Players: ${mode === 'occupied' ? 2 : 1}`, 'Slot 1 Ready https://osu.ppy.sh/u/101 Synthetic [Host / Team Red]', ...(mode === 'occupied' ? ['Slot 2 Ready https://osu.ppy.sh/u/102 Other [Team Blue]'] : [])
      ].filter(body => mode !== 'mapless' || !/^(Beatmap|Active mods):/.test(body)).map(body => `:BanchoBot PRIVMSG #mp_9 :${body}\n`).join(''))
      if (line.endsWith(':!mp listrefs')) socket.write(':BanchoBot PRIVMSG #mp_9 :Match referees: Example\n')
    } })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const session = new IrcSession(() => net.createConnection({ host: '127.0.0.1', port: (server.address() as net.AddressInfo).port }), { floodMs: 10, queryMs: 300, retryBaseMs: 20 })
  session.login({ username: 'Example', password: 'SYNTHETIC_ONLY' }); await until(() => session.state.connection === 'online')
  session.join('9'); await until(() => Boolean(session.state.room?.joined)); await pause(20)
  const target = () => ({ roomId: 9, roomEpoch: session.state.room!.epoch })
  session.query({ ...target(), kind: 'settings' }); await until(() => mode === 'mapless' ? session.state.room?.syncState === 'partial' : session.state.room?.syncState === 'complete'); await pause(20)
  session.query({ ...target(), kind: 'listrefs' }); await until(() => session.state.room?.referee === 'listed'); await pause(20)
  return { session, sent, target, peer: () => peer, async close() { session.logout(); for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}

test('room commands validate structured values and conceal passwords', () => {
  assert.equal(lobbyCommand(lobbyIntent({kind:'configure',teamMode:'2',scoreMode:'3',size:'16'})), '!mp set 2 3 16')
  assert.equal(lobbyCommand(lobbyIntent({kind:'password',mode:'set'})), '!mp password 〔隱藏〕')
  for (const intent of [{kind:'rename',name:'a\nQUIT'}, {kind:'configure',teamMode:'4',scoreMode:'0',size:'16'}, {kind:'host',osuId:'1 PRIVMSG'}, {kind:'raw'}]) assert.throws(() => lobbyIntent(intent))
  assert.throws(() => lobbyCommand({kind:'password',mode:'set'}, 'a b'))
})
test('queued room refresh fences readiness until both reads and shared throttle finish', async () => {
  const f = await fixture()
  try {
    assert.equal(f.session.relayReady(f.target(), '!mp invite New_Player'), true)
    const priorReads = f.sent.filter(line => line.endsWith(':!mp settings')).length
    f.session.relayRefresh(f.target())
    // The queued timer has not run yet: the old snapshot is still fresh, but it
    // cannot be used for a preview which the imminent refresh would invalidate.
    assert.equal(f.session.relayReady(f.target(), '!mp invite New_Player'), false)
    await until(() => f.session.relayReady(f.target(), '!mp invite New_Player'))
    assert.equal(f.sent.filter(line => line.endsWith(':!mp settings')).length, priorReads + 1)
    const preview = f.session.previewWebsiteInvite({...f.target(), intent: {kind: 'invite', osuId: '999', name: 'New Player'}})
    f.session.executeWebsiteInvite({...f.target(), token: preview.token, reviewed: true, playerName: 'New Player'})
    await until(() => f.sent.includes('PRIVMSG #mp_9 :!mp invite New_Player'))
    assert.equal(f.sent.filter(line => line.includes('!mp invite')).length, 1)
  } finally {await f.close()}
})
test('room mutations require one-use review, mask secrets, and never infer execution from sending', async () => {
  for (const intent of [{kind:'rename',name:'Synthetic renamed'}, {kind:'configure',teamMode:'2',scoreMode:'3',size:'8'}, {kind:'lock'}, {kind:'unlock'}, {kind:'host',osuId:'101'}, {kind:'clearhost'}, {kind:'password',mode:'set'}, {kind:'password',mode:'clear'}, {kind:'close'}]) {
    const f = await fixture()
    try {
      assert.throws(() => f.session.previewLobby({...f.target(), intent:{kind:'host',osuId:'999'}}))
      let preview = f.session.previewLobby({...f.target(),intent})
      assert.throws(() => f.session.executeLobby({...f.target(),token:preview.token,reviewed:false}))
      assert.throws(() => f.session.executeLobby({...f.target(),token:preview.token,reviewed:true}))
      if (intent.kind === 'close') {
        preview = f.session.previewLobby({...f.target(),intent})
        assert.throws(() => f.session.executeLobby({...f.target(),token:preview.token,reviewed:true,closeRoom:'#mp_8'}))
      }
      preview = f.session.previewLobby({...f.target(),intent})
      const secret = 'SYNTHETIC_ROOM_SECRET'
      assert.ok(!JSON.stringify(preview).includes(secret))
      f.session.executeLobby({...f.target(),token:preview.token,reviewed:true,password:secret,closeRoom:'#mp_9'})
      await until(() => f.sent.some(line => line.includes(':!mp ') && !/:!mp (settings|listrefs)$/.test(line)))
      assert.equal(f.session.state.operations!.records.at(-1)!.state, 'awaiting')
      assert.ok(!JSON.stringify(f.session.state).includes(secret))
      f.peer().write(':BanchoBot PRIVMSG #mp_9 :Changed match password to '+secret+'\n')
      await pause(20)
      assert.ok(!JSON.stringify(f.session.state).includes(secret))
      assert.throws(() => f.session.executeLobby({...f.target(),token:preview.token,reviewed:true}))
      assert.equal(f.sent.filter(line => line.includes(':!mp ') && !/:!mp (settings|listrefs)$/.test(line)).length, 1)
    } finally { await f.close() }
  }
})

test('mapless settings allow independent room controls; changed state invalidates preview', async () => {
  const f = await fixture('mapless')
  try {
    const intent = {kind:'lock'}
    let preview = f.session.previewLobby({...f.target(),intent})
    f.peer().write(':BanchoBot PRIVMSG #mp_9 :The match has started!\n')
    await until(() => f.session.state.room?.phase === 'playing')
    assert.throws(() => f.session.executeLobby({...f.target(),token:preview.token,reviewed:true}))
    assert.equal(f.sent.some(line => line.endsWith(':!mp lock')), false)
  } finally { await f.close() }
})

test('player commands require typed UID, explicit name confirmation and one-use fixed target', async () => {
  for (const intent of [{kind:'invite',osuId:'999',name:'Manual Player'}, {kind:'move',osuId:'101',slot:'4'}, {kind:'team',osuId:'101',team:'blue'}, {kind:'kick',osuId:'101'}]) {
    const f = await fixture()
    try {
      const first = f.session.previewLobby({...f.target(),intent})
      assert.equal(first.playerName, intent.kind === 'invite' ? 'Manual Player' : 'Synthetic')
      assert.throws(() => f.session.executeLobby({...f.target(),token:first.token,reviewed:true,playerName:'Wrong Player'}))
      assert.throws(() => f.session.executeLobby({...f.target(),token:first.token,reviewed:true,playerName:first.playerName}))
      const next = f.session.previewLobby({...f.target(),intent})
      f.session.executeLobby({...f.target(),token:next.token,reviewed:true,playerName:next.playerName})
      await until(() => f.sent.some(line => line.includes(`:!mp ${intent.kind} `)))
      assert.equal(f.sent.filter(line=>line.includes(`:!mp ${intent.kind} `)).length, 1)
      assert.equal(f.session.state.operations!.records.at(-1)!.state, 'awaiting')
      // Invitation does not create a player observation.
      assert.equal(f.session.state.room!.slots.some(player=>player.osuId === 999), false)
    } finally { await f.close() }
  }
})
test('unknown targets, existing invitees, invalid slots and unsafe player identity are blocked', async () => {
  const f = await fixture()
  try {
    for (const intent of [{kind:'invite',osuId:'101',name:'Synthetic'}, {kind:'move',osuId:'999',slot:'2'}, {kind:'kick',osuId:'999'}, {kind:'team',osuId:'101',team:'green'}, {kind:'move',osuId:'101',slot:'17'}, {kind:'invite',osuId:'123\nQUIT',name:'X'}, {kind:'invite',osuId:'123',name:'X\nQUIT'}]) assert.throws(() => f.session.previewLobby({...f.target(),intent}))
    const preview = f.session.previewLobby({...f.target(),intent:{kind:'kick',osuId:'101'}})
    f.session.logout()
    assert.throws(() => f.session.executeLobby({roomId:9,roomEpoch:1,token:preview.token,reviewed:true,playerName:'Synthetic'}))
    assert.equal(f.sent.some(line=>/:!mp (invite|move|team|kick) /.test(line)), false)
  } finally { await f.close() }
})

test('occupied destinations and non-team modes block player mutations', async () => {
  for (const mode of ['occupied','solo']) {
    const f = await fixture(mode)
    try {
      const intent = mode === 'occupied' ? {kind:'move',osuId:'101',slot:'2'} : {kind:'team',osuId:'101',team:'red'}
      assert.throws(() => f.session.previewLobby({...f.target(),intent}))
      assert.equal(f.sent.some(line=>/:!mp (move|team) /.test(line)), false)
    } finally { await f.close() }
  }
})
