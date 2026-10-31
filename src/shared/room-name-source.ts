import type { OclrSnapshot } from './oclr-contracts.ts'

function candidate(state: OclrSnapshot) {
  const panel = state.panel, fixtureId = state.selectedFixtureId
  if (!['connected', 'refreshing'].includes(state.status) || !state.subject || !fixtureId || panel?.workspace.fixture.id !== fixtureId) return null
  const workspace = panel.workspace
  const name = (workspace.session?.settings ?? workspace.defaultSettings)?.roomName?.trim()
  if (!name || [...name].length > 50 || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(name)) return null
  return { name, label: workspace.fixture.label, key: JSON.stringify([state.subject.osuId, fixtureId, workspace.fixture.version, workspace.dependencyFingerprint, name]) }
}

/** A naming suggestion only: never an authorization or official room binding. */
export function roomNameSource(state: OclrSnapshot) {
  return state.status === 'connected' && state.panelState === 'fresh' ? candidate(state) : null
}

/** Keep an existing draft while the identical saved source is being refreshed. */
export function roomNameSourcePending(state: OclrSnapshot, previous: ReturnType<typeof roomNameSource>) {
  return previous !== null && (state.status === 'refreshing' || ['stale', 'loading'].includes(state.panelState)) && candidate(state)?.key === previous.key
}
