import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
const { validate, assemble, assertReleaseAvailable } = createRequire(import.meta.url)('../scripts/prepare-release.cjs')

test('release publishing requires matching existing tag; branch runs are dry-run only', () => {
  const tag = { REQUIRE_SIGNED_MAC: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v0.4.0' }
  validate('0.4.0', '0.4.0', tag)
  assert.throws(() => validate('0.4.0', '0.4.0', { ...tag, REQUIRE_SIGNED_MAC: 'false' }))
  assert.throws(() => validate('0.4.0', '0.4.1', tag))
  assert.throws(() => validate('0.4.0', '0.4.0', tag, '0.4.1'))
  assert.throws(() => validate('0.4.0', '0.4.0', tag, null))
  assert.throws(() => validate('0.4.0', '0.4.0', { ...tag, GITHUB_REF_NAME: 'v0.5.0' }))
  assert.throws(() => validate('0.4.0', '0.4.0', { ...tag, GITHUB_REF_TYPE: 'branch' }))
  validate('0.4.0', '0.4.0', { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_TYPE: 'branch', DRY_RUN: 'true' })
  assert.throws(() => validate('0.4.0', '0.4.0', { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_TYPE: 'branch', DRY_RUN: 'false' }))
})

test('release preflight accepts only absent releases and fails closed without exposing credentials', async () => {
  const token = 'SYNTHETIC_RELEASE_TOKEN'
  for (const status of [200, 401, 403, 429, 500]) {
    await assert.rejects(assertReleaseAvailable('OCLR-dev/OCLR-IRC', 'v0.7.0', token, async () => ({ status })), error => {
      assert.doesNotMatch((error as Error).message, new RegExp(token)); return true
    })
  }
  await assertReleaseAvailable('OCLR-dev/OCLR-IRC', 'v0.7.0', token, async (url: string, options: { headers: { Authorization: string } }) => {
    assert.equal(url, 'https://api.github.com/repos/OCLR-dev/OCLR-IRC/releases/tags/v0.7.0')
    assert.equal(options.headers.Authorization, `Bearer ${token}`)
    return { status: 404 }
  })
  await assert.rejects(assertReleaseAvailable('OCLR-dev/OCLR-IRC', 'v0.7.0', token, async () => { throw new Error(token) }), /Could not check existing release/)
  await assert.rejects(assertReleaseAvailable('OCLR-dev/OCLR-IRC', 'v0.7.0', ''))
  await assert.rejects(assertReleaseAvailable('untrusted/../../path', 'v0.7.0', token))
})

test('release assembly requires all three identities and hashes before producing assets', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'oclr-release-')), input = join(temp, 'input'), output = join(temp, 'output')
  const sha = 'a'.repeat(40), version = '0.4.0'
  mkdirSync(input)
  let archive = '', metadataFile = ''
  try {
    for (const [platform, arch, ext] of [['windows', 'x64', '.zip'], ['linux', 'x64', '.tar.gz'], ['macos', 'arm64', '.zip']]) {
      const name = `OCLR-IRC-${version}-${platform}-${arch}-${sha.slice(0, 7)}`, dir = join(input, name), filename = name + ext
      mkdirSync(dir); archive = join(dir, filename); writeFileSync(archive, 'synthetic archive')
      writeFileSync(join(dir, 'SHA256SUMS.txt'), `${createHash('sha256').update('synthetic archive').digest('hex')}  ${filename}\n`)
      metadataFile = join(dir, 'build-info.json')
      writeFileSync(metadataFile, JSON.stringify({ version, commit: sha, platform, arch, signed: false }))
    }
    await assert.rejects(assemble(input, output, version, sha, true), /notarized/); assert.equal(existsSync(output), false)
    const originalMetadata = readFileSync(metadataFile)
    writeFileSync(metadataFile, JSON.stringify({ version, commit: 'b'.repeat(40), platform: 'macos', arch: 'arm64', signed: false }))
    await assert.rejects(assemble(input, output, version, sha), /identity/); assert.equal(existsSync(output), false)
    writeFileSync(metadataFile, originalMetadata); writeFileSync(archive, 'corrupt')
    await assert.rejects(assemble(input, output, version, sha), /checksum/); assert.equal(existsSync(output), false)
    writeFileSync(archive, 'synthetic archive'); await assemble(input, output, version, sha)
    assert.equal(readFileSync(join(output, 'SHA256SUMS.txt'), 'utf8').trim().split('\n').length, 3)
    assert.equal(JSON.parse(readFileSync(join(output, 'build-info.json'), 'utf8')).length, 3)
    const notes = readFileSync(join(output, 'RELEASE_NOTES.md'), 'utf8')
    for (const [platform, arch, ext] of [['windows', 'x64', '.zip'], ['linux', 'x64', '.tar.gz'], ['macos', 'arm64', '.zip']]) {
      assert.ok(notes.includes(`https://github.com/OCLR-dev/OCLR-IRC/releases/download/v${version}/OCLR-IRC-${version}-${platform}-${arch}-${sha.slice(0, 7)}${ext}`))
    }
    writeFileSync(metadataFile, JSON.stringify({ version, commit: sha, platform: 'macos', arch: 'arm64', signed: true, codeSigning: 'developer-id', notarized: true, teamId: 'ABCDEF1234' }))
    await assemble(input, output, version, sha, true)
    assert.match(readFileSync(join(output, 'RELEASE_NOTES.md'), 'utf8'), /macOS is Developer ID signed/)
    mkdirSync(join(input, 'unexpected'))
    await assert.rejects(assemble(input, join(temp, 'other'), version, sha), /exactly three/)
  } finally { rmSync(temp, { recursive: true, force: true }) }
})
