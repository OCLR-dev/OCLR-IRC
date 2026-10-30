// Verify and launch the actual extracted distribution, not the development Electron.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { execFileSync, spawn } = require('node:child_process')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function verifyIdentity(downloads, platform, arch, commit, version) {
  const label = { darwin: 'macos', win32: 'windows', linux: 'linux' }[platform]
  if (!label || (platform === 'darwin' ? arch !== 'arm64' : arch !== 'x64')) throw new Error('Unsupported archive platform')
  if (!/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Expected full build commit')
  const filename = `OCLR-IRC-${version}-${label}-${arch}-${commit.slice(0, 7)}${platform === 'linux' ? '.tar.gz' : '.zip'}`
  const files = fs.readdirSync(downloads).filter(name => /\.(zip|tar\.gz)$/.test(name))
  if (files.length !== 1 || files[0] !== filename) throw new Error('Archive identity mismatch')
  const metadata = JSON.parse(fs.readFileSync(path.join(downloads, 'build-info.json'), 'utf8'))
  if (metadata.commit !== commit || metadata.version !== version || metadata.platform !== label || metadata.arch !== arch) throw new Error('Build metadata identity mismatch')
  const checksum = fs.readFileSync(path.join(downloads, 'SHA256SUMS.txt'), 'utf8').trim()
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(path.join(downloads, filename))) hash.update(chunk)
  if (checksum !== `${hash.digest('hex')}  ${filename}`) throw new Error('Archive checksum mismatch')
  return { filename, metadata }
}
async function main() {
  const downloads = path.resolve('release/downloads')
  const { filename, metadata } = await verifyIdentity(downloads, process.platform, process.arch, process.env.GITHUB_SHA, require('../package.json').version)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'oclr-archive-'))
  let child, ws
  try {
    const archive = path.join(downloads, filename)
    if (process.platform === 'darwin') execFileSync('ditto', ['-x', '-k', archive, temp])
    else if (process.platform === 'win32') execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:OCLR_VERIFY_SOURCE -DestinationPath $env:OCLR_VERIFY_TARGET'], { env: { ...process.env, OCLR_VERIFY_SOURCE: archive, OCLR_VERIFY_TARGET: temp } })
    else execFileSync('tar', ['-xzf', archive, '-C', temp])
    const folder = path.join(temp, `OCLR IRC-${process.platform}-${process.arch}`)
    const innerMetadata = JSON.parse(fs.readFileSync(path.join(folder, 'build-info.json'), 'utf8'))
    if (JSON.stringify(innerMetadata) !== JSON.stringify(metadata)) throw new Error('Extracted metadata differs from archive identity')
    const app = path.join(folder, 'OCLR IRC.app')
    if (process.platform === 'darwin') {
      execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' })
      if (metadata.signed) {
        execFileSync('xcrun', ['stapler', 'validate', app], { stdio: 'inherit' })
        execFileSync('spctl', ['--assess', '--type', 'execute', '--verbose=4', app], { stdio: 'inherit' })
        // Simulate a browser-quarantined copy without disabling Gatekeeper.
        execFileSync('xattr', ['-w', 'com.apple.quarantine', '0083;00000000;OCLR-CI;', app])
        execFileSync('spctl', ['--assess', '--type', 'execute', '--verbose=4', app], { stdio: 'inherit' })
      }
    }
    const executable = process.platform === 'darwin' ? path.join(app, 'Contents/MacOS/OCLR IRC') : path.join(folder, process.platform === 'win32' ? 'OCLR IRC.exe' : 'OCLR IRC')
    let endpoint, stderr = '', launchError
    child = spawn(executable, ['--remote-debugging-port=0', `--user-data-dir=${path.join(temp, 'profile')}`], { stdio: ['ignore', 'ignore', 'pipe'] })
    child.on('error', error => { launchError = error.message })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16384); endpoint = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/.exec(stderr)?.[1] })
    for (let i = 0; i < 100 && !endpoint && !launchError && child.exitCode === null; i++) await delay(100)
    if (!endpoint || launchError) throw new Error('Extracted app failed to start: ' + (launchError || stderr.slice(-2000)))
    ws = new WebSocket(endpoint)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Packaged debugger connection timed out')), 5000)
      ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      ws.addEventListener('error', error => { clearTimeout(timer); reject(error) }, { once: true })
    })
    let id = 0
    const pending = new Map()
    ws.addEventListener('message', event => { const msg = JSON.parse(event.data); const handler = pending.get(msg.id); if (handler) { pending.delete(msg.id); handler(msg) } })
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const request = ++id, timer = setTimeout(() => { pending.delete(request); reject(new Error('Packaged renderer inspection timed out')) }, 5000)
      pending.set(request, msg => { clearTimeout(timer); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result) })
      ws.send(JSON.stringify({ id: request, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
    let passed = false
    for (let i = 0; i < 50 && !passed; i++) {
      const targets = await send('Target.getTargets')
      const target = targets.targetInfos.find(t => t.type === 'page' && t.url.startsWith('file:') && t.url.includes('/renderer/index.html'))
      if (target) {
        const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
        const result = await send('Runtime.evaluate', { expression: '(async () => Boolean(document.querySelector("input[name=username]")) && typeof window.require === "undefined" && Boolean(window.oclr) && (await window.oclr.snapshot()).connection === "offline")()', awaitPromise: true, returnByValue: true }, sessionId)
        passed = result.result?.value === true
        await send('Target.detachFromTarget', { sessionId })
      }
      if (!passed) await delay(200)
    }
    if (!passed) throw new Error('Packaged app did not reach a usable offline login screen')
    fs.mkdirSync('artifacts', { recursive: true })
    fs.writeFileSync(`artifacts/${metadata.platform}-archive-verification.json`, JSON.stringify({ archive: filename, commit: metadata.commit, platform: process.platform, arch: process.arch, recordedAt: new Date().toISOString(), passed: ['archive SHA256 and build identity', ...(process.platform === 'darwin' ? ['extracted archive strict deep code signature'] : []), 'actual packaged executable launched', 'sandboxed login screen and preload IPC usable', 'offline; no IRC credentials or operations'], signing: metadata.codeSigning, notarized: metadata.notarized, limitation: process.platform !== 'darwin' ? 'CI offline startup only; no real OS IME, provider, sleep, upgrade or user download acceptance.' : metadata.notarized ? 'CI assessment includes stapled ticket and quarantined-copy Gatekeeper checks; user download/first-launch acceptance still required.' : 'Does not establish Gatekeeper approval for a browser-quarantined download or Developer ID identity.' }, null, 2) + '\n')
    console.log(`Extracted ${metadata.platform} archive: identity, checksum and packaged login passed.`)
  } finally {
    if (ws?.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify({ id: 999999, method: 'Browser.close' })) } catch {} }
    ws?.close()
    if (child) for (let i = 0; i < 20 && child.exitCode === null && child.signalCode === null; i++) await delay(100)
    if (child && child.exitCode === null) {
      child.kill('SIGTERM')
      for (let i = 0; i < 30 && child.exitCode === null && child.signalCode === null; i++) await delay(100)
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await delay(300) }
    }
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
}
module.exports = { main, verifyIdentity }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
