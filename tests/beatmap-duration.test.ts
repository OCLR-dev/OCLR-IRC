import test from 'node:test'
import assert from 'node:assert/strict'
import { beatmapDuration } from '../src/main/beatmap-duration.ts'
const map = (objects: string) => `osu file format v14\n[General]\nMode:0\n[Metadata]\nBeatmapID:75\n[Difficulty]\nSliderMultiplier:1.4\n[TimingPoints]\n0,500,4,1,0,100,1\n[HitObjects]\n${objects}`
test('duration uses object ends including slider repeats and spinners', () => {
  assert.equal(beatmapDuration(map('0,0,1000,2,0,B|0:0,2,140'), 75), 2000)
  assert.equal(beatmapDuration(map('0,0,1000,8,0,5000'), 75), 5000)
  assert.equal(beatmapDuration(map('0,0,1000,1,0'), 75), 1000)
  assert.equal(beatmapDuration(map('0,0,1000,2,0,B|0:0,2,140').replace('[HitObjects]', '500,-50,4,1,0,100,0\n[HitObjects]'), 75), 1500)
})
test('wrong map, unsupported ruleset and invalid duration stay unknown', () => {
  for (const text of [map('0,0,1000,8,0,NaN'), map('0,0,1000,8,0,500'), map('0,0,1000,1,0').replace('Mode:0','Mode:3'), '<html>error</html>']) assert.equal(beatmapDuration(text,75),null)
  assert.equal(beatmapDuration(map('0,0,1000,1,0'),76),null)
})
