const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { distribution, digest } = require('./distribution.cjs')
const { appleVerify } = require('./apple-verify.cjs')

function windowsConfiguration(filename, output) {
  return {
    appId: 'org.oclr.ref-tools', productName: 'OCLR IRC', executableName: 'OCLR IRC',
    directories: { output }, publish: null, npmRebuild: false,
    protocols: [{ name: 'OCLR IRC', schemes: ['oclr-irc'] }],
    win: { target: ['nsis'], signAndEditExecutable: false, artifactName: filename },
    nsis: { artifactName: filename, oneClick: false, perMachine: false, allowElevation: false,
      allowToChangeInstallationDirectory: true, runAfterFinish: false, deleteAppDataOnUninstall: false,
      createDesktopShortcut: false, createStartMenuShortcut: true, differentialPackage: false,
      installerLanguages: ['en_US', 'zh_CN', 'zh_TW'] }
  }
}
async function main() {
  if (process.platform === 'linux') { console.log('Linux retains the portable tar.gz distribution.'); return }
  const dir = path.resolve('release/downloads'), metadata = JSON.parse(fs.readFileSync(path.join(dir, 'build-info.json'), 'utf8'))
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : ''
  const expected = distribution(require('../package.json').version, process.env.GITHUB_SHA, platform, process.arch)
  if (metadata.version !== require('../package.json').version || metadata.commit !== process.env.GITHUB_SHA || JSON.stringify(metadata.installer) !== JSON.stringify(expected.installer)) throw new Error('Installer build identity mismatch')
  const source = path.resolve('release', `OCLR IRC-${process.platform}-${process.arch}`), target = path.join(dir, expected.installer.file)
  if (platform === 'windows') {
    const { build, Platform, Arch } = require('electron-builder')
    const output = path.resolve('release/installer-output')
    await build({ prepackaged: source, targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), config: windowsConfiguration(expected.installer.file, output), publish: 'never' })
    fs.copyFileSync(path.join(output, expected.installer.file), target)
  } else {
    const staging = path.resolve('release/dmg-stage')
    fs.rmSync(staging, { recursive: true, force: true }); fs.mkdirSync(staging)
    execFileSync('ditto', [path.join(source, 'OCLR IRC.app'), path.join(staging, 'OCLR IRC.app')])
    fs.symlinkSync('/Applications', path.join(staging, 'Applications'))
    fs.copyFileSync(path.join(source, 'build-info.json'), path.join(staging, 'build-info.json'))
    fs.copyFileSync(path.join(source, 'THIRD_PARTY_NOTICES.md'), path.join(staging, 'THIRD_PARTY_NOTICES.md'))
    execFileSync('hdiutil', ['create', '-volname', 'OCLR IRC', '-srcfolder', staging, '-fs', 'HFS+', '-format', 'UDZO', '-ov', target], { stdio: 'inherit' })
    if (metadata.signed) {
      const identity = process.env.MAC_SIGNING_IDENTITY, keychain = process.env.MAC_KEYCHAIN_PATH, profile = process.env.MAC_NOTARY_PROFILE
      if (!/^[a-f0-9]{40}$/i.test(identity || '') || !keychain || !profile) throw new Error('DMG signing configuration missing')
      execFileSync('codesign', ['--sign', identity, '--keychain', keychain, '--timestamp', target], { stdio: 'inherit' })
      const reply = JSON.parse(execFileSync('xcrun', ['notarytool', 'submit', target, '--keychain-profile', profile, '--keychain', keychain, '--wait', '--timeout', '30m', '--output-format', 'json'], { encoding: 'utf8', timeout: 1900000 }))
      if (reply.status !== 'Accepted') throw new Error('DMG notarization not accepted')
      execFileSync('xcrun', ['stapler', 'staple', target], { stdio: 'inherit' })
      await appleVerify('xcrun', ['stapler', 'validate', target])
      execFileSync('codesign', ['--verify', '--strict', target], { stdio: 'inherit' })
      await appleVerify('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', target])
    }
  }
  fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'), `${await digest(path.join(dir, expected.archive))}  ${expected.archive}\n${await digest(target)}  ${path.basename(target)}\n`)
  console.log(`Created ${metadata.installer.format} distribution: ${path.basename(target)}`)
}
module.exports = { windowsConfiguration, main }
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
