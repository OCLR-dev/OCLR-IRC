import { z } from 'zod'
import { scoringRulesSchema } from './oclr-website/competition-model.ts'
import { refereeSettingsSchema } from './oclr-website/referee-commands.ts'
import { projectReferee, refereePolicySchema } from './oclr-website/referee-model.ts'

export const OCLR_ORIGIN = 'https://oclr.org'
export const OCLR_SCOPES = ['referee:fixtures:read', 'referee:context:read', 'referee:panel:read', 'referee:relay'] as const
export const uuid = z.uuid()
export const positiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const text = z.string().max(2000)
const short = z.string().max(200)
export const instant = z.iso.datetime({ offset: false })
export const subjectSchema = z.object({ osuId: positiveId, username: z.string().min(1).max(50) })
export const editionSchema = z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/), name: short })
const revision = z.string().min(1).max(256)
export const fingerprint = z.string().regex(/^[a-f0-9]{64}$/)
export const metaSchema = z.object({ apiVersion: z.literal('1'), contractVersion: z.string().regex(/^1\.\d+\.\d+$/), requestId: uuid, serverTime: instant, pollAfterSeconds: z.number().int().min(1).max(300).optional() })
export function envelope<T extends z.ZodType>(data: T) { return z.object({ data, meta: metaSchema }) }
const scopes = z.array(z.enum(OCLR_SCOPES)).length(OCLR_SCOPES.length).refine(values => new Set(values).size === OCLR_SCOPES.length)
const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
export const authRequestSchema = envelope(z.object({ authorization_request_id: uuid, authorization_url: z.string().max(512), verification_code: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/), expires_at: instant }))
export const tokenSchema = envelope(z.object({ token_type: z.literal('Bearer'), access_token: z.string().regex(/^oclr_desk_at_[A-Za-z0-9_-]{43}$/), refresh_token: z.string().regex(/^oclr_desk_rt_[A-Za-z0-9_-]{43}$/), expires_in: z.number().int().min(1).max(600), access_expires_at: instant, refresh_expires_at: instant, session_expires_at: instant, session_id: uuid, scope: scopes, subject: subjectSchema }))
export const callbackCodeSchema = secret
const fixtureStatus = z.enum(['scheduled', 'in_progress', 'cancelled'])
const teamSlot = z.object({ slot: z.enum(['home', 'away']), resolution: z.enum(['resolved', 'unresolved']), team: z.object({ id: uuid, name: short }).nullable(), sourceLabel: short.nullable() }).refine(s => s.resolution === 'resolved' ? s.team !== null && s.sourceLabel === null : s.team === null && s.sourceLabel !== null)
export const fixtureSchema = z.object({ fixtureId: uuid, fixtureRevision: revision, edition: editionSchema, round: z.object({ id: uuid, name: short }), label: short, scheduledAt: instant.nullable(), timeZone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false } }), status: fixtureStatus, resultReviewState: z.enum(['draft', 'submitted', 'approved']).nullable(), operational: z.boolean(), teams: z.array(teamSlot).length(2).refine(v => new Set(v.map(t => t.slot)).size === 2), streamingState: z.enum(['unassigned', 'confirmed', 'needs_confirmation', 'unavailable']), reviewUrl: z.string().max(512) })
export const fixturePageSchema = envelope(z.object({ items: z.array(fixtureSchema).max(100), collectionRevision: revision, nextCursor: z.string().min(1).max(2048).nullable() }))
export type FixtureSummary = z.infer<typeof fixtureSchema>

