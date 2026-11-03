import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
const { distribution } = createRequire(import.meta.url)('../scripts/distribution.cjs')
const { verifyIdentity, verifyPackagedIcons } = createRequire(import.meta.url)('../scripts/verify-archive.cjs')
const { createPackage } = createRequire(import.meta.url)('@electron/asar')

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

test('packaged icon verification reads native paths in both ASAR and loose packages and rejects a damaged launcher icon', async () => {
  for (const packed of [false, true]) {
    const dir = mkdtempSync(join(tmpdir(), 'oclr-icon-package-'))
    try {
      const source = join(dir, 'resources', 'app'), icons = join(source, 'resources', 'icons')
      mkdirSync(icons, { recursive: true })
      for (const file of ['icon.png', 'tray-color.png', 'trayTemplate.png', 'trayTemplate@2x.png', 'LICENSE.txt']) copyFileSync(join('resources', 'icons', file), join(icons, file))
      copyFileSync('resources/icons/icon-256.png', join(dir, 'oclr-irc.png'))
      if (packed) { await createPackage(source, join(dir, 'resources', 'app.asar')); rmSync(source, { recursive: true }) }
      verifyPackagedIcons(dir, 'linux')
      writeFileSync(join(dir, 'oclr-irc.png'), 'damaged synthetic icon')
      assert.throws(() => verifyPackagedIcons(dir, 'linux'), assert.AssertionError)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
})
