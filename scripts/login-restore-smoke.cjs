// Cold-start restoration with a shared synthetic profile and a test-only crypto key.
const { app, BrowserWindow, safeStorage } = require('electron')
const fs = require('node:fs'), path = require('node:path'), net = require('node:net'), crypto = require('node:crypto')
const assert = require('node:assert/strict')
app.disableHardwareAcceleration()
const phase = process.argv[2], profile = path.join(process.env.OCLR_QA_TEMP, 'login-restore')
fs.mkdirSync(profile, { recursive: true }); app.setPath('userData', profile)
require('./mock-system-locale.cjs')
const file = path.join(profile, 'irc-credentials.enc'), prefs = path.join(profile, 'preferences.json')
const key = crypto.createHash('sha256').update('OCLR_SYNTHETIC_RESTORE_TEST_ONLY').digest()
function encrypt(text) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const bytes = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), bytes])
}
let releaseDecrypt, decryptStarted = false
const held = ['cancel', 'disable', 'forget', 'manual'].includes(phase)
safeStorage.isAsyncEncryptionAvailable = async () => phase !== 'unavailable'
safeStorage.encryptStringAsync = async text => encrypt(text)
safeStorage.decryptStringAsync = async bytes => {
  decryptStarted = true
  if (held && !releaseDecrypt) await new Promise(resolve => { releaseDecrypt = resolve })
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
  decipher.setAuthTag(bytes.subarray(12, 28))
  return { result: Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(), shouldReEncrypt: false }
}
if (phase === 'enable-pending') {
  fs.writeFileSync(prefs, JSON.stringify({schema:2,preferences:{closeToBackground:true,language:'zh-Hant',restoreIrcLogin:false},ircLoginActive:false}))
  fs.rmSync(file, {force:true})
} else if (!['seed', 'restore', 'logged-out'].includes(phase)) {
  fs.writeFileSync(prefs, JSON.stringify({ schema: 2, preferences: { closeToBackground: true, language: 'zh-Hant', restoreIrcLogin: true }, ircLoginActive: true }))
  fs.writeFileSync(file, phase === 'corrupt' ? 'corrupt synthetic ciphertext' : encrypt(JSON.stringify({ username: 'SyntheticRef', password: 'SYNTHETIC_RESTORE_ONLY' })))
}
const sent = [], errors = []
let logins = 0, nick = '', releaseWelcome
const server = net.createServer(socket => {
  let pending = ''
  socket.on('data', chunk => {
    pending += chunk.toString()
    let end
    while ((end = pending.indexOf('\r\n')) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 2)
      sent.push(line.startsWith('PASS ') ? 'PASS <synthetic-redacted>' : line)
      if (line.startsWith('NICK ')) nick = line.slice(5)
      if (line.startsWith('USER ')) {
        logins++
        const reply = () => socket.write(phase === 'bad-password' ? `:server 464 ${nick} :Rejected\n` : `:server 001 ${nick} :Welcome\n`)
        if (phase === 'enable-pending') releaseWelcome = reply
        else reply()
      }
    }
  })
})
app.on('web-contents-created', (_event, contents) => contents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) }))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn) { for (let i = 0; i < 100; i++) { if (await fn()) return; await delay(50) } throw Error(`Restore ${phase} condition timed out`) }
const eligible = () => JSON.parse(fs.readFileSync(prefs, 'utf8')).ircLoginActive
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const connect = net.createConnection
  net.createConnection = options => { assert.equal(options.host, 'irc.ppy.sh'); return connect({ host: '127.0.0.1', port: server.address().port }) }
  require('./mock-avatar-fetch.cjs')
  require('../out/main/index.js')
  await app.whenReady(); await until(() => BrowserWindow.getAllWindows().length)
  const window = BrowserWindow.getAllWindows()[0]
  window.webContents.setBackgroundThrottling(false)
  await until(() => !window.webContents.isLoading())
  const js = code => window.webContents.executeJavaScript(code)
  await until(() => js('Boolean(window.oclr)'))
  const state = () => js('window.oclr.snapshot()')
  const online = () => until(async () => (await state()).connection === 'online')
  const setRestore = value => js(`(async () => window.oclr.settings.update({...((await window.oclr.settings.snapshot()).preferences),restoreIrcLogin:${value}}))()`)
  const login = () => js('window.oclr.login({username:"SyntheticRef",password:"SYNTHETIC_RESTORE_ONLY"})')
  if (phase === 'seed') {
    assert.equal(logins, 0)
    await js('document.querySelector(".sidebar-settings button").click()')
    await until(() => js('Boolean(document.querySelector("input[name=restoreIrcLogin]"))'))
    assert.equal(await js('document.querySelector("input[name=restoreIrcLogin]").checked'), false)
    if (process.platform === 'linux') {
      assert.equal(await js('document.querySelector("input[name=restoreIrcLogin]").disabled'), true)
      assert.equal((await setRestore(true)).ok, false)
    } else {
      assert.equal((await login()).ok, true); await online()
      assert.equal(fs.existsSync(file), false)
      await until(() => js('!document.querySelector("input[name=restoreIrcLogin]").disabled'))
      window.setSize(900, 640)
      await js('document.querySelector("input[name=restoreIrcLogin]").click()')
      await until(() => fs.existsSync(prefs) && eligible())
      await until(() => js('document.querySelector("input[name=restoreIrcLogin]").checked && !document.querySelector("input[name=restoreIrcLogin]").disabled'))
      assert.equal(JSON.parse(fs.readFileSync(prefs, 'utf8')).preferences.restoreIrcLogin, true)
      assert.equal(await js('document.querySelector("input[name=restoreIrcLogin]").getBoundingClientRect().bottom < innerHeight'), true)
      fs.mkdirSync('artifacts', { recursive: true })
      fs.writeFileSync('artifacts/restore-irc-settings-synthetic.png', (await window.webContents.capturePage()).toPNG())
    }
  } else if (phase === 'enable-pending') {
    assert.equal((await login()).ok, true)
    await until(() => Boolean(releaseWelcome))
    assert.equal((await setRestore(true)).ok, true)
    assert.equal(fs.existsSync(file), false)
    releaseWelcome(); await online(); await until(() => eligible())
    assert.equal(logins, 1)
  } else if (phase === 'restore') {
    await online(); assert.equal(logins, 1); assert.equal((await state()).username, 'SyntheticRef')
    assert.deepEqual((await state()).rooms, [])
    assert.equal((await js('window.oclr.website.snapshot()')).status, 'disconnected')
    window.webContents.reload(); await until(() => !window.webContents.isLoading())
    await until(() => js('Boolean(window.oclr)')); await online(); assert.equal(logins, 1)
    await js('window.oclr.logout()'); assert.equal(eligible(), false)
  } else if (phase === 'logged-out') {
    await js('window.oclr.credentialStatus()'); assert.equal(logins, 0)
    assert.equal((await state()).connection, 'offline'); assert.equal(eligible(), false)
  } else if (held) {
    await until(() => Boolean(releaseDecrypt))
    let pending
    if (phase === 'cancel') await js('window.oclr.logout()')
    if (phase === 'disable') assert.equal((await setRestore(false)).ok, true)
    if (phase === 'forget') { await js('window.restorePending = window.oclr.forgetCredentials(); true'); pending = 'window.restorePending' }
    if (phase === 'manual') { await js('window.restorePending = window.oclr.login({username:"NewSynthetic",password:"NEW_SYNTHETIC_ONLY"}); true'); pending = 'window.restorePending' }
    releaseDecrypt()
    if (pending) assert.equal((await js(pending)).ok, true)
    await js('window.oclr.credentialStatus()')
    if (phase === 'manual') { await online(); assert.equal((await state()).username, 'NewSynthetic'); assert.equal(logins, 1); await until(() => eligible()) }
    else { assert.equal(logins, 0); assert.equal((await state()).connection, 'offline'); assert.equal(eligible(), false) }
    if (phase === 'forget') assert.equal(fs.existsSync(file), false)
  } else if (phase === 'bad-password') {
    await until(async () => (await state()).connection === 'error')
    assert.equal(logins, 1); assert.equal(eligible(), false)
    window.webContents.reload(); await until(() => !window.webContents.isLoading())
    await until(() => js('Boolean(window.oclr)')); await state(); assert.equal(logins, 1)
  } else if (phase === 'corrupt' || phase === 'unavailable') {
    await until(async () => Boolean((await state()).credentialError))
    assert.equal(logins, 0); assert.equal(eligible(), false)
    if (phase === 'unavailable') {
      assert.equal(decryptStarted, false); assert.equal((await login()).ok, true); await online(); assert.equal(eligible(), false)
      await js('document.querySelector(".sidebar-settings button").click()')
      await until(() => js('Boolean(document.querySelector("input[name=restoreIrcLogin]"))'))
      assert.equal(await js('document.querySelector("input[name=restoreIrcLogin]").disabled'), false)
      await js('document.querySelector("input[name=restoreIrcLogin]").click()')
      await until(() => js('(async () => !(await window.oclr.settings.snapshot()).preferences.restoreIrcLogin)()'))
    }
  }
  assert.ok(!sent.some(line => /^(JOIN |PRIVMSG )/.test(line)))
  assert.equal(await js('typeof window.oclr.authenticatedCredentials'), 'undefined')
  assert.ok(!JSON.stringify(await state()).includes('SYNTHETIC_RESTORE_ONLY'))
  if (fs.existsSync(file)) assert.ok(!fs.readFileSync(file).includes('SYNTHETIC_RESTORE_ONLY'))
  if (fs.existsSync(prefs)) assert.ok(!fs.readFileSync(prefs).includes('SyntheticRef'))
  assert.deepEqual(errors, [])
  app.on('will-quit', () => {
    if (phase === 'seed' && process.platform !== 'linux') assert.equal(eligible(), true)
    console.log(JSON.stringify({ evidence: 'synthetic-irc-login-restore', phase, platform: process.platform, logins, noRoomCommands: true, limitation: 'Synthetic transport and crypto; physical secure-storage provider acceptance remains separate.' }))
  })
  app.quit()
}
main().catch(error => { console.error(error.stack); app.exit(1) })
