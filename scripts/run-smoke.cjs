const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'oclr-ui-qa-'))
try {
  const result = spawnSync(require('electron'), ['scripts/smoke.cjs'], {
    stdio: 'inherit', timeout: 40000, env: { ...process.env, OCLR_QA_TEMP: temp }
  })
  process.exitCode = result.status || (result.error ? 1 : 0)
} finally { fs.rmSync(temp, { recursive: true, force: true }) }
