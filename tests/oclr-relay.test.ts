import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { OclrRelay } from '../src/main/oclr-relay.ts'
import { relayCommand, relayReply } from '../src/shared/relay-command.ts'
import type { OclrSession } from '../src/main/oclr.ts'
import type { IrcSession } from '../src/main/irc.ts'
import { id, meta } from './fixtures/oclr.ts'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate: () => boolean) { for (let i = 0; i < 400; i++) { if (predicate()) return; await delay(10) } throw Error('Timed out') }
function harness() {
  const requests: any[] = [], writes: any[] = []
  const irc = Object.assign(new EventEmitter(), {sessionGeneration: 1, state: {connection: 'online', username: 'Ref_Name', room: {id: 123, epoch: 1, joined: true, kind: 'match', binding: 'verified', referee: 'listed'}, messages: [] as any[]}, relayReady() {return true}, relayRefresh() {}, relaySend(input: unknown) {writes.push(input)}})
  let command: any = null, fail = false
  const oclr = Object.assign(new EventEmitter(), {sessionGeneration: 1, updatePairing(value: unknown) { this.state.pairing = value }, state: {pairing: null as any, subject: {osuId: 100, username: 'Ref Name'}, selectedFixtureId: id(101), panelState: 'fresh', relay: null as any}, updateRelay(state: unknown) {this.state.relay = state; (this as unknown as EventEmitter).emit('state')}, async relayRequest(_id: string, body: any) {requests.push(body); if (fail) throw Error('network failure'); return {value: {data: {connectionId: id(40), sequence: body.sequence ?? 0, command: body.action === 'sync' ? command : null}, meta: meta()}}}})
  const relay = new OclrRelay(oclr as unknown as OclrSession, irc as unknown as IrcSession)
  relay.refreshPairing()
  relay.confirmPairing({ token: oclr.state.pairing.token, reviewed: true })
  return {relay, oclr, irc, requests, writes, command(value: any) {command = value}, fail() {fail = true}}
}

