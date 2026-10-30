// Test-only public metadata transport; never make a live osu! request in smoke.
const original = global.fetch
global.fetch = async (url, options) => {
  const match = /^https:\/\/osu\.ppy\.sh\/osu\/(\d+)$/.exec(String(url))
  if (match) return new Response(`osu file format v14\n[General]\nMode:0\n[Metadata]\nBeatmapID:${match[1]}\n[Difficulty]\nSliderMultiplier:1.4\n[TimingPoints]\n0,500\n[HitObjects]\n0,0,120000,1,0`, { status: 200 })
  return original(url, options)
}
