import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { IrcSession } from '../src/main/irc.ts'
import { Lines } from '../src/main/protocol.ts'
import { mpCommand } from '../src/shared/mp-command.ts'
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn: () => boolean) { for (let i = 0; i < 200; i++) { if (fn()) return; await delay(10) }; throw new Error('Timed out') }
async function fixture(empty: boolean | 'no-mods' = false, durationLookup: (id: number) => Promise<number | null> = async () => null) {
  const sent: string[] = [], sockets = new Set<net.Socket>()
  let peer: net.Socket
  const server = net.createServer(socket => {
    peer = socket; sockets.add(socket); socket.on('close', () => sockets.delete(socket))
    const parser = new Lines()
    socket.on('data', chunk => { for (const line of parser.feed(chunk)) {
      sent.push(line)
      if (line.startsWith('USER ')) socket.write(':server 001 Example :welcome\n')
      if (line.startsWith('JOIN ')) socket.write(`:server 366 Example ${line.slice(5)} :End\n`)
      const channel = line.split(' ')[1]
      if (line.endsWith(':!mp settings')) socket.write([
        `Room name: Synthetic, History: https://osu.ppy.sh/mp/${channel.slice(4)}`,
        ...(empty === true ? ['Team mode: TeamVs, Win condition: ScoreV2', 'Players: 0'] : ['Beatmap: https://osu.ppy.sh/b/123 Synthetic', 'Team mode: TeamVs, Win condition: ScoreV2',
        ...(empty === 'no-mods' ? [] : ['Active mods: None']), 'Players: 1', 'Slot 1 Ready https://osu.ppy.sh/u/101 Synthetic [Host / Team Red]'])
      ].map(body => `:BanchoBot PRIVMSG ${channel} :${body}\n`).join(''))
      if (line.endsWith(':!mp listrefs')) socket.write(`:BanchoBot PRIVMSG ${channel} :Match referees: Example\n`)
    } })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const session = new IrcSession(() => net.createConnection({ host: '127.0.0.1', port: (server.address() as net.AddressInfo).port }), { floodMs: 15, retryBaseMs: 30 }, durationLookup)
  session.login({ username: 'Example', password: 'SYNTHETIC_ONLY' })
  await until(() => session.state.connection === 'online')
  const target = () => ({ roomId: session.state.room!.id, roomEpoch: session.state.room!.epoch })
  session.join('9'); await until(() => Boolean(session.state.room?.joined))
  async function refresh() {
    await delay(20); session.query({ ...target(), kind: 'settings' }); await until(() => session.state.room?.syncState === (empty ? 'partial' : 'complete'))
    await delay(20); session.query({ ...target(), kind: 'listrefs' }); await until(() => session.state.room?.referee === 'listed'); await delay(20)
  }
  return { session, sent, target, refresh, peer: () => peer, async close() { session.logout(); for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}

test('manual mp builder rejects injection, invalid IDs, unknown mods and conflicts', () => {
  assert.equal(mpCommand({ kind: 'map', beatmapId: '123' }), '!mp map 123')
  assert.equal(mpCommand({ kind: 'mods', mods: [] }), '!mp mods None')
  assert.equal(mpCommand({ kind: 'mods', mods: ['HR', 'HD'] }), '!mp mods HD HR')
  assert.equal(mpCommand({ kind: 'mods', mods: ['Freemod'] }), '!mp mods Freemod')
  for (const beatmapId of ['0', '-1', '1\n!mp close', '1 0', '9007199254740992', 'https://osu.ppy.sh/b/1', 1]) assert.throws(() => mpCommand({ kind: 'map', beatmapId }))
  for (const mods of [['Unknown'], ['HD', 'HD'], ['DT', 'HT'], ['NC', 'DT'], ['EZ', 'HR'], ['NF', 'PF'], ['SD', 'PF'], ['HD\r\nQUIT'], 'HD']) assert.throws(() => mpCommand({ kind: 'mods', mods }))
  for (const kind of ['close', 'password', 'start\nQUIT']) assert.throws(() => mpCommand({ kind }))
})

test('four manual commands require scoped one-use preview and explicit confirmation; no success inference', async () => {
  const f = await fixture()
  try {
    assert.throws(() => f.session.previewMp({ ...f.target(), intent: { kind: 'start' } }))
    for (const intent of [{ kind: 'map', beatmapId: '456' }, { kind: 'mods', mods: ['HD', 'HR'] }, { kind: 'start' }, { kind: 'abort' }]) {
      await f.refresh()
      const preview = f.session.previewMp({ ...f.target(), intent })
      const before = f.sent.length
      await delay(20); assert.equal(f.sent.length, before, 'preview must not send')
      f.session.executeMp({ ...f.target(), token: preview.token, reviewed: true, command: '!mp close' })
      await until(() => f.sent.includes(`PRIVMSG #mp_9 :${preview.command}`))
      assert.equal(f.session.state.room?.syncState, 'stale')
      assert.equal(f.session.state.room?.referee, 'unknown')
      assert.ok(f.session.state.messages.some(m => m.text === preview.command && m.delivery === 'unconfirmed'))
      assert.throws(() => f.session.executeMp({ ...f.target(), token: preview.token, reviewed: true }))
      assert.throws(() => f.session.previewMp({ ...f.target(), intent }))
      const operation = f.session.state.operations!.records.at(-1)!
      f.session.reviewOperation({ id: operation.id, reviewed: true })
    }
    assert.equal(f.sent.filter(line => /:!mp (?:map|mods|start|abort)(?: |$)/.test(line)).length, 4)
    assert.ok(!f.sent.some(line => line.includes('!mp close')))
  } finally { await f.close() }
})

test('changed snapshots, unchecked confirmation, wrong epoch, room switching and disconnect invalidate previews', async () => {
  const f = await fixture()
  try {
    await f.refresh()
    let preview = f.session.previewMp({ ...f.target(), intent: { kind: 'start' } })
    assert.throws(() => f.session.executeMp({ ...f.target(), token: preview.token, reviewed: false }))
    assert.throws(() => f.session.executeMp({ ...f.target(), token: preview.token, reviewed: true }))
    preview = f.session.previewMp({ ...f.target(), intent: { kind: 'start' } })
    f.peer().write(':BanchoBot PRIVMSG #mp_9 :Synthetic room update.\n')
    await until(() => f.session.state.room?.syncState !== 'complete')
    assert.throws(() => f.session.executeMp({ ...f.target(), token: preview.token, reviewed: true }))
    await until(() => f.session.state.pending === null)
    await f.refresh()
    preview = f.session.previewMp({ ...f.target(), intent: { kind: 'abort' } })
    assert.throws(() => f.session.executeMp({ ...f.target(), roomEpoch: -1, token: preview.token, reviewed: true }))
    preview = f.session.previewMp({ ...f.target(), intent: { kind: 'abort' } })
    f.session.selectRoom(f.target())
    assert.throws(() => f.session.executeMp({ ...f.target(), token: preview.token, reviewed: true }))
    preview = f.session.previewMp({ ...f.target(), intent: { kind: 'abort' } })
    const oldTarget = f.target()
    f.peer().destroy()
    await until(() => f.session.state.connection !== 'online')
    assert.throws(() => f.session.executeMp({ ...oldTarget, token: preview.token, reviewed: true }))
    await until(() => f.session.state.connection === 'online' && f.session.state.pending === null)
    assert.ok(!f.sent.some(line => /:!mp (?:map|mods|start|abort)(?: |$)/.test(line)))
  } finally { await f.close() }
})

test('freshness, referee permission, empty lobby, active play and send failure gates fail closed', async () => {
  const f = await fixture()
  try {
    await f.refresh()
    // state getter is Main-internal; renderer only receives cloned IPC snapshots.
    const room = f.session.state.room!
    room.referee = 'unknown'; assert.throws(() => f.session.previewMp({ ...f.target(), intent: { kind: 'start' } }))
    room.referee = 'listed'; room.observedAt = new Date(Date.now() - 11000).toISOString()
    assert.throws(() => f.session.previewMp({ ...f.target(), intent: { kind: 'abort' } }))
    await f.refresh()
    const expiring = f.session.previewMp({ ...f.target(), intent: { kind: 'abort' } })
    ;(f.session as unknown as { mpPreview: { deadline: number } }).mpPreview.deadline = performance.now() - 1
    assert.throws(() => f.session.executeMp({ ...f.target(), token: expiring.token, reviewed: true }))
    room.slots = []; assert.throws(() => f.session.previewMp({ ...f.target(), intent: { kind: 'start' } }))
    await f.refresh()
    room.slots[0].status = 'Playing'
    assert.throws(() => f.session.previewMp({ ...f.target(), intent: { kind: 'map', beatmapId: '1' } }))
    const preview = f.session.previewMp({ ...f.target(), intent: { kind: 'abort' } })
    const socket = (f.session as unknown as { socket: net.Socket }).socket
    const originalWrite = socket.write
    socket.write = (() => { throw new Error('Synthetic write failure') }) as typeof socket.write
    assert.throws(() => f.session.executeMp({ ...f.target(), token: preview.token, reviewed: true }))
    socket.write = originalWrite
    assert.throws(() => f.session.executeMp({ ...f.target(), token: preview.token, reviewed: true }))
    assert.equal(room.syncState, 'stale')
  } finally { await f.close() }
})

test('website relay uses the existing verified room transport and never accepts raw IRC', async () => {
  const f = await fixture()
  try {
    assert.throws(() => f.session.relaySend({...f.target(), text: '!mp map 456 0'}))
    await f.refresh()
    assert.throws(() => f.session.relaySend({...f.target(), text: '!mp password secret'}))
    f.session.relaySend({...f.target(), text: '!mp map 456 0'})
    await until(() => f.sent.includes('PRIVMSG #mp_9 :!mp map 456 0'))
    assert.equal(f.sent.filter(line => line.endsWith(':!mp map 456 0')).length, 1)
    assert.ok(f.session.state.messages.some(m => m.text === '!mp map 456 0' && m.delivery === 'unconfirmed'))
    assert.throws(() => f.session.relaySend({...f.target(), roomEpoch: -1, text: '!mp abort'}))
  } finally {await f.close()}
})

test('Main evidence blocks forged complete state and obsolete connection generations', async () => {
  const f = await fixture()
  try {
    await f.refresh()
    const internals = f.session as unknown as { generation: number }
    internals.generation++
    assert.throws(() => f.session.previewMp({ ...f.target(), intent: { kind: 'abort' } }))
    internals.generation--
    const room = f.session.state.room!
    const originalEpoch = room.epoch
    room.epoch++
    assert.throws(() => f.session.previewMp({ ...f.target(), intent: { kind: 'abort' } }))
    room.epoch = originalEpoch
    assert.ok(f.session.previewMp({ ...f.target(), intent: { kind: 'abort' } }).token)
  } finally { await f.close() }
})
test('observed empty-room format permits map replacement without inferring missing mods', async () => {
  const f = await fixture(true)
  try {
    await f.refresh()
    assert.equal(f.session.state.room!.mods, null)
    assert.throws(() => f.session.previewMp({ ...f.target(), intent: { kind: 'start' } }))
    assert.throws(() => f.session.previewMp({ ...f.target(), intent: { kind: 'mods', mods: [] } }))
    const preview = f.session.previewMp({ ...f.target(), intent: { kind: 'map', beatmapId: '456' } })
    f.session.executeMp({ ...f.target(), token: preview.token, reviewed: true })
    await until(() => f.sent.includes('PRIVMSG #mp_9 :!mp map 456'))
    assert.equal(f.sent.filter(line => line === 'PRIVMSG #mp_9 :!mp map 456').length, 1)
  } finally { await f.close() }
})
test('explicit mods replacement does not require old mods but start still does', async () => {
  const f = await fixture('no-mods')
  try {
    await f.refresh()
    assert.equal(f.session.state.room!.mods, null)
    assert.throws(() => f.session.previewMp({ ...f.target(), intent: { kind: 'start' } }))
    const preview = f.session.previewMp({ ...f.target(), intent: { kind: 'mods', mods: ['HD'] } })
    f.session.executeMp({ ...f.target(), token: preview.token, reviewed: true })
    await until(() => f.sent.includes('PRIVMSG #mp_9 :!mp mods HD'))
    assert.equal(f.session.state.room!.mods, null, 'sending must not infer observed effect')
    assert.throws(() => f.session.executeMp({ ...f.target(), token: preview.token, reviewed: true }))
  } finally { await f.close() }
})
test('trusted match start refreshes player settings and retains phase; fake start cannot', async () => {
  const f = await fixture()
  try {
    await f.refresh()
    const before = f.sent.filter(line => line.endsWith(':!mp settings')).length
    f.peer().write(':Someone PRIVMSG #mp_9 :The match has started!\n')
    await delay(40)
    assert.equal(f.session.state.room!.phase, 'unknown')
    assert.equal(f.sent.filter(line => line.endsWith(':!mp settings')).length, before)
    f.peer().write(':BanchoBot PRIVMSG #mp_9 :The match has started!\n')
    await until(() => f.sent.filter(line => line.endsWith(':!mp settings')).length === before + 1 && f.session.state.room!.syncState === 'complete')
    assert.equal(f.session.state.room!.phase, 'playing')
    assert.equal(f.session.state.room!.match!.beatmap!.id, 123)
    assert.deepEqual(f.session.state.room!.match!.mods, [])
    assert.equal(f.session.state.room!.slots[0].osuId, 101)
    f.peer().write(':BanchoBot PRIVMSG #mp_9 :Aborted the match\n')
    await until(() => f.session.state.room!.phase === 'idle' && f.session.state.room!.syncState === 'complete')
    assert.equal(f.session.state.room!.match, null)
    assert.equal(f.sent.some(line => /:!mp (start|abort)/.test(line)), false)
  } finally { await f.close() }
})

test('late duration response cannot attach to a different room epoch', async () => {
  let resolve!: (value: number) => void
  const f = await fixture(false, () => new Promise<number>(done => { resolve = done }))
  try {
    await f.refresh()
    f.session.state.room!.epoch++
    resolve(120000)
    await delay(20)
    assert.equal(f.session.state.room!.duration, null)
  } finally { await f.close() }
})

test('timer controls work in a verified empty room without inventing map or mods', async () => {
  const f = await fixture(true)
  try {
    for (const intent of [{ kind: 'timer', seconds: '30' }, { kind: 'aborttimer' }]) {
      await f.refresh()
      const preview = f.session.previewMp({ ...f.target(), intent })
      f.session.executeMp({ ...f.target(), token: preview.token, reviewed: true })
      await until(() => f.sent.includes(`PRIVMSG #mp_9 :${preview.command}`))
      assert.throws(() => f.session.executeMp({ ...f.target(), token: preview.token, reviewed: true }))
      assert.equal(f.session.state.room?.phase, 'unknown')
    }
    await f.refresh()
    assert.throws(() => f.session.previewMp({ ...f.target(), intent: { kind: 'start', seconds: '10' } }))
  } finally { await f.close() }
})

test('trusted countdowns, cancellation, external start and reconnect do not replay or infer success', async () => {
  const f = await fixture()
  try {
    await f.refresh()
    f.peer().write(':Other PRIVMSG #mp_9 :Match starts in 10 seconds\n:BanchoBot PRIVMSG #mp_10 :Countdown ends in 30 seconds\n')
    await delay(30)
    assert.equal(f.session.state.room?.startCountdown === null, true)
    assert.equal(f.session.state.room?.timer === null, true)
    const preview = f.session.previewMp({ ...f.target(), intent: { kind: 'start', seconds: '10' } })
    f.session.executeMp({ ...f.target(), token: preview.token, reviewed: true })
    await until(() => f.sent.includes('PRIVMSG #mp_9 :!mp start 10'))
    assert.equal(f.session.state.room?.startCountdown === null, true, 'write is not acknowledgement')
    f.peer().write(':BanchoBot PRIVMSG #mp_9 :Match starts in 10 seconds\n:BanchoBot PRIVMSG #mp_9 :Countdown ends in 30 seconds\n')
    await until(() => f.session.state.room?.timer?.status === 'active')
    assert.equal(f.session.state.room?.startCountdown?.status, 'active')
    assert.notEqual(f.session.state.room?.phase, 'playing')
    await f.refresh()
    assert.throws(() => f.session.previewMp({ ...f.target(), intent: { kind: 'map', beatmapId: '456' } }))
    const cancel = f.session.previewMp({ ...f.target(), intent: { kind: 'aborttimer' } })
    f.peer().write(':BanchoBot PRIVMSG #mp_9 :Match starts in 5 seconds\n')
    await delay(30)
    f.session.executeMp({ ...f.target(), token: cancel.token, reviewed: true })
    assert.equal(f.session.state.room?.startCountdown?.status, 'unknown')
    assert.equal(f.session.state.room?.timer?.status, 'unknown')
    await f.refresh()
    assert.throws(() => f.session.previewMp({ ...f.target(), intent: { kind: 'map', beatmapId: '456' } }), /倒數/)
    f.peer().write(':BanchoBot PRIVMSG #mp_9 :Aborted the match start timer\n')
    await until(() => f.session.state.room?.startCountdown?.status === 'cancelled')
    assert.equal(f.session.state.room?.timer?.status, 'unknown', 'one reply must not confirm both timers')
    f.peer().write(':BanchoBot PRIVMSG #mp_9 :The match has started!\n')
    await until(() => f.session.state.room?.phase === 'playing')
    assert.equal(f.session.state.room?.startCountdown === null, true)
    const writes = f.sent.filter(line => /:!mp (start|timer|aborttimer)/.test(line))
    f.peer().destroy()
    await until(() => f.session.state.connection !== 'online')
    assert.equal(f.session.state.room?.timer === null, true)
    await until(() => f.session.state.connection === 'online' && f.session.state.room?.joined === true)
    assert.deepEqual(f.sent.filter(line => /:!mp (start|timer|aborttimer)/.test(line)), writes)
  } finally { await f.close() }
})

 test('external map or lineup changes invalidate countdown observations and previews', async () => {
  const f = await fixture()
  try {
    for (const change of ['Changed beatmap to https://osu.ppy.sh/b/456 Synthetic', 'Synthetic joined in slot 2']) {
      await f.refresh()
      f.peer().write(':BanchoBot PRIVMSG #mp_9 :Match starts in 30 seconds\n')
      await until(() => f.session.state.room?.startCountdown?.status === 'active')
      const cancel = f.session.previewMp({ ...f.target(), intent: { kind: 'aborttimer' } })
      f.peer().write(`:BanchoBot PRIVMSG #mp_9 :${change}\n`)
      await until(() => f.session.state.room?.startCountdown?.status === 'unknown')
      assert.throws(() => f.session.executeMp({ ...f.target(), token: cancel.token, reviewed: true }))
      await until(() => f.session.state.pending === null)
    }
    assert.equal(f.sent.some(line => line.includes(':!mp aborttimer')), false)
  } finally { await f.close() }
})


test('website relay uses intent-specific empty-room evidence without bypassing send checks', async () => {
  for (const text of ['!mp map 75', '!mp timer 30', '!mp aborttimer']) {
    const f = await fixture(true)
    try {
      await f.refresh()
      assert.equal(f.session.relayReady(f.target(), text), true)
      assert.equal(f.session.relayReady(f.target(), '!mp start 5'), false)
      assert.equal(f.session.relayReady(f.target(), '!mp mods HD'), false)
      assert.equal(f.session.relayReady(f.target(), 'PASS invalid'), false)
      assert.throws(() => f.session.relaySend({ ...f.target(), text: '!mp start 5' }))
      f.session.relaySend({ ...f.target(), text })
      await until(() => f.sent.includes(`PRIVMSG #mp_9 :${text}`))
      assert.equal(f.sent.filter(line => line === `PRIVMSG #mp_9 :${text}`).length, 1)
      assert.equal(f.session.state.room!.beatmap, null)
      assert.equal(f.session.state.room!.mods, null)
    } finally { await f.close() }
  }
})

test('website explicit Mods replacement tolerates omitted old Mods, but start remains blocked', async () => {
  const f = await fixture('no-mods')
  try {
    await f.refresh()
    assert.equal(f.session.relayReady(f.target(), '!mp mods HD'), true)
    assert.equal(f.session.relayReady(f.target(), '!mp start 5'), false)
    assert.throws(() => f.session.relaySend({ ...f.target(), text: '!mp start 5' }))
    f.session.relaySend({ ...f.target(), text: '!mp mods HD' })
    await until(() => f.sent.includes('PRIVMSG #mp_9 :!mp mods HD'))
    assert.equal(f.sent.filter(line => line === 'PRIVMSG #mp_9 :!mp mods HD').length, 1)
    assert.equal(f.session.state.room!.mods, null)
  } finally { await f.close() }
})
