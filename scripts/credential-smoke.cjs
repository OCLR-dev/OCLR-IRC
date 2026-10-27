// Real Main/Preload with synthetic transport + crypto adapter. No OS keychain assertion.
const { app, BrowserWindow, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
app.setPath('userData', process.env.OCLR_QA_TEMP)
const file = path.join(process.env.OCLR_QA_TEMP, 'irc-credentials.enc')
let available = true, refuse = false, encryptionFails = false, holdDecrypt = false, releaseDecrypt
const key = crypto.randomBytes(32)
safeStorage.isAsyncEncryptionAvailable = async () => available
safeStorage.encryptStringAsync = async value => {
  if (encryptionFails) throw new Error('synthetic encryption failure')
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), bytes])
}
safeStorage.decryptStringAsync = async bytes => {
  if (holdDecrypt) await new Promise(resolve => { releaseDecrypt = resolve })
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
  decipher.setAuthTag(bytes.subarray(12, 28))
  return { result: Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(), shouldReEncrypt: false }
}
let logins = 0
const server = net.createServer(socket => {
  let pending = ''
  socket.on('data', chunk => {
    pending += chunk.toString()
    let end
    while ((end = pending.indexOf('\r\n')) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 2)
      if (line.startsWith('USER ')) { logins++; socket.write(refuse ? ':server 464 Example :rejected\n' : ':server 001 Example :welcome\n') }
    }
  })
})
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn) { for (let i = 0; i < 100; i++) { if (await fn()) return; await delay(20) } throw new Error('condition timed out') }
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const create = net.createConnection
  net.createConnection = options => {
    assert.equal(options.host, 'irc.ppy.sh')
    return create({ host: '127.0.0.1', port: server.address().port })
  }
  require('../out/main/index.js')
  await app.whenReady()
  await until(() => BrowserWindow.getAllWindows().length)
  const window = BrowserWindow.getAllWindows()[0]
  await until(() => !window.webContents.isLoading())
  const js = code => window.webContents.executeJavaScript(code)
  await until(() => js('Boolean(window.oclr)'))
  if (process.platform === 'linux') {
    assert.equal((await js('window.oclr.credentialStatus()')).available, false)
    assert.equal((await js('window.oclr.login({ username: "Example", password: "SYNTHETIC_ONLY", remember: true })')).ok, false)
    console.log('Linux fail-closed save verified; saved-login lifecycle skipped because provider remains disabled.')
    app.exit(0); return
  }
  const login = () => js('window.oclr.login({username:"Example", password:"SYNTHETIC_ONLY", remember:true})')
  const online = () => until(() => js('(async () => (await window.oclr.snapshot()).connection === "online")()'))
  assert.equal((await login()).ok, true); await online()
  await until(() => js('(async () => (await window.oclr.credentialStatus()).saved)()'))
  assert.ok(!fs.readFileSync(file).includes('SYNTHETIC_ONLY'))
  assert.ok(!JSON.stringify(await js('window.oclr.snapshot()')).includes('SYNTHETIC_ONLY'))
  await js('window.oclr.logout()')
  assert.equal((await js('window.oclr.loginSaved()')).ok, true); await online()
  await js('window.oclr.logout()')
  holdDecrypt = true
  await js('window.savedLoginResult = window.oclr.loginSaved(); true')
  await until(() => Boolean(releaseDecrypt))
  await js('window.oclr.logout()')
  const before = logins
  releaseDecrypt(); holdDecrypt = false
  assert.equal((await js('window.savedLoginResult')).ok, false)
  await delay(50); assert.equal(logins, before)
  assert.equal((await js('window.oclr.forgetCredentials()')).ok, true)
  assert.equal(fs.existsSync(file), false)
  refuse = true
  assert.equal((await login()).ok, true)
  await until(() => js('(async () => (await window.oclr.snapshot()).connection === "error")()'))
  assert.equal((await js('window.oclr.credentialStatus()')).saved, false)
  refuse = false; available = false
  assert.equal((await login()).ok, false)
  available = true; encryptionFails = true
  assert.equal((await login()).ok, true); await online()
  await until(() => js('(async () => Boolean((await window.oclr.snapshot()).credentialError))()'))
  assert.equal(fs.existsSync(file), false)
  encryptionFails = false
  await js('window.oclr.logout()'); assert.equal((await login()).ok, true); await online()
  await until(() => fs.existsSync(file))
  await js('window.oclr.logout()'); fs.writeFileSync(file, 'corrupt')
  assert.equal((await js('window.oclr.loginSaved()')).ok, false)
  await js('window.oclr.forgetCredentials()')
  assert.equal(fs.existsSync(file), false)
  const report = { evidence: 'synthetic-desktop-credential-lifecycle', platform: process.platform, arch: process.arch, recordedAt: new Date().toISOString(),
    passed: ['save only after own 001', 'no plaintext credential file or snapshot', 'saved login stays inside Main', 'logout cancels delayed saved login', 'forget removes encrypted file', 'bad password never saved', 'unavailable backend blocks save', 'failed save visible without disconnect', 'corrupt ciphertext has generic failure'],
    limitation: 'Injected synthetic crypto and local IRC; not an OS keychain/provider, upgrade, cross-platform or real-account verification.' }
  fs.mkdirSync('artifacts', { recursive: true })
  fs.writeFileSync('artifacts/credential-smoke.json', JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report)); app.exit(0)
}
main().catch(error => { console.error(error.stack); app.exit(1) })
