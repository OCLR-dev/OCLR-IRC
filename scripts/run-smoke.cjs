const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'oclr-ui-qa-'))
try {
  for (const script of ['scripts/smoke.cjs', 'scripts/credential-smoke.cjs', 'scripts/oclr-smoke.cjs', 'scripts/background-smoke.cjs', 'scripts/mp-smoke.cjs', 'scripts/journal-smoke.cjs']) {
    const result = spawnSync(require('electron'), [script], {
      stdio: 'inherit', timeout: 60000, env: { ...process.env, OCLR_QA_TEMP: temp }
    })
    process.exitCode = result.status || (result.error ? 1 : 0)
    if (process.exitCode) break
  }
} finally { fs.rmSync(temp, { recursive: true, force: true }) }
