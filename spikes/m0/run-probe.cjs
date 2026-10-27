// Own temporary files in the parent so Chromium has exited before cleanup.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'oclr-m0-'));
const binary = process.argv[2] || require('electron');
const args = process.argv[2] ? [] : ['.'];
try {
  for (const phase of ['initial', 'restart']) {
    const output = process.env.OCLR_SPIKE_REPORT;
    const report = output && (phase === 'initial' ? output : output.replace(/\.json$/, '-restart.json'));
    const result = spawnSync(binary, args, { stdio: 'inherit', timeout: 60000,
      env: { ...process.env, OCLR_SPIKE_TEMP: temp, OCLR_SPIKE_PHASE: phase, ...(report ? { OCLR_SPIKE_REPORT: report } : {}) } });
    if (result.status !== 0) { process.exitCode = result.status || 1; break; }
  }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
