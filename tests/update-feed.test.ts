import assert from 'node:assert/strict'
import { generateKeyPairSync, verify } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { decodeUpdatePublicKey, parseWindowsUpdate, publicRelease, windowsUpdate } from '../src/main/update-feed.ts'

const { writeUpdateAssets } = createRequire(import.meta.url)('../scripts/update-assets.cjs')

test('only newer stable GitHub releases are reported for manual download', async () => {
  const reply = (tag_name: string, prerelease = false): typeof fetch => async (_input, options) => {
    assert.equal(_input, 'https://api.github.com/repos/OCLR-dev/OCLR-IRC/releases/latest')
    assert.equal(options?.redirect, 'error')
    assert.equal(options?.credentials, 'omit')
    return Response.json({ tag_name, draft: false, prerelease })
  }
  assert.equal(await publicRelease(reply('v0.10.0'), '0.9.9'), '0.10.0')
  assert.equal(await publicRelease(reply('v0.9.0'), '0.9.0'), null)
  assert.equal(await publicRelease(reply('v0.9.0'), '0.10.0'), null)
  assert.equal(await publicRelease(reply('v0.9.0'), '0.9.0-rc.1'), '0.9.0')
  await assert.rejects(publicRelease(reply('v0.9.1-rc.1', true), '0.9.0'))
  await assert.rejects(publicRelease(reply('v0.9.1/installer'), '0.9.0'))
})

test('stable release metadata authenticates both the Windows installer identity and the Sparkle archive', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oclr-synthetic-updates-'))
  const commit = 'd'.repeat(40), version = '0.10.0'
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const edSeed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('base64')
  const edPublic = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')
  const env = { OCLR_UPDATE_PUBLIC_KEY: edPublic, OCLR_UPDATE_PRIVATE_KEY: edSeed }
  const windows = { installer: { file: 'OCLR-IRC-0.10.0-windows-x64-ddddddd-setup.exe' }, metadata: { updatePublicKey: edPublic } }
  const mac = { installer: { file: 'OCLR-IRC-0.10.0-macos-arm64-ddddddd.dmg' }, metadata: { updatePublicKey: edPublic, notarized: true } }
  try {
    assert.deepEqual(writeUpdateAssets(dir, version, commit, windows, mac, {}), [])
    assert.deepEqual(writeUpdateAssets(dir, `${version}-rc.1`, commit, windows, mac, env), [])
    assert.throws(() => writeUpdateAssets(dir, version, commit, windows, mac, { OCLR_UPDATE_PUBLIC_KEY: edPublic }), /both/)
    assert.throws(() => writeUpdateAssets(dir, version, commit, windows, { ...mac, metadata: { ...mac.metadata, notarized: false } }, env), /notarized/)
    assert.equal(existsSync(join(dir, 'appcast.xml')), false)
    writeFileSync(join(dir, windows.installer.file), 'synthetic Windows installer')
    const dmg = Buffer.from('synthetic macOS disk image')
    writeFileSync(join(dir, mac.installer.file), dmg)
    assert.deepEqual(writeUpdateAssets(dir, version, commit, windows, mac, env), ['windows-update.json', 'appcast.xml'])
    const envelope = JSON.parse(readFileSync(join(dir, 'windows-update.json'), 'utf8'))
    const decoded = decodeUpdatePublicKey(edPublic)
    const info = await windowsUpdate(async url => {
      assert.equal(url, 'https://github.com/OCLR-dev/OCLR-IRC/releases/latest/download/windows-update.json')
      return Response.json(envelope)
    }, decoded)
    assert.equal(info.version, version)
    assert.equal(info.files[0].url, `https://github.com/OCLR-dev/OCLR-IRC/releases/download/v${version}/${windows.installer.file}`)
    assert.equal(info.files[0].size, Buffer.byteLength('synthetic Windows installer'))
    const payload = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'))
    payload.size++
    assert.throws(() => parseWindowsUpdate({ ...envelope, payload: Buffer.from(JSON.stringify(payload)).toString('base64') }, decoded), /signature/)
    assert.throws(() => parseWindowsUpdate(envelope, generateKeyPairSync('ed25519').publicKey), /signature/)
    await assert.rejects(windowsUpdate(async () => new Response('x'.repeat(4097)), decoded), /too large/)
    const appcast = readFileSync(join(dir, 'appcast.xml'), 'utf8')
    const signature = /sparkle:edSignature="([^"]+)"/.exec(appcast)?.[1]
    assert.ok(signature)
    assert.ok(verify(null, dmg, decoded, Buffer.from(signature, 'base64')))
    assert.ok(appcast.includes(`/download/v${version}/${mac.installer.file}`))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
