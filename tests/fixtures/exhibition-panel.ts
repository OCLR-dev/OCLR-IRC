import { panel, id, serverTime } from './oclr.ts'
// Synthetic wire shapes from website refereeWorkspace at ed9e83c.
export function exhibitionPanel(skipBans = false, ex = false) {
  const value = panel(), w = value.data.workspace
  const policy = {...w.policy, steps: ex && !skipBans ? w.policy.steps : [{...w.policy.steps[0],kind:'ban',actor:'firstBan'}, ...w.policy.steps]}
  const events = [{id:id(401),ordinal:1,actorId:900000001,createdAt:serverTime,payload:{type:'order_set',firstBanTeamId:skipBans ? null : id(201),firstPickTeamId:id(202),...(skipBans ? {skipBans:true} : {})}}]
  const extra = ex ? [
    {id:id(402),ordinal:2,actorId:900000001,createdAt:serverTime,payload:{type:'selection_recorded',stepIndex:skipBans ? 1 : 0,kind:'pick',teamId:id(202),entryId:id(301),beatmapId:900000101,category:'HD'}},
    {id:id(403),ordinal:3,actorId:900000001,createdAt:serverTime,payload:{type:'ex_declared',pickId:id(402),enabled:true}}
  ] : []
  return {...value,data:{...value.data,workspace:{...w,
    fixture:{...w.fixture,openExhibition:true},round:{...w.round,exhibition:true},policy,
    teams:w.teams.map(t=>({...t,captainId:null,captainUsername:null,members:[]})),
    rules:{...w.rules,exPlayersPerTeam:2},
    session:{revision:events.length+extra.length,firstBanTeamId:skipBans ? null : id(201),firstPickTeamId:id(202),settings:w.defaultSettings,dependencyFingerprint:w.dependencyFingerprint,
      basis:{policy,teamIds:w.teams.map(t=>t.id),maps:w.maps,series:w.series,tiedMapPolicy:w.rules.tiedMapPolicy,exPlayersPerTeam:2,...(skipBans ? {skipBans:true} : {})}},events:[...events,...extra]}}}
}

