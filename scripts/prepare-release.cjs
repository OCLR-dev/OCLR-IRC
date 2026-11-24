const fs = require('node:fs')
const path = require('node:path')
const { distribution, verifyDistribution, digest } = require('./distribution.cjs')
const { writeUpdateAssets } = require('./update-assets.cjs')

function validate(version, lockVersion, env, rootLockVersion = lockVersion) {
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version) || version !== lockVersion || version !== rootLockVersion) throw new Error('Package and lock versions must agree')
  const dry = env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.DRY_RUN === 'true'
  if (!dry && env.REQUIRE_SIGNED_MAC !== 'true') throw new Error('Publishing requires Developer ID signed and notarized macOS')
  if (!dry && (env.GITHUB_REF_TYPE !== 'tag' || env.GITHUB_REF_NAME !== `v${version}`)) throw new Error('Publishing requires an existing v<package version> tag')
  if (env.GITHUB_REF_TYPE === 'tag' && env.GITHUB_REF_NAME !== `v${version}`) throw new Error('Tag does not match package version')
}
async function assertReleaseAvailable(repository, tag, token, request = fetch) {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository || '') || !/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(tag || '') || !token) throw new Error('Missing or invalid release identity/authentication')
  let response
  try {
    response = await request(`https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2026-03-10' },
      signal: AbortSignal.timeout(15000)
    })
  } catch { throw new Error('Could not check existing release; publishing stopped') }
  if (response.status === 404) return
  if (response.status === 200) throw new Error('A release with this tag already exists; refusing to replace it')
  throw new Error(`Release availability check failed (HTTP ${response.status}); publishing stopped`)
}
async function assemble(input, output, version, sha, requireSignedMac = false) {
  const platforms = [['windows', 'x64'], ['linux', 'x64'], ['macos', 'arm64']]
  const entries = fs.readdirSync(input)
  if (entries.length !== platforms.length) throw new Error('Expected exactly three platform artifacts')
  const checked = []
  for (const [platform, arch] of platforms) {
    const expected = distribution(version, sha, platform, arch)
    if (!entries.includes(expected.name)) throw new Error(`Missing platform artifact: ${platform}`)
    const dir = path.join(input, expected.name), item = await verifyDistribution(dir, version, sha, platform, arch)
    const metadata = item.metadata
    const signedMac = platform === 'macos' && metadata.signed === true && metadata.codeSigning === 'developer-id' && metadata.notarized === true && /^[A-Z0-9]{10}$/.test(metadata.teamId || '')
    if (platform === 'macos' && requireSignedMac && !signedMac) throw new Error('Release requires notarized Developer ID macOS artifact')
    if ((metadata.signed !== false && !signedMac) || (metadata.notarized === true && !signedMac)) throw new Error('Invalid signing metadata')
    checked.push({...item, dir})
  }
  fs.mkdirSync(output, { recursive: true })
  for (const item of checked) for (const file of item.files) fs.copyFileSync(path.join(item.dir, file), path.join(output, file))
  const checksums = checked.flatMap(item => item.checksums)
  const updateFiles = writeUpdateAssets(output, version, sha, checked[0], checked[2])
  for (const file of updateFiles) checksums.push(`${await digest(path.join(output, file))}  ${file}`)
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), checksums.join('\n') + '\n')
  fs.writeFileSync(path.join(output, 'build-info.json'), JSON.stringify(checked.map(item => item.metadata), null, 2) + '\n')
  const signedMac = checked.some(item => item.metadata.platform === 'macos' && item.metadata.signed)
  const signingNote = signedMac ? 'The macOS App and DMG are Developer ID signed and Apple notarized with stapled tickets.' : 'The macOS app uses an ad-hoc signature.'
  const releaseLabel = version.includes('-') ? '公開預覽版 / Pre-release' : '正式版 / Stable release'
  const base = `https://github.com/OCLR-dev/OCLR-IRC/releases/download/v${version}`
  const source = `https://github.com/OCLR-dev/OCLR-IRC/blob/${sha}`
  const changelog = `docs/releases/v${version}.md`
  const changes = fs.existsSync(path.join(__dirname, '..', changelog)) ? `\n\n[本版更新說明 / What's new](${source}/${changelog})` : ''
  const names = { windows: 'Windows', linux: 'Linux', macos: 'macOS (Apple Silicon)' }
  const downloads = checked.map(item => `| ${names[item.metadata.platform]} | ${item.metadata.arch} | ${item.installer ? `[${item.installer.format === 'nsis' ? 'Installer EXE' : 'DMG'}](${base}/${item.installer.file})` : '—'} | [${item.metadata.platform === 'linux' ? 'tar.gz' : 'ZIP'}](${base}/${item.archive}) |`).join('\n')
  fs.writeFileSync(path.join(output, 'RELEASE_NOTES.md'), `# OCLR IRC v${version}

${releaseLabel}${changes}

## 三平台下載 / Downloads

| 平台 / Platform | 架構 / Architecture | 安裝版 / Installer | 可攜式 / Portable |
| --- | --- | --- | --- |
${downloads}

[SHA256 校驗碼](${base}/SHA256SUMS.txt) · [建置與簽章資訊](${base}/build-info.json)

Windows 請執行 Setup EXE，安裝後從開始功能表啟動。macOS 請開啟 DMG，將 OCLR IRC.app 拖至 Applications。使用 Linux 或可攜版時，請完整解壓縮後再執行。

Run the setup EXE on Windows. On macOS, open the DMG and drag the app to Applications. Extract portable archives completely before launching. Verify downloads using SHA256SUMS.txt.

## 簽章 / Signing

${signingNote} Windows and Linux packages are unsigned. Linux credential persistence remains disabled.

Source commit: ${sha}

[使用指南 / User guide](${source}/README.md)
`)
}

module.exports = { validate, assemble, assertReleaseAvailable }
if (require.main === module) {
  const version = require('../package.json').version
  const task = process.argv[2]
  Promise.resolve().then(() => {
    if (task === 'validate') {
      const lock = require('../package-lock.json')
      return validate(version, lock.version, process.env, lock.packages?.['']?.version ?? null)
    }
    if (task === 'check-remote') return assertReleaseAvailable(process.env.GITHUB_REPOSITORY, process.env.GITHUB_REF_NAME, process.env.GH_TOKEN)
    if (task === 'assemble') return assemble('release-input', 'release-assets', version, process.env.GITHUB_SHA, process.env.REQUIRE_SIGNED_MAC === 'true')
    throw new Error('Expected validate, check-remote or assemble')
  }).catch(error => { console.error(error.message); process.exitCode = 1 })
}
