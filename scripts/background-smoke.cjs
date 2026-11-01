// Exercise native window/tray lifecycle with synthetic IRC and OCLR services only.
const { app, BrowserWindow, Menu, Tray, ipcMain, shell } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
if (process.env.CI && process.platform === 'linux') app.disableHardwareAcceleration()
const phase = process.argv[2] || 'initial-hidden'
const scenarios = {
  'initial-hidden': { state: 'hidden', background: true, locale: 'zh-Hant' },
  'initial-foreground': { state: 'foreground', background: true, locale: 'zh-Hans' },
  'initial-minimized': { state: 'minimized', background: true, locale: 'en' },
  'updated-hidden': { state: 'hidden', background: false, locale: 'zh-Hans' },
  'updated-foreground': { state: 'foreground', background: false, locale: 'en' },
  'updated-minimized': { state: 'minimized', background: false, locale: 'zh-Hant' },
  'close-disabled': { state: 'foreground', background: false, locale: 'zh-Hant' }
}
const scenario = scenarios[phase]
assert.ok(scenario, 'Unknown background smoke phase')
app.setPath('userData', require('node:path').join(process.env.OCLR_QA_TEMP, 'background-' + phase))
let osLanguages = [scenario.locale]
app.getPreferredSystemLanguages = () => osLanguages
let trayMenu, tray, peer, welcomes = 0
const trayMenus = [], relaySignals = []
const labels = {
  'zh-Hant': ['開啟 OCLR IRC', '退出程式'],
  'zh-Hans': ['打开 OCLR IRC', '退出程序'],
  en: ['Open OCLR IRC', 'Quit']
}
function checkMenu(menu, locale) {
  assert.ok(menu, 'Tray menu must be constructed')
  assert.deepEqual(menu.items.map(item => item.type), ['normal', 'separator', 'normal'])
  assert.deepEqual([menu.items[0].label, menu.items[2].label], labels[locale])
  assert.equal(menu.items[2].enabled, true)
}
const handlers = new Map(), sent = []
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (name, fn) => { handlers.set(name, fn); handle(name, fn) }
const buildMenu = Menu.buildFromTemplate.bind(Menu)
Menu.buildFromTemplate = template => {
  const menu = buildMenu(template)
  if (template.some(item => Object.values(labels).some(([open]) => item.label === open))) {
    trayMenu = menu; trayMenus.push(menu)
  }
  return menu
}
const setContextMenu = Tray.prototype.setContextMenu
Tray.prototype.setContextMenu = function(menu) { tray = this; return setContextMenu.call(this, menu) }
// Synthetic desktop authorization and an active relay; no live HTTP or browser.
const fixtures = JSON.parse(fs.readFileSync('tests/fixtures/oclr-fixtures.json', 'utf8'))
const panel = JSON.parse(fs.readFileSync('tests/fixtures/oclr-panel.json', 'utf8'))
const meta = fixtures.meta, nativeFetch = global.fetch
let auth
const json = (data, status = 200) => new Response(JSON.stringify({ data, meta }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-OCLR-Desktop-Contract': '1.1.0', 'X-OCLR-Referee-Contract': '1.1.0', 'X-Request-Id': meta.requestId } })
shell.openExternal = async () => {}
global.fetch = async (value, init = {}) => {
  const url = new URL(String(value))
  assert.equal(url.origin, 'https://oclr.org')
  if (url.pathname.endsWith('/auth/requests')) {
    auth = JSON.parse(init.body)
    return json({ authorization_request_id: meta.requestId, authorization_url: `https://oclr.org/desktop/authorize?request_id=${meta.requestId}`, verification_code: 'ABCD-2345', expires_at: '2026-10-28T08:10:00.000Z' }, 201)
  }
  if (url.pathname.endsWith('/auth/exchange')) return json({ token_type: 'Bearer', access_token: 'oclr_desk_at_' + 'A'.repeat(43), refresh_token: 'oclr_desk_rt_' + 'D'.repeat(43), expires_in: 600, access_expires_at: '2026-10-28T08:10:00.000Z', refresh_expires_at: '2026-10-28T10:00:00.000Z', session_expires_at: '2026-10-28T20:00:00.000Z', session_id: meta.requestId, scope: auth.scope, subject: panel.data.viewer })
  if (url.pathname.includes('/me/fixtures')) return json(fixtures.data)
  if (url.pathname.endsWith('/panel')) return json(panel.data)
  if (url.pathname.endsWith('/relay')) {
    relaySignals.push(init.signal)
    const body = JSON.parse(init.body)
    return json({ connectionId: meta.requestId, sequence: body.sequence ?? 0, command: null })
  }
  throw new Error('Unexpected synthetic OCLR endpoint')
}
const roomId = 900000081, username = 'Synthetic_Referee'
const server = net.createServer(socket => {
  peer = socket
  let pending = ''
  socket.on('data', chunk => {
    pending += chunk.toString()
    let end
    while ((end = pending.indexOf('\r\n')) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 2)
      sent.push(line.startsWith('PASS ') ? 'PASS <synthetic-redacted>' : line)
      if (line.startsWith('USER ')) { welcomes++; socket.write(`:server 001 ${username} :Welcome\n`) }
      if (line.startsWith('JOIN ')) socket.write(`:${username}!x JOIN :${line.slice(5)}\n`)
      if (line.endsWith(':!mp settings')) socket.write(`:BanchoBot PRIVMSG #mp_${roomId} :Room name: Synthetic background, History: https://osu.ppy.sh/mp/${roomId}\n:BanchoBot PRIVMSG #mp_${roomId} :Team mode: TeamVs, Win condition: ScoreV2\n:BanchoBot PRIVMSG #mp_${roomId} :Players: 0\n`)
      if (line.endsWith(':!mp listrefs')) socket.write(`:BanchoBot PRIVMSG #mp_${roomId} :Match referees: ${username}\n`)
      if (line.startsWith('PING :')) socket.write(`:server PONG server :${line.slice(6)}\n`)
    }
  })
})
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn) { for (let n = 0; n < 200; n++) { if (await fn()) return; await delay(30) }; throw new Error('Background condition timed out') }
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
  checkMenu(trayMenus[0], 'zh-Hant') // Constructor and resolved system locale both retain Quit.
  checkMenu(trayMenu, scenario.locale)
  assert.equal((await js(`window.oclr.login({username:${JSON.stringify(username)},password:"SYNTHETIC_ONLY"})`)).ok, true)
  await until(() => js('(async () => (await window.oclr.snapshot()).connection === "online")()'))
  assert.equal((await js(`window.oclr.join("${roomId}")`)).ok, true)
  await until(() => js('(async () => (await window.oclr.snapshot()).room?.joined)()'))
  for (const kind of ['settings', 'listrefs']) {
    await until(async () => (await js(`(async () => { const s = await window.oclr.snapshot(); return window.oclr.query({roomId:s.room.id,roomEpoch:s.room.epoch,kind:${JSON.stringify(kind)}}) })()`)).ok)
    await until(() => js('(async () => !(await window.oclr.snapshot()).pending)()'))
  }
  await until(() => js('(async () => (await window.oclr.snapshot()).room?.referee === "listed")()'))
  const room = (await js('window.oclr.snapshot()')).room
  await until(async () => (await js(`window.oclr.chat(${JSON.stringify({ roomId, roomEpoch: room.epoch, text: 'SYNTHETIC_BACKGROUND_ONCE' })})`)).ok)
  await until(() => sent.includes(`PRIVMSG #mp_${roomId} :SYNTHETIC_BACKGROUND_ONCE`))
  assert.equal((await js('window.oclr.website.login()')).ok, true)
  assert.equal((await nativeFetch(`${auth.redirect_uri}?state=${auth.state}&code=${'C'.repeat(43)}`)).status, 200)
  await until(() => js('(async () => (await window.oclr.website.snapshot()).fixtures.length === 2)()'))
  assert.equal((await js(`window.oclr.website.selectFixture(${JSON.stringify(fixtures.data.items[0].fixtureId)})`)).ok, true)
  await until(() => js('(async () => (await window.oclr.website.snapshot()).panelState === "fresh")()'))
  assert.equal((await js('window.oclr.website.startRelay()')).ok, true)
  assert.equal((await js('window.oclr.website.snapshot()')).relay.status, 'connected')
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
  trayMenu.items[0].click(trayMenu.items[0], window, {})
  await until(() => window.isVisible() && !window.isMinimized())
  await js('window.oclr.runInBackground()')
  app.emit('second-instance', {}, [], process.cwd())
  await until(() => window.isVisible() && !window.isMinimized())
  assert.equal(welcomes, 1)
  window.emit('query-session-end', { preventDefault() { throw new Error('Shutdown must not be blocked') } })
  assert.equal((await js('window.oclr.snapshot()')).connection, 'online')
  if (phase.startsWith('updated')) {
    for (const locale of ['en', 'zh-Hans', 'zh-Hant']) {
      assert.equal((await js(`window.oclr.settings.update({restoreIrcLogin:false,closeToBackground:${scenario.background},language:${JSON.stringify(locale)}})`)).ok, true)
      checkMenu(trayMenu, locale)
    }
    // Following the system refreshes the same native menu on foreground changes.
    osLanguages = [scenario.locale === 'en' ? 'zh-TW' : 'en-US']
    assert.equal((await js(`window.oclr.settings.update({restoreIrcLogin:false,closeToBackground:${scenario.background},language:"system"})`)).ok, true)
    checkMenu(trayMenu, scenario.locale === 'en' ? 'zh-Hant' : 'en')
    osLanguages = [scenario.locale]; window.emit('focus')
    checkMenu(trayMenu, scenario.locale)
  } else if (!scenario.background) {
    assert.equal((await js('window.oclr.settings.update({restoreIrcLogin:false,closeToBackground:false,language:"system"})')).ok, true)
  }
  assert.equal((await js('window.oclr.settings.snapshot()')).preferences.closeToBackground, scenario.background)
  if (scenario.state === 'hidden') {
    if (scenario.background) window.close()
    else assert.equal((await js('window.oclr.runInBackground()')).ok, true)
    await until(() => headlessLinux ? minimizes >= 4 : !window.isVisible() || window.isMinimized())
  } else if (scenario.state === 'minimized') {
    const before = minimizes
    window.minimize()
    await until(() => headlessLinux ? minimizes > before : window.isMinimized())
  }
  const outboundBeforeQuit = sent.filter(line => line.startsWith('PRIVMSG '))
  app.on('before-quit', () => {
    // Main's cleanup listener is registered first; inspect without depending on a closing renderer.
    const state = handlers.get('irc:snapshot')({ sender: window.webContents, senderFrame: window.webContents.mainFrame })
    assert.equal(state.connection, 'offline'); assert.equal(state.username, '')
    assert.equal(state.rooms.length, 0); assert.equal(state.messages.length, 0)
    const website = handlers.get('oclr:snapshot')({ sender: window.webContents, senderFrame: window.webContents.mainFrame })
    assert.equal(website.status, 'disconnected'); assert.equal(website.subject, null)
    assert.equal(website.panel, null); assert.equal(website.fixtures.length, 0)
    assert.equal(website.relay.status, 'off')
    assert.ok(relaySignals.length > 0 && relaySignals.every(signal => signal.aborted))
    assert.equal(tray.isDestroyed(), true)
  })
  app.on('will-quit', () => {
    assert.equal(window.isDestroyed(), true)
    assert.equal(sent.filter(line => line.includes('SYNTHETIC_BACKGROUND_ONCE')).length, 1)
    assert.deepEqual(sent.filter(line => line.startsWith('PRIVMSG ')), outboundBeforeQuit)
    assert.ok(!sent.some(line => /:!mp (?!settings$|listrefs$)/.test(line)))
    fs.mkdirSync('artifacts', { recursive: true })
    const report = { evidence: 'synthetic-native-background', phase, scenario, platform: process.platform, arch: process.arch, recordedAt: new Date().toISOString(), trayConstructed: Boolean(trayMenu), passed: ['close retains native window and authenticated IRC', 'IRC PING/PONG works while hidden/minimized', 'activate restores original window', 'explicit background IPC', 'tray open restores original window', 'second-instance event restores one window without relogin', 'initial and system locale tray menu includes Open / separator / Quit', ...(phase.startsWith('updated') ? ['three language changes and system language refresh retain usable Quit'] : []), 'quit clears IRC and active OCLR session / panel / relay and aborts requests', 'quit destroys tray and window and bypasses close-to-background', 'chat sent once; no replay or match mutations'], limitation: 'Synthetic IRC/HTTP; native menu callbacks and second-instance event are invoked by the test. Headless Linux checks minimize requests, not window-manager handling. Tray construction does not prove physical system indicator visibility or actual right-click / OS shutdown behavior. Three-platform device acceptance remains separate.' }
    fs.writeFileSync(`artifacts/background-smoke-${phase}.json`, JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report))
  })
  if (phase === 'close-disabled') window.close()
  else {
    const quitMenu = phase === 'initial-hidden' ? trayMenus[0] : trayMenu
    quitMenu.items[2].click(quitMenu.items[2], window, {})
  }
}
main().catch(async error => {
  console.error(error.stack)
  const window = BrowserWindow.getAllWindows()[0]
  const state = window && !window.isDestroyed() ? await window.webContents.executeJavaScript('(async () => { const s = await window.oclr.snapshot(); return { connection: s.connection, pending: s.pending, room: s.room } })()').catch(() => null) : null
  console.error(JSON.stringify({ phase, state, sent }))
  app.exit(1)
})
