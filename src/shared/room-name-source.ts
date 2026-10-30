import type { OclrSnapshot } from './oclr-contracts.ts'

/** A naming suggestion only: never an authorization or official room binding. */
export function roomNameSource(state: OclrSnapshot) {
  const panel = state.panel, fixtureId = state.selectedFixtureId
  if (state.status !== 'connected' || !state.subject || !fixtureId || state.panelState !== 'fresh' || panel?.workspace.fixture.id !== fixtureId) return null
  const workspace = panel.workspace
  const name = (workspace.session?.settings ?? workspace.defaultSettings)?.roomName?.trim()
  if (!name || [...name].length > 50 || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(name)) return null
  return { name, label: workspace.fixture.label, key: JSON.stringify([state.subject.osuId, fixtureId, workspace.fixture.version, workspace.dependencyFingerprint, name]) }
}
