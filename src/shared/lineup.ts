import type { Room } from './types.ts'
/** Only known room modes determine whether a manual lineup needs team colors. */
export function lineupMode(room: Pick<Room, 'mode'>) {
  if (/^(?:TeamVs|TagTeamVs) · (?:Score|Accuracy|Combo|ScoreV2)$/.test(room.mode ?? '')) return 'teams'
  if (/^HeadToHead · (?:Score|Accuracy|Combo|ScoreV2)$/.test(room.mode ?? '')) return 'individual'
  return 'unknown'
}
export interface ManualRosterEntry { osuId: number; name: string }
export interface LineupSelection { osuId: number; team: 'red' | 'blue' | null; slot: number | null }
export type LineupDifference = { kind: 'unknown' | 'empty' | 'duplicate' | 'unlisted' | 'missing' | 'bench' | 'team' | 'slot' | 'conflict' | 'policy'; osuId?: number }
export function manualRoster(input: unknown): ManualRosterEntry[] {
  if (!Array.isArray(input) || input.length > 32) throw new Error('手動名單最多 32 人。')
  const ids = new Set<number>()
  return input.map(value => {
    if (!value || !Number.isSafeInteger(value.osuId) || value.osuId < 1 || typeof value.name !== 'string' || !value.name.trim() || [...value.name].length > 64 || /[\p{Cc}\p{Cf}]/u.test(value.name)) throw new Error('請輸入有效 UID 與玩家名稱。')
    if (ids.has(value.osuId)) throw new Error('名單包含重複 UID。')
    ids.add(value.osuId); return { osuId: value.osuId, name: value.name.trim() }
  })
}
/** Comparison only. A matching manual lineup never authorizes Start or a substitution. */
export function compareLineup(roster: ManualRosterEntry[], selection: LineupSelection[], room: Room, now = Date.now()): LineupDifference[] {
  const issues: LineupDifference[] = [], ids = new Set<number>(), slots = new Set<number>(), mode = lineupMode(room)
  if (!selection.length) issues.push({ kind: 'empty' })
  for (const player of selection) {
    if (ids.has(player.osuId)) issues.push({ kind: 'duplicate', osuId: player.osuId })
    ids.add(player.osuId)
    if (!roster.some(entry => entry.osuId === player.osuId)) issues.push({ kind: 'unlisted', osuId: player.osuId })
    if ((mode === 'individual' ? player.team !== null : player.team !== 'red' && player.team !== 'blue') || !Number.isInteger(player.slot) || player.slot! < 1 || player.slot! > 16) issues.push({ kind: 'policy', osuId: player.osuId })
    if (player.slot !== null && slots.has(player.slot)) issues.push({ kind: 'conflict', osuId: player.osuId })
    if (player.slot !== null) slots.add(player.slot)
  }
  const age = now - Date.parse(room.observedAt ?? '')
  if (mode === 'unknown' || !room.joined || room.binding !== 'verified' || !room.slotsVerified || !['complete', 'partial'].includes(room.syncState) || !Number.isFinite(age) || age < 0 || age >= 10000) return [...issues, { kind: 'unknown' }]
  for (const player of selection) {
    const actual = room.slots.find(slot => slot.osuId === player.osuId)
    if (!actual) issues.push({ kind: 'missing', osuId: player.osuId })
    else {
      if (mode === 'teams' && player.team !== null && actual.team !== player.team) issues.push({ kind: 'team', osuId: player.osuId })
      if (player.slot !== null && actual.slot !== player.slot) issues.push({ kind: 'slot', osuId: player.osuId })
    }
  }
  for (const actual of room.slots) {
    if (!roster.some(entry => entry.osuId === actual.osuId)) issues.push({ kind: 'unlisted', osuId: actual.osuId })
    else if (!ids.has(actual.osuId)) issues.push({ kind: 'bench', osuId: actual.osuId })
  }
  return issues
}