test('relay allowlist rejects raw IRC, secret commands and line injection', () => {
  for (const value of ['!mp map 42 0', '!mp invite Player_Name', '!mp timer 30', '!mp start 5', '!mp abort', '!mp mods NF HD']) assert.equal(relayCommand(value), value)
  for (const value of ['PASS secret', '!mp password secret', '!mp make Test', '!mp map 42\r\nQUIT', '!mp invite player with space', '!mp start 0', '!mp map 4\u202e']) assert.throws(() => relayCommand(value))
})
test('only exact supported Bancho reply confirms, never an unrelated map or socket write', () => {
  assert.equal(relayReply('!mp map 42 0', 'Beatmap changed to: Song (https://osu.ppy.sh/b/42)'), 'confirmed')
  assert.equal(relayReply('!mp map 42 0', 'Beatmap changed to: Song (https://osu.ppy.sh/b/420)'), null)
  assert.equal(relayReply('!mp map 42 0', 'Song https://osu.ppy.sh/b/42'), null)
  assert.equal(relayReply('!mp map 75', 'Changed beatmap to https://osu.ppy.sh/b/75 Kenji Ninuma - DISCO PRINCE'), 'confirmed')
  assert.equal(relayReply('!mp map 75', 'Changed beatmap to https://osu.ppy.sh/b/750 Synthetic'), null)
  assert.equal(relayReply('!mp map 75', 'Player says Changed beatmap to https://osu.ppy.sh/b/75'), null)
  assert.equal(relayReply('!mp start 5', 'Started the match'), null)
})
test('relay binds explicitly, sends once, projects only bound room and correlates bot evidence', async () => {
  const f = harness(); try {
    await f.relay.start(); f.command({id: id(50), text: '!mp map 42 0', target: '#mp_123'})
    await until(() => f.writes.length === 1)
    f.irc.emit('message', {roomId: 999, roomEpoch: 1, message: {id: 1, kind: 'bot', sender: 'BanchoBot', text: 'Beatmap changed to: Song https://osu.ppy.sh/b/42'}})
    f.irc.emit('message', {roomId: 123, roomEpoch: 1, message: {id: 2, kind: 'chat', sender: 'BanchoBot', text: 'Beatmap changed to: Song https://osu.ppy.sh/b/42'}})
    f.irc.emit('message', {roomId: 123, roomEpoch: 1, message: {id: 3, kind: 'bot', sender: 'BanchoBot', text: 'Changed beatmap to https://osu.ppy.sh/b/42 Song'}})
    await until(() => f.requests.some(r => r.receipts?.some((receipt: any) => receipt.status === 'confirmed')))
    assert.equal(f.writes.length, 1)
    assert.deepEqual(f.requests.filter(r => r.sequence).map(r => r.sequence), [1, 2])
    const receipts = f.requests.flatMap(r => r.receipts ?? [])
    assert.deepEqual(receipts.map(r => r.status), ['sent', 'confirmed'])
    assert.equal(receipts[1].evidence.target, '#mp_123')
    f.irc.state.room.id = 999
    await until(() => f.oclr.state.relay.status === 'off')
    const lastSync = f.requests.filter(r => r.action === 'sync').at(-1)
    assert.equal(lastSync.projection.status, 'disconnected'); assert.deepEqual(lastSync.projection.messages, [])
  } finally {await f.relay.stop()}
})
test('identity mismatch, wrong command target and lost response never send or retry', async () => {
  const f = harness(); try {
    f.irc.state.username = 'Other'; await assert.rejects(f.relay.start()); f.irc.state.username = 'Ref_Name'
    f.relay.refreshPairing(); f.relay.confirmPairing({ token: f.oclr.state.pairing.token, reviewed: true })
    await f.relay.start(); f.command({id: id(50), text: '!mp map 42', target: '#mp_999'})
    await until(() => f.requests.some(r => r.receipts?.some((receipt: any) => receipt.status === 'failed')))
    assert.equal(f.writes.length, 0)
    f.fail(); await until(() => f.oclr.state.relay.status === 'error')
    const count = f.requests.length; await delay(1100); assert.equal(f.requests.length, count)
  } finally {await f.relay.stop()}
})
test('room projection bounds each chat line and removes control characters without failing sync', async () => {
  const f = harness(); try {
    f.irc.state.messages = [
      {id: 1, sender: 'Player\tName', text: '\u202ehello\tworld' + 'x'.repeat(1100), time: '2026-10-29T12:00:00.000Z'},
      {id: 2, sender: 'Player', text: '\t\n', time: '2026-10-29T12:00:00.000Z'},
      {id: 3, sender: 'R'.repeat(150), text: 'ready', time: '2026-10-29T12:00:00.000Z'},
    ]
    await f.relay.start()
    await until(() => f.requests.some(r => r.action === 'sync'))
    const messages = f.requests.find(r => r.action === 'sync').projection.messages
    assert.equal(messages.length, 2)
    assert.equal(messages[0].sender, 'PlayerName')
    assert.equal(messages[0].text.length, 1000)
    assert.ok(messages[0].text.startsWith('helloworld'))
    assert.equal(messages[1].sender.length, 100)
  } finally {await f.relay.stop()}
})
test('credential-shaped messages and confirmation evidence never leave the local relay', async () => {
  const f = harness(); try {
    const sensitive = [
      '!mp password SYNTHETIC_PASSWORD', 'access_token: SYNTHETIC_ACCESS',
      'refresh_token=SYNTHETIC_REFRESH', 'code_verifier: SYNTHETIC_VERIFIER',
      'oclr_desk_at_SYNTHETIC_ACCESS', 'oclr_desk_rt_SYNTHETIC_REFRESH',
      'PASS SYNTHETIC_IRC', ' AUTHENTICATE SYNTHETIC_AUTH',
      'pass\tSYNTHETIC_IRC', 'access_\u202etoken=SYNTHETIC_FORMAT',
      'x'.repeat(1100) + ' password=SYNTHETIC_SUFFIX',
    ]
    f.irc.state.messages = sensitive.map((text, i) => ({id: i + 1, sender: 'Player', text, time: '2026-10-29T12:00:00.000Z'}))
    f.irc.state.messages.push({id: 20, sender: 'oclr_desk_at_SYNTHETIC_SENDER', text: 'hello', time: '2026-10-29T12:00:00.000Z'})
    f.irc.state.messages.push({id: 21, sender: 'Player', text: 'ready', time: '2026-10-29T12:00:00.000Z'})
    await f.relay.start(); f.command({id: id(50), text: '!mp map 42 0', target: '#mp_123'})
    await until(() => f.writes.length === 1)
    f.irc.emit('message', {roomId: 123, roomEpoch: 1, message: {id: 30, kind: 'bot', sender: 'BanchoBot', text: 'Beatmap changed to: Song (https://osu.ppy.sh/b/42) oclr_desk_at_SYNTHETIC_EVIDENCE'}})
    await until(() => f.requests.filter(r => r.action === 'sync').length === 2)
    const syncs = f.requests.filter(r => r.action === 'sync')
    for (const sync of syncs) assert.deepEqual(sync.projection.messages.map((m: any) => m.text), ['ready'])
    assert.equal(JSON.stringify(syncs).includes('SYNTHETIC_'), false)
    assert.deepEqual(syncs.flatMap(r => r.receipts).map(r => r.status), ['sent'])
  } finally {await f.relay.stop()}
})
test('same nickname with a different OCLR subject invalidates binding', async () => {
  const f = harness()
  try {
    await f.relay.start()
    f.oclr.state.subject.osuId = 200
    f.oclr.emit('state')
    assert.equal(f.oclr.state.relay.status, 'off')
    assert.equal(f.writes.length, 0)
  } finally { await f.relay.stop() }
})
test('late bind cannot attach to a changed room or subject', async () => {
  for (const change of ['room', 'subject']) {
    const f = harness()
    let release!: () => void
    const original = f.oclr.relayRequest.bind(f.oclr)
    f.oclr.relayRequest = async (fixture, body) => {
      if (body.action === 'bind') await new Promise<void>(resolve => { release = resolve })
      return original(fixture, body)
    }
    try {
      const starting = f.relay.start()
      if (change === 'room') f.irc.state.room.epoch++
      else f.oclr.state.subject.osuId++
      release(); await starting
      assert.equal(f.oclr.state.relay.status, change === 'room' ? 'error' : 'off')
      assert.equal(f.writes.length, 0)
      assert.equal(f.requests.filter(request => request.action === 'sync').length, 0)
    } finally { await f.relay.stop() }
  }
})

