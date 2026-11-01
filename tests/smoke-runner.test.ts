import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import * as path from 'node:path'

const runner = readFileSync(new URL('../scripts/run-smoke.cjs', import.meta.url), 'utf8')

function run(result: { status: number | null; signal?: string; error?: Error }) {
  let launches = 0, cleaned = false
  const errors: string[] = [], process = { platform: 'linux', env: {}, exitCode: 0 }
  const modules: Record<string, unknown> = {
    'node:child_process': { spawnSync() { launches++; return result } },
    'node:fs': { mkdtempSync: () => '/synthetic/profile', rmSync() { cleaned = true } },
    'node:os': { tmpdir: () => '/synthetic' },
    'node:path': path,
    electron: '/synthetic/electron'
  }
  runInNewContext(runner, { require: (name: string) => { assert.ok(name in modules); return modules[name] }, process, console: { log() {}, error: (message: string) => errors.push(message) } })
  return { launches, cleaned, exitCode: process.exitCode, errors }
}

test('smoke runner stops after a signalled Electron startup instead of launching further apps', () => {
  const result = run({ status: null, signal: 'SIGABRT' })
  assert.equal(result.exitCode, 1)
  assert.equal(result.launches, 1)
  assert.equal(result.cleaned, true)
  assert.match(result.errors[0], /SIGABRT/)
})

test('smoke runner stops on timeouts and nonzero exits and cleans the synthetic profile', () => {
  for (const failure of [{ status: null, error: new Error('ETIMEDOUT') }, { status: 2 }]) {
    const result = run(failure)
    assert.ok(result.exitCode > 0)
    assert.equal(result.launches, 1)
    assert.equal(result.cleaned, true)
    assert.equal(result.errors.length, 1)
  }
})

test('smoke runner continues through successful Electron processes', () => {
  const result = run({ status: 0 })
  assert.equal(result.exitCode, 0)
  assert.ok(result.launches > 1)
  assert.equal(result.cleaned, true)
  assert.deepEqual(result.errors, [])
})
