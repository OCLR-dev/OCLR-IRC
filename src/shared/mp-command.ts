export type MpIntent = { kind: 'map'; beatmapId: string } | { kind: 'mods'; mods: string[] } | { kind: 'start' } | { kind: 'abort' }
export interface MpPreview { token: string; command: string; channel: string; expiresAt: string }
export const MP_MODS = ['NF', 'EZ', 'HD', 'HR', 'DT', 'HT', 'NC', 'FL', 'SD', 'PF', 'Freemod'] as const

/** Only typed, bounded manual intents reach the IRC wire. No raw command input. */
export function mpCommand(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('無效的房內操作。')
  const value = input as Record<string, unknown>
  if (value.kind === 'map') {
    if (typeof value.beatmapId !== 'string' || !/^[1-9]\d{0,15}$/.test(value.beatmapId) || !Number.isSafeInteger(Number(value.beatmapId))) throw new Error('請輸入有效的 beatmap ID（不是圖組 ID）。')
    return `!mp map ${value.beatmapId}`
  }
  if (value.kind === 'mods') {
    const mods = value.mods
    if (!Array.isArray(mods) || mods.length > MP_MODS.length || mods.some(mod => !MP_MODS.includes(mod)) || new Set(mods).size !== mods.length) throw new Error('無效的 Mods 組合。')
    if ([['EZ', 'HR'], ['DT', 'HT', 'NC'], ['NF', 'SD', 'PF']].some(group => group.filter(mod => mods.includes(mod)).length > 1)) throw new Error('選擇的 Mods 互相衝突。')
    return `!mp mods ${MP_MODS.filter(mod => mods.includes(mod)).join(' ') || 'None'}`
  }
  if (value.kind === 'start') return '!mp start'
  if (value.kind === 'abort') return '!mp abort'
  throw new Error('不支援此房內操作。')
}
