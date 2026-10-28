const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

function validate(version, lockVersion, env) {
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version) || version !== lockVersion) throw new Error('Package and lock versions must agree')
  const dry = env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.DRY_RUN === 'true'
  if (!dry && (env.GITHUB_REF_TYPE !== 'tag' || env.GITHUB_REF_NAME !== `v${version}`)) throw new Error('Publishing requires an existing v<package version> tag')
  if (env.GITHUB_REF_TYPE === 'tag' && env.GITHUB_REF_NAME !== `v${version}`) throw new Error('Tag does not match package version')
}
async function assemble(input, output, version, sha) {
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Invalid source commit')
  const platforms = [['windows', 'x64', '.zip'], ['linux', 'x64', '.tar.gz'], ['macos', 'arm64', '.zip']]
  const entries = fs.readdirSync(input)
  if (entries.length !== platforms.length) throw new Error('Expected exactly three platform artifacts')
  const checked = []
  for (const [platform, arch, extension] of platforms) {
    const name = `OCLR-ref-tools-${version}-${platform}-${arch}-${sha.slice(0, 7)}`
    if (!entries.includes(name)) throw new Error(`Missing platform artifact: ${platform}`)
    const dir = path.join(input, name), filename = name + extension
    const metadata = JSON.parse(fs.readFileSync(path.join(dir, 'build-info.json'), 'utf8'))
    if (metadata.commit !== sha || metadata.version !== version || metadata.platform !== platform || metadata.arch !== arch || metadata.signed !== false) throw new Error('Artifact identity mismatch')
    const archive = path.join(dir, filename), hash = createHash('sha256')
    for await (const chunk of fs.createReadStream(archive)) hash.update(chunk)
    const checksum = `${hash.digest('hex')}  ${filename}`
    if (fs.readFileSync(path.join(dir, 'SHA256SUMS.txt'), 'utf8').trim() !== checksum) throw new Error('Archive checksum mismatch')
    checked.push({ archive, filename, checksum, metadata })
  }
  fs.mkdirSync(output, { recursive: true })
  for (const item of checked) fs.copyFileSync(item.archive, path.join(output, item.filename))
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), checked.map(item => item.checksum).join('\n') + '\n')
  fs.writeFileSync(path.join(output, 'build-info.json'), JSON.stringify(checked.map(item => item.metadata), null, 2) + '\n')
  fs.writeFileSync(path.join(output, 'RELEASE_NOTES.md'), `OCLR-ref-tools ${version}\n\nSource commit: ${sha}\n\nWindows x64, Linux x64 and macOS Apple Silicon arm64 portable test builds. Extract the entire archive before launching. Verify downloads using SHA256SUMS.txt.\n\nThese builds are not publicly signed/notarized and are published as a pre-release, not Latest. Linux credential persistence remains disabled. CI checks do not replace real IME, OS sleep, keychain or Bancho acceptance. This release does not declare M1 complete.\n\n[Acceptance guide](https://github.com/OCLR-dev/OCLR-ref-tools/blob/${sha}/docs/m1/platform-acceptance.md)\n`)
}
module.exports = { validate, assemble }
if (require.main === module) {
  const version = require('../package.json').version
  const task = process.argv[2]
  Promise.resolve().then(() => {
    if (task === 'validate') return validate(version, require('../package-lock.json').version, process.env)
    if (task === 'assemble') return assemble('release-input', 'release-assets', version, process.env.GITHUB_SHA)
    throw new Error('Expected validate or assemble')
  }).catch(error => { console.error(error.message); process.exitCode = 1 })
}
