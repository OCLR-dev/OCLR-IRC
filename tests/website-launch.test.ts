import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { parseWebsiteLaunch } from '../src/shared/website-launch.ts'
import { WebsiteLaunch } from '../src/main/website-launch.ts'
import type { OclrSession } from '../src/main/oclr.ts'
import { id } from './fixtures/oclr.ts'
const url = (n = 10) => `oclr-irc://connect?fixture=${id(n)}`
const tick = () => new Promise(resolve => setImmediate(resolve))
function harness() {
  const calls: string[] = []
  const session = Object.assign(new EventEmitter(), {
    sessionGeneration: 1,
    state: {status: 'connected', subject: {osuId: 1}, fixtures: [] as {fixtureId: string}[], hasMore: true, panelState: 'empty'},
    async login() { calls.push('login'); this.state.status = 'authorizing' },
    async loadFixtures(more = false) { calls.push(more ? 'more' : 'list'); this.state.fixtures = [{fixtureId: id(more ? 10 : 11)}]; this.state.hasMore = !more },
    async selectFixture(fixtureId: string) { calls.push(fixtureId); this.state.panelState = 'fresh' }
  })
  const launch = new WebsiteLaunch(session as unknown as OclrSession, async () => { calls.push('stop-relay') })
  return {session, launch, calls}
}
test('only the exact credential-free fixture launch URI is accepted', () => {
  assert.equal(parseWebsiteLaunch(url()), id(10))
  for (const value of [url()+'&token=secret', url()+'#x', url()+'&fixture='+id(11), url().replace('connect?', 'connect/?'), url().replace('connect?', 'user@connect?'), url().replace('fixture=', 'fixture=%20'), 'oclr-irc://connect?fixture=bad', 'oclr-irc://make?command=!mp make x', 'https://oclr.org', url()+'\n', null]) assert.equal(parseWebsiteLaunch(value), null)
})
test('external launch has no side effects until local confirmation, pages authorized fixtures, never starts relay', async () => {
  const f = harness()
  try {
    f.launch.receive(url()); const token = f.launch.state!.requestId
    f.launch.receive(url()); assert.equal(f.launch.state!.requestId, token)
    assert.deepEqual(f.calls, [])
    await assert.rejects(f.launch.continue('stale'))
    await f.launch.continue(token)
    assert.deepEqual(f.calls, ['stop-relay', 'list', 'more', id(10)])
    assert.equal(f.launch.state?.status, 'ready')
  } finally { f.launch.clear() }
})
test('pending navigation survives a new browser login but cancellation, changed subject and replacement fence late replies', async () => {
  const f = harness()
  try {
    f.session.state.subject = null as any; f.session.state.status = 'disconnected'
    f.launch.receive(url()); await f.launch.continue(f.launch.state!.requestId)
    assert.equal(f.launch.state?.status, 'authorizing'); assert.deepEqual(f.calls, ['stop-relay', 'login'])
    f.session.state.subject = {osuId: 1}; f.session.state.status = 'connected'; f.session.emit('state')
    await tick(); assert.equal(f.launch.state?.status, 'ready')
    f.launch.clear(); f.calls.length = 0
    let release!: () => void
    f.session.loadFixtures = () => new Promise<void>(resolve => { release = resolve })
    f.launch.receive(url()); const pending = f.launch.continue(f.launch.state!.requestId); await tick()
    f.launch.receive(url(12)); release(); await pending
    assert.equal(f.launch.state?.fixtureId, id(12)); assert.equal(f.launch.state?.status, 'pending')
    assert.deepEqual(f.calls, ['stop-relay'])
  } finally { f.launch.clear() }
})
test('unassigned fixture and revoked identity never navigate or authorize execution', async () => {
  const f = harness()
  try {
    f.launch.receive(url(99)); await f.launch.continue(f.launch.state!.requestId)
    assert.equal(f.launch.state?.status, 'error'); assert.ok(!f.calls.includes(id(99)))
    f.session.loadFixtures = async () => { f.session.state.subject = null as any }
    f.launch.receive(url()); await f.launch.continue(f.launch.state!.requestId)
    assert.equal(f.launch.state, null)
  } finally { f.launch.clear() }
})
