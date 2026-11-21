// Isolated settings/localization acceptance; no live IRC or external browser opens.
const { app, BrowserWindow, ipcMain, shell, Notification } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
app.disableHardwareAcceleration()
const profile = path.join(process.env.OCLR_QA_TEMP, 'settings')
app.setPath('userData', profile)
let osLanguages = ['en-US']
const savedProxy = { mode: 'socks5', host: '127.0.0.1', port: 1080 }
app.getPreferredSystemLanguages = () => osLanguages
const restart = process.argv.includes('--restart-check')
const handlers = new Map(), opened = [], sent = [], errors = []
const notifications = []
Notification.isSupported = () => true
Notification.prototype.show = function () { notifications.push(this.title) }
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
  await until(() => js('Array.from(document.querySelectorAll("img.brand-symbol")).every(img=>img.complete && img.naturalWidth===256)'))
  assert.equal(await js('document.querySelectorAll(".brand img.brand-symbol").length'), 1)
  const settings = await js('window.oclr.settings.snapshot()')
  assert.equal(settings.locale, 'en')
  assert.equal(settings.preferences.language, restart ? 'en' : 'system')
  assert.equal(settings.preferences.closeToBackground, !restart)
  assert.equal(settings.preferences.autoRefreshOclr, !restart)
  assert.equal(settings.preferences.chatFontSize, restart ? 24 : 12)
  assert.equal(settings.preferences.chatFontFamily, restart ? 'monospace' : 'default')
  assert.equal(settings.preferences.chatTimestamp, restart ? 'minutes' : 'seconds')
  assert.equal(settings.preferences.chatSendShortcut, restart ? 'modifier-enter' : 'enter')
  assert.equal(settings.preferences.foldBanchoQueries, !restart)
  assert.equal(settings.preferences.notifyPlayersReady, true)
  assert.equal(settings.preferences.notifyMatchFinished, !restart)
  assert.equal(settings.preferences.notifyOnlyInBackground, restart)
  assert.deepEqual(settings.preferences.networkProxy, restart ? savedProxy : { mode: 'direct' })
  assert.equal(await js('document.documentElement.lang'), 'en')
  assert.equal(await js('document.body.textContent.includes("Quit")'), false)
  assert.equal(await js('Boolean(document.querySelector(".sidebar-note"))'), false)
  assert.throws(() => handlers.get('app:avatar')({ sender: window.webContents, senderFrame: { url: 'https://untrusted.invalid' } }), /Untrusted/)
  await assert.rejects(handlers.get('app:settings-update')({ sender: window.webContents, senderFrame: { url: 'https://untrusted.invalid' } }, settings.preferences), /Untrusted/)
  await assert.rejects(handlers.get('oclr:open-referee-panel')({ sender: window.webContents, senderFrame: { url: 'https://untrusted.invalid' } }, '00000000-0000-4000-8000-000000000101'), /Untrusted/)
  if (!restart) {
    try {
      for (const [width, height, size] of [[1440, 900, 64], [1920, 1080, 80], [1440, 700, 40]]) {
        window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height }, viewPosition: { x: 0, y: 0 }, viewSize: { width, height }, deviceScaleFactor: 2, scale: 1 })
        await until(() => js(`innerWidth===${width} && innerHeight===${height}`))
        const brand = await js('(() => { const r=document.querySelector(".brand img").getBoundingClientRect(), sidebar=document.querySelector(".sidebar").getBoundingClientRect(), text=document.querySelector(".brand > div").getBoundingClientRect(); return { width:r.width, height:r.height, inside:r.left>=sidebar.left && text.right<=sidebar.right, font:getComputedStyle(document.querySelector(".brand strong")).fontSize, density:devicePixelRatio, overflow:document.documentElement.scrollWidth>innerWidth } })()')
        assert.equal(brand.width, size); assert.equal(brand.height, size)
        assert.equal(brand.inside, true); assert.equal(brand.overflow, false)
        assert.equal(brand.font, size === 40 ? '21px' : '28px'); assert.equal(brand.density, 2)
        if (size === 80) {
          fs.mkdirSync('artifacts', { recursive: true })
          fs.writeFileSync('artifacts/liru-brand-wide-synthetic.png', (await window.webContents.capturePage({ x: 0, y: 0, width: 222, height: 140 })).toPNG())
        }
      }
    } finally { window.webContents.disableDeviceEmulation() }
    await js('document.querySelector(".sidebar-settings button").click()')
    await until(() => js('Boolean(document.querySelector(".language-select"))'))
    window.setSize(900, 640)
    assert.equal(await js('document.querySelector("input[name=autoRefreshOclr]").checked'), true)
    await js('document.querySelector("input[name=autoRefreshOclr]").click()')
    await until(() => js('(async () => !(await window.oclr.settings.snapshot()).preferences.autoRefreshOclr)()'))
    await until(() => js('!document.querySelector("input[name=closeToBackground]").disabled'))
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
      await until(() => js('!document.querySelector("[role=option]")'))
    }
    await choose('简体中文', 'zh-Hans', 'zh-Hans')
    assert.equal(await js('document.querySelector(".settings-section:has(input[name=autoRefreshOclr]) .label").textContent'), '自动更新 OCLR 网站数据')
    assert.equal(await js('document.querySelector(".settings-view h1").textContent'), '设置')
    await choose('繁體中文', 'zh-Hant', 'zh-Hant')
    assert.equal(await js('document.querySelector(".settings-section:has(input[name=autoRefreshOclr]) .label").textContent'), '自動更新 OCLR 網站資料')
    assert.equal(await js('document.querySelector(".settings-view h1").textContent'), '設定')
    await choose('跟隨系統', 'en', 'system')
    osLanguages = ['zh-TW']; window.emit('focus')
    await until(() => js('document.documentElement.lang==="zh-Hant"'))
    assert.equal((await js('window.oclr.settings.snapshot()')).preferences.language, 'system')
    osLanguages = ['en-US']; window.emit('focus')
    await until(() => js('document.documentElement.lang==="en"'))
    await choose('English', 'en', 'en')
    assert.equal(await js('document.querySelector(".settings-view h1").textContent'), 'Settings')
    for (const [name, selected] of [['notifyMatchFinished', false], ['notifyOnlyInBackground', true]]) {
      await until(() => js(`!document.querySelector('input[name=${name}]').disabled`))
      await js(`document.querySelector('input[name=${name}]').click()`)
      await until(() => js(`(async () => (await window.oclr.settings.snapshot()).preferences.${name} === ${selected})()`))
    }
    const chatSize = '.chat-font-size-select button[aria-haspopup]'
    await until(() => js(`!document.querySelector('${chatSize}').disabled`))
    assert.equal(await js(`document.querySelector('${chatSize}').textContent`), '12 px')
    await js(`document.querySelector('${chatSize}').scrollIntoView({block:"nearest"}); document.querySelector('${chatSize}').click()`)
    await until(() => js('Array.from(document.querySelectorAll("[role=option]")).some(option => option.textContent === "24 px")'))
    await js('Array.from(document.querySelectorAll("[role=option]")).find(option => option.textContent === "24 px").click()')
    await until(() => js(`document.querySelector('${chatSize}').textContent === "24 px"`))
    await until(() => js('!document.querySelector("[role=option]")'))
    assert.equal((await js('window.oclr.settings.snapshot()')).preferences.chatFontSize, 24)
    const chatFont = '.chat-font-family-select button[aria-haspopup]'
    await until(() => js(`!document.querySelector('${chatFont}').disabled`))
    assert.equal(await js(`document.querySelector('${chatFont}').textContent`), 'Default font')
    await js(`document.querySelector('${chatFont}').click()`)
    await until(() => js('Array.from(document.querySelectorAll("[role=option]")).some(option => option.textContent === "Monospace")'))
    await js('Array.from(document.querySelectorAll("[role=option]")).find(option => option.textContent === "Monospace").click()')
    await until(() => js(`document.querySelector('${chatFont}').textContent === "Monospace" && !document.querySelector("[role=option]")`))
    const timestamps = '.chat-timestamp-select button[aria-haspopup]'
    await until(() => js(`!document.querySelector('${timestamps}').disabled`))
    assert.equal(await js(`document.querySelector('${timestamps}').textContent`), 'HH:mm:ss')
    await js(`document.querySelector('${timestamps}').scrollIntoView({block:"nearest"}); document.querySelector('${timestamps}').click()`)
    await until(() => js('Array.from(document.querySelectorAll("[role=option]")).some(option => option.textContent === "HH:mm")'))
    await js('Array.from(document.querySelectorAll("[role=option]")).find(option => option.textContent === "HH:mm").click()')
    await until(() => js(`document.querySelector('${timestamps}').textContent === "HH:mm" && !document.querySelector("[role=option]")`))
    const sendShortcut = '.chat-send-shortcut-select button[aria-haspopup]'
    const modifiedEnter = process.platform === 'darwin' ? '⌘+Enter' : 'Ctrl+Enter'
    await until(() => js(`!document.querySelector('${sendShortcut}').disabled`))
    assert.equal(await js(`document.querySelector('${sendShortcut}').textContent`), 'Enter')
    await js(`document.querySelector('${sendShortcut}').scrollIntoView({block:"nearest"}); document.querySelector('${sendShortcut}').click()`)
    const shortcutOption = `Array.from(document.querySelectorAll('[role=option]')).find(option => option.textContent === ${JSON.stringify(modifiedEnter)})`
    await until(() => js(`Boolean(${shortcutOption})`))
    await js(`(${shortcutOption}).click()`)
    await until(() => js(`document.querySelector('${sendShortcut}').textContent === ${JSON.stringify(modifiedEnter)} && !document.querySelector("[role=option]")`))
    await until(() => js('!document.querySelector("input[name=foldBanchoQueries]").disabled'))
    await js('document.querySelector("input[name=foldBanchoQueries]").click()')
    await until(() => js('(async () => !(await window.oclr.settings.snapshot()).preferences.foldBanchoQueries)()'))
    assert.equal(await js('document.querySelector(".settings-section:has(input[name=autoRefreshOclr]) .label").textContent'), 'Automatically update OCLR website data')
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
    await until(() => js('document.querySelector(".about-app img.brand-symbol")?.naturalWidth===256'))
    assert.equal(await js('Array.from(document.querySelectorAll("img.brand-symbol")).every(img=>{const r=img.getBoundingClientRect();return r.width===40 && r.height===40 && r.right<=innerWidth && r.bottom<=innerHeight})'), true)
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
    await until(() => js('Boolean(document.querySelector(".referee-workbench .connected-panel"))'))
    await js('document.querySelector(".connected-panel .primary-button").click()')
    await until(() => js('Boolean(document.querySelector(".join-room-button"))'))
    assert.equal((await js('window.oclr.join("900000008")')).ok, true)
    await until(() => js('(async () => { const s=await window.oclr.snapshot(); return s.room?.joined && !s.pending })()'))
    for (const kind of ['settings', 'listrefs']) {
      const reads=sent.filter(line=>line.endsWith(':!mp '+kind)).length
      await until(async () => (await js(`(async () => { const s=await window.oclr.snapshot(); return window.oclr.query({roomId:s.room.id,roomEpoch:s.room.epoch,kind:${JSON.stringify(kind)}}) })()`)).ok)
      await until(() => sent.filter(line=>line.endsWith(':!mp '+kind)).length>reads)
      await until(() => js('(async () => !(await window.oclr.snapshot()).pending)()'))
    }
    await until(() => js('Array.from(document.querySelectorAll("[role=tab]")).some(e=>e.textContent==="Players")'))
    await js('Array.from(document.querySelectorAll("[role=tab]")).find(e=>e.textContent==="Players").click()')
    await until(() => js('Boolean(document.querySelector(".player-slot.occupied"))'))
    await until(() => js('(async () => { const s=await window.oclr.snapshot(); return s.room.referee==="listed" && !s.pending })()'))
    await until(() => js('Array.from(document.querySelectorAll(".message-row.bot")).some(row => row.textContent.includes("Match referees:"))'))
    assert.equal(await js('Boolean(document.querySelector(".query-replies"))'), false)
    peer.write(':系統 PRIVMSG #mp_900000008 :已連線 原文\n')
    await until(() => js('document.querySelector(".message-area").textContent.includes("已連線 原文")'))
    const conversationFontSize = `(() => {
      const message = [...document.querySelectorAll('.message-row.chat .message-text')].find(e => e.textContent.includes('已連線 原文'))
      return message && [getComputedStyle(message).fontSize, getComputedStyle(document.querySelector('[name=chat]')).fontSize]
    })()`
    const waitForChatSize = size => until(() => js(`(${conversationFontSize})?.every(font => font === "${size}px") === true`))
    await waitForChatSize(24)
    const waitForChatFont = family => until(() => js(`(() => {
      const message = [...document.querySelectorAll('.message-row.chat .message-text')].find(e => e.textContent.includes('已連線 原文'))
      const composer = document.querySelector('[name=chat]')
      return message && composer && [message, composer].every(el => getComputedStyle(el).fontFamily.startsWith('ui-${family},'))
    })()`))
    await waitForChatFont('monospace')
    const timestamp = `(() => {
      const message = [...document.querySelectorAll('.message-row.chat .message-text')].find(e => e.textContent.includes('已連線 原文'))
      const row = message?.closest('.message-row')
      return row && { text: row.querySelector('time')?.textContent ?? null, columns: getComputedStyle(row).gridTemplateColumns.split(' ').length }
    })()`
    const waitForTimestamp = (format, columns = 3) => until(async () => {
      const value = await js(timestamp)
      return value?.columns === columns && (format ? format.test(value.text) : value.text === null)
    })
    await waitForTimestamp(/^\d{2}:\d{2}$/)
    await js('(() => { const el=document.querySelector("[name=chat]"); Object.getOwnPropertyDescriptor((el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement).prototype,"value").set.call(el,"Draft 未知"); el.dispatchEvent(new Event("input",{bubbles:true})) })()')
    const before = sent.length
    const updateSettings = patch => js(`(async () => window.oclr.settings.update({ ...(await window.oclr.settings.snapshot()).preferences, ...${JSON.stringify(patch)} }))()`)
    assert.equal((await updateSettings({chatFontSize: 25})).ok, false)
    assert.equal((await updateSettings({chatFontFamily: 'Arial'})).ok, false)
    assert.equal((await updateSettings({chatTimestamp: 'invalid'})).ok, false)
    assert.equal((await updateSettings({language: 'zh-Hans', chatFontSize: 14, chatFontFamily: 'serif', chatTimestamp: 'hidden'})).ok, true)
    await until(() => js('document.documentElement.lang==="zh-Hans"'))
    // The locale and the virtual message list can render in separate frames.
    await waitForChatSize(14)
    await waitForChatFont('serif')
    await waitForTimestamp(null, 2)
    assert.equal(await js('document.querySelector(".conversation-title h2").textContent'), '未知 房間')
    assert.ok((await js('document.querySelector(".match-status").textContent')).includes('歌曲 原文'))
    assert.equal(await js('document.querySelector(".slot-player strong").textContent'), '未知')
    assert.ok((await js('document.querySelector(".message-area").textContent')).includes('已連線 原文'))
    assert.equal(await js('document.querySelector("[name=chat]").value'), 'Draft 未知')
    assert.deepEqual(sent.slice(before).filter(line=>!/^PRIVMSG #mp_\d+ :!mp (?:settings|listrefs)$/.test(line)), [])
    assert.equal((await updateSettings({language: 'en', chatFontSize: 24, chatFontFamily: 'monospace', chatTimestamp: 'seconds'})).ok, true)
    await until(() => js('document.querySelector(".tools-heading").textContent.includes("Room tools")'))
    await waitForTimestamp(/^\d{2}:\d{2}:\d{2}$/)
    assert.equal(await js('document.querySelector(".composer").getBoundingClientRect().bottom<=innerHeight'), true)
    assert.equal((await updateSettings({chatTimestamp: 'minutes'})).ok, true)
    await until(() => js(`document.querySelector('.composer-help').textContent.includes(${JSON.stringify(modifiedEnter)})`))
    const enter = modifiers => js(`!document.querySelector('[name=chat]').dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true, ...${JSON.stringify(modifiers)}
    }))`)
    const modifier = process.platform === 'darwin' ? {metaKey: true} : {ctrlKey: true}
    assert.equal(await enter({}), false, 'plain Enter keeps the text area default')
    await js('(() => { const el = document.querySelector("[name=chat]"); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, el.value + "\\nsecond line"); el.dispatchEvent(new Event("input", {bubbles:true})) })()')
    assert.equal(await enter({...modifier, isComposing: true}), false, 'an IME key event does not run the shortcut')
    assert.equal(await enter(modifier), true, 'the modified Enter shortcut handles the key')
    await until(() => sent.some(line => line.endsWith(':second line')))
    assert.deepEqual(sent.filter(line => /:(?:Draft 未知|second line)$/.test(line)), [
      'PRIVMSG #mp_900000008 :Draft 未知', 'PRIVMSG #mp_900000008 :second line'
    ])

    async function checkNotifications(marker, expected) {
      const before = notifications.length
      const room = '#mp_900000008'
      peer.write(`:BanchoBot PRIVMSG ${room} :All players are ready\n:BanchoBot PRIVMSG ${room} :The match has finished!\n:Player PRIVMSG ${room} :${marker}\n`)
      await until(() => js(`(async () => (await window.oclr.snapshot()).messages.some(message => message.text === ${JSON.stringify(marker)}))()`))
      assert.deepEqual(notifications.slice(before), expected)
    }
    window.show()
    await until(() => window.isVisible() && !window.isMinimized())
    // Keep this settings check independent of which native window the test host activates.
    const isFocused = window.isFocused
    window.isFocused = () => true
    try { await checkNotifications('foreground notifications', []) }
    finally { window.isFocused = isFocused }
    window.hide()
    await until(() => !window.isVisible())
    await checkNotifications('background ready notification', ['All players are ready'])
    assert.equal((await updateSettings({notifyPlayersReady: false, notifyMatchFinished: true})).ok, true)
    await checkNotifications('background finish notification', ['The match has finished'])
    assert.equal((await updateSettings({notifyPlayersReady: true, notifyMatchFinished: false})).ok, true)
    window.show()

    assert.equal((await updateSettings({networkProxy: {mode: 'http', host: 'http://127.0.0.1', port: 8080}})).ok, false)
    await js('document.querySelector(".sidebar-settings button").click()')
    await until(() => js('Array.from(document.querySelectorAll("[role=tab]")).some(tab => tab.textContent === "Network")'))
    await js('Array.from(document.querySelectorAll("[role=tab]")).find(tab => tab.textContent === "Network").click()')
    const mode = '.network-proxy-form button[aria-haspopup]'
    const saveProxy = '.network-proxy-form button[type=submit]'
    await until(() => js(`document.querySelector('${mode}')?.textContent === 'Direct connection'`))
    await js(`document.querySelector('${mode}').click()`)
    await until(() => js('Array.from(document.querySelectorAll("[role=option]")).some(option => option.textContent === "SOCKS5")'))
    assert.equal(await js('Array.from(document.querySelectorAll("[role=option]")).some(option => option.textContent === "HTTP CONNECT")'), true)
    await js('Array.from(document.querySelectorAll("[role=option]")).find(option => option.textContent === "SOCKS5").click()')
    await until(() => js('Boolean(document.querySelector("[name=proxyPort]")) && !document.querySelector("[role=option]")'))
    await js(`document.querySelector('${saveProxy}').click()`)
    await until(() => js('Boolean(document.querySelector(".network-proxy-form [role=alert]"))'))
    for (const [name, value] of [['proxyHost', savedProxy.host], ['proxyPort', String(savedProxy.port)]]) {
      await js(`(() => {
        const input = document.querySelector('[name=${name}]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', {bubbles: true}));
      })()`)
    }
    await js(`document.querySelector('${saveProxy}').click()`)
    await until(() => js('document.querySelector(".network-proxy-form [role=status]")?.textContent === "Proxy settings saved."'))
    assert.deepEqual((await js('window.oclr.settings.snapshot()')).preferences.networkProxy, savedProxy)
    assert.equal((await js('window.oclr.snapshot()')).connection, 'online')
    assert.equal(await js('document.querySelector(".network-proxy-form").getBoundingClientRect().right <= innerWidth'), true)
  }
  assert.deepEqual(errors, [])
  assert.ok(sent.filter(line => line.includes('!mp')).every(line => /:!mp (settings|listrefs)$/.test(line)))
  app.on('before-quit', () => {
    const state = handlers.get('irc:snapshot')({ sender: window.webContents, senderFrame: window.webContents.mainFrame })
    assert.equal(state.connection, 'offline')
    const saved = JSON.parse(fs.readFileSync(path.join(profile, 'preferences.json'), 'utf8'))
    assert.deepEqual(saved.preferences, {
      closeToBackground: false, language: 'en', restoreIrcLogin: false, autoRefreshOclr: false,
      chatFontSize: 24, chatFontFamily: 'monospace', chatTimestamp: 'minutes', chatSendShortcut: 'modifier-enter', foldBanchoQueries: false,
      notifyPlayersReady: true, notifyMatchFinished: false, notifyOnlyInBackground: true, networkProxy: savedProxy
    })
  })
  app.on('will-quit', () => {
    const report = { evidence: restart ? 'synthetic-settings-restart' : 'synthetic-settings-localization', passed: restart ? ['new application process restores locale, close behavior, chat display, notifications, send shortcut and proxy', 'close without background exits'] : ['HeroUI language selection for all four options', 'language changes without relogin or IRC commands', 'chat display settings and foreground/background notifications', 'send shortcut selection and query folding opt-out', 'proxy settings validation and save without IRC disconnect', 'chat, names, maps and draft remain literal', '900x640 settings, about and composer', 'no sidebar quit button', 'fixed About link allowlist', 'invalid IPC inputs and sender rejected', 'preferences survive renderer reload', 'close without background exits and cleans authentication'], limitation: 'Synthetic services and OS language. Physical tray/IME acceptance remains separate.' }
    fs.mkdirSync('artifacts', { recursive: true }); fs.writeFileSync(`artifacts/settings${restart ? '-restart' : ''}-smoke.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report))
  })
  window.close()
}
main().catch(async error => { console.error(error.stack); console.error({restart, errors}); app.exit(1) })
