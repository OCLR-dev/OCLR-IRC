import { z } from 'zod'
import { envelope, instant, positiveId, subjectSchema, uuid } from './oclr-contracts.ts'
const short=z.string().min(1).max(200), revision=z.string().min(1).max(256), nullableCode=z.string().min(1).max(80).nullable()
const timeZone=z.string().max(100).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true}catch{return false}})
const series=z.object({kind:short,target:positiveId.nullable(),mapCount:positiveId.nullable()}).nullable()
const rules=z.object({revision,ruleset:nullableCode,teamMode:nullableCode,scoringMode:nullableCode,playersPerTeam:z.number().int().min(1).max(16).nullable(),roomSize:z.number().int().min(1).max(16).nullable(),series,noFailPolicy:nullableCode,substitutionPolicy:nullableCode,startPolicy:z.object({streamingRequirement:short}).nullable()})
const rosterPlayer=subjectSchema.extend({role:z.enum(['captain','player']),eligible:z.boolean()})
const team=z.object({id:uuid,name:short,rosterRevision:revision,roster:z.array(rosterPlayer).max(64)})
const teamSlot=z.object({slot:z.enum(['home','away']),resolution:z.enum(['resolved','unresolved']),team:team.nullable(),sourceLabel:short.nullable()}).refine(s=>s.resolution==='resolved'?s.team!==null&&s.sourceLabel===null:s.team===null&&s.sourceLabel!==null)
const profile=z.object({roomMods:z.array(z.string().min(1).max(32)).max(32),freeMod:z.boolean(),individualModsCheck:short,policyText:z.string().min(1).max(2000).nullable()})
const entry=z.object({id:uuid,slot:short,category:short,position:z.number().int().min(1).max(256),beatmapId:positiveId,ruleset:short,metadata:z.object({artist:z.string().max(200),title:z.string().max(200),difficulty:z.string().max(200),lengthSeconds:z.number().nonnegative().nullable(),stars:z.number().nonnegative().nullable()}).nullable(),commandProfile:profile.nullable(),availability:short,blockingCodes:z.array(short).max(64)})
const binding=z.object({state:z.enum(['bound','unbound']),roomId:positiveId.nullable(),mpUrl:z.string().max(200).nullable()}).refine(b=>b.state==='bound'?b.roomId!==null&&b.mpUrl===`https://osu.ppy.sh/mp/${b.roomId}`:b.roomId===null&&b.mpUrl===null)
export const CONTEXT_INTENTS=['create_lobby','configure_lobby','invite_players','place_players','select_map','start_game','manage_timer','abort_game','close_lobby'] as const
export type ContextIntent=typeof CONTEXT_INTENTS[number]
const context=z.object({
  contextRevision:z.string().regex(/^ctx_[a-f0-9]{64}$/),capturedAt:instant,freshUntil:instant,
  sourceVersions:z.object({fixture:revision.nullable(),assignment:revision.nullable(),rules:revision.nullable(),rosters:revision.nullable(),pool:revision.nullable(),streaming:revision.nullable(),lobby:revision.nullable()}),viewer:subjectSchema,
  edition:z.object({slug:z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),name:short,abbreviation:short,status:short,archive:z.boolean(),operational:z.boolean()}),round:z.object({id:uuid,name:short,stage:z.enum(['group','knockout','other'])}),
  fixture:z.object({id:uuid,label:short,scheduledAt:instant.nullable(),timeZone,status:z.enum(['scheduled','in_progress','cancelled']),resultReviewState:z.enum(['draft','submitted','approved']).nullable()}),rules:rules.nullable(),teams:z.array(teamSlot).length(2),
  lobby:z.object({roomName:z.string().min(1).max(200).nullable(),nameTemplateId:short.nullable(),teamColourAssignments:z.array(z.object({teamId:uuid,colour:z.enum(['red','blue'])})).length(2).nullable(),binding:binding.nullable()}),
  pool:z.object({id:uuid,revision,name:short,entries:z.array(entry).max(256)}).nullable(),
  officials:z.object({referees:z.array(subjectSchema).max(50),streaming:z.object({state:z.enum(['unassigned','unavailable','confirmed','needs_confirmation']),streamer:subjectSchema.nullable(),confirmedFor:z.object({scheduledAt:instant,timeZone}).nullable()})}),
  allowedIntents:z.array(short).max(32),requiredLocalChecks:z.record(short,z.array(short).max(32)),issues:z.array(z.object({code:short,severity:z.enum(['blocking','warning']),path:z.string().max(500),affectedIntents:z.array(short).max(32),message:z.string().max(2000)})).max(64),links:z.object({fixtureUrl:z.string().max(512),reviewUrl:z.string().max(512)})
}).superRefine((c,ctx)=>{
  const reject=(message:string)=>ctx.addIssue({code:'custom',message}),unique=(values:unknown[])=>new Set(values).size===values.length
  if(Date.parse(c.freshUntil)-Date.parse(c.capturedAt)!==30000)reject('Context freshness must be 30 seconds')
  const teams=c.teams.flatMap(slot=>slot.team?[slot.team]:[])
  if(!unique(c.teams.map(s=>s.slot))||!unique(teams.map(t=>t.id))||!unique(teams.flatMap(t=>t.roster.map(p=>p.osuId))))reject('Ambiguous team or roster identity')
  if(!unique(c.allowedIntents)||JSON.stringify([...c.allowedIntents].sort())!==JSON.stringify(Object.keys(c.requiredLocalChecks).sort()))reject('Intent/check keys differ')
  if(!unique(c.officials.referees.map(p=>p.osuId))||!c.officials.referees.some(p=>p.osuId===c.viewer.osuId))reject('Viewer must be a currently assigned referee')
  if(c.pool&&(!unique(c.pool.entries.map(e=>e.id))||!unique(c.pool.entries.map(e=>e.slot))||!unique(c.pool.entries.map(e=>e.position))))reject('Ambiguous pool entries')
  if(c.lobby.teamColourAssignments&&(!unique(c.lobby.teamColourAssignments.map(a=>a.colour))||!unique(c.lobby.teamColourAssignments.map(a=>a.teamId))||c.lobby.teamColourAssignments.some(a=>!teams.some(t=>t.id===a.teamId))))reject('Invalid colour assignment')
  const stream=c.officials.streaming
  if(['unassigned','unavailable'].includes(stream.state)&&(stream.streamer!==null||stream.confirmedFor!==null)||['confirmed','needs_confirmation'].includes(stream.state)&&stream.streamer===null)reject('Inconsistent streaming state')
  if(stream.state==='confirmed'&&(!c.fixture.scheduledAt||stream.confirmedFor?.scheduledAt!==c.fixture.scheduledAt||stream.confirmedFor?.timeZone!==c.fixture.timeZone))reject('Streaming schedule mismatch')
  if(c.issues.some(i=>i.severity==='blocking'&&i.affectedIntents.some(intent=>c.allowedIntents.includes(intent))))reject('Blocked intent cannot be allowed')
  if(c.links.fixtureUrl!==`https://oclr.org/tournaments/${c.edition.slug}/schedule`||c.links.reviewUrl!==`https://oclr.org/admin/tournaments/${c.edition.slug}/matches/${c.fixture.id}`)reject('Unexpected context links')
})
/** Candidate only: separate from PR409 panel; no production execution authority. */
export const contextSchema=envelope(context)
export type ContextSnapshot=z.infer<typeof context>
