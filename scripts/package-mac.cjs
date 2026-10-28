const { execFileSync } = require('node:child_process')
const path = require('node:path')

async function main() {
  if (process.platform !== 'darwin') throw new Error('macOS packaging/signing must run on macOS')
  const { packager } = await import('@electron/packager')
  const outputs = await packager({
    dir: '.', name: 'OCLR-ref-tools', platform: 'darwin', arch: 'arm64',
    appBundleId: 'org.oclr.ref-tools',
    out: 'release', overwrite: true,
    ignore: [/^\/(?:release(?:-input|-assets)?|spikes|docs|tests|src|scripts|artifacts|\.github)(?:\/|$)/],
    osxSign: {
      identity: '-', identityValidation: false, continueOnError: false,
      preAutoEntitlements: false, preEmbedProvisioningProfile: false,
      // Ad-hoc test distribution has no Developer ID/team. Keep the existing
      // non-hardened runtime; JIT is required by Electron's V8 processes.
      optionsForFile: () => ({ hardenedRuntime: false, entitlements: ['com.apple.security.cs.allow-jit'] })
    }
  })
  for (const output of outputs) execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', path.join(output, 'OCLR-ref-tools.app')], { stdio: 'inherit' })
}
main().catch(error => { console.error(error); process.exitCode = 1 })
