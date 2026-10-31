import test from 'node:test'
import assert from 'node:assert/strict'
import { manualRoster, compareLineup } from '../src/shared/lineup.ts'
import type { Room } from '../src/shared/types.ts'
const now = Date.now()
const room = { mode: 'TeamVs · ScoreV2', joined: true, binding: 'verified', slotsVerified: true, syncState: 'partial', observedAt: new Date(now).toISOString(), slots: [{ osuId: 101, slot: 1, team: 'red', username: 'Observed literal' }] } as Room
const roster = [{ osuId: 101, name: 'Manual alias' }, { osuId: 102, name: 'Bench' }]
test('manual roster validates stable unique IDs and literal bounded names', () => {
  assert.deepEqual(manualRoster(roster), roster)
  for (const bad of [[roster[0], roster[0]], [{osuId:0,name:'X'}], [{osuId:1,name:'a\nQUIT'}], [{osuId:NaN,name:'X'}], Array(33).fill(roster[0])]) assert.throws(() => manualRoster(bad))
})
test('lineup matches by UID without auto-selecting bench or choosing team; discrepancies remain distinct', () => {
  assert.deepEqual(compareLineup(roster, [{osuId:101,team:'red',slot:1}], room, now), [])
  assert.deepEqual(compareLineup(roster, [], room, now).map(x=>x.kind), ['empty','bench'])
  assert.deepEqual(compareLineup(roster, [{osuId:101,team:null,slot:null}], room, now).map(x=>x.kind), ['policy'])
  assert.deepEqual(compareLineup(roster, [{osuId:101,team:'blue',slot:2},{osuId:102,team:'red',slot:2}], room, now).map(x=>x.kind), ['conflict','team','slot','missing'])
  const result = compareLineup(roster, [{osuId:999,team:'red',slot:1}], room, now)
  assert.ok(result.some(x=>x.kind === 'unlisted')); assert.ok(result.some(x=>x.kind === 'missing'))
  assert.ok(compareLineup([], [], room, now).some(x=>x.kind === 'unlisted' && x.osuId === 101))
})
test('stale, unknown and disconnected observations never report a matching lineup or missing players', () => {
  for (const patch of [{joined:false},{binding:'unknown'},{slotsVerified:false},{syncState:'stale'},{observedAt:new Date(now-10000).toISOString()},{observedAt:new Date(now+1).toISOString()}]) {
    const result = compareLineup(roster, [{osuId:101,team:'red',slot:1}], {...room,...patch} as Room, now)
    assert.deepEqual(result, [{kind:'unknown'}])
  }
})

test('HeadToHead compares UID and slot without inventing a team, while unknown mode stays blocked', () => {
  const individual = { ...room, mode: 'HeadToHead · Score', slots: [{...room.slots[0], team: null}] } as Room
  assert.deepEqual(compareLineup(roster, [{osuId:101,team:null,slot:1}], individual, now), [])
  assert.ok(compareLineup(roster, [{osuId:101,team:'red',slot:1}], individual, now).some(x => x.kind === 'policy'))
  assert.ok(compareLineup(roster, [{osuId:101,team:null,slot:1}], {...individual, mode:null}, now).some(x => x.kind === 'unknown'))
  assert.ok(compareLineup(roster, [{osuId:101,team:null,slot:1}], {...individual, mode:'HeadToHeadUnknown · Score'}, now).some(x => x.kind === 'unknown'))
})
