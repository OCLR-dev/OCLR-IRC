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
  const irc = Object.assign(new EventEmitter(), {state: {connection: 'online', username: 'Ref_Name', room: {id: 123, epoch: 1, joined: true, kind: 'match', binding: 'verified', referee: 'listed'}, messages: [] as any[]}, relayReady() {return true}, relayRefresh() {}, relaySend(input: unknown) {writes.push(input)}})
  let command: any = null, fail = false
  const oclr = Object.assign(new EventEmitter(), {state: {subject: {username: 'Ref Name'}, selectedFixtureId: id(101), panelState: 'fresh', relay: null as any}, updateRelay(state: unknown) {this.state.relay = state; (this as unknown as EventEmitter).emit('state')}, async relayRequest(_id: string, body: any) {requests.push(body); if (fail) throw Error('network failure'); return {value: {data: {connectionId: id(40), sequence: body.sequence ?? 0, command: body.action === 'sync' ? command : null}, meta: meta()}}}})
  const relay = new OclrRelay(oclr as unknown as OclrSession, irc as unknown as IrcSession)
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
  assert.equal(relayReply('!mp start 5', 'Started the match'), null)
})
test('relay binds explicitly, sends once, projects only bound room and correlates bot evidence', async () => {
  const f = harness(); try {
    await f.relay.start(); f.command({id: id(50), text: '!mp map 42 0', target: '#mp_123'})
    await until(() => f.writes.length === 1)
    f.irc.emit('message', {roomId: 999, roomEpoch: 1, message: {id: 1, kind: 'bot', sender: 'BanchoBot', text: 'Beatmap changed to: Song https://osu.ppy.sh/b/42'}})
    f.irc.emit('message', {roomId: 123, roomEpoch: 1, message: {id: 2, kind: 'chat', sender: 'BanchoBot', text: 'Beatmap changed to: Song https://osu.ppy.sh/b/42'}})
    f.irc.emit('message', {roomId: 123, roomEpoch: 1, message: {id: 3, kind: 'bot', sender: 'BanchoBot', text: 'Beatmap changed to: Song https://osu.ppy.sh/b/42'}})
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
