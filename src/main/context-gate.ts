import { createHash } from 'node:crypto'
import { CONTEXT_INTENTS } from '../shared/oclr-context.ts'
import type { ContextIntent, ContextSnapshot } from '../shared/oclr-context.ts'
import { mapProfile } from '../shared/map-profile.ts'
import { matchName, normalize } from './protocol.ts'
import type { Room } from '../shared/types.ts'
export interface ContextLocalEvidence {
  sessionActive:boolean; ircOnline:boolean; fresh:boolean; subjectId:number; ircUsername:string; connectionGeneration:number
  room:Room|null; roomAgeMs:number|null; permissionAgeMs:number|null; noLocalLobbyReference:boolean; recoveryReviewed:boolean
  entryId:string|null; lineup:{osuId:number;teamId:string;slot:number}[]; teamColours:{teamId:string;colour:'red'|'blue'}[]
  lineupChanged:boolean; policyReviewed:boolean; individualModsReviewed:boolean; confirmationFingerprint:string|null
}
const minimum:Record<ContextIntent,string[]>={
  create_lobby:['no_local_lobby_reference'],configure_lobby:['room_binding','room_permission','room_snapshot'],invite_players:['room_binding','room_permission'],place_players:['room_binding','room_permission','room_snapshot','lineup_selected'],select_map:['room_binding','room_permission','room_snapshot'],start_game:['room_binding','room_permission','room_snapshot','lineup_selected','map_and_mods_verified'],manage_timer:['room_binding','room_permission'],abort_game:['room_binding','room_permission','room_snapshot'],close_lobby:['room_binding','room_permission','room_snapshot']
}
const knownIssues=new Set(['RULES_NOT_CONFIGURED','REQUIRED_RULE_FIELD_MISSING','UNSUPPORTED_RULES','ROSTER_NOT_FINALIZED','LOBBY_NAME_NOT_CONFIGURED','LOBBY_ALREADY_BOUND','MAPPOOL_NOT_ASSIGNED','NO_SELECTABLE_MAP','UNKNOWN_MOD_POLICY','FIXTURE_NOT_OPERATIONAL','START_POLICY_NOT_CONFIGURED','STREAM_UNASSIGNED','STREAM_RECONFIRMATION_REQUIRED','STREAM_UNAVAILABLE'])
export function contextEntry(context:ContextSnapshot,id:string|null){
  const entry=context.pool?.entries.find(e=>e.id===id),profile=entry?.commandProfile,rules=context.rules
  if(!entry||entry.availability!=='selectable'||entry.blockingCodes.length||entry.ruleset!=='osu'||!profile||!rules||!['required','optional','forbidden'].includes(rules.noFailPolicy??''))return null
  if(profile.freeMod?(profile.individualModsCheck!=='manual'||!profile.policyText?.trim()):(profile.individualModsCheck!=='not_required'))return null
  if(rules.noFailPolicy==='required'&&!profile.roomMods.includes('NF')||rules.noFailPolicy==='forbidden'&&profile.roomMods.includes('NF'))return null
  try{return {entry,profile:mapProfile({beatmapId:String(entry.beatmapId),roomMods:profile.roomMods,freemod:profile.freeMod,individualModsPolicy:profile.freeMod?'manual':'disabled',ruleset:'current',revision:'context'})}}catch{return null}
}
/** Main-only planning result, not a renderer-supplied authorization or an execution API. */
export function checkContext(context:ContextSnapshot,intent:ContextIntent,local:ContextLocalEvidence){
  const reasons:string[]=[],checks=new Set(['identity_match',...(minimum[intent]??[]),...(context.requiredLocalChecks[intent]??[])])
  const require=(condition:unknown,reason:string)=>{if(!condition)reasons.push(reason)}
  require(CONTEXT_INTENTS.includes(intent)&&context.allowedIntents.includes(intent),'INTENT_NOT_ALLOWED')
  require(local.sessionActive&&local.fresh,'CONTEXT_NOT_CURRENT')
  require(context.edition.operational&&!context.edition.archive&&context.fixture.status!=='cancelled'&&context.fixture.resultReviewState!=='approved','FIXTURE_NOT_OPERATIONAL')
  require(context.sourceVersions.fixture&&context.sourceVersions.assignment,'SOURCE_VERSION_MISSING')
  require(!context.issues.some(issue=>issue.affectedIntents.includes(intent)&&(issue.severity==='blocking'||!knownIssues.has(issue.code))),'CONTEXT_ISSUE')
  const rules=context.rules,teams=context.teams.flatMap(s=>s.team?[s.team]:[]),entry=contextEntry(context,local.entryId)
  if(['create_lobby','invite_players','place_players','start_game'].includes(intent))require(teams.length===2,'ROSTER_NOT_FINALIZED')
  if(['configure_lobby','place_players','select_map','start_game'].includes(intent))require(rules?.ruleset==='osu'&&['head_to_head','team_vs'].includes(rules.teamMode??'')&&rules.scoringMode==='score_v2','UNSUPPORTED_RULES')
  if(intent==='configure_lobby'||intent==='start_game')require(rules?.roomSize&&rules.playersPerTeam&&rules.roomSize>=2*rules.playersPerTeam&&(rules.teamMode!=='head_to_head'||rules.playersPerTeam===1),'ROOM_RULES_INCOMPLETE')
  if(intent==='create_lobby'){
    try{matchName(context.lobby.roomName)}catch{reasons.push('LOBBY_NAME_NOT_CONFIGURED')}
    require(context.lobby.binding?.state!=='bound','LOBBY_ALREADY_BOUND')
  }
  if(intent==='select_map'||intent==='start_game'){require(entry,'ENTRY_UNAVAILABLE');if(entry?.profile.freemod)checks.add('individual_mods_verified')}
  if(['place_players','start_game'].includes(intent)&&rules?.teamMode==='team_vs')checks.add('team_colours_verified')
  if(intent==='place_players'&&local.lineupChanged){checks.add('substitution_policy_reviewed');require(rules?.substitutionPolicy==='roster_only_between_games','SUBSTITUTION_NOT_ALLOWED')}
  if(intent==='start_game'){
    require(rules?.series && (rules.series.kind==='first_to' ? rules.series.target!==null&&rules.series.mapCount===null : rules.series.kind==='fixed_maps'&&rules.series.mapCount!==null&&rules.series.target===null),'SERIES_NOT_CONFIGURED')
    require(rules?.startPolicy&&['required','optional'].includes(rules.startPolicy.streamingRequirement),'START_POLICY_NOT_CONFIGURED')
    if(rules?.startPolicy?.streamingRequirement==='required')require(context.officials.streaming.state==='confirmed','STREAM_NOT_CONFIRMED')
  }
  const room=local.room,validLineup=teams.length===2&&Boolean(rules?.playersPerTeam)&&local.lineup.length===2*rules!.playersPerTeam!&&new Set(local.lineup.map(p=>p.osuId)).size===local.lineup.length&&new Set(local.lineup.map(p=>p.slot)).size===local.lineup.length&&teams.every(team=>local.lineup.filter(p=>p.teamId===team.id).length===rules!.playersPerTeam)&&local.lineup.every(player=>Number.isInteger(player.slot)&&player.slot>=1&&player.slot<=16&&teams.find(t=>t.id===player.teamId)?.roster.some(p=>p.osuId===player.osuId&&p.eligible))
  const colours=context.lobby.teamColourAssignments??local.teamColours
  const validColours=colours.length===2&&new Set(colours.map(c=>c.teamId)).size===2&&new Set(colours.map(c=>c.colour)).size===2&&colours.every(c=>teams.some(t=>t.id===c.teamId)&&['red','blue'].includes(c.colour))
  if(intent==='start_game'&&validLineup){
    require(room?.slotsVerified&&room.slots.length===local.lineup.length&&local.lineup.every(player=>room.slots.some(slot=>slot.osuId===player.osuId&&slot.slot===player.slot&&(rules?.teamMode!=='team_vs'||slot.team===colours.find(c=>c.teamId===player.teamId)?.colour))),'LINEUP_OBSERVATION_MISMATCH')
    require(room?.phase==='idle'&&room.slots.every(slot=>/^ready$/i.test(slot.status))&&(!room?.startCountdown||room.startCountdown.status==='cancelled'),'MATCH_PHASE_NOT_READY')
  }
  const expectedMods=entry?[...entry.profile.roomMods,...(entry.profile.freemod?['Freemod']:[])].map(normalize).sort().join(','):null
  const fingerprint=createHash('sha256').update(JSON.stringify({intent,contextRevision:context.contextRevision,sourceVersions:context.sourceVersions,subject:context.viewer.osuId,generation:local.connectionGeneration,room:room?{id:room.id,epoch:room.epoch,map:room.beatmap?.id,mods:room.mods,slots:room.slots}:null,pool:context.pool?.revision,entry:local.entryId,lineup:local.lineup,colours,policy:rules?.revision})).digest('hex')
  const evidence:Record<string,boolean>={
    identity_match:local.ircOnline&&local.subjectId===context.viewer.osuId&&normalize(local.ircUsername)===normalize(context.viewer.username),
    no_local_lobby_reference:local.noLocalLobbyReference&&local.recoveryReviewed,
    room_binding:Boolean(room?.joined&&room.kind==='match'&&room.binding==='verified'&&(context.lobby.binding?.state!=='bound'||context.lobby.binding.roomId===room.id)),room_permission:room?.referee==='listed'&&local.permissionAgeMs!==null&&Number.isFinite(local.permissionAgeMs)&&local.permissionAgeMs>=0&&local.permissionAgeMs<60000,
    room_snapshot:Boolean(room?.slotsVerified&&['complete','partial'].includes(room.syncState)&&local.roomAgeMs!==null&&Number.isFinite(local.roomAgeMs)&&local.roomAgeMs>=0&&local.roomAgeMs<10000),
    lineup_selected:validLineup,team_colours_verified:validColours,
    map_and_mods_verified:Boolean(entry&&room?.beatmap?.id===entry.entry.beatmapId&&room.mods!==null&&room?.mods.map(normalize).sort().join(',')===expectedMods),
    individual_mods_verified:local.individualModsReviewed&&local.confirmationFingerprint===fingerprint,substitution_policy_reviewed:local.policyReviewed&&local.confirmationFingerprint===fingerprint
  }
  for(const check of checks)require(evidence[check]===true,`LOCAL_CHECK:${check}`)
  return {allowed:reasons.length===0,reasons:[...new Set(reasons)],checks:[...checks],fingerprint}
}
