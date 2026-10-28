// All identities, rooms, metadata and credentials in this fixture are synthetic.
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const serverTime = '2026-10-28T08:00:00.000Z'
export const at = (seconds: number) => new Date(Date.parse(serverTime) + seconds * 1000).toISOString()
export const subject = { osuId: 900000001, username: 'Synthetic Referee' }
export const edition = { slug: 'synthetic-oclr', name: 'Synthetic OCLR' }
export const scopes = ['referee:fixtures:read', 'referee:context:read', 'referee:panel:read']
export const meta = () => ({ apiVersion: '1', contractVersion: '1.1.0', requestId: id(999), serverTime, pollAfterSeconds: 15 })
export function jsonResponse(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-OCLR-Desktop-Contract': '1.1.0', 'X-OCLR-Referee-Contract': '1.1.0', 'X-Request-Id': id(999), ...extra } })
}
export function apiError(code: string, status: number, extra = {}) { return jsonResponse({ error: { code, message: 'Synthetic error; never display server messages.', requestId: id(999), retryable: true } }, status, extra) }
export function pair(serial = 0) {
  return { data: { token_type: 'Bearer', access_token: 'oclr_desk_at_' + (serial ? 'B' : 'A').repeat(43), refresh_token: 'oclr_desk_rt_' + (serial ? 'E' : 'D').repeat(43), expires_in: 600, access_expires_at: at(600), refresh_expires_at: at(7200), session_expires_at: at(43200), session_id: id(1), scope: [...scopes], subject: { ...subject } }, meta: meta() }
}
export function fixture(n = 101) {
  return { fixtureId: id(n), fixtureRevision: 'fixture:1', edition: { ...edition }, round: { id: id(102), name: 'Synthetic round' }, label: n === 101 ? 'Team A vs Team B' : 'Synthetic second fixture', scheduledAt: at(3600), timeZone: 'Asia/Taipei', status: 'scheduled', resultReviewState: null, operational: true, teams: [ { slot: 'home', resolution: 'resolved', team: { id: id(201), name: 'Team A' }, sourceLabel: null }, { slot: 'away', resolution: 'resolved', team: { id: id(202), name: 'Team B' }, sourceLabel: null } ], streamingState: 'unavailable', reviewUrl: `https://oclr.org/admin/tournaments/${edition.slug}/matches/${id(n)}` }
}
export function fixtures() { return { data: { items: [fixture(), fixture(103)], collectionRevision: 'collection:1', nextCursor: null as string | null }, meta: meta() } }
export function panel(n = 101) {
  return { data: { viewer: { ...subject }, edition: { ...edition }, capturedAt: serverTime, freshUntil: at(30), workspace: {
    fixture: { id: id(n), label: fixture(n).label, roundId: id(102), status: 'scheduled', homeTeamId: id(201), awayTeamId: id(202), version: 1 }, round: { id: id(102), name: 'Synthetic round' },
    teams: [ { id: id(201), name: 'Team A', captainId: 900000011, captainUsername: 'Player A', members: [{ osuId: 900000011, username: 'Player A' }] }, { id: id(202), name: 'Team B', captainId: 900000021, captainUsername: 'Player B', members: [{ osuId: 900000021, username: 'Player B' }] } ],
    defaultSettings: { roomName: 'OCLR: (Team A) vs (Team B)', streamerUsername: 'Synthetic Streamer', timerSeconds: 60, startSeconds: 10, roomSize: 2 },
    maps: [{ id: id(301), beatmapId: 900000101, category: 'HD', position: 1, metadata: { title: 'Synthetic song <img src=x>', artist: 'Synthetic artist', difficulty: 'Synthetic difficulty', stars: 5.2, duration: 180 } }],
    rules: { version: 'rules:1', mode: 'osu', teamType: 'head-to-head', scoringType: 'scorev2', aggregation: 'sum', playersPerTeam: 1, series: { type: 'first_to', wins: 1 }, allowSubstitutions: false, allowShortHanded: false, failedScorePolicy: 'include', tiedMapPolicy: 'require_replay' },
    series: { type: 'first_to', wins: 1 },
    policy: { steps: [{ kind: 'pick', actor: 'firstPick', categories: ['HD'], entryIds: [], avoidRepeatCategory: false, tiedAt: null }], maxReplaysPerMap: 2, commands: { roomSize: 2, noFail: true, categoryMods: { HD: { mods: ['HD'], freemod: false } }, banSeconds: 30, pickSeconds: 60, prepareSeconds: 60, startSeconds: 10 } }, policyRevision: 1,
    session: null, events: [], projection: {}, dependencyFingerprint: 'a'.repeat(64), readiness: [], canRecord: true, canConfigure: true
  } }, meta: meta() }
}
