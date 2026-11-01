const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

function distribution(version, commit, platform, arch) {
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version || '') || !/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Invalid build identity')
  if (!['windows', 'linux', 'macos'].includes(platform) || arch !== (platform === 'macos' ? 'arm64' : 'x64')) throw new Error('Unsupported distribution platform/architecture')
  const name = `OCLR-IRC-${version}-${platform}-${arch}-${commit.slice(0, 7)}`
  return { name, archive: name + (platform === 'linux' ? '.tar.gz' : '.zip'), installer: platform === 'windows' ? { file: name + '-setup.exe', format: 'nsis' } : platform === 'macos' ? { file: name + '.dmg', format: 'dmg' } : null }
}
async function digest(file) {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
async function verifyDistribution(dir, version, commit, platform, arch) {
  const expected = distribution(version, commit, platform, arch)
  const metadata = JSON.parse(fs.readFileSync(path.join(dir, 'build-info.json'), 'utf8'))
  if (metadata.version !== version || metadata.commit !== commit || metadata.platform !== platform || metadata.arch !== arch) throw new Error('Build metadata identity mismatch')
  if (JSON.stringify(metadata.installer ?? null) !== JSON.stringify(expected.installer)) throw new Error('Installer identity missing or mismatched')
  const files = [expected.archive, ...(expected.installer ? [expected.installer.file] : [])]
  if (fs.readdirSync(dir).sort().join('\n') !== [...files, 'SHA256SUMS.txt', 'build-info.json'].sort().join('\n')) throw new Error('Unexpected distribution files')
  const lines = fs.readFileSync(path.join(dir, 'SHA256SUMS.txt'), 'utf8').trim().split('\n')
  const sums = new Map()
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line)
    if (!match || !files.includes(match[2]) || sums.has(match[2])) throw new Error('Invalid or duplicate checksum identity')
    sums.set(match[2], match[1])
  }
  if (sums.size !== files.length) throw new Error('Missing distribution checksum')
  for (const file of files) if (await digest(path.join(dir, file)) !== sums.get(file)) throw new Error('Distribution checksum mismatch')
  return { ...expected, metadata, files, checksums: files.map(file => `${sums.get(file)}  ${file}`) }
}
module.exports = { distribution, digest, verifyDistribution }
