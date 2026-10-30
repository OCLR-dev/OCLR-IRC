import { mpCommand } from './mp-command.ts'
export interface MapProfile { beatmapId: string; roomMods: string[]; freemod: boolean; individualModsPolicy: 'disabled' | 'manual'; ruleset: 'current'; revision: string }
export function mapProfile(input: unknown): MapProfile {
  if (!input || typeof input !== 'object') throw new Error('無效的選圖設定。')
  const p = input as Record<string, unknown>
  mpCommand({ kind: 'map', beatmapId: p.beatmapId })
  mpCommand({ kind: 'mods', mods: p.roomMods })
  if ((p.roomMods as string[]).includes('Freemod') || typeof p.freemod !== 'boolean' || p.ruleset !== 'current' || typeof p.revision !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(p.revision)) throw new Error('選圖設定或版本無效。')
  if (p.individualModsPolicy !== (p.freemod ? 'manual' : 'disabled')) throw new Error('個人 Mods 規則尚未確認。')
  return { beatmapId: p.beatmapId as string, roomMods: [...p.roomMods as string[]], freemod: p.freemod, individualModsPolicy: p.freemod ? 'manual' : 'disabled', ruleset: 'current', revision: p.revision }
}
export function profileCommands(profile: MapProfile) { return [mpCommand({ kind: 'map', beatmapId: profile.beatmapId }), mpCommand({ kind: 'mods', mods: [...profile.roomMods, ...(profile.freemod ? ['Freemod'] : [])] })] }
export type PlanStepState = 'queued' | 'sending' | 'awaiting' | 'observed' | 'unknown' | 'failed' | 'cancelled'
export interface MapPlanState { id: string; roomId: number; roomEpoch: number; revision: string; state: PlanStepState; steps: { command: string; state: PlanStepState }[] }
export interface MapPlanPreview { token: string; channel: string; commands: string[]; expiresAt: string; freemod: boolean }
