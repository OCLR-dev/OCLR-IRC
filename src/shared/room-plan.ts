import type { Room } from './types.ts'
import { lineupMode, type LineupSelection } from './lineup.ts'
import { lobbyCommand, lobbyIntent } from './lobby-command.ts'
export type RoomPlanInput = { kind: 'room'; name: string; teamMode: string; scoreMode: string } | { kind: 'lineup'; players: LineupSelection[] }
type Effect = { kind: 'name'; value: string } | { kind: 'mode'; value: string } | { kind: 'move'; osuId: number; slot: number } | { kind: 'team'; osuId: number; team: 'red' | 'blue' }
export interface RoomPlanDefinition { kind: 'room' | 'lineup'; initial: Room; steps: { command: string; effect: Effect }[]; names: string[] }
export interface RoomPlanPreview { token: string; channel: string; kind: 'room' | 'lineup'; commands: string[]; names: string[]; expiresAt: string }
function shape(room: Room) { return JSON.stringify({ name:room.name, mode:room.mode, map:room.beatmap?.id ?? null, mods:room.mods?.slice().sort() ?? null, slots:room.slots.map(({osuId,username,slot,team,host})=>({osuId,username,slot,team,host})).sort((a,b)=>a.osuId-b.osuId) }) }
function apply(room: Room, effect: Effect) {
  if (effect.kind === 'name') room.name = effect.value
  else if (effect.kind === 'mode') room.mode = effect.value
  else { const player = room.slots.find(p=>p.osuId === effect.osuId)!; if (effect.kind === 'move') player.slot = effect.slot; else player.team = effect.team }
}
export function roomPlanMatches(plan: RoomPlanDefinition, room: Room, completed: number) {
  const expected = structuredClone(plan.initial)
  for (const step of plan.steps.slice(0,completed)) apply(expected,step.effect)
  return shape(expected) === shape(room)
}
export function roomPlan(input: unknown, room: Room): RoomPlanDefinition {
  if (!input || typeof input !== 'object') throw new Error('無效的逐步計畫。')
  const value = input as Record<string,unknown>, initial = structuredClone(room), steps: RoomPlanDefinition['steps'] = [], names: string[] = []
  if (value.kind === 'room') {
    const rename = lobbyIntent({kind:'rename',name:value.name}), config = lobbyIntent({kind:'configure',teamMode:value.teamMode,scoreMode:value.scoreMode,size:'16'})
    if (rename.kind !== 'rename' || config.kind !== 'configure') throw new Error('設定無效。')
    if (room.name !== rename.name) steps.push({command:lobbyCommand(rename),effect:{kind:'name',value:rename.name}})
    const mode = `${['HeadToHead','TagCoop','TeamVs','TagTeamVs'][Number(config.teamMode)]} · ${['Score','Accuracy','Combo','ScoreV2'][Number(config.scoreMode)]}`
    if (room.mode !== mode) steps.push({command:`!mp set ${config.teamMode} ${config.scoreMode}`,effect:{kind:'mode',value:mode}})
  } else if (value.kind === 'lineup') {
    const mode = lineupMode(room)
    if (!Array.isArray(value.players) || !value.players.length || value.players.length > 16 || mode === 'unknown') throw new Error('請選擇已核對模式的出賽玩家。')
    const ids = new Set<number>(), slots = new Set<number>(), players: LineupSelection[] = []
    for (const player of value.players) {
      if (!player || !Number.isSafeInteger(player.osuId) || player.osuId < 1 || ids.has(player.osuId) || !Number.isInteger(player.slot) || player.slot < 1 || player.slot > 16 || slots.has(player.slot) || (mode === 'individual' ? player.team !== null : !['red','blue'].includes(player.team))) throw new Error('出賽 UID、隊伍或槽位有缺漏或重複。')
      const observed = room.slots.find(p=>p.osuId === player.osuId)
      if (!observed) throw new Error('出賽玩家尚未全部到場。')
      ids.add(player.osuId); slots.add(player.slot); names.push(observed.username); players.push({osuId:player.osuId,slot:player.slot,team:player.team})
    }
    const working = structuredClone(room)
    const remaining = players.filter(p=>working.slots.find(s=>s.osuId===p.osuId)!.slot !== p.slot)
    while (remaining.length) {
      const index = remaining.findIndex(p=>!working.slots.some(s=>s.slot === p.slot))
      if (index < 0) throw new Error('目標槽位已佔用或形成交換循環，請先手動騰出槽位。')
      const [player] = remaining.splice(index,1), effect: Effect = {kind:'move',osuId:player.osuId,slot:player.slot!}
      steps.push({command:`!mp move #${player.osuId} ${player.slot}`,effect}); apply(working,effect)
    }
    for (const player of players) if (mode === 'teams' && working.slots.find(s=>s.osuId===player.osuId)!.team !== player.team) steps.push({command:`!mp team #${player.osuId} ${player.team}`,effect:{kind:'team',osuId:player.osuId,team:player.team!}})
  } else throw new Error('不支援此逐步計畫。')
  if (!steps.length) throw new Error('目前設定已符合，沒有需要送出的步驟。')
  return {kind:value.kind,initial,steps,names}
}
