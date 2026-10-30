// Isolated synthetic crypto/IRC; never reads the real profile or OS keychain.
const { app, BrowserWindow, safeStorage, dialog } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const assert = require('node:assert/strict')
app.disableHardwareAcceleration()
app.setPath('userData', process.env.OCLR_QA_TEMP)
safeStorage.isAsyncEncryptionAvailable = async () => true
safeStorage.encryptStringAsync = async value => Buffer.from(value)
safeStorage.decryptStringAsync = async value => ({ result: value.toString(), shouldReEncrypt: false })
let peer, exportResolve
const target = path.join(process.env.OCLR_QA_TEMP, 'export.json')
dialog.showSaveDialog = async () => new Promise(resolve => { exportResolve = resolve })
const server = net.createServer(socket => {
  peer = socket
  let pending = ''
  socket.on('data', chunk => {
    pending += chunk.toString()
    let end
    while ((end = pending.indexOf('\r\n')) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 2)
      if (line.startsWith('USER ')) socket.write(':server 001 Example :welcome\n')
      if (line === 'JOIN #test') socket.write(':Example!x JOIN :#test\n')
    }
  })
})
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn) { for (let i = 0; i < 100; i++) { if (await fn()) return; await delay(50) } throw new Error('journal condition timed out') }
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const connect = net.createConnection
  net.createConnection = options => { assert.equal(options.host, 'irc.ppy.sh'); return connect({ host: '127.0.0.1', port: server.address().port }) }
  require('../out/main/index.js')
  await app.whenReady()
  await until(() => BrowserWindow.getAllWindows().length)
  const window = BrowserWindow.getAllWindows()[0]
  await until(() => !window.webContents.isLoading())
  const js = code => window.webContents.executeJavaScript(code)
  await until(() => js('Boolean(window.oclr)'))
  await js('window.oclr.login({username:"Example",password:"SYNTHETIC"})')
  await until(() => js('(async () => (await window.oclr.snapshot()).connection === "online")()'))
  const available = process.platform !== 'linux'
  await until(() => js(`(async () => (await window.oclr.journal.status()).status === '${available ? 'saving' : 'memory_only'}')()`))
  await js('window.oclr.openConversation({kind:"channel",name:"#test"})')
  await until(() => js('(async () => (await window.oclr.snapshot()).room?.joined)()'))
  peer.write(':Player PRIVMSG #test :SYNTHETIC_PRIVATE_HISTORY\n:Player PRIVMSG #test :access_token=SYNTHETIC_SECRET\n')
  await until(() => js('(async () => (await window.oclr.snapshot()).messages.some(m => m.text.includes("SYNTHETIC_PRIVATE_HISTORY")))()'))
  if (available) {
    await until(() => js('(async () => (await window.oclr.journal.read("#test")).entries?.some(e => e.text.includes("SYNTHETIC_PRIVATE_HISTORY")))()'))
    const data = await js('window.oclr.journal.read("#test")')
    assert.equal(JSON.stringify(data).includes('SYNTHETIC_SECRET'), false)
    assert.equal(fs.readFileSync(path.join(process.env.OCLR_QA_TEMP, 'irc-journal.sqlite')).includes(Buffer.from('SYNTHETIC_PRIVATE_HISTORY')), false)
    await js('Array.from(document.querySelectorAll("nav button")).find(b => b.textContent.includes("本機日誌")).click()')
    await until(() => js('Boolean(document.querySelector(".journal-view"))'))
    await js('Array.from(document.querySelectorAll(".journal-view button")).find(b => b.textContent === "讀取歷史").click()')
    await until(() => js('document.querySelector(".journal-entries").textContent.includes("SYNTHETIC_PRIVATE_HISTORY")'))
    fs.writeFileSync(path.resolve('artifacts/journal-synthetic.png'), (await window.webContents.capturePage()).toPNG())
    assert.equal((await js('window.oclr.journal.read({account:"Other"})')).ok, false)
    const exported = js('window.oclr.journal.export("#test")')
    await until(() => Boolean(exportResolve)); exportResolve({ canceled: false, filePath: target })
    assert.equal((await exported).ok, true)
    assert.ok(JSON.parse(fs.readFileSync(target, 'utf8')).entries.every(e => e.room === '#test'))
    fs.unlinkSync(target); exportResolve = null
    const staleExport = js('window.oclr.journal.export("#test")')
    await until(() => Boolean(exportResolve))
    await js('window.oclr.logout()')
    exportResolve({ canceled: false, filePath: target })
    assert.equal((await staleExport).ok, false); assert.equal(fs.existsSync(target), false)
    await until(() => js('!document.body.textContent.includes("SYNTHETIC_PRIVATE_HISTORY")'))
  }
  await js('window.oclr.journal.setEnabled(false)')
  assert.equal((await js('window.oclr.journal.status()')).enabled, false)
  console.log(JSON.stringify({ evidence: 'synthetic-journal', available, passed: ['provider fail closed', 'persisted disable', ...(available ? ['encrypted payload', 'secret redaction', 'history UI', 'scope validation', 'native export scope', 'logout cancels export and clears UI'] : [])] }))
  app.quit(); server.close()
}
main().catch(error => { console.error(error); app.exit(1) })
