// Isolated settings/localization acceptance; no live IRC or external browser opens.
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
app.disableHardwareAcceleration()
const profile = path.join(process.env.OCLR_QA_TEMP, 'settings')
app.setPath('userData', profile)
let osLanguages = ['en-US']
app.getPreferredSystemLanguages = () => osLanguages
const restart = process.argv.includes('--restart-check')
const handlers = new Map(), opened = [], sent = [], errors = []
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (name, fn) => { handlers.set(name, fn); handle(name, fn) }
shell.openExternal = async url => { opened.push(url) }
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  contents.on('preload-error', () => errors.push('preload failed'))
})
let peer
const server = net.createServer(socket => {
  peer = socket
  let pending = ''
  socket.on('data', chunk => {
    pending += chunk.toString()
    let end
    while ((end = pending.indexOf('\r\n')) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 2)
      sent.push(line.startsWith('PASS ') ? 'PASS <synthetic-redacted>' : line)
      if (line.startsWith('USER ')) socket.write(':server 001 SyntheticRef :Welcome\n')
      if (line.startsWith('JOIN ')) socket.write(':server 366 SyntheticRef #mp_900000008 :End\n')
      if (line.endsWith(':!mp settings')) socket.write(':BanchoBot PRIVMSG #mp_900000008 :Room name: 未知 房間, History: https://osu.ppy.sh/mp/900000008\n:BanchoBot PRIVMSG #mp_900000008 :Beatmap: https://osu.ppy.sh/b/75 歌曲 原文\n:BanchoBot PRIVMSG #mp_900000008 :Team mode: TeamVs, Win condition: ScoreV2\n:BanchoBot PRIVMSG #mp_900000008 :Active mods: None\n:BanchoBot PRIVMSG #mp_900000008 :Players: 1\n:BanchoBot PRIVMSG #mp_900000008 :Slot 1 Ready https://osu.ppy.sh/u/101 未知 [Team Red]\n')
      if (line.endsWith(':!mp listrefs')) socket.write(':BanchoBot PRIVMSG #mp_900000008 :Match referees:\n:BanchoBot PRIVMSG #mp_900000008 :SyntheticRef\n')
    }
  })
})
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn) { for (let i = 0; i < 100; i++) { if (await fn()) return; await delay(50) } throw new Error('Settings UI condition timed out') }
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const connect = net.createConnection
  net.createConnection = options => { assert.equal(options.host, 'irc.ppy.sh'); return connect({ host: '127.0.0.1', port: server.address().port }) }
  require('./mock-beatmap-fetch.cjs')
  require('./mock-avatar-fetch.cjs')
  require('../out/main/index.js')
  await app.whenReady()
  await until(() => BrowserWindow.getAllWindows().length)
  const window = BrowserWindow.getAllWindows()[0]
  window.webContents.setBackgroundThrottling(false)
  await until(() => !window.webContents.isLoading())
  const js = code => window.webContents.executeJavaScript(code).catch(error => { throw new Error(`Settings evaluation: ${code.slice(0, 240)}; ${error.message}; console: ${errors.join(' | ')}`) })
  await until(() => js('Boolean(document.querySelector(".sidebar-settings button"))'))
  const settings = await js('window.oclr.settings.snapshot()')
  assert.equal(settings.locale, 'en')
  assert.equal(settings.preferences.language, restart ? 'en' : 'system')
  assert.equal(settings.preferences.closeToBackground, !restart)
  assert.equal(await js('document.documentElement.lang'), 'en')
  assert.equal(await js('document.body.textContent.includes("Quit")'), false)
  assert.equal(await js('Boolean(document.querySelector(".sidebar-note"))'), false)
  assert.throws(() => handlers.get('app:avatar')({ sender: window.webContents, senderFrame: { url: 'https://untrusted.invalid' } }), /Untrusted/)
  await assert.rejects(handlers.get('app:settings-update')({ sender: window.webContents, senderFrame: { url: 'https://untrusted.invalid' } }, { closeToBackground: false, language: 'en', restoreIrcLogin: false }), /Untrusted/)
  if (!restart) {
    await js('document.querySelector(".sidebar-settings button").click()')
    await until(() => js('Boolean(document.querySelector(".language-select"))'))
    window.setSize(900, 640)
    await js('document.querySelector("input[name=closeToBackground]").click()')
    await until(() => js('(async () => !(await window.oclr.settings.snapshot()).preferences.closeToBackground)()'))
    async function choose(value, locale, preference) {
      await until(() => js('!document.querySelector(".language-select button[aria-haspopup]").disabled'))
      await js('document.querySelector(".language-select button[aria-haspopup]").click()')
      await until(() => js('Boolean(document.querySelector("[role=option]"))'))
      await js(`Array.from(document.querySelectorAll('[role=option]')).find(e=>e.textContent===${JSON.stringify(value)}).click()`)
      await until(() => js(`document.documentElement.lang===${JSON.stringify(locale)}`))
      await until(() => js(`(async () => (await window.oclr.settings.snapshot()).preferences.language===${JSON.stringify(preference)})()`))
      await until(() => js('document.querySelector(".language-select button[aria-haspopup]").getAttribute("aria-expanded")!=="true"'))
    }
    await choose('简体中文', 'zh-Hans', 'zh-Hans')
    assert.equal(await js('document.querySelector(".settings-view h1").textContent'), '设置')
    await choose('繁體中文', 'zh-Hant', 'zh-Hant')
    assert.equal(await js('document.querySelector(".settings-view h1").textContent'), '設定')
    await choose('跟隨系統', 'en', 'system')
    osLanguages = ['zh-TW']; window.emit('focus')
    await until(() => js('document.documentElement.lang==="zh-Hant"'))
    assert.equal((await js('window.oclr.settings.snapshot()')).preferences.language, 'system')
    osLanguages = ['en-US']; window.emit('focus')
    await until(() => js('document.documentElement.lang==="en"'))
    await choose('English', 'en', 'en')
    assert.equal(await js('document.querySelector(".settings-view h1").textContent'), 'Settings')
    assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true)
    assert.ok((await js('document.querySelector(".settings-section:has(input[name=closeToBackground]) .label").textContent')).endsWith('closed'))
    assert.equal(await js('document.querySelector(".settings-section:has(input[name=restoreIrcLogin]) .label").textContent'), 'Restore the last IRC login on startup')
    assert.equal(await js('Array.from(document.querySelectorAll(".settings-section")).every(e=>e.scrollWidth<=e.clientWidth+1)'), true)
    const box = await js('(() => { const r=document.querySelector(".sidebar-settings button").getBoundingClientRect(); return {bottom:r.bottom,right:r.right} })()')
    assert.ok(box.bottom <= 640 && box.right <= 900)
    fs.mkdirSync('artifacts', { recursive: true })
    fs.writeFileSync('artifacts/settings-compact-synthetic.png', (await window.webContents.capturePage()).toPNG())
    await js('Array.from(document.querySelectorAll("[role=tab]")).find(e=>e.textContent==="About").click()')
    await until(() => js('Boolean(document.querySelector(".about-app"))'))
    assert.ok((await js('document.querySelector(".about-details").textContent')).includes(app.getVersion()))
    await js('Array.from(document.querySelectorAll(".about-links button")).find(e=>e.textContent.includes("Project website")).click()')
    await until(() => opened.length === 1)
    assert.equal(opened[0], 'https://github.com/OCLR-dev/OCLR-IRC')
    assert.equal((await js('window.oclr.settings.openAboutLink("https://untrusted.invalid")')).ok, false)
    assert.equal((await js('window.oclr.settings.update({closeToBackground:"false",language:"en"})')).ok, false)
    assert.equal((await js('window.oclr.settings.snapshot()')).preferences.closeToBackground, false)
    fs.writeFileSync('artifacts/about-compact-synthetic.png', (await window.webContents.capturePage()).toPNG())
    const reloaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve))
    window.webContents.reload(); await reloaded
    await until(() => js('Boolean(document.querySelector(".sidebar-settings button"))'))
    assert.equal(await js('document.documentElement.lang'), 'en')
    await js('window.oclr.login({username:"SyntheticRef",password:"SYNTHETIC_ONLY"})')
    await until(() => js('Boolean(document.querySelector(".join-room-button"))'))
    assert.equal((await js('window.oclr.join("900000008")')).ok, true)
    await until(() => js('(async () => { const s=await window.oclr.snapshot(); return s.room?.joined && !s.pending })()'))
    for (const kind of ['settings', 'listrefs']) {
      await until(async () => (await js(`(async () => { const s=await window.oclr.snapshot(); return window.oclr.query({roomId:s.room.id,roomEpoch:s.room.epoch,kind:${JSON.stringify(kind)}}) })()`)).ok)
      await until(() => js('(async () => !(await window.oclr.snapshot()).pending)()'))
    }
    await js('Array.from(document.querySelectorAll("[role=tab]")).find(e=>e.textContent==="Players").click()')
    await until(() => js('Boolean(document.querySelector(".player-slot.occupied"))'))
    await until(() => js('(async () => { const s=await window.oclr.snapshot(); return s.room.referee==="listed" && !s.pending })()'))
    peer.write(':系統 PRIVMSG #mp_900000008 :已連線 原文\n')
    await until(() => js('document.querySelector(".message-area").textContent.includes("已連線 原文")'))
    await js('(() => { const el=document.querySelector("input[name=chat]"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,"Draft 未知"); el.dispatchEvent(new Event("input",{bubbles:true})) })()')
    const before = sent.length
    await js('window.oclr.settings.update({restoreIrcLogin:false,closeToBackground:false,language:"zh-Hans"})')
    await until(() => js('document.documentElement.lang==="zh-Hans"'))
    assert.equal(await js('document.querySelector(".conversation-title h2").textContent'), '未知 房間')
    assert.ok((await js('document.querySelector(".match-status").textContent')).includes('歌曲 原文'))
    assert.equal(await js('document.querySelector(".slot-player strong").textContent'), '未知')
    assert.ok((await js('document.querySelector(".message-area").textContent')).includes('已連線 原文'))
    assert.equal(await js('document.querySelector("input[name=chat]").value'), 'Draft 未知')
    assert.equal(sent.length, before)
    await js('window.oclr.settings.update({restoreIrcLogin:false,closeToBackground:false,language:"en"})')
    await until(() => js('document.querySelector(".tools-heading").textContent.includes("Room tools")'))
    assert.equal(await js('document.querySelector(".composer").getBoundingClientRect().bottom<=innerHeight'), true)
  }
  assert.deepEqual(errors, [])
  assert.ok(sent.filter(line => line.includes('!mp')).every(line => /:!mp (settings|listrefs)$/.test(line)))
  app.on('before-quit', () => {
    const state = handlers.get('irc:snapshot')({ sender: window.webContents, senderFrame: window.webContents.mainFrame })
    assert.equal(state.connection, 'offline')
    const saved = JSON.parse(fs.readFileSync(path.join(profile, 'preferences.json'), 'utf8'))
    assert.deepEqual(saved.preferences, { closeToBackground: false, language: 'en', restoreIrcLogin: false })
  })
  app.on('will-quit', () => {
    const report = { evidence: restart ? 'synthetic-settings-restart' : 'synthetic-settings-localization', passed: restart ? ['new application process restores locale and close behavior', 'close without background exits'] : ['HeroUI language selection for all four options', 'language changes without relogin or IRC commands', 'chat, names, maps and draft remain literal', '900x640 settings, about and composer', 'no sidebar quit button', 'fixed About link allowlist', 'invalid IPC inputs and sender rejected', 'preferences survive renderer reload', 'close without background exits and cleans authentication'], limitation: 'Synthetic services and OS language. Physical tray/IME acceptance remains separate.' }
    fs.mkdirSync('artifacts', { recursive: true }); fs.writeFileSync(`artifacts/settings${restart ? '-restart' : ''}-smoke.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report))
  })
  window.close()
}
main().catch(async error => { console.error(error.stack); console.error({restart, errors}); app.exit(1) })
