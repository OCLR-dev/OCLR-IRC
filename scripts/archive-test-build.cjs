const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')

async function main() {
  const version = require('../package.json').version
  const sha = process.env.GITHUB_SHA
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(version) || !/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Invalid build identity')
  if (!(process.platform === 'darwin' && process.arch === 'arm64') && !(['win32', 'linux'].includes(process.platform) && process.arch === 'x64')) throw new Error('Unsupported test build platform/architecture')
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'
  const folder = `OCLR-ref-tools-${process.platform}-${process.arch}`
  const source = path.resolve('release', folder)
  if (!fs.statSync(source).isDirectory()) throw new Error('Packaged app is missing')
  const name = `OCLR-ref-tools-${version}-${platform}-${process.arch}-${sha.slice(0, 7)}`
  const downloads = path.resolve('release/downloads')
  fs.mkdirSync(downloads, { recursive: true })
  const metadata = { version, commit: sha, platform, arch: process.arch, node: process.version, electron: require('electron/package.json').version,
    builtAt: new Date().toISOString(), run: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`, signed: false, codeSigning: platform === 'macos' ? 'ad-hoc' : 'unsigned', notarized: false, milestoneAccepted: false }
  fs.writeFileSync(path.join(source, 'build-info.json'), JSON.stringify(metadata, null, 2) + '\n')
  fs.writeFileSync(path.join(source, 'README-TESTING.txt'), `OCLR-ref-tools ${version} — internal test build\nCommit: ${sha}\n\nExtract the entire directory before launching. This is a portable test build, not an installer. No Developer ID signing/notarization; macOS uses an ad-hoc integrity signature.\nAcceptance guide: https://github.com/OCLR-dev/OCLR-ref-tools/blob/${sha}/docs/m1/platform-acceptance.md\nLinux credential persistence is disabled pending provider verification.\nCI tests use synthetic IRC; real IME, OS sleep and Bancho acceptance are still required.\n`)
  const archive = path.join(downloads, name + (platform === 'linux' ? '.tar.gz' : '.zip'))
  const result = platform === 'windows'
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Compress-Archive -LiteralPath $env:OCLR_ARCHIVE_SOURCE -DestinationPath $env:OCLR_ARCHIVE_TARGET -CompressionLevel Optimal'], { stdio: 'inherit', env: { ...process.env, OCLR_ARCHIVE_SOURCE: source, OCLR_ARCHIVE_TARGET: archive } })
    : platform === 'macos' ? spawnSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', source, archive], { stdio: 'inherit' })
    : spawnSync('tar', ['-czf', archive, '-C', path.resolve('release'), folder], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error('Archive creation failed')
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(archive)) hash.update(chunk)
  fs.writeFileSync(path.join(downloads, 'SHA256SUMS.txt'), `${hash.digest('hex')}  ${path.basename(archive)}\n`)
  fs.writeFileSync(path.join(downloads, 'build-info.json'), JSON.stringify(metadata, null, 2) + '\n')
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `artifact_name=${name}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${name}\n\nDownload the build artifact below, then extract the inner archive. Contains SHA256SUMS.txt and build-info.json. Unsigned test build; not M1 acceptance.\n`)
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
