import type { OclrSnapshot } from './oclr-contracts.ts'
// Keep validation libraries and server-side command builders out of the renderer bundle.
export const emptyOclrState = (): OclrSnapshot => ({ relay: { status: 'off', roomId: null, error: null }, status: 'disconnected', subject: null, authorization: null, error: null, remoteRevocation: 'none', fixtures: [], fixturesLoading: false, hasMore: false, selectedFixtureId: null, panel: null, panelState: 'empty', selectedMapId: null, previewId: '', commands: [], retryAt: null })