test('unreviewed same nickname never binds; reconnect invalidates review before late sync can send', async () => {
  const f = harness()
  try {
    f.irc.sessionGeneration++
    await assert.rejects(f.relay.start())
    assert.equal(f.requests.length, 0)
    f.relay.confirmPairing({ token: f.oclr.state.pairing.token, reviewed: true })
    let release!: () => void
    const original = f.oclr.relayRequest.bind(f.oclr)
    f.oclr.relayRequest = async (fixture, body) => {
      if (body.action === 'sync') await new Promise<void>(resolve => { release = resolve })
      return original(fixture, body)
    }
    await f.relay.start()
    f.command({ id: id(70), text: '!mp start', target: '#mp_123' })
    await until(() => Boolean(release))
    // Even without a renderer/state event, Main checks the actual login generation.
    f.irc.sessionGeneration++
    release()
    await until(() => f.oclr.state.relay.status === 'off')
    assert.equal(f.writes.length, 0)
    assert.equal(f.oclr.state.pairing.reviewed, false)
  } finally { await f.relay.stop() }
})

test('lost membership rejects late bot evidence and publishes disconnected without replay', async () => {
  const f = harness()
  try {
    await f.relay.start(); f.command({id: id(80), text: '!mp map 42', target: '#mp_123'})
    await until(() => f.writes.length === 1)
    f.irc.state.room.joined = false
    f.irc.emit('message', {roomId: 123, roomEpoch: 1, message: {id: 99, kind: 'bot', sender: 'BanchoBot', text: 'Changed beatmap to https://osu.ppy.sh/b/42 Song'}})
    await until(() => f.oclr.state.relay.status === 'off')
    const sync = f.requests.filter(r => r.action === 'sync').at(-1)
    assert.equal(sync.projection.status, 'disconnected')
    assert.deepEqual(sync.projection.messages, [])
    assert.deepEqual(sync.receipts.map((r: any) => r.status), ['sent', 'unknown'])
    assert.equal(f.writes.length, 1)
  } finally { await f.relay.stop() }
})

test('membership lost during HTTP response cannot dispatch a newly received command', async () => {
  const f = harness(); let release!: () => void
  const original = f.oclr.relayRequest.bind(f.oclr)
  f.oclr.relayRequest = async (fixture, body) => {
    if (body.action === 'sync') await new Promise<void>(resolve => { release = resolve })
    return original(fixture, body)
  }
  try {
    await f.relay.start(); f.command({id: id(81), text: '!mp abort', target: '#mp_123'})
    await until(() => Boolean(release)); f.irc.state.room.joined = false; release()
    await until(() => f.oclr.state.relay.status === 'off')
    assert.equal(f.writes.length, 0)
    assert.ok(f.requests.some(r => r.action === 'disconnect'))
  } finally { await f.relay.stop() }
})

test('conflicting relay Mods produce a failure receipt without dispatch or automatic replay', async () => {
  for (const text of ['!mp mods HD HD', '!mp mods EZ HR', '!mp mods DT HT', '!mp mods DT NC', '!mp mods NF SD', '!mp mods SD PF']) assert.throws(() => relayCommand(text))
  for (const text of ['!mp mods None', '!mp mods HD HR', '!mp mods NF NC Freemod', '!mp mods FI SO MR 4K']) assert.equal(relayCommand(text), text)
  const f = harness()
  try {
    await f.relay.start(); f.command({id:id(82),text:'!mp mods DT HT',target:'#mp_123'})
    await until(() => f.requests.some(r => r.receipts?.some((receipt:any) => receipt.commandId === id(82) && receipt.status === 'failed')))
    assert.equal(f.writes.length, 0)
    await until(() => f.requests.filter(r => r.action === 'sync').length >= 3)
    assert.equal(f.writes.length, 0)
    assert.equal(f.requests.flatMap(r => r.receipts ?? []).filter(r => r.commandId === id(82)).length, 1)
  } finally { await f.relay.stop() }
})
