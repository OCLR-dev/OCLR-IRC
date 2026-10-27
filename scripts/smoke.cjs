// Desktop UI integration QA. Transport is replaced in this process only, before
// loading the built Main. No production environment flag or renderer host override.
const { app, BrowserWindow, shell } = require('electron')
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
app.setPath('userData', process.env.OCLR_QA_TEMP)
const output = path.resolve('artifacts')
fs.mkdirSync(output, { recursive: true })
const sent = []
let username = ''
let peer
const opened = []
shell.openExternal = async url => { opened.push(url) }
const server = net.createServer(socket => {
  peer = socket
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
  await delay(1100)
  await fill('input[name=chat]', '中文輸入測試')
  const beforeIME = sent.length
  await js(`document.querySelector('input[name=chat]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true, cancelable: true }))`)
  await delay(150)
  assert.equal(sent.length, beforeIME)
  await js('document.querySelector(".composer button[type=submit]").click()')
  await until(() => sent.some(line => line.endsWith(':中文輸入測試')))
  await until(() => js('document.querySelector("input[name=chat]").value === ""'))
  await until(() => js('document.body.textContent.includes("未確認送達")'))
  await fill('input[name=chat]', '!mp start')
  assert.equal(await js('document.querySelector(".composer button[type=submit]").disabled'), true)
  const rejected = await js('window.oclr.chat({roomId:900000001,roomEpoch:0,text:"!mp start"})')
  assert.equal(rejected.ok, false)
  await fill('input[name=chat]', '')
  peer.write(':Player PRIVMSG #mp_900000001 :https://osu.ppy.sh/mp/900000001 <img src=x onerror=alert(1)>\n')
  await until(() => js('Boolean(document.querySelector(".message-text a"))'))
  await js('document.querySelector(".message-text a").click()')
  await until(() => opened.length === 1)
  assert.equal(opened[0], 'https://osu.ppy.sh/mp/900000001')
  assert.equal(await js('Boolean(document.querySelector(".message-text img"))'), false)
  assert.equal((await js('window.oclr.openMessageLink("file:///tmp/test")')).ok, false)
  assert.equal((await js('window.oclr.openMessageLink("https://unknown.invalid")')).ok, false)
  await delay(300)
  fs.writeFileSync(path.join(output, 'workspace-chat-synthetic.png'), (await window.webContents.capturePage()).toPNG())
  peer.write(Array.from({ length: 1200 }, (_, i) => `:Player PRIVMSG #mp_900000001 :SYNTHETIC row ${i}\n`).join(''))
  await until(() => js('(async () => (await window.oclr.snapshot()).messages.at(-1)?.text === "SYNTHETIC row 1199")()'))
  await delay(500)
  assert.equal((await js('window.oclr.snapshot()')).messages.length, 1000)
  assert.ok(await js('document.querySelectorAll(".message-row").length < 100'))
  await js('document.querySelector("[data-virtuoso-scroller]").scrollTop = 0')
  await delay(300)
  await until(() => js('Boolean(document.querySelector(".jump-latest"))'))
  peer.write(':Player PRIVMSG #mp_900000001 :SYNTHETIC newer row\n')
  await delay(300)
  assert.ok(await js('document.querySelector("[data-virtuoso-scroller]").scrollTop < 500'))
  await js('document.querySelector(".jump-latest").click()')
  await until(() => js('document.body.textContent.includes("SYNTHETIC newer row")'))
  window.setSize(900, 640)
  await delay(300)
  assert.equal(await js('document.querySelector(".composer").getBoundingClientRect().bottom <= innerHeight'), true)
  fs.writeFileSync(path.join(output, 'workspace-compact-synthetic.png'), (await window.webContents.capturePage()).toPNG())
  peer.write(`:Operator KICK #mp_900000001 ${username} :synthetic kick\n`)
  await until(() => js('document.querySelector("input[name=chat]").disabled'))
  assert.equal(await js('document.querySelector(".query-actions button").disabled'), true)
  assert.ok(!sent.some(line => /!mp (?:start|close|abort)/.test(line)))
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
    passed: ['renderer and sandboxed preload loaded', 'form login to local fake IRC', 'LF-only settings binding', 'split-line referee membership', 'plain chat and unconfirmed delivery', 'synthetic IME Enter guard', 'blocked command and unsafe links', 'safe external link and escaped HTML', '1000 retained rows with under 100 DOM rows', 'history scroll and jump to latest', '900x640 composer visible', 'kick disables room actions', 'logout and secret clearing', 'no renderer console errors'],
    sent, limitation: 'Local fake server only; no live account credentials, no OCLR OAuth, no Windows/Linux verification; synthetic composition event is not a real IME test.' }
  fs.writeFileSync(path.join(output, 'ui-smoke-chat.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
  app.exit(0)
}
main().catch(error => { console.error(error.stack); app.exit(1) })