// PR #409's saved workspace DTO, with bounded data and no DB/Next.js dependency.
const mapSchema = z.object({ id: uuid, beatmapId: positiveId, category: z.string().min(1).max(30), position: z.number().int().min(1).max(200), metadata: z.object({ title: short, artist: short, difficulty: short, stars: z.number().nonnegative(), duration: z.number().nonnegative() }).nullable() })
const basisSchema = z.object({ policy: refereePolicySchema.nullable(), teamIds: z.array(uuid).max(2), maps: z.array(mapSchema.omit({ metadata: true })).max(200), series: scoringRulesSchema.shape.series.nullable(), tiedMapPolicy: scoringRulesSchema.shape.tiedMapPolicy })
const payloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('order_set'), firstBanTeamId: uuid, firstPickTeamId: uuid }),
  z.object({ type: z.literal('selection_recorded'), stepIndex: z.number().int().min(0).max(199), kind: z.enum(['ban', 'pick', 'tb']), teamId: uuid.nullable(), entryId: uuid, beatmapId: positiveId, category: short }),
  z.object({ type: z.literal('attempt_started'), pickId: uuid, attemptId: uuid }),
  z.object({ type: z.literal('attempt_resolved'), pickId: uuid, attemptId: uuid, status: z.enum(['completed', 'tied', 'aborted']), winnerTeamId: uuid.nullable() }),
  z.object({ type: z.literal('attempt_replayed'), pickId: uuid }),
  z.object({ type: z.literal('selection_voided'), selectionId: uuid }),
  z.object({ type: z.literal('settings_saved'), settings: refereeSettingsSchema }),
  z.object({ type: z.literal('dependencies_reconfirmed') }),
  z.object({ type: z.literal('policy_configured'), policy: refereePolicySchema, revision: z.number().int().positive() })
])
const workspace = z.object({
  fixture: z.object({ id: uuid, label: short, roundId: uuid, status: fixtureStatus, homeTeamId: uuid.nullable(), awayTeamId: uuid.nullable(), version: z.number().int().nonnegative() }),
  round: z.object({ id: uuid, name: short }),
  teams: z.array(z.object({ id: uuid, name: short, captainId: positiveId.nullable(), captainUsername: short.nullable(), members: z.array(subjectSchema).max(100) })).max(2),
  defaultSettings: refereeSettingsSchema,
  maps: z.array(mapSchema).max(200), rules: scoringRulesSchema.nullable(), series: scoringRulesSchema.shape.series.nullable(), policy: refereePolicySchema.nullable(), policyRevision: z.number().int().nonnegative(),
  session: z.object({ revision: z.number().int().nonnegative(), firstBanTeamId: uuid.nullable(), firstPickTeamId: uuid.nullable(), settings: refereeSettingsSchema, dependencyFingerprint: fingerprint, basis: basisSchema }).nullable(),
  events: z.array(z.object({ id: uuid, ordinal: z.number().int().positive(), actorId: positiveId, createdAt: instant, payload: payloadSchema })).max(2000),
  dependencyFingerprint: fingerprint, readiness: z.array(text).max(100), canRecord: z.boolean(), canConfigure: z.boolean()
}).refine(w => new Set(w.teams.map(t => t.id)).size === w.teams.length && w.teams.every(t => [w.fixture.homeTeamId, w.fixture.awayTeamId].includes(t.id) && new Set(t.members.map(m => m.osuId)).size === t.members.length) && new Set(w.maps.map(m => m.id)).size === w.maps.length && w.fixture.roundId === w.round.id && w.events.every((e, i) => e.ordinal === i + 1) && (w.session ? w.session.revision === w.events.length : w.events.length === 0), 'Inconsistent workspace identities or event sequence')
.transform(w => ({ ...w, projection: projectReferee({ ...(w.session?.basis ?? { policy: w.policy, teamIds: w.teams.map(t => t.id), maps: w.maps, series: w.series, tiedMapPolicy: w.rules?.tiedMapPolicy ?? 'require_replay' }), orders: { firstBanTeamId: w.session?.firstBanTeamId ?? null, firstPickTeamId: w.session?.firstPickTeamId ?? null }, events: w.events }) }))

// Additive panel candidate 1.1.0. Does not claim to be the full /context operation contract.
export const panelSchema = envelope(z.object({ viewer: subjectSchema, edition: editionSchema, capturedAt: instant, freshUntil: instant, workspace }))
export type RefereePanel = z.infer<typeof panelSchema>['data']
export interface OclrCommand { id: string; kind: string; text: string | null; reason: string | null; teamName?: string; playerName?: string }
export interface OclrRelayState { status: 'off' | 'connecting' | 'connected' | 'error'; roomId: number | null; error: string | null }
export interface AccountPairingState { status: 'unknown' | 'nickname_matched' | 'mismatch'; token: string; reviewed: boolean; ircUsername: string | null }
export interface OclrSnapshot {
  pairing: AccountPairingState
  relay: OclrRelayState
  status: 'disconnected' | 'authorizing' | 'connected' | 'refreshing' | 'error'
  subject: z.infer<typeof subjectSchema> | null
  authorization: { verificationCode: string; expiresAt: string } | null
  error: string | null
  remoteRevocation: 'none' | 'unconfirmed'
  fixtures: FixtureSummary[]
  fixturesLoading: boolean
  hasMore: boolean
  selectedFixtureId: string | null
  panel: RefereePanel | null
  panelState: 'empty' | 'loading' | 'fresh' | 'stale' | 'unavailable'
  selectedMapId: string | null
  previewId: string
  commands: OclrCommand[]
  retryAt: string | null
}
