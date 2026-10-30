import test from 'node:test'
import assert from 'node:assert/strict'
import { remainingMatchSeconds } from '../src/shared/match-time.ts'
test('remaining time adjusts DT/NC/HT, clamps zero and keeps unknown metadata unknown', () => {
  assert.equal(remainingMatchSeconds(120000, 10, []), 110)
  assert.equal(remainingMatchSeconds(120000, 10, ['DT']), 70)
  assert.equal(remainingMatchSeconds(120000, 10, ['Nightcore']), 70)
  assert.equal(remainingMatchSeconds(120000, 10, ['Half', 'Time']), 150)
  assert.equal(remainingMatchSeconds(120000, 300, []), 0)
  assert.equal(remainingMatchSeconds(120000, 10, null), null)
  assert.equal(remainingMatchSeconds(null, 10, []), null)
  assert.equal(remainingMatchSeconds(120000, 10, ['DT', 'HT']), null)
})
