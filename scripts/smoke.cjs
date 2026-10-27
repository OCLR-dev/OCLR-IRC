// Desktop UI integration QA. Transport is replaced in this process only, before
// loading the built Main. No production environment flag or renderer host override.
const { app, BrowserWindow } = require('electron')
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
app.setPath('userData', process.env.OCLR_QA_TEMP)
const output = path.resolve('artifacts')
fs.mkdirSync(output, { recursive: true })
const sent = []
let username = ''
const server = net.createServer(socket => {
  let pending = ''
  socket.on('data', chunk => {
    pending += chunk.toString()
    let end
    while ((end = pending.indexOf('\r\n')) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 2)
      sent.push(line.startsWith('PASS ') ? 'PASS <synthetic-redacted>' : line)
      if (line.startsWith('NICK ')) username = line.slice(5)
      if (line.startsWith('USER ')) socket.write(`:server 001 ${username} :Welcome\r\n`)
      if (line === 'JOIN #mp_900000001') socket.write(`:server 366 ${username} #mp_900000001 :End\r\n`)
      if (line.endsWith(':!mp settings')) socket.write(':BanchoBot PRIVMSG #mp_900000001 :Room name: SYNTHETIC QA ROOM, History: https://osu.ppy.sh/mp/900000001\n:BanchoBot PRIVMSG #mp_900000001 :Team mode: TeamVs, Win condition: ScoreV2\n:BanchoBot PRIVMSG #mp_900000001 :Players: 0\n')
      if (line.endsWith(':!mp listrefs')) socket.write(`:BanchoBot PRIVMSG #mp_900000001 :Match referees:\n:BanchoBot PRIVMSG #mp_900000001 :${username}\n`)
    }
  })
})
const originalConnect = net.createConnection
const errors = []
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  contents.on('preload-error', () => errors.push('preload failed'))
})
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn) {
  for (let i = 0; i < 60; i++) { if (await fn()) return; await delay(100) }
  throw new Error('UI condition timed out')
}
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  net.createConnection = function(options, ...rest) {
    if (options.host !== 'irc.ppy.sh') throw new Error('Unexpected network target')
    return originalConnect.call(net, { host: '127.0.0.1', port }, ...rest)
  }
  require('../out/main/index.js')
  await app.whenReady()
  await until(() => BrowserWindow.getAllWindows().length > 0)
  const window = BrowserWindow.getAllWindows()[0]
  await until(() => !window.webContents.isLoading())
  const js = code => window.webContents.executeJavaScript(code)
  await until(() => js('Boolean(document.querySelector("input[name=username]"))'))
  assert.equal(await js('typeof window.oclr.login'), 'function')
  assert.equal(await js('typeof window.require'), 'undefined')
  assert.equal(window.webContents.getLastWebPreferences().sandbox, true)
  await delay(400)
  fs.writeFileSync(path.join(output, 'login.png'), (await window.webContents.capturePage()).toPNG())
  async function fill(selector, value) {
    await js(`(() => {const element=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,${JSON.stringify(value)});element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));})()`)
    await delay(100)
  }
  await fill('input[name=username]', 'SyntheticRef')
  await fill('input[name=password]', 'SYNTHETIC_PASSWORD_ONLY')
  assert.equal(await js('document.querySelector("button[type=submit]").disabled'), false)
  await js('document.querySelector("button[type=submit]").click()')
  await until(() => js('Boolean(document.querySelector(".join-form"))'))
  await fill('.join-form input', '900000001')
  await js('document.querySelector(".join-form button[type=submit]").click()')
  await until(() => js('!document.querySelector(".query-actions button").disabled'))
  await js('document.querySelectorAll(".query-actions button")[0].click()')
  await until(() => js('document.body.textContent.includes("History 連結相符")'))
  await delay(1100)
  await js('document.querySelectorAll(".query-actions button")[1].click()')
  await until(() => js('document.body.textContent.includes("已列於裁判名單")'))
  await delay(300)
  fs.writeFileSync(path.join(output, 'workspace-synthetic.png'), (await window.webContents.capturePage()).toPNG())
  assert.ok(!JSON.stringify(await js('window.oclr.snapshot()')).includes('SYNTHETIC_PASSWORD_ONLY'))
  await js(`document.querySelector('button[aria-label="登出 IRC"]').click()`)
  await until(() => js('Boolean(document.querySelector("input[name=password]"))'))
  assert.equal(await js('document.querySelector("input[name=password]").value'), '')
  assert.equal((await js('window.oclr.snapshot()')).connection, 'offline')
  assert.deepEqual(errors, [])
  const report = { evidence: 'synthetic-desktop-ui', platform: process.platform, arch: process.arch,
    electron: process.versions.electron, recordedAt: new Date().toISOString(),
    passed: ['renderer and sandboxed preload loaded', 'form login to local fake IRC', 'LF-only settings binding', 'split-line referee membership', 'logout and secret clearing', 'no renderer console errors'],
    sent, limitation: 'Local fake server only; no live account credentials, no OCLR OAuth, no Windows/Linux verification.' }
  fs.writeFileSync(path.join(output, 'ui-smoke.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
  app.exit(0)
}
main().catch(error => { console.error(error.message); app.exit(1) })
