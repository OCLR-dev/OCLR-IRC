const fs = require('node:fs')
const path = require('node:path')
const { createHash, createPrivateKey, createPublicKey, sign } = require('node:crypto')

const releases = 'https://github.com/OCLR-dev/OCLR-IRC/releases'

function decodeKey(value) {
  const raw = Buffer.from(value || '', 'base64')
  if (raw.length !== 32 || raw.toString('base64') !== value) throw new Error('Update signing key must be 32 bytes encoded as base64')
  return raw
}

function updatePublicKey(env = process.env) {
  const key = env.OCLR_UPDATE_PUBLIC_KEY?.trim() || ''
  if (key) decodeKey(key)
  return key
}

function writeUpdateAssets(dir, version, commit, windows, mac, env = process.env) {
  const publicKey = updatePublicKey(env), seed = env.OCLR_UPDATE_PRIVATE_KEY?.trim()
  if (version.includes('-') || (!publicKey && !seed)) return []
  if (!publicKey || !seed) throw new Error('Configure both update signing keys for a stable release')
  if (windows.metadata.updatePublicKey !== publicKey || mac.metadata.updatePublicKey !== publicKey || !mac.metadata.notarized) throw new Error('Update artifacts must have the configured key and a notarized macOS app')
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), decodeKey(seed)]), format: 'der', type: 'pkcs8' })
  if (!createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32).equals(decodeKey(publicKey))) throw new Error('Update signing keys do not match')

  const exe = fs.readFileSync(path.join(dir, windows.installer.file))
  const payload = Buffer.from(JSON.stringify({ version, commit, size: exe.length, sha512: createHash('sha512').update(exe).digest('base64') }))
  fs.writeFileSync(path.join(dir, 'windows-update.json'), JSON.stringify({ payload: payload.toString('base64'), signature: sign(null, payload, key).toString('base64') }))

  const dmg = fs.readFileSync(path.join(dir, mac.installer.file))
  const signature = sign(null, dmg, key).toString('base64')
  fs.writeFileSync(path.join(dir, 'appcast.xml'), `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>OCLR IRC</title>
    <item>
      <title>OCLR IRC ${version}</title>
      <sparkle:version>${version}</sparkle:version>
      <sparkle:shortVersionString>${version}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>
      <enclosure url="${releases}/download/v${version}/${mac.installer.file}" length="${dmg.length}" type="application/octet-stream" sparkle:edSignature="${signature}" />
    </item>
  </channel>
</rss>
`)
  return ['windows-update.json', 'appcast.xml']
}

module.exports = { releases, updatePublicKey, writeUpdateAssets }
