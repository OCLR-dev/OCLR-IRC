const { copyFileSync, chmodSync } = require('node:fs')
const path = require('node:path')
async function main() {
  const { packager } = await import('@electron/packager')
  const outputs = await packager({dir: '.', name: 'OCLR IRC', platform: 'linux', out: 'release', overwrite: true, ignore: [/^\/(?:release(?:-input|-assets)?|spikes|docs|tests|src|scripts|artifacts|\.github)(?:\/|$)/]})
  for (const output of outputs) {
    const target = path.join(output, 'install-protocol.sh')
    copyFileSync('scripts/install-linux-protocol.sh', target); chmodSync(target, 0o755)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
