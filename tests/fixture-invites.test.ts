import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { IrcSession } from '../src/main/irc.ts'
import { Lines } from '../src/main/protocol.ts'
import { FixtureInvites } from '../src/main/fixture-invites.ts'
import { fixtureInviteSource } from '../src/shared/fixture-tools.ts'
import { emptyOclrState } from '../src/shared/oclr-state.ts'
import { panelSchema } from '../src/shared/oclr-contracts.ts'
import { refereeCommands } from '../src/shared/oclr-website/referee-commands.ts'
import type { OclrSession } from '../src/main/oclr.ts'
import type { OclrRelay } from '../src/main/oclr-relay.ts'
import type { OperationRecord } from '../src/shared/operation.ts'
import { id } from './fixtures/oclr.ts'
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn: () => boolean) {for (let i = 0; i < 500; i++) {if (fn()) return; await pause(5)} throw Error('Fixture invite timed out')}
async function fixture() {
  const panel = panelSchema.parse(JSON.parse(readFileSync(new URL('./fixtures/oclr-panel.json', import.meta.url), 'utf8'))).data
  const state = {...emptyOclrState(), fixtures: JSON.parse(readFileSync(new URL('./fixtures/oclr-fixtures.json', import.meta.url), 'utf8')).data.items, subject: panel.viewer, panel, status: 'connected' as const, panelState: 'fresh' as const, selectedFixtureId: panel.workspace.fixture.id, previewId: id(800), commands: refereeCommands({settings: panel.workspace.defaultSettings, policy: panel.workspace.policy?.commands || null, rules: panel.workspace.rules, teams: panel.workspace.teams, selectedMap: null})}
  let reads = 0, barrier: Promise<void> | null = null, release: (() => void) | null = null, scope = 'bound'
  const oclr = Object.assign(new EventEmitter(), {state, sessionGeneration: 1, async loadFixtures(_more = false) {}, async readPanel() {reads++; if (barrier) await barrier; state.previewId = id(800 + reads)}})
  const relay = {localBinding() {if (!scope) throw Error('No binding'); return scope}}
  const sent: string[] = [], saved: OperationRecord[] = [], sockets = new Set<net.Socket>()
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); const lines = new Lines()
    socket.on('data', chunk => {for (const line of lines.feed(chunk)) {
      sent.push(line)
      if (line.startsWith('USER ')) socket.write(':server 001 Synthetic_Referee :welcome\n')
      if (line.startsWith('JOIN ')) socket.write(':Synthetic_Referee!x JOIN :#mp_9\n')
      if (line.endsWith(':!mp settings')) socket.write(':BanchoBot PRIVMSG #mp_9 :Room name: Synthetic, History: https://osu.ppy.sh/mp/9\n:BanchoBot PRIVMSG #mp_9 :Team mode: TeamVs, Win condition: ScoreV2\n:BanchoBot PRIVMSG #mp_9 :Players: 0\n')
      if (line.endsWith(':!mp listrefs')) socket.write(':BanchoBot PRIVMSG #mp_9 :Match referees: Synthetic_Referee\n')
    }})
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const irc = new IrcSession(() => net.createConnection({host: '127.0.0.1', port: (server.address() as net.AddressInfo).port}), {floodMs: 5, queryMs: 200, retryBaseMs: 20})
  irc.setOperationStore({load: () => [], save: (_account, record) => saved.push(structuredClone(record)), clear() {}})
  irc.login({username: 'Synthetic_Referee', password: 'SYNTHETIC_ONLY'}); await until(() => irc.state.connection === 'online')
  irc.join('9')
  const target = () => ({roomId: 9, roomEpoch: irc.state.room!.epoch})
  await until(() => irc.state.room?.joined === true)
  irc.relayRefresh(target())
  await until(() => irc.relayReady(target(), '!mp invite Player_A'))
  const controller = new FixtureInvites(oclr as unknown as OclrSession, irc, relay as unknown as OclrRelay)
  const input = () => ({...target(), previewId: state.previewId, teamId: state.panel.workspace.teams[0].id, osuId: state.panel.workspace.teams[0].members[0].osuId})
  return {irc, state, controller, oclr, sent, saved, input, target, reads: () => reads, bind: (value: string) => {scope = value}, hold: () => {barrier = new Promise<void>(resolve => {release = resolve})}, release: () => {barrier = null; release?.()}, async close() {irc.logout(); for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve()))}}
}
test('fixture invite rereads its source, previews one fixed player and sends once without persisting website history', async () => {
  const f = await fixture()
  try {
    const preview = await f.controller.prepare(f.input())
    assert.equal(preview.command, '!mp invite Player_A'); assert.equal(preview.osuId, 900000011)
    assert.equal(f.sent.some(line => line.includes('!mp invite')), false)
    const value = {...f.target(), token: preview.token, reviewed: true, playerName: preview.playerName!}
    await f.controller.execute(value)
    await until(() => f.sent.some(line => line.endsWith(':!mp invite Player_A')))
    await assert.rejects(f.controller.execute(value))
    assert.equal(f.sent.filter(line => line.includes('!mp invite')).length, 1)
    assert.equal(f.reads(), 2)
    assert.equal(f.irc.state.operations?.records.at(-1)?.source, 'oclr')
    assert.equal(f.irc.state.operations?.records.at(-1)?.state, 'awaiting')
    assert.equal(f.saved.length, 0); assert.equal(f.irc.state.room?.players, 0)
  } finally {await f.close()}
})
test('manual IPC cannot execute a website invitation and missing name confirmation never writes', async () => {
  const f = await fixture()
  try {
    let preview = await f.controller.prepare(f.input())
    assert.throws(() => f.irc.executeLobby({...f.target(), token: preview.token, reviewed: true, playerName: preview.playerName}))
    preview = await f.controller.prepare(f.input())
    await assert.rejects(f.controller.execute({...f.target(), token: preview.token, reviewed: true, playerName: 'Wrong player'}))
    assert.equal(f.sent.some(line => line.includes('!mp invite')), false)
  } finally {await f.close()}
})
test('changed roster, source revision, authorization, binding and room epoch reject old confirmations', async () => {
  for (const mode of ['roster', 'revision', 'authorization', 'binding', 'epoch', 'approved', 'assignment', 'list-failure']) {
    const f = await fixture()
    try {
      const preview = await f.controller.prepare(f.input()), target = f.target()
      if (mode === 'roster') f.state.panel.workspace.teams[0].members[0].username = 'Changed'
      if (mode === 'revision') f.state.panel.workspace.fixture.version++
      if (mode === 'authorization') f.oclr.sessionGeneration++
      if (mode === 'binding') f.bind('another-connection')
      if (mode === 'epoch') {f.irc.leaveRoom(target); f.irc.join('10')}
      if (mode === 'approved') f.state.fixtures[0].resultReviewState = 'approved'
      if (mode === 'assignment') f.state.fixtures = []
      if (mode === 'list-failure') f.state.error = 'Unavailable'
      await assert.rejects(f.controller.execute({...target, token: preview.token, reviewed: true, playerName: preview.playerName!}))
      assert.equal(f.sent.some(line => line.includes('!mp invite')), false, mode)
    } finally {await f.close()}
  }
})
test('scope changes during source preflight cannot return or send a late invitation', async () => {
  const f = await fixture()
  try {
    f.hold()
    const preparing = f.controller.prepare(f.input()), rejected = assert.rejects(preparing)
    await until(() => f.reads() === 1); f.bind('replacement'); f.release(); await rejected
    assert.equal(f.sent.some(line => line.includes('!mp invite')), false)
  } finally {await f.close()}
})
test('assigned fixture summary is reread across pages before preparing an invitation', async () => {
  const f = await fixture()
  try {
    const wanted = structuredClone(f.state.fixtures[0]), other = structuredClone(f.state.fixtures[1]), pages: boolean[] = []
    f.oclr.loadFixtures = async (more = false) => {
      pages.push(more)
      if (!more) {f.state.fixtures = [other]; f.state.hasMore = true}
      else {f.state.fixtures.push(wanted); f.state.hasMore = false}
    }
    const preview = await f.controller.prepare(f.input())
    assert.deepEqual(pages, [false, true]); assert.equal(preview.command, '!mp invite Player_A')
    assert.equal(f.sent.some(line => line.includes('!mp invite')), false)
  } finally {await f.close()}
})
test('unavailable authorization clears an existing preview even if the same source is restored', async () => {
  const f = await fixture()
  try {
    const preview = await f.controller.prepare(f.input()), panel = f.state.panel
    f.state.panel = null as any; f.oclr.emit('state'); f.state.panel = panel
    await assert.rejects(f.controller.execute({...f.target(), token: preview.token, reviewed: true, playerName: preview.playerName!}))
    assert.equal(f.sent.some(line => line.includes('!mp invite')), false)
  } finally {await f.close()}
})
test('duplicates, stale sources, missing players and disabled website commands cannot become invitations', async () => {
  const f = await fixture()
  try {
    const original = structuredClone(f.state)
    for (const mode of ['duplicate-id', 'duplicate-name', 'stale', 'missing', 'blocked', 'injection']) {
      Object.assign(f.state, structuredClone(original))
      const team = f.state.panel.workspace.teams[0], member = team.members[0]
      if (mode === 'duplicate-id') f.state.panel.workspace.teams[1].members.push({...member})
      if (mode === 'duplicate-name') f.state.panel.workspace.teams[1].members[0].username = 'Player_A'
      if (mode === 'stale') (f.state as any).panelState = 'stale'
      if (mode === 'missing') team.members = []
      if (mode === 'blocked') f.state.commands.find(command => command.kind === 'invite')!.text = null
      if (mode === 'injection') member.username = 'Player\r\n!mp close'
      assert.throws(() => fixtureInviteSource(f.state, team.id, 900000011), mode)
    }
    assert.equal(f.sent.some(line => line.includes('!mp invite')), false)
  } finally {await f.close()}
})
test('unreviewed operations and an unbound room block new fixture invitations', async () => {
  const f = await fixture()
  try {
    f.bind(''); await assert.rejects(f.controller.prepare(f.input())); f.bind('bound')
    f.irc.relaySend({...f.target(), text: '!mp timer 30'})
    await assert.rejects(f.controller.prepare(f.input()), /待核對操作/)
    assert.equal(f.sent.some(line => line.includes('!mp invite')), false)
  } finally {await f.close()}
})
