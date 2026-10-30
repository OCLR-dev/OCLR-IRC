import test from 'node:test'
import assert from 'node:assert/strict'
import { OperationPlan } from '../src/main/operation-plan.ts'
import type { MapPlanState } from '../src/shared/map-profile.ts'
const initial = (): MapPlanState => ({ id: 'synthetic', roomId: 9, roomEpoch: 1, revision: 'v1', state: 'queued', steps: [{ command: '!mp map 1', state: 'queued' }, { command: '!mp mods HD', state: 'queued' }] })
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
test('queued cancel sends nothing and a transport throw never dispatches the next step', async () => {
  let sends = 0, finished = 0
  const driver = { ready: () => 'wait' as const, send: () => { sends++ }, observe: () => 'wait' as const, changed() {}, finished() { finished++ } }
  const waiting = new OperationPlan(initial(), driver, 100)
  waiting.start(); waiting.cancel(); await pause(60)
  assert.equal(sends, 0); assert.equal(finished, 1)
  assert.deepEqual(waiting.state.steps.map(s => s.state), ['cancelled', 'cancelled'])
  const throwing = new OperationPlan(initial(), { ...driver, ready: () => 'ready', send() { sends++; throw new Error('wire ambiguity') } }, 100)
  throwing.start(); await pause(60)
  assert.equal(sends, 1); assert.equal(throwing.state.state, 'unknown')
  assert.deepEqual(throwing.state.steps.map(s => s.state), ['unknown', 'cancelled'])
})
test('only the first effect observed stays observed after later timeout; snapshots cannot change the plan', async () => {
  const sent: number[] = []
  const plan = new OperationPlan(initial(), { ready: () => 'ready', send: i => { sent.push(i) }, observe: i => i === 0 ? 'match' : 'wait', changed() {}, finished() {} }, 100)
  plan.start()
  plan.state.steps[0].state = 'cancelled'
  await pause(260)
  assert.deepEqual(sent, [0, 1])
  assert.deepEqual(plan.state.steps.map(s => s.state), ['observed', 'unknown'])
  assert.equal(plan.state.state, 'unknown')
  plan.cancel(); await pause(50); assert.deepEqual(sent, [0, 1])
})
