const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'oclr-ui-qa-'))
try {
  for (const [script, ...args] of [['scripts/website-launch-smoke.cjs'], ['scripts/smoke.cjs'], ['scripts/credential-smoke.cjs'], ['scripts/oclr-smoke.cjs'], ['scripts/relay-creation-smoke.cjs'], ['scripts/background-smoke.cjs'], ['scripts/mp-smoke.cjs'], ['scripts/room-plan-smoke.cjs'], ['scripts/journal-smoke.cjs'], ['scripts/settings-smoke.cjs'], ['scripts/settings-smoke.cjs', '--restart-check']]) {
    console.log(`[smoke] Starting ${script}`)
    const result = spawnSync(require('electron'), [script, ...args], {
      stdio: 'inherit', timeout: 60000, env: { ...process.env, OCLR_QA_TEMP: temp }
    })
    process.exitCode = result.status || (result.error ? 1 : 0)
    if (process.exitCode) {
      console.error(`[smoke] ${script} failed: ${result.error?.message || result.signal || `exit ${result.status}`}`)
      break
    }
  }
} finally { fs.rmSync(temp, { recursive: true, force: true }) }
