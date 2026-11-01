const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const { verifyDistribution } = require('./distribution.cjs')
const { verifyStartup } = require('./verify-archive.cjs')
const { appleVerify } = require('./apple-verify.cjs')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

async function main() {
  if (process.platform === 'linux') return
  const platform = process.platform === 'win32' ? 'windows' : 'macos'
  const checked = await verifyDistribution(path.resolve('release/downloads'), require('../package.json').version, process.env.GITHUB_SHA, platform, process.arch)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'oclr-installer-')), file = path.resolve('release/downloads', checked.installer.file)
  const passed = ['installer identity and SHA256'], metadata = checked.metadata
  let mounted = false, installed = false
  const target = path.join(temp, 'installed'), mount = path.join(temp, 'mounted')
  try {
    if (platform === 'windows') {
      if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Windows installer smoke requires an ephemeral GitHub runner')
      // Hosted CI account only; no real profile, credentials or services are used.
      const markerDir = path.join(process.env.APPDATA, 'oclr-ref-tools'), marker = path.join(markerDir, 'installer-ci-preserve.txt')
      fs.mkdirSync(markerDir, { recursive: true }); fs.writeFileSync(marker, 'synthetic installer retention marker')
      try {
        execFileSync(file, ['/S', `/D=${target}`], { stdio: 'inherit', timeout: 180000 }); installed = true
        const inner = JSON.parse(fs.readFileSync(path.join(target, 'build-info.json'), 'utf8'))
        if (JSON.stringify(inner) !== JSON.stringify(metadata)) throw new Error('Installed build metadata mismatch')
        const protocol = execFileSync('reg.exe', ['query', 'HKCU\\Software\\Classes\\oclr-irc\\shell\\open\\command', '/ve'], { encoding: 'utf8' })
        if (!protocol.toLowerCase().includes(path.join(target, 'OCLR IRC.exe').toLowerCase()) || !protocol.includes('%1')) throw new Error('Installer protocol registration mismatch')
        passed.push('actual per-user silent install and protocol registration')
        await verifyStartup(path.join(target, 'OCLR IRC.exe'), path.join(temp, 'profile'), metadata)
        passed.push('installed app offline startup and exact version')
        execFileSync(file, ['/S', `/D=${target}`], { stdio: 'inherit', timeout: 180000 })
        if (!fs.existsSync(marker)) throw new Error('Reinstall removed existing user data')
        passed.push('same-version reinstall retains user data')
        execFileSync(path.join(target, 'Uninstall OCLR IRC.exe'), ['/S'], { stdio: 'inherit', timeout: 90000 })
        for (let i = 0; i < 100 && fs.existsSync(path.join(target, 'OCLR IRC.exe')); i++) await delay(200)
        if (fs.existsSync(path.join(target, 'OCLR IRC.exe')) || !fs.existsSync(marker)) throw new Error('Uninstall did not remove app or removed user data')
        if (spawnSync('reg.exe', ['query', 'HKCU\\Software\\Classes\\oclr-irc\\shell\\open\\command', '/ve'], {stdio: 'ignore'}).status === 0) throw new Error('Uninstall left the protocol registration')
        installed = false; passed.push('actual uninstall retains user data and removes protocol registration')
      } finally { fs.rmSync(marker, { force: true }) }
    } else {
      fs.mkdirSync(mount)
      execFileSync('hdiutil', ['verify', file], { stdio: 'inherit' })
      if (metadata.signed) {
        execFileSync('codesign', ['--verify', '--strict', file], { stdio: 'inherit' })
        await appleVerify('xcrun', ['stapler', 'validate', file])
        await appleVerify('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', file])
        passed.push('Developer ID signed, notarized and stapled DMG')
      }
      execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, file], { stdio: 'inherit' }); mounted = true
      if (fs.readlinkSync(path.join(mount, 'Applications')) !== '/Applications') throw new Error('DMG Applications shortcut mismatch')
      const inner = JSON.parse(fs.readFileSync(path.join(mount, 'build-info.json'), 'utf8'))
      if (JSON.stringify(inner) !== JSON.stringify(metadata)) throw new Error('Mounted DMG metadata mismatch')
      const app = path.join(mount, 'OCLR IRC.app')
      execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
      if (metadata.signed) {
        await appleVerify('xcrun', ['stapler', 'validate', app])
        await appleVerify('spctl', ['--assess', '--type', 'execute', '--verbose=4', app])
      }
      passed.push('read-only mount, Applications link and intact app signature')
      await verifyStartup(path.join(app, 'Contents/MacOS/OCLR IRC'), path.join(temp, 'profile'), metadata)
      passed.push('mounted app offline startup and exact version')
    }

  } finally {
    if (mounted) {
      let detached = false
      for (let attempt = 0; attempt < 8 && !detached; attempt++) {
        detached = spawnSync('hdiutil', ['detach', mount], {encoding: 'utf8', timeout: 30000}).status === 0
        if (!detached) await delay(500 * (attempt + 1))
      }
      if (!detached) {
        // Only our read-only temporary image, after all test child processes exit.
        execFileSync('hdiutil', ['detach', '-force', mount], {stdio: 'inherit', timeout: 30000})
      }
    }
    if (installed && fs.existsSync(path.join(target, 'Uninstall OCLR IRC.exe'))) execFileSync(path.join(target, 'Uninstall OCLR IRC.exe'), ['/S'], { stdio: 'inherit', timeout: 90000 })
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 })
  }
    fs.mkdirSync('artifacts', { recursive: true })
    fs.writeFileSync(`artifacts/${platform}-installer-verification.json`, JSON.stringify({ installer: checked.installer.file, version: metadata.version, commit: metadata.commit, signed: metadata.signed, notarized: metadata.notarized, passed, limitation: 'Native CI installation/mount and offline smoke; real-user upgrade, IME, provider and Bancho acceptance remain separate.' }, null, 2) + '\n')
    console.log(JSON.stringify({ platform, passed }))
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
