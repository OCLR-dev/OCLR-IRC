// Real desktop Main/Preload/Renderer and loopback; synthetic HTTPS API, IRC and browser approval.
// No production test switch, live credentials or network requests to OCLR/osu!.
const { app, BrowserWindow, clipboard, shell } = require('electron')
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
if (process.env.CI && process.platform === 'linux') app.disableHardwareAcceleration()
app.setPath('userData', process.env.OCLR_QA_TEMP)
require('./mock-system-locale.cjs')
const output = path.resolve('artifacts')
fs.mkdirSync(output, { recursive: true })
const panel = JSON.parse(fs.readFileSync('tests/fixtures/oclr-panel.json', 'utf8'))
const fixtures = JSON.parse(fs.readFileSync('tests/fixtures/oclr-fixtures.json', 'utf8'))
const meta = fixtures.meta
const nativeFetch = global.fetch
const sent = [], requests = [], opened = [], errors = []
let authRequest, unavailable = true, stale = false, revoked = false, panelGate = null
const access = 'oclr_desk_at_' + 'A'.repeat(43), refresh = 'oclr_desk_rt_' + 'D'.repeat(43)
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-OCLR-Desktop-Contract': '1.1.0', 'X-OCLR-Referee-Contract': '1.1.0', 'X-Request-Id': meta.requestId } })
global.fetch = async (url, init = {}) => {
  const target = new URL(String(url)); assert.equal(target.origin, 'https://oclr.org')
  assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error')
  requests.push({ path: target.pathname, method: init.method })
  if (target.pathname.endsWith('/auth/requests')) {
    if (unavailable) return new Response('<html>not deployed</html>', { headers: { 'Content-Type': 'text/html' } })
    authRequest = JSON.parse(init.body)
    assert.deepEqual(authRequest.scope, ['referee:fixtures:read', 'referee:context:read', 'referee:panel:read', 'referee:relay'])
    return json({ data: { authorization_request_id: meta.requestId, authorization_url: 'https://oclr.org/desktop/authorize?request_id=' + meta.requestId, verification_code: 'ABCD-2345', expires_at: '2026-10-28T08:10:00.000Z' }, meta }, 201)
  }
  if (target.pathname.endsWith('/auth/exchange')) {
    const body = JSON.parse(init.body)
    assert.equal(body.redirect_uri, authRequest.redirect_uri)
    assert.equal(createHash('sha256').update(body.code_verifier, 'ascii').digest('base64url'), authRequest.code_challenge)
    return json({ data: { token_type: 'Bearer', access_token: access, refresh_token: refresh, expires_in: 600, access_expires_at: '2026-10-28T08:10:00.000Z', refresh_expires_at: '2026-10-28T10:00:00.000Z', session_expires_at: '2026-10-28T20:00:00.000Z', session_id: meta.requestId, scope: authRequest.scope, subject: panel.data.viewer }, meta })
  }
  if (target.pathname.endsWith('/auth/revoke')) return new Response(null, { status: 204 })
  assert.equal(init.headers.Authorization, 'Bearer ' + access)
  if (revoked) return json({ error: { code: 'REFEREE_ACCESS_REVOKED', message: 'SYNTHETIC_SERVER_MESSAGE_NOT_FOR_UI', requestId: meta.requestId, retryable: false } }, 403)
  if (target.pathname.includes('/me/fixtures')) return json(fixtures)
  if (target.pathname.endsWith('/panel')) {
    if (panelGate) await panelGate
    const value = structuredClone(panel)
    if (stale) value.data.freshUntil = value.data.capturedAt
    value.data.workspace.unexpectedSecret = 'SYNTHETIC_UNEXPECTED_FIELD_NOT_FOR_RENDERER'
    return json(value)
  }
  throw new Error('Unexpected synthetic OCLR API call')
}
shell.openExternal = async url => { opened.push(url) }
const server = net.createServer(socket => {
  let pending = '', username = ''
  socket.on('data', chunk => {
    pending += chunk.toString()
    let end
    while ((end = pending.indexOf('\r\n')) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 2)
      sent.push(line.startsWith('PASS ') ? 'PASS <redacted synthetic>' : line)
      if (line.startsWith('NICK ')) username = line.slice(5)
      if (line.startsWith('USER ')) socket.write(`:server 001 ${username} :Welcome\n`)
      if (line.startsWith('PING :')) socket.write(':server PONG server :' + line.slice(6) + '\n')
    }
  })
})
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  contents.on('preload-error', () => errors.push('preload error'))
})
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn) { for (let i = 0; i < 100; i++) { if (await fn()) return; await delay(50) }; throw new Error('OCLR UI condition timed out') }
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const create = net.createConnection
  net.createConnection = options => { assert.equal(options.host, 'irc.ppy.sh'); return create({ host: '127.0.0.1', port: server.address().port }) }
  require('./mock-beatmap-fetch.cjs')
  require('../out/main/index.js')
  await app.whenReady()
  await until(() => BrowserWindow.getAllWindows().length)
  const window = BrowserWindow.getAllWindows()[0]
  await until(() => !window.webContents.isLoading())
  const js = code => window.webContents.executeJavaScript(code)
  await until(() => js('Boolean(window.oclr?.website)'))
  assert.equal((await js('window.oclr.login({username:"SyntheticRef",password:"SYNTHETIC_ONLY"})')).ok, true)
  await until(() => js('(async () => (await window.oclr.snapshot()).connection === "online")()'))
  await js(`Array.from(document.querySelectorAll('nav button')).find(b => b.textContent.includes('OCLR 場次')).click()`)
  await until(() => js('Boolean(document.querySelector(".oclr-login"))'))
  await js('document.querySelector(".oclr-login .primary-button").click()')
  await until(() => js('document.body.textContent.includes("桌面 API 尚不可用")'))
  assert.deepEqual(opened, [])
  unavailable = false
  await js('document.querySelector(".oclr-login .primary-button").click()')
  await until(() => js('document.body.textContent.includes("ABCD-2345")'))
  assert.equal(opened.length, 1)
  fs.writeFileSync(path.join(output, 'oclr-authorization-synthetic.png'), (await window.webContents.capturePage()).toPNG())
  const response = await nativeFetch(authRequest.redirect_uri + '?state=' + authRequest.state + '&code=' + 'C'.repeat(43))
  assert.equal(response.status, 200)
  await until(() => js('document.querySelectorAll(".oclr-fixture").length === 2'))
  await until(() => js('document.querySelector(".account-pairing")?.textContent.includes("暱稱不符")'))
  assert.equal((await js('window.oclr.website.confirmPairing({token:"forged",reviewed:true})')).ok, false)
  assert.equal((await js('window.oclr.website.startRelay()')).ok, false)
  await js('window.oclr.logout()')
  await js('window.oclr.login({username:"Synthetic_Referee",password:"SYNTHETIC_ONLY"})')
  await until(() => js('(async () => (await window.oclr.snapshot()).connection === "online")()'))
  await until(() => js('document.querySelector(".account-pairing")?.textContent.includes("待人工核對")'))
  await js('document.querySelector(".account-pairing input[type=checkbox]").click()')
  await until(() => js('(async () => (await window.oclr.website.snapshot()).pairing.reviewed)()'))
  const oldPairing = (await js('window.oclr.website.snapshot()')).pairing.token
  await js('window.oclr.logout()')
  await until(() => js('document.querySelector(".account-pairing")?.textContent.includes("尚未配對")'))
  await js('window.oclr.login({username:"Synthetic_Referee",password:"SYNTHETIC_ONLY"})')
  await until(() => js('document.querySelector(".account-pairing")?.textContent.includes("待人工核對")'))
  assert.equal((await js(`window.oclr.website.confirmPairing({token:${JSON.stringify(oldPairing)},reviewed:true})`)).ok, false)
  await js('document.querySelector(".account-pairing input[type=checkbox]").click()')
  await until(() => js('(async () => (await window.oclr.website.snapshot()).pairing.reviewed)()'))
  await js('document.querySelector(".oclr-fixture").click()')
  await until(() => js('Boolean(document.querySelector(".oclr-settings"))'))
  await until(() => js(`!document.querySelector('button[aria-label="複製 make"]').disabled`))
  assert.equal(await js('Boolean(document.querySelector(".oclr-panel input"))'), false)
  await js(`document.querySelector('button[aria-label="複製 make"]').click()`)
  await until(() => js('document.body.textContent.includes("已複製")'))
  assert.equal(await clipboard.readText(), '!mp make OCLR: (Team A) vs (Team B)')
  // Room creation reads the selected OCLR name, without issuing a make command.
  await js(`Array.from(document.querySelectorAll('nav button')).find(b => b.textContent.includes('房間記錄')).click()`)
  await until(() => js('Boolean(document.querySelector(".new-room-button"))'))
  await js('document.querySelector(".new-room-button").click()')
  await until(() => js('document.querySelector("input[name=matchName]")?.value === "OCLR: (Team A) vs (Team B)"'))
  assert.equal(await js('Boolean(document.querySelector("[data-room-name-source]"))'), true)
  assert.equal(await js('document.querySelector("input[name=reviewedCreation]").checked'), false)
  assert.equal(await js('document.querySelector(".create-room-form button[type=submit]").disabled'), true)
  // Retain user edits and review through a stale -> fresh refresh of the same source.
  await js(`(() => { const input = document.querySelector('input[name=matchName]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, 'SYNTHETIC CUSTOM ROOM'); input.dispatchEvent(new Event('input', {bubbles:true})); })()`)
  await until(() => js('document.querySelector("input[name=matchName]")?.value === "SYNTHETIC CUSTOM ROOM"'))
  await js('document.querySelector("input[name=reviewedCreation]").click()')
  await until(() => js('!document.querySelector(".create-room-form button[type=submit]").disabled'))
  let releasePanel
  panelGate = new Promise(resolve => { releasePanel = resolve })
  await js('void window.oclr.website.refreshPanel()')
  await until(() => js('document.querySelector(".create-room-form")?.textContent.includes("場次資料待更新")'))
  assert.equal(await js('document.querySelector("input[name=matchName]").value'), 'SYNTHETIC CUSTOM ROOM')
  assert.equal(await js('document.querySelector(".create-room-form button[type=submit]").disabled'), true)
  await js('document.querySelector(".create-room-form").requestSubmit()')
  assert.equal(sent.some(line => line.includes('!mp make ')), false)
  panelGate = null; releasePanel()
  await until(() => js('!document.querySelector(".create-room-form button[type=submit]").disabled'))
  assert.equal(await js('document.querySelector("input[name=matchName]").value'), 'SYNTHETIC CUSTOM ROOM')
  assert.equal(await js('document.querySelector("input[name=reviewedCreation]").checked'), true)
  // A real source revision/name change still clears customization and its review.
  const originalName = panel.data.workspace.defaultSettings.roomName
  panel.data.workspace.defaultSettings.roomName = 'SYNTHETIC UPDATED ROOM'
  await js('window.oclr.website.refreshPanel()')
  await until(() => js('document.querySelector("input[name=matchName]")?.value === "SYNTHETIC UPDATED ROOM"'))
  assert.equal(await js('document.querySelector("input[name=reviewedCreation]").checked'), false)
  assert.equal(await js('document.querySelector(".create-room-form button[type=submit]").disabled'), true)
  assert.equal(sent.some(line => line.includes('!mp make ')), false)
  panel.data.workspace.defaultSettings.roomName = originalName
  await js('document.querySelector(".create-room-heading button").click()')
  await until(() => js('!document.querySelector(".create-room-form")'))
  await js(`Array.from(document.querySelectorAll('nav button')).find(b => b.textContent.includes('OCLR 場次')).click()`)
  await until(() => js('Boolean(document.querySelector(".oclr-settings"))'))
  fs.writeFileSync(path.join(output, 'oclr-prepare-synthetic.png'), (await window.webContents.capturePage()).toPNG())
  await js('document.querySelector("#oclr-tab-1").click()')
  await until(() => js('Boolean(document.querySelector(".oclr-map"))'))
  assert.equal(await js('Boolean(document.querySelector(".oclr-map img"))'), false)
  await js('document.querySelector(".oclr-map").click()')
  await until(() => js('document.body.textContent.includes("!mp mods NF HD")'))
  assert.equal(await js('document.body.textContent.includes("已複製")'), false)
  window.setSize(900, 640); await delay(200)
  assert.equal(await js('getComputedStyle(document.querySelector(".oclr-fixture-picker")).display !== "none"'), true)
  await js('document.querySelector(".oclr-maps").scrollIntoView({block:"center"})')
  await delay(150)
  assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true)
  fs.writeFileSync(path.join(output, 'oclr-pool-compact-synthetic.png'), (await window.webContents.capturePage()).toPNG())
  window.setSize(1180, 780)
  await js('document.querySelector("main").scrollTop=0')
  await js('document.querySelector("#oclr-tab-2").click()')
  await until(() => js('document.body.textContent.includes("裁判暫記比分")'))
  await js(`Array.from(document.querySelectorAll('.oclr-phase-content button')).find(b => b.textContent.includes('網站 MP 審核')).click()`)
  await until(() => opened.length === 2)
  assert.equal(opened[1], fixtures.data.items[0].reviewUrl)
  const beforeReload = requests.filter(r => r.path.endsWith('/auth/exchange')).length
  const rendererReloaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve))
  window.webContents.reload()
  await rendererReloaded
  await until(() => js('Boolean(window.oclr?.website && document.querySelector("nav button"))'))
  await js(`Array.from(document.querySelectorAll('nav button')).find(b => b.textContent.includes('OCLR 場次')).click()`)
  await until(() => js('Boolean(document.querySelector(".oclr-settings"))'))
  assert.equal(requests.filter(r => r.path.endsWith('/auth/exchange')).length, beforeReload)
  const snapshot = JSON.stringify(await js('window.oclr.website.snapshot()'))
  for (const forbidden of [access, refresh, authRequest.state, 'SYNTHETIC_UNEXPECTED_FIELD_NOT_FOR_RENDERER']) assert.equal(snapshot.includes(forbidden), false)
  let minimizedForBackground = false
  const minimize = window.minimize.bind(window)
  window.minimize = () => { minimizedForBackground = true; minimize() }
  window.close()
  await until(() => process.env.CI && process.platform === 'linux' ? minimizedForBackground : !window.isVisible() || window.isMinimized())
  assert.equal((await js('window.oclr.website.snapshot()')).status, 'connected')
  app.emit('activate')
  await until(() => window.isVisible() && !window.isMinimized())
  assert.equal((await js('window.oclr.website.snapshot()')).subject.osuId, panel.data.viewer.osuId)
  stale = true
  await js('window.oclr.website.refreshPanel()')
  await until(() => js('document.body.textContent.includes("資料已過期")'))
  assert.equal(await js(`document.querySelector('button[aria-label="複製 make"]').disabled`), true)
  await js(`Array.from(document.querySelectorAll('.oclr-session button')).find(b => b.textContent === '登出 OCLR').click()`)
  await until(() => js('Boolean(document.querySelector(".oclr-login"))'))
  assert.equal((await js('window.oclr.website.snapshot()')).panel, null)
  assert.equal((await js('window.oclr.snapshot()')).connection, 'online')
  assert.ok(!requests.some(r => r.method === 'PATCH' || r.path.includes('/api/admin/')))
  assert.ok(!sent.some(line => line.includes('!mp')))
  assert.deepEqual(errors, [])
  const report = { evidence: 'synthetic-oclr-desktop-integration', source: 'OCLR-website PR409@1abbab1ddd981025249af727d748e70e23b9096b', platform: process.platform, arch: process.arch, electron: process.versions.electron, recordedAt: new Date().toISOString(),
    passed: ['nickname mismatch blocks relay, explicit checkbox confirms matching nickname, relogin rejects stale review', 'undeployed HTML endpoint fails closed without opening browser', 'browser authorization comparison code', 'real one-shot 127.0.0.1 callback and S256 exchange', 'assigned fixtures and native preparation panel', 'Main-only constrained clipboard copy', 'pool preview uses shared website Mods builder', 'remote metadata renders as escaped text', '900x640 has no horizontal overflow', 'review URL opens fixed OCLR origin', 'renderer reload preserves Main session', 'no tokens/state/unexpected response fields in renderer snapshot', 'close-to-background preserves OCLR session and restore', 'stale panel disables copying', 'logout clears OCLR data while IRC remains connected', 'no referee business writes or IRC commands sent', 'no renderer console errors'],
    limitation: 'OCLR HTTPS API, browser approval, identities and IRC are synthetic. No real website authorization/deployment, production data, live IRC command or true IME acceptance.', requests }
  fs.writeFileSync(path.join(output, 'oclr-smoke.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2)); app.exit(0)
}
main().catch(async error => {
  const window = BrowserWindow.getAllWindows()[0]
  if (window) {
    fs.writeFileSync(path.join(output, 'oclr-failure-synthetic.png'), (await window.webContents.capturePage()).toPNG())
    console.error(JSON.stringify({ syntheticFailure: true, requests, errors, state: await window.webContents.executeJavaScript('window.oclr.website.snapshot()'), body: await window.webContents.executeJavaScript('document.body.textContent') }))
  }
  console.error(error.stack); app.exit(1)
})
