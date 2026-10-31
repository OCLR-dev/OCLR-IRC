import test from 'node:test'
import assert from 'node:assert/strict'
import { roomNameSource, roomNameSourcePending } from '../src/shared/room-name-source.ts'
import { emptyOclrState } from '../src/shared/oclr-state.ts'
import { panelSchema } from '../src/shared/oclr-contracts.ts'
import { panel, subject, id } from './fixtures/oclr.ts'

function selected() { return { ...emptyOclrState(), status: 'connected' as const, subject, selectedFixtureId: id(101), panelState: 'fresh' as const, panel: panelSchema.parse(panel()).data } }
test('room naming suggestion uses selected saved settings without requiring execution policies', () => {
  const state = selected()
  assert.equal(roomNameSource(state)?.name, 'OCLR: (Team A) vs (Team B)')
  state.panel.workspace.rules = null
  assert.ok(roomNameSource(state), 'readable name is not an operation authorization')
  const first = roomNameSource(state)!.key
  state.panel.workspace.defaultSettings!.roomName = 'New fixture name'
  assert.notEqual(roomNameSource(state)!.key, first)
  state.subject = { ...subject, osuId: 123 }
  assert.notEqual(roomNameSource(state)!.key, first)
})
test('stale, wrong-fixture, logged-out or unsafe names never prefill', () => {
  assert.equal(roomNameSource({ ...selected(), panelState: 'stale' }), null)
  assert.equal(roomNameSource({ ...selected(), selectedFixtureId: id(103) }), null)
  assert.equal(roomNameSource({ ...selected(), subject: null }), null)
  for (const name of ['', 'x'.repeat(51), 'Room\nQUIT', 'Room\u200b']) {
    const state = selected(); state.panel.workspace.defaultSettings!.roomName = name
    assert.equal(roomNameSource(state), null)
  }
})

test('only an unchanged cached source may retain a draft while freshness is unavailable', () => {
  const state = selected(), source = roomNameSource(state)
  for (const panelState of ['stale', 'loading'] as const) {
    const pending = { ...state, panelState }
    assert.equal(roomNameSourcePending(pending, source), true)
    assert.equal(roomNameSource(pending), null, 'retained draft is never fresh enough to submit')
    assert.equal(roomNameSourcePending({ ...pending, subject: { ...subject, osuId: 999 } }, source), false)
    assert.equal(roomNameSourcePending({ ...pending, selectedFixtureId: id(103) }, source), false)
    assert.equal(roomNameSourcePending({ ...pending, status: 'disconnected' }, source), false)
    assert.equal(roomNameSourcePending({ ...pending, panel: null }, source), false)
  }
  const refreshing = { ...state, status: 'refreshing' as const }
  assert.equal(roomNameSourcePending(refreshing, source), true)
  assert.equal(roomNameSource(refreshing), null, 'authorization refresh retains a disabled draft, never a submit source')
  assert.equal(roomNameSourcePending({ ...refreshing, subject: { ...subject, osuId: 999 } }, source), false)
  state.panel.workspace.defaultSettings!.roomName = 'Changed source'
  assert.equal(roomNameSourcePending({ ...state, panelState: 'stale' }, source), false)
})
