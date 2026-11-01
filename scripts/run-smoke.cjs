const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'oclr-ui-qa-'))
const restorePhases = process.platform === 'linux' ? ['seed', 'unavailable'] : ['seed', 'restore', 'logged-out', 'enable-pending', 'cancel', 'disable', 'forget', 'manual', 'bad-password', 'corrupt', 'unavailable']
const backgroundPhases = ['initial-hidden', 'initial-foreground', 'initial-minimized', 'updated-hidden', 'updated-foreground', 'updated-minimized', 'close-disabled']
try {
  for (const [script, ...args] of [['scripts/website-room-join-smoke.cjs'], ['scripts/website-launch-smoke.cjs'], ['scripts/smoke.cjs'], ['scripts/credential-smoke.cjs'], ['scripts/oclr-smoke.cjs'], ['scripts/relay-creation-smoke.cjs'], ...backgroundPhases.map(phase => ['scripts/background-smoke.cjs', phase]), ['scripts/mp-smoke.cjs'], ['scripts/room-plan-smoke.cjs'], ['scripts/journal-smoke.cjs'], ['scripts/settings-smoke.cjs'], ['scripts/settings-smoke.cjs', '--restart-check'], ...restorePhases.map(phase => ['scripts/login-restore-smoke.cjs', phase])]) {
    console.log(`[smoke] Starting ${script} ${args.join(' ')}`)
    const result = spawnSync(require('electron'), [script, ...args], {
      stdio: 'inherit', timeout: 60000, env: { ...process.env, OCLR_QA_TEMP: temp }
    })
    process.exitCode = result.status ?? 1
    if (process.exitCode) {
      console.error(`[smoke] ${script} failed: ${result.error?.message || result.signal || `exit ${result.status}`}`)
      break
    }
  }
} finally { fs.rmSync(temp, { recursive: true, force: true }) }
