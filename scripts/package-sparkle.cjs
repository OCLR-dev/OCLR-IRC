const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { releases } = require('./update-assets.cjs')

const version = '2.10.1'
const sha256 = '1a856d2a9edb8e628de88121d7be04cf0e2167f8641650b78fca00b14244cf27'

function packageSparkle(publicKey) {
  if (!publicKey) return { options: {}, cleanup() {} }
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'oclr-sparkle-'))
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true })
  try {
    const archive = path.join(dir, 'sparkle.tar.xz')
    execFileSync('curl', ['--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--max-time', '120', '--output', archive, `https://github.com/sparkle-project/Sparkle/releases/download/${version}/Sparkle-${version}.tar.xz`])
    if (createHash('sha256').update(fs.readFileSync(archive)).digest('hex') !== sha256) throw new Error('Sparkle archive checksum mismatch')
    execFileSync('tar', ['-xJf', archive, '-C', dir, 'Sparkle.framework', 'LICENSE'])
    fs.renameSync(path.join(dir, 'LICENSE'), path.join(dir, 'Sparkle-LICENSE.txt'))
    const bridge = path.join(dir, 'oclr-sparkle.node')
    execFileSync('xcrun', ['clang', '-arch', 'arm64', '-mmacosx-version-min=12.0', '-fobjc-arc', '-bundle', '-undefined', 'dynamic_lookup',
      '-I', require('node-api-headers').include_dir, '-F', dir, '-framework', 'Cocoa', '-framework', 'Sparkle',
      '-Wl,-rpath,@loader_path/../Frameworks', path.join(__dirname, 'sparkle-updater.m'), '-o', bridge])
    return { cleanup, options: {
      extendInfo: { SUFeedURL: `${releases}/latest/download/appcast.xml`, SUPublicEDKey: publicKey, SUEnableAutomaticChecks: true, SUAllowsAutomaticUpdates: false, SUVerifyUpdateBeforeExtraction: true },
      extraResource: [bridge, path.join(dir, 'Sparkle-LICENSE.txt')],
      afterCopyExtraResources: [({ buildPath }) => {
        execFileSync('ditto', [path.join(dir, 'Sparkle.framework'), path.join(buildPath, 'OCLR IRC.app', 'Contents', 'Frameworks', 'Sparkle.framework')])
      }]
    } }
  } catch (error) {
    cleanup()
    throw error
  }
}

module.exports = { packageSparkle }
