const { execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

async function main() {
  if (process.platform !== 'darwin') throw new Error('macOS packaging/signing must run on macOS')
  const mode = process.env.MAC_SIGNING_MODE || 'ad-hoc'
  if (!['ad-hoc', 'developer-id'].includes(mode)) throw new Error('Invalid macOS signing mode')
  const signed = mode === 'developer-id'
  if (signed && (!/^[a-f0-9]{40}$/i.test(process.env.MAC_SIGNING_IDENTITY || '') || !/^[A-Z0-9]{10}$/.test(process.env.MAC_TEAM_ID || '') || !process.env.MAC_KEYCHAIN_PATH || !process.env.MAC_NOTARY_PROFILE)) throw new Error('Developer ID signing setup is incomplete; refusing ad-hoc fallback')
  const { packager } = await import('@electron/packager')
  const outputs = await packager({
    dir: '.', name: 'OCLR IRC', platform: 'darwin', arch: 'arm64',
    appBundleId: 'org.oclr.ref-tools',
    protocols: [{name: 'OCLR IRC', schemes: ['oclr-irc']}],
    out: 'release', overwrite: true,
    ignore: [/^\/(?:release(?:-input|-assets)?|spikes|docs|tests|src|scripts|artifacts|\.github)(?:\/|$)/],
    osxSign: {
      identity: signed ? process.env.MAC_SIGNING_IDENTITY : '-', keychain: signed ? process.env.MAC_KEYCHAIN_PATH : undefined, identityValidation: signed, continueOnError: false,
      preAutoEntitlements: false, preEmbedProvisioningProfile: false,
      // Hardened runtime + secure timestamp for notarized Developer ID builds.
      optionsForFile: () => ({ hardenedRuntime: signed, entitlements: ['com.apple.security.cs.allow-jit'] })
    },
    osxNotarize: signed ? { keychainProfile: process.env.MAC_NOTARY_PROFILE, keychain: process.env.MAC_KEYCHAIN_PATH } : undefined
  })
  for (const output of outputs) {
    const app = path.join(output, 'OCLR IRC.app')
    execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' })
    if (signed) {
      const info = require('node:child_process').spawnSync('codesign', ['-d', '--verbose=4', app], { encoding: 'utf8' })
      if (info.status !== 0 || !info.stderr.includes(`TeamIdentifier=${process.env.MAC_TEAM_ID}`) || !/Authority=Developer ID Application:/.test(info.stderr) || !/flags=.*\bruntime\b/.test(info.stderr)) throw new Error('Developer ID/team/hardened runtime verification failed')
      execFileSync('xcrun', ['stapler', 'validate', app], { stdio: 'inherit' })
      execFileSync('spctl', ['--assess', '--type', 'execute', '--verbose=4', app], { stdio: 'inherit' })
    }
    fs.writeFileSync(path.join(output, 'mac-signing.json'), JSON.stringify({ codeSigning: mode, signed, notarized: signed, teamId: signed ? process.env.MAC_TEAM_ID : null }, null, 2) + '\n')
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
