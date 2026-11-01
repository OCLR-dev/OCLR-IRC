// Exercise native window/tray lifecycle with a local synthetic IRC peer only.
const { app, BrowserWindow, Menu, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
if (process.env.CI && process.platform === 'linux') app.disableHardwareAcceleration()
app.setPath('userData', require('node:path').join(process.env.OCLR_QA_TEMP, 'background'))
require('./mock-system-locale.cjs')
let trayMenu, peer, welcomes = 0
const handlers = new Map(), sent = []
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (name, fn) => { handlers.set(name, fn); handle(name, fn) }
const buildMenu = Menu.buildFromTemplate.bind(Menu)
Menu.buildFromTemplate = template => {
  const menu = buildMenu(template)
  if (template.some(item => item.label === '開啟 OCLR IRC')) trayMenu = menu
  return menu
}
const server = net.createServer(socket => {
  peer = socket
  let pending = ''
  socket.on('data', chunk => {
    pending += chunk.toString()
    let end
    while ((end = pending.indexOf('\r\n')) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 2)
      sent.push(line.startsWith('PASS ') ? 'PASS <synthetic-redacted>' : line)
      if (line.startsWith('USER ')) { welcomes++; socket.write(':server 001 SyntheticRef :Welcome\n') }
    }
  })
})
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn) { for (let n = 0; n < 100; n++) { if (await fn()) return; await delay(30) }; throw new Error('Background condition timed out') }
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const connect = net.createConnection
  net.createConnection = options => { assert.equal(options.host, 'irc.ppy.sh'); return connect({ host: '127.0.0.1', port: server.address().port }) }
  require('./mock-beatmap-fetch.cjs')
  require('./mock-avatar-fetch.cjs')
  require('../out/main/index.js')
  await app.whenReady()
  await until(() => BrowserWindow.getAllWindows().length > 0)
  const window = BrowserWindow.getAllWindows()[0]
  const headlessLinux = process.env.CI && process.platform === 'linux'
  let minimizes = 0
  const minimize = window.minimize.bind(window)
  window.minimize = () => { minimizes++; minimize() }
  const js = code => window.webContents.executeJavaScript(code)
  await until(() => !window.webContents.isLoading())
  await until(() => js('Boolean(window.oclr)'))
  assert.equal((await js('window.oclr.login({username:"SyntheticRef",password:"SYNTHETIC_ONLY"})')).ok, true)
  await until(() => js('(async () => (await window.oclr.snapshot()).connection === "online")()'))
  window.close()
  await until(() => headlessLinux ? minimizes === 1 : !window.isVisible() || window.isMinimized())
  assert.equal(window.isDestroyed(), false)
  assert.equal((await js('window.oclr.snapshot()')).connection, 'online')
  peer.write('PING :background-synthetic\n')
  await until(() => sent.includes('PONG :background-synthetic'))
  app.emit('activate')
  await until(() => window.isVisible() && !window.isMinimized())
  assert.equal(BrowserWindow.getAllWindows().length, 1)
  assert.equal((await js('window.oclr.runInBackground()')).ok, true)
  await until(() => headlessLinux ? minimizes === 2 : !window.isVisible() || window.isMinimized())
  if (trayMenu) trayMenu.items[0].click(trayMenu.items[0], window, {})
  else app.emit('activate') // Headless Linux can have no indicator service.
  await until(() => window.isVisible() && !window.isMinimized())
  await js('window.oclr.runInBackground()')
  app.emit('second-instance', {}, [], process.cwd())
  await until(() => window.isVisible() && !window.isMinimized())
  assert.equal(welcomes, 1)
  window.emit('query-session-end', { preventDefault() { throw new Error('Shutdown must not be blocked') } })
  assert.equal((await js('window.oclr.snapshot()')).connection, 'online')
  assert.ok(!sent.some(line => line.includes('!mp')))
  app.on('before-quit', () => {
    // Main's cleanup listener is registered first; inspect without depending on a closing renderer.
    const state = handlers.get('irc:snapshot')({ sender: window.webContents, senderFrame: window.webContents.mainFrame })
    assert.equal(state.connection, 'offline'); assert.equal(state.username, '')
  })
  app.on('will-quit', () => {
    fs.mkdirSync('artifacts', { recursive: true })
    const report = { evidence: 'synthetic-native-background', platform: process.platform, arch: process.arch, recordedAt: new Date().toISOString(), trayConstructed: Boolean(trayMenu), passed: ['close retains native window and authenticated IRC', 'IRC PING/PONG works while hidden/minimized', 'activate restores original window', 'explicit background IPC', 'tray open or Linux fallback restores window', 'second-instance event restores one window without relogin', 'quit clears IRC authentication and bypasses close-to-background', 'close with background disabled quits and clears authentication', 'no custom quit menu item', 'no match commands sent'], limitation: 'Synthetic IRC; second-instance event is injected. Headless Linux checks minimize requests, not window-manager handling. CI tray construction does not prove physical system indicator visibility or OS shutdown/desktop-session behavior.' }
    fs.writeFileSync('artifacts/background-smoke.json', JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report))
  })
  assert.ok(!trayMenu || !trayMenu.items.some(item => item.label === '退出程式'))
  assert.equal((await js('window.oclr.settings.update({closeToBackground:false,language:"zh-Hant"})')).ok, true)
  window.close()
}
main().catch(error => { console.error(error.stack); app.exit(1) })
