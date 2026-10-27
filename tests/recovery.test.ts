import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { IrcSession } from '../src/main/irc.ts'
import { Lines } from '../src/main/protocol.ts'
import { SettingsCollector, blankObservation } from '../src/main/settings.ts'
import type { Room } from '../src/shared/types.ts'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate: () => boolean) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(10) }
  throw new Error('condition timed out')
}
async function fixture(reply?: (line: string, socket: net.Socket) => void, timing = {}) {
  const sockets = new Set<net.Socket>(), sent: string[] = [], sentAt: number[] = []
  let peer: net.Socket
  const server = net.createServer(socket => {
    peer = socket; sockets.add(socket); socket.on('close', () => sockets.delete(socket))
    const parser = new Lines()
    socket.on('data', chunk => { for (const line of parser.feed(chunk)) {
      sent.push(line); sentAt.push(Date.now())
      if (reply) reply(line, socket)
      else {
        if (line.startsWith('USER ')) socket.write(':server 001 Example :welcome\n')
        if (line.startsWith('JOIN ')) socket.write(`:server 366 Example ${line.slice(5)} :End\n`)
        if (line.endsWith(':!mp settings')) socket.write(':BanchoBot PRIVMSG #mp_9 :Room name: test, History: https://osu.ppy.sh/mp/9\n:BanchoBot PRIVMSG #mp_9 :Team mode: TeamVs, Win condition: ScoreV2\n:BanchoBot PRIVMSG #mp_9 :Players: 0\n')
        if (line.endsWith(':!mp listrefs')) socket.write(':BanchoBot PRIVMSG #mp_9 :Match referees:\n:BanchoBot PRIVMSG #mp_9 :Example\n')
        if (line.startsWith('PING :')) socket.write(':server PONG server :' + line.slice(6) + '\n')
      }
    } })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  const session = new IrcSession(() => net.createConnection({ host: '127.0.0.1', port }), { floodMs: 20, queryMs: 150, loginMs: 200, retryBaseMs: 20, retryMaxMs: 80, ...timing })
  return { session, sent, sentAt, peer: () => peer, async close() { session.logout(); for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}
async function login(session: IrcSession) {
  session.login({ username: 'Example', password: 'SYNTHETIC_ONLY' }); await until(() => session.state.connection === 'online')
}
async function join(session: IrcSession) { session.join('9'); await until(() => Boolean(session.state.room?.joined)); await delay(30) }
function target(session: IrcSession) { return { roomId: session.state.room!.id, roomEpoch: session.state.room!.epoch } }

test('recovery preserves tabs/history but invalidates epochs and only replays JOIN and reads', async () => {
  const f = await fixture()
  try {
    await login(f.session); await join(f.session)
    const old = target(f.session)
    f.session.chat({ ...old, text: 'send once' }); await until(() => f.sent.includes('PRIVMSG #mp_9 :send once'))
    f.peer().destroy()
    await until(() => f.session.state.connection === 'reconnecting')
    assert.equal(f.session.state.room?.binding, 'unknown')
    assert.equal(f.session.state.room?.referee, 'unknown')
    assert.equal(f.session.state.room?.syncState, 'stale')
    assert.throws(() => f.session.chat({ ...old, text: 'stale draft' }))
    await until(() => f.session.state.room?.referee === 'listed')
    assert.equal(f.session.state.room?.binding, 'verified')
    assert.equal(f.session.state.room?.syncState, 'partial')
    assert.equal(f.sent.filter(l => l === 'JOIN #mp_9').length, 2)
    assert.equal(f.sent.filter(l => l === 'PRIVMSG #mp_9 :send once').length, 1)
    assert.ok(f.session.state.messages.some(m => m.text === 'send once'))
    assert.notEqual(f.session.state.room?.epoch, old.roomEpoch)
    assert.ok(!JSON.stringify(f.session.state).includes('SYNTHETIC_ONLY'))
  } finally { await f.close() }
})

test('retry budget stops after five reconnects, explicit retry resets it, logout cancels it', async () => {
  const f = await fixture((line, socket) => { if (line.startsWith('USER ')) socket.end('ERROR :try later\n') })
  try {
    f.session.login({ username: 'Example', password: 'SYNTHETIC_ONLY' })
    await until(() => f.session.state.connection === 'error')
    assert.equal(f.sent.filter(l => l.startsWith('USER ')).length, 6)
    assert.equal(f.session.state.retryAttempt, 5)
    f.session.retry(); await until(() => f.session.state.connection === 'reconnecting')
    f.session.logout(); const count = f.sent.length
    await delay(150)
    assert.equal(f.sent.length, count)
    assert.equal(f.session.state.connection, 'offline')
  } finally { await f.close() }
})

test('suspend pauses retries; resume revalidates even when retryAttempt is zero', async () => {
  const f = await fixture()
  try {
    await login(f.session); await join(f.session)
    f.session.suspend(); assert.equal(f.session.state.connection, 'suspended')
    const count = f.sent.length
    await delay(150); assert.equal(f.sent.length, count)
    f.session.resume(); await until(() => f.session.state.room?.referee === 'listed')
    assert.equal(f.session.state.retryAttempt, 0)
    f.session.logout(); f.session.resume(); assert.equal(f.session.state.connection, 'offline')
  } finally { await f.close() }
})

test('heartbeat accepts matching PONG; absent or wrong PONG loses connection', async () => {
  const f = await fixture(undefined, { heartbeatMs: 30, heartbeatTimeoutMs: 25 })
  try { await login(f.session); await delay(150); assert.equal(f.session.state.connection, 'online'); assert.equal(f.sent.filter(l => l.startsWith('USER ')).length, 1) } finally { await f.close() }
  const bad = await fixture((line, socket) => {
    if (line.startsWith('USER ')) socket.write(':server 001 Example :welcome\n')
    if (line.startsWith('PING ')) socket.write(':server PONG server :wrong\n')
  }, { heartbeatMs: 30, heartbeatTimeoutMs: 25, retryBaseMs: 100 })
  try { await login(bad.session); await until(() => bad.session.state.connection === 'reconnecting'); assert.match(bad.session.state.error!, /心跳/) } finally { await bad.close() }
})

test('channel names, bounded private inbox, member completion sources and bot guard', async () => {
  const f = await fixture()
  try {
    await login(f.session)
    for (const name of ['#osu\r\nQUIT', '#osu,#other', 'irc://host']) assert.throws(() => f.session.openConversation({ kind: 'channel', name }))
    f.session.openConversation({ kind: 'channel', name: '#osu' })
    await until(() => Boolean(f.session.state.room?.joined))
    const channel = target(f.session)
    f.peer().write(':server 353 Example = #osu :@Example Other\n')
    await until(() => f.session.state.room!.members.includes('Other'))
    f.peer().write(':Other NICK :Renamed\n')
    await until(() => f.session.state.room!.members.includes('Renamed'))
    f.peer().write(':Someone PRIVMSG Example :hello privately\n')
    await until(() => f.session.state.rooms.length === 2)
    assert.equal(f.session.state.room!.id, channel.roomId)
    const pm = f.session.state.rooms.find(r => r.channel === 'Someone')!
    f.session.selectRoom({ roomId: pm.id, roomEpoch: pm.epoch })
    assert.equal(f.session.state.messages.at(-1)?.text, 'hello privately')
    assert.equal(f.session.state.room?.kind, 'private')
    assert.throws(() => f.session.query({ ...target(f.session), kind: 'settings' }))
    await delay(30); f.session.chat({ ...target(f.session), text: 'reply' })
    await until(() => f.sent.includes('PRIVMSG Someone :reply'))
    f.session.openConversation({ kind: 'private', name: 'BanchoBot' })
    assert.throws(() => f.session.chat({ ...target(f.session), text: 'mp make unsafe' }))
  } finally { await f.close() }
})

function room(): Room { return { ...blankObservation(), id: 9, epoch: 1, channel: '#mp_9', joined: true, binding: 'unknown', referee: 'unknown', name: null, mode: null, players: null, kind: 'match', members: [] } }
const header = 'Room name: synthetic, History: https://osu.ppy.sh/mp/9'
const fields = ['Beatmap: https://osu.ppy.sh/b/123 Artist - Title', 'Team mode: TeamVs, Win condition: ScoreV2', 'Active mods: HD, HR', 'Players: 2']
const slots = ['Slot 1 Not Ready https://osu.ppy.sh/u/100 One [Host / Team Red]', 'Slot 2 Ready https://osu.ppy.sh/users/101 Two [Team Blue]']
test('settings complete requires map, mode, mods, player count, unique UID slots and matching MP', () => {
  const c = new SettingsCollector(9), r = room()
  for (const line of [header, ...fields, slots[0]]) assert.equal(c.feed(line), false)
  assert.equal(c.feed(slots[1]), true); c.apply(r)
  assert.equal(r.syncState, 'complete'); assert.equal(r.slots[0].host, true); assert.equal(r.slots[1].team, 'blue')
  assert.deepEqual(r.mods, ['HD', 'HR']); assert.equal(r.phase, 'unknown')
})
test('empty/partial, malformed, mismatched and timed-out snapshots never imply complete state', () => {
  for (const lines of [[header, 'Players: 0'], [header, ...fields, slots[0], slots[0]], [header.replace('/9', '/8'), ...fields, ...slots], [header, ...fields, slots[0]], [header, ...fields, 'Slot 17 Ready https://osu.ppy.sh/u/102 Invalid', ...slots]]) {
    const c = new SettingsCollector(9), r = room(); for (const line of lines) c.feed(line); c.apply(r); assert.equal(r.syncState, 'partial')
  }
  const c = new SettingsCollector(9), r = room(); for (const line of [header, ...fields, ...slots]) c.feed(line); c.apply(r, true); assert.equal(r.syncState, 'partial')
})


test('JOIN/PART share throttle and cancelling a queued JOIN sends neither JOIN nor PART', async () => {
  const f = await fixture(undefined, { floodMs: 80 })
  try {
    await login(f.session); await join(f.session)
    f.session.join('10'); const cancelled = target(f.session); f.session.leaveRoom(cancelled)
    f.session.join('11'); await until(() => Boolean(f.session.state.room?.joined))
    f.session.leaveRoom(target(f.session))
    await until(() => f.sent.includes('PART #mp_11'))
    assert.ok(!f.sent.includes('JOIN #mp_10')); assert.ok(!f.sent.includes('PART #mp_10'))
    const times = f.sent.flatMap((line, i) => /^(JOIN|PART|PRIVMSG) /.test(line) ? [f.sentAt[i]] : [])
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 75)
  } finally { await f.close() }
})

test('KICK disables restoration; closed tabs and failed joins cannot be resurrected by reconnect', async () => {
  const f = await fixture()
  try {
    await login(f.session); await join(f.session)
    f.session.join('10'); await until(() => Boolean(f.session.state.room?.joined)); const kicked = target(f.session)
    f.peer().write(':Operator KICK #mp_10 Example :test\n')
    await until(() => !f.session.state.room?.joined)
    f.session.selectRoom({ roomId: 9, roomEpoch: f.session.state.rooms.find(r => r.id === 9)!.epoch })
    f.peer().destroy()
    await until(() => f.session.state.room?.referee === 'listed')
    assert.equal(f.sent.filter(l => l === 'JOIN #mp_10').length, 1)
    assert.equal(f.session.state.rooms.find(r => r.id === kicked.roomId)?.joined, false)
  } finally { await f.close() }
})

test('query timeout keeps partial observations and late replies cannot complete an expired collector', async () => {
  const f = await fixture((line, socket) => {
    if (line.startsWith('USER ')) socket.write(':server 001 Example :welcome\n')
    if (line.startsWith('JOIN ')) socket.write(':server 366 Example #mp_9 :End\n')
    if (line.endsWith(':!mp settings')) socket.write(':BanchoBot PRIVMSG #mp_9 :Room name: incomplete, History: https://osu.ppy.sh/mp/9\n')
  })
  try {
    await login(f.session); await join(f.session)
    f.session.query({ ...target(f.session), kind: 'settings' })
    await until(() => f.session.state.pending === null)
    assert.equal(f.session.state.room?.syncState, 'partial'); assert.equal(f.session.state.room?.players, null)
    f.peer().write(':BanchoBot PRIVMSG #mp_9 :Players: 0\n')
    await until(() => f.session.state.messages.at(-1)?.text === 'Players: 0')
    assert.equal(f.session.state.room?.players, null); assert.equal(f.session.state.room?.syncState, 'stale')
  } finally { await f.close() }
})


test('known room changes coalesce into a read-only settings refresh without changing selection', async () => {
  const f = await fixture()
  try {
    await login(f.session); await join(f.session)
    f.peer().write(':BanchoBot PRIVMSG #mp_9 :Beatmap changed to: synthetic\n:BanchoBot PRIVMSG #mp_9 :Player joined in slot 1.\n')
    await until(() => f.session.state.room?.binding === 'verified')
    assert.equal(f.sent.filter(l => l.endsWith(':!mp settings')).length, 1)
    assert.equal(f.session.state.room?.syncState, 'partial')
    assert.equal(f.session.state.room?.id, 9)
  } finally { await f.close() }
})
