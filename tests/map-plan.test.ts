import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { IrcSession } from '../src/main/irc.ts'
import { Lines } from '../src/main/protocol.ts'
import { mapProfile, profileCommands } from '../src/shared/map-profile.ts'
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn: () => boolean) { for (let i = 0; i < 400; i++) { if (fn()) return; await pause(10) } throw new Error('Plan timed out') }
const profile = { beatmapId: '456', roomMods: ['HD'], freemod: false, individualModsPolicy: 'disabled', ruleset: 'current', revision: 'v1' }
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
        'Room name: Synthetic, History: https://osu.ppy.sh/mp/9', `Beatmap: https://osu.ppy.sh/b/${map} Synthetic`, 'Team mode: TeamVs, Win condition: ScoreV2', `Active mods: ${mods}`, 'Players: 1', 'Slot 1 Ready https://osu.ppy.sh/u/101 Synthetic [Host / Team Red]'
      ].map(body => `:BanchoBot PRIVMSG #mp_9 :${body}\n`).join(''))
      if (line.endsWith(':!mp listrefs')) socket.write(':BanchoBot PRIVMSG #mp_9 :Match referees: Example\n')
    } })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const session = new IrcSession(() => net.createConnection({ host: '127.0.0.1', port: (server.address() as net.AddressInfo).port }), { floodMs: 10, queryMs: 300, retryBaseMs: 20 })
  session.login({ username: 'Example', password: 'SYNTHETIC_ONLY' }); await until(() => session.state.connection === 'online')
  session.join('9'); await until(() => Boolean(session.state.room?.joined)); await pause(20)
  const target = () => ({ roomId: 9, roomEpoch: session.state.room!.epoch })
  session.query({ ...target(), kind: 'settings' }); await until(() => session.state.room?.syncState === 'complete'); await pause(20)
  session.query({ ...target(), kind: 'listrefs' }); await until(() => session.state.room?.referee === 'listed'); await pause(20)
  const start = (p = profile, individualReviewed = false) => {
    const preview = session.previewProfile({ ...target(), profile: p })
    session.executeProfile({ ...target(), token: preview.token, reviewed: true, individualReviewed }); return preview
  }
  return { session, sent, start, target, peer: () => peer, async close() { session.logout(); for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}

test('manual profiles preserve optional NF, reject conflicting or unknown policy and require explicit ruleset', () => {
  assert.deepEqual(profileCommands(mapProfile(profile)), ['!mp map 456', '!mp mods HD'])
  assert.deepEqual(profileCommands(mapProfile({ ...profile, roomMods: ['NF'], freemod: true, individualModsPolicy: 'manual' })), ['!mp map 456', '!mp mods NF Freemod'])
  for (const bad of [{ roomMods: ['DT', 'HT'] }, { freemod: true }, { individualModsPolicy: 'unknown' }, { ruleset: 0 }, { revision: '' }, { beatmapId: '4\nQUIT' }, { roomMods: ['Freemod'] }]) assert.throws(() => mapProfile({ ...profile, ...bad }))
})
test('map then mods execute once with new query-scoped observations; duplicate execution and other mutations are blocked', async () => {
  const f = await fixture()
  try {
    const preview = f.start()
    assert.throws(() => f.session.executeProfile({ ...f.target(), token: preview.token, reviewed: true }))
    await until(() => f.session.state.mapPlan?.state === 'observed')
    assert.deepEqual(f.session.state.mapPlan!.steps.map(s => s.state), ['observed', 'observed'])
    assert.deepEqual(f.sent.filter(s => /:!mp (map|mods) /.test(s)), ['PRIVMSG #mp_9 :!mp map 456', 'PRIVMSG #mp_9 :!mp mods HD'])
    const mapIndex = f.sent.indexOf('PRIVMSG #mp_9 :!mp map 456'), modsIndex = f.sent.indexOf('PRIVMSG #mp_9 :!mp mods HD')
    assert.ok(f.sent.slice(mapIndex + 1, modsIndex).includes('PRIVMSG #mp_9 :!mp settings'))
    assert.equal(f.session.state.operations!.records.at(-1)!.state, 'observed')
    f.session.previewMp({ ...f.target(), intent: { kind: 'start' } })
  } finally { await f.close() }
})
test('wrong map, missing response, changed mods and disconnect stop remaining steps without replay', async () => {
  for (const mode of ['wrong-map', 'wrong-mods', 'timeout', 'disconnect']) {
    const f = await fixture(mode)
    try {
      f.start(); await until(() => f.session.state.mapPlan?.state === 'unknown')
      assert.equal(f.sent.filter(s => s.includes(':!mp map ')).length, 1)
      assert.equal(f.sent.filter(s => s.includes(':!mp mods ')).length, mode === 'wrong-mods' ? 1 : 0)
      if (mode === 'wrong-mods') assert.equal(f.session.state.mapPlan!.steps[0].state, 'observed')
      assert.throws(() => f.session.previewMp({ ...f.target(), intent: { kind: 'start' } }))
      const count = f.sent.filter(s => /:!mp (map|mods) /.test(s)).length
      await pause(100); assert.equal(f.sent.filter(s => /:!mp (map|mods) /.test(s)).length, count)
    } finally { await f.close() }
  }
})
test('cancel and manual review stop unsent steps; FM confirmation and stale previews cannot be bypassed', async () => {
  const f = await fixture('timeout')
  try {
    const fm = { ...profile, freemod: true, individualModsPolicy: 'manual' }
    const preview = f.session.previewProfile({ ...f.target(), profile: fm })
    assert.throws(() => f.session.executeProfile({ ...f.target(), token: preview.token, reviewed: true, individualReviewed: false }))
    assert.equal(f.sent.some(s => s.includes(':!mp map ')), false)
    f.start(fm, true)
    f.session.reviewOperation({ id: f.session.state.mapPlan!.id, reviewed: true })
    assert.equal(f.session.state.mapPlan!.state, 'unknown')
    assert.equal(f.session.state.mapPlan!.steps[1].state, 'cancelled')
    await pause(150); assert.equal(f.sent.some(s => s.includes(':!mp mods ')), false)
  } finally { await f.close() }
})
