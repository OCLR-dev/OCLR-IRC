/** Estimate playable end from official .osu objects, not audio-file length. */
export function beatmapDuration(text: string, expectedId: number): number | null {
  if (text.length > 2_000_000 || !/^osu file format v\d+/.test(text)) return null
  const sections = new Map<string, string[]>()
  let section = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('//')) continue
    if (/^\[.+\]$/.test(line)) { section = line; sections.set(section, []); continue }
    sections.get(section)?.push(line)
  }
  const property = (name: string, key: string) => sections.get(name)?.find(line => line.startsWith(key + ':'))?.split(':').slice(1).join(':').trim()
  if (Number(property('[Metadata]', 'BeatmapID')) !== expectedId || Number(property('[General]', 'Mode') ?? 0) !== 0) return null
  const multiplier = Number(property('[Difficulty]', 'SliderMultiplier'))
  const timing = (sections.get('[TimingPoints]') ?? []).map(line => line.split(',').map(Number)).sort((a,b) => a[0] - b[0])
  let end = 0
  for (const line of sections.get('[HitObjects]') ?? []) {
    const fields = line.split(','), start = Number(fields[2]), type = Number(fields[3])
    if (!Number.isFinite(start) || start < 0 || !Number.isInteger(type)) return null
    let finish = start
    if (type & 8) finish = Number(fields[5])
    else if (type & 2) {
      let beat = NaN, velocity = 1
      for (const point of timing) {
        if (point[0] > start) break
        if (point[1] > 0) { beat = point[1]; velocity = 1 }
        else if (point[1] < 0) velocity = Math.min(10, Math.max(.1, -100 / point[1]))
      }
      const repeats = Number(fields[6]), length = Number(fields[7])
      if (!(multiplier > 0) || !Number.isInteger(repeats) || repeats < 1 || repeats > 10000 || !(length >= 0)) return null
      finish += length * repeats * beat / (100 * multiplier * velocity)
    } else if (!(type & 1)) return null
    if (!Number.isFinite(finish) || finish < start || finish > 7_200_000) return null
    end = Math.max(end, finish)
  }
  const leadIn = Number(property('[General]', 'AudioLeadIn') ?? 0)
  return end > 0 && Number.isFinite(leadIn) && leadIn >= 0 && leadIn <= 60000 ? Math.ceil(end + leadIn) : null
}

export async function fetchBeatmapDuration(id: number): Promise<number | null> {
  if (!Number.isSafeInteger(id) || id < 1) return null
  try {
    const response = await fetch(`https://osu.ppy.sh/osu/${id}`, { signal: AbortSignal.timeout(8000), redirect: 'error', credentials: 'omit' })
    if (!response.ok || !response.body) return null
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > 2_000_000) { await reader.cancel(); return null }
      chunks.push(value)
    }
    return beatmapDuration(Buffer.concat(chunks).toString('utf8'), id)
  } catch { return null }
}
