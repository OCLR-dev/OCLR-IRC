// Verify and launch the actual extracted distribution, not the development Electron.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function main() {
  if (process.platform !== 'darwin') throw new Error('macOS only')
  const files = fs.readdirSync('release/downloads').filter(name => /-macos-arm64-.*\.zip$/.test(name))
  if (files.length !== 1) throw new Error('Expected exactly one macOS archive')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'oclr-mac-archive-'))
  let child, ws
  try {
    execFileSync('ditto', ['-x', '-k', path.resolve('release/downloads', files[0]), temp])
    const app = path.join(temp, 'OCLR-ref-tools-darwin-arm64/OCLR-ref-tools.app')
    execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' })
    let endpoint, stderr = '', launchError
    child = spawn(path.join(app, 'Contents/MacOS/OCLR-ref-tools'), ['--remote-debugging-port=0', `--user-data-dir=${path.join(temp, 'profile')}`], { stdio: ['ignore', 'ignore', 'pipe'] })
    child.on('error', error => { launchError = error.message })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16384); endpoint = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/.exec(stderr)?.[1] })
    for (let i = 0; i < 100 && !endpoint && !launchError && child.exitCode === null; i++) await delay(100)
    if (!endpoint || launchError) throw new Error('Extracted app failed to start: ' + (launchError || stderr.slice(-2000)))
    ws = new WebSocket(endpoint)
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
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
    fs.writeFileSync('artifacts/mac-archive-verification.json', JSON.stringify({ archive: files[0], platform: process.platform, arch: process.arch, recordedAt: new Date().toISOString(), passed: ['extracted archive strict deep code signature', 'actual packaged executable launched', 'sandboxed login screen and preload IPC usable', 'offline; no IRC credentials or operations'], signing: 'ad-hoc', notarized: false, limitation: 'Does not establish Gatekeeper approval for a browser-quarantined download or Developer ID identity.' }, null, 2) + '\n')
    console.log('Extracted macOS archive: signature and packaged login passed.')
  } finally {
    ws?.close()
    if (child && child.exitCode === null) {
      child.kill('SIGTERM')
      for (let i = 0; i < 30 && child.exitCode === null && child.signalCode === null; i++) await delay(100)
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
