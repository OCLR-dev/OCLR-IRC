import type { Room } from './types.ts'
import { lobbyCommand, lobbyIntent } from './lobby-command.ts'
export type RoomPlanInput = { kind: 'room'; name: string; teamMode: string; scoreMode: string }
type Effect = { kind: 'name' | 'mode'; value: string }
export interface RoomPlanDefinition { initial: Room; steps: { command: string; effect: Effect }[] }
export interface RoomPlanPreview { token: string; channel: string; commands: string[]; expiresAt: string }
function shape(room: Room) { return JSON.stringify({ name:room.name, mode:room.mode, map:room.beatmap?.id ?? null, mods:room.mods?.slice().sort() ?? null, slots:room.slots.map(({osuId,username,slot,team,host})=>({osuId,username,slot,team,host})).sort((a,b)=>a.osuId-b.osuId) }) }
export function roomPlanMatches(plan: RoomPlanDefinition, room: Room, completed: number) {
  const expected = structuredClone(plan.initial)
  for (const {effect} of plan.steps.slice(0,completed)) expected[effect.kind] = effect.value
  return shape(expected) === shape(room)
}
export function roomPlan(input: unknown, room: Room): RoomPlanDefinition {
  if (!input || typeof input !== 'object') throw new Error('無效的逐步計畫。')
  const value = input as Record<string, unknown>
  if (value.kind !== 'room') throw new Error('不支援此逐步計畫。')
  const steps: RoomPlanDefinition['steps'] = []
  const rename = lobbyIntent({kind:'rename',name:value.name}), config = lobbyIntent({kind:'configure',teamMode:value.teamMode,scoreMode:value.scoreMode,size:'16'})
  if (rename.kind !== 'rename' || config.kind !== 'configure') throw new Error('設定無效。')
  if (room.name !== rename.name) steps.push({command:lobbyCommand(rename),effect:{kind:'name',value:rename.name}})
  const mode = `${['HeadToHead','TagCoop','TeamVs','TagTeamVs'][Number(config.teamMode)]} · ${['Score','Accuracy','Combo','ScoreV2'][Number(config.scoreMode)]}`
  if (room.mode !== mode) steps.push({command:`!mp set ${config.teamMode} ${config.scoreMode}`,effect:{kind:'mode',value:mode}})
  if (!steps.length) throw new Error('目前設定已符合，沒有需要送出的步驟。')
  return {initial:structuredClone(room),steps}
}
