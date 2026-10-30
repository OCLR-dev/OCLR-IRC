/** Display-only estimate; reaching zero must never change match phase. */
export function remainingMatchSeconds(durationMs: number | null, elapsedSeconds: number | null, mods: string[] | null | undefined): number | null {
  if (durationMs === null || elapsedSeconds === null || mods == null || !Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(elapsedSeconds)) return null
  const names = mods.map(mod => mod.replace(/\s/g, '').toLowerCase())
  const combined = names.join('')
  const fast = names.some(mod => mod === 'dt' || mod === 'nc') || /(?:doubletime|nightcore)/.test(combined)
  const slow = names.includes('ht') || combined.includes('halftime')
  if (fast && slow) return null
  const rate = fast ? 1.5 : slow ? .75 : 1
  return Math.max(0, Math.ceil(durationMs / rate / 1000 - Math.max(0, elapsedSeconds)))
}
