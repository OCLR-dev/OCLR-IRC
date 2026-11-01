import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
const { distribution } = createRequire(import.meta.url)('../scripts/distribution.cjs')
const { verifyIdentity } = createRequire(import.meta.url)('../scripts/verify-archive.cjs')

test('native archive verification rejects wrong builds and corruption before extraction or launch', async () => {
  for (const [platform, arch, label, ext] of [['win32', 'x64', 'windows', '.zip'], ['linux', 'x64', 'linux', '.tar.gz'], ['darwin', 'arm64', 'macos', '.zip']]) {
    const dir = mkdtempSync(join(tmpdir(), 'oclr-verify-test-'))
    const commit = 'a'.repeat(40), version = '0.7.0'
    const filename = `OCLR-IRC-${version}-${label}-${arch}-${commit.slice(0, 7)}${ext}`
    const installer = distribution(version, commit, label, arch).installer
    const metadata = { commit, version, platform: label, arch, installer }
    try {
      writeFileSync(join(dir, filename), 'synthetic')
      writeFileSync(join(dir, 'build-info.json'), JSON.stringify(metadata))
      if (installer) writeFileSync(join(dir, installer.file), 'synthetic installer')
      writeFileSync(join(dir, 'SHA256SUMS.txt'), `${createHash('sha256').update('synthetic').digest('hex')}  ${filename}\n` + (installer ? `${createHash('sha256').update('synthetic installer').digest('hex')}  ${installer.file}\n` : ''))
      assert.equal((await verifyIdentity(dir, platform, arch, commit, version)).filename, filename)
      await assert.rejects(verifyIdentity(dir, platform, arch, 'b'.repeat(40), version), /identity/)
      await assert.rejects(verifyIdentity(dir, platform, arch, '', version), /identity/)
      writeFileSync(join(dir, 'build-info.json'), JSON.stringify({ ...metadata, commit: 'b'.repeat(40) }))
      await assert.rejects(verifyIdentity(dir, platform, arch, commit, version), /identity/)
      writeFileSync(join(dir, 'build-info.json'), JSON.stringify(metadata))
      writeFileSync(join(dir, filename), 'corrupt')
      await assert.rejects(verifyIdentity(dir, platform, arch, commit, version), /checksum/)
      writeFileSync(join(dir, 'extra.zip'), 'extra')
      await assert.rejects(verifyIdentity(dir, platform, arch, commit, version), /Unexpected/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
})
