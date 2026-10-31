import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
test('Linux helper installs a quoted per-user URI entry without executing the application', {skip: process.platform === 'win32'}, () => {
  const root = mkdtempSync(join(tmpdir(), 'oclr-protocol-test-'))
  try {
    const dir = join(root, 'Portable $IRC % "quoted"'), bin = join(root, 'bin'), data = join(root, 'data')
    mkdirSync(dir); mkdirSync(bin)
    copyFileSync('scripts/install-linux-protocol.sh', join(dir, 'install-protocol.sh'))
    writeFileSync(join(dir, 'OCLR IRC'), '#!/bin/sh\nexit 99\n', {mode: 0o755})
    writeFileSync(join(bin, 'xdg-mime'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$OCLR_TEST_XDG_LOG"\n', {mode: 0o755})
    const log = join(root, 'xdg.log')
    const result = spawnSync('bash', [join(dir, 'install-protocol.sh')], {encoding: 'utf8', env: {...process.env, PATH: bin+':'+process.env.PATH, XDG_DATA_HOME: data, OCLR_TEST_XDG_LOG: log}})
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(log, 'utf8'), 'default\noclr-irc.desktop\nx-scheme-handler/oclr-irc\n')
    const entry = readFileSync(join(data, 'applications', 'oclr-irc.desktop'), 'utf8')
    assert.ok(entry.includes('MimeType=x-scheme-handler/oclr-irc;'))
    assert.ok(entry.includes('Exec="')); assert.ok(entry.includes('\\$IRC %% \\"quoted\\"/OCLR IRC" %u'))
    assert.ok(!entry.includes('sudo'))
  } finally {rmSync(root, {recursive: true, force: true})}
})
