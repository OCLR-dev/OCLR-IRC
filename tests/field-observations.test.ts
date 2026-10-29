import test from 'node:test'
import assert from 'node:assert/strict'
import { SettingsCollector } from '../src/main/settings.ts'

// Synthetic protocol fixtures; these do not establish real Bancho defaults.
const header = 'Room name: Synthetic, History: https://osu.ppy.sh/mp/9'
test('empty settings preserve missing fields and query identity', () => {
  const collector = new SettingsCollector(9, 7)
  collector.feed(header)
  collector.feed('Players: 0')
  const fields = collector.observations(3)
  assert.equal(fields.players.value, 0)
  assert.equal(fields.slots.knowledge, 'known')
  assert.deepEqual(fields.slots.value, [])
  for (const field of [fields.mods, fields.beatmap, fields.capacity, fields.phase, fields.timer, fields.individualMods]) assert.equal(field.knowledge, 'unknown')
  assert.equal(fields.players.connectionGeneration, 7)
  assert.equal(fields.players.roomEpoch, 3)
  assert.equal(fields.players.queryId, fields.mods.queryId)
  assert.notEqual(fields.players.queryId, new SettingsCollector(9).observations(3).players.queryId)
  assert.equal(collector.observations(3, true).players.knowledge, 'unknown')
})
test('mismatched history invalidates field evidence', () => {
  const collector = new SettingsCollector(10)
  collector.feed(header)
  collector.feed('Players: 0')
  assert.equal(collector.observations(1).slots.knowledge, 'invalid')
})
test('returned slots cannot mutate collector evidence', () => {
  const collector = new SettingsCollector(9)
  collector.feed(header)
  collector.feed('Players: 0')
  collector.observations(1).slots.value!.push({ slot: 1 } as never)
  assert.deepEqual(collector.observations(1).slots.value, [])
})
