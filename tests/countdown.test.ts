import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countdownEvent, countdownLabel } from '../src/shared/countdown.ts'
import { mpCommand } from '../src/shared/mp-command.ts'

test('bounded timer intents never accept injection or implicit zero-delay start', () => {
  for (const kind of ['timer', 'start']) {
    assert.equal(mpCommand({ kind, seconds: '600' }), `!mp ${kind} 600`)
    for (const seconds of ['0', '-1', '601', '1.5', ' 10', '10\nQUIT', 10, null, '']) assert.throws(() => mpCommand({ kind, seconds }))
  }
  assert.equal(mpCommand({ kind: 'start' }), '!mp start')
  assert.equal(mpCommand({ kind: 'aborttimer' }), '!mp aborttimer')
  assert.throws(() => mpCommand({ kind: 'timer' }))
})

test('timer and start observations remain separate and elapsed estimates never imply playing', () => {
  const now = Date.parse('2026-10-30T02:00:00Z')
  const timer = countdownEvent('Countdown ends in 1 minute and 30 seconds', now)!
  assert.equal(timer.kind, 'timer')
  assert.equal(countdownLabel(timer.value, now), '約 1:30')
  assert.equal(countdownLabel(timer.value, now + 90000), '等待伺服器確認')
  assert.equal(timer.value.status, 'active')
  for (const body of ['Match starts in 10 seconds', 'Queued the match to start in 10 seconds']) assert.equal(countdownEvent(body, now)?.kind, 'start')
  assert.equal(countdownEvent('Countdown finished', now)?.value.status, 'finished')
  assert.equal(countdownEvent('Countdown aborted', now)?.kind, 'timer')
  assert.equal(countdownEvent('Aborted the match start timer', now)?.kind, 'start')
  for (const body of ['Countdown ends in 9999 minutes', 'Countdown ends in 1 minute and 99 seconds', 'Match starts in 0 seconds', 'Queued the match to start in -1 seconds', 'Countdown aborted extra']) assert.equal(countdownEvent(body, now), null)
})
