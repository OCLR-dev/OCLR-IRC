import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Operations } from '../src/main/operations.ts'
import { SqliteOperationStore } from '../src/main/operation-store.ts'

test('same-room operation gate, scoped replies and review never imply causal success', () => {
  const ops = new Operations(() => {})
  ops.authenticate('Alice')
  const id = ops.begin('manual', 'map', 1, 4, 2, '!mp map 75')
  assert.throws(() => ops.begin('oclr', 'mods', 1, 4, 2, '!mp mods HD'))
  ops.observe(2, 4, 2, 'Changed beatmap to https://osu.ppy.sh/b/75 Map')
  ops.observe(1, 3, 2, 'Changed beatmap to https://osu.ppy.sh/b/75 Map')
  ops.observe(1, 4, 1, 'Changed beatmap to https://osu.ppy.sh/b/75 Map')
  ops.observe(1, 4, 2, 'Changed beatmap to https://osu.ppy.sh/b/76 Map')
  assert.equal(ops.snapshot.records[0].state, 'awaiting')
  ops.observe(1, 4, 2, 'Changed beatmap to https://osu.ppy.sh/b/75 Map')
  assert.equal(ops.snapshot.records[0].state, 'observed')
  assert.throws(() => ops.review({ id, reviewed: true }))
  const timer = ops.begin('manual', 'timer', 1, 4, 2, '!mp timer 30')
  assert.throws(() => ops.review({ id: timer, reviewed: false }))
  ops.review({ id: timer, reviewed: true })
  assert.equal(ops.snapshot.records[1].state, 'unknown')
  assert.equal(ops.snapshot.records[1].reviewed, true)
  ops.logout()
})

test('deadline and disconnect produce unknown; late reply never revives interrupted operation', async () => {
  const ops = new Operations(() => {}, undefined, 10)
  ops.authenticate('Alice')
  ops.begin('manual', 'abort', 1, 1, 1, '!mp abort')
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(ops.snapshot.records[0].state, 'unknown')
  ops.observe(1, 1, 1, 'Aborted the match')
  assert.equal(ops.snapshot.records[0].state, 'unknown')
  assert.throws(() => ops.begin('manual', 'map', 1, 1, 1, '!mp map 75'))
  const other = ops.begin('manual', 'abort', 2, 1, 1, '!mp abort')
  ops.interrupt(2)
  assert.equal(ops.snapshot.records.find(r => r.id === other)?.state, 'unknown')
  ops.logout()
})

test('recovery stores no command/private name, scopes accounts, fails before send and recovers pending as unknown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oclr-operation-test-')), file = join(dir, 'operations.sqlite')
  const store = new SqliteOperationStore(file)
  try {
    const ops = new Operations(() => {}, store)
    ops.authenticate('Alice')
    ops.begin('manual', 'make', null, 0, 1, '!mp make PRIVATE_TEAM_NAME')
    const second = new SqliteOperationStore(file)
    const recovered = new Operations(() => {}, second)
    recovered.authenticate('Alice')
    assert.equal(recovered.snapshot.records[0].state, 'unknown')
    assert.throws(() => recovered.begin('manual', 'make', null, 0, 2, '!mp make Another'))
    recovered.authenticate('Bob'); assert.equal(recovered.snapshot.records.length, 0)
    assert.equal(readFileSync(file).includes(Buffer.from('PRIVATE_TEAM_NAME')), false)
    assert.equal(readFileSync(file).includes(Buffer.from('Alice')), false)
    ops.logout(); assert.equal(store.load('Alice').length, 0)
    recovered.logout(); second.close()
    const broken = new Operations(() => {}, { load() { return [] }, save() { throw new Error('disk full') }, clear() {} })
    broken.authenticate('Alice')
    assert.throws(() => broken.begin('manual', 'map', 1, 1, 1, '!mp map 75'))
    assert.equal(broken.snapshot.failed, true)
    assert.equal(broken.snapshot.records.length, 0)
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('step deadlines can extend only active plans and never revive interrupted results', async () => {
  const ops = new Operations(()=>{},undefined,10);ops.authenticate('Alice')
  const id=ops.begin('manual','roomplan',1,1,1,'')
  assert.equal(ops.extend(id,100),true)
  await new Promise(resolve=>setTimeout(resolve,25));assert.equal(ops.snapshot.records[0].state,'awaiting')
  ops.interrupt();assert.equal(ops.extend(id,100),false)
  assert.equal(ops.snapshot.records[0].state,'unknown');ops.logout()
})
