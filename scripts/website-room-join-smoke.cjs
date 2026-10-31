// Real Main/preload/renderer; only isolated synthetic IRC is used.
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const net = require('node:net')
const path = require('node:path')
const assert = require('node:assert/strict')
app.disableHardwareAcceleration()
app.setPath('userData', path.join(process.env.OCLR_QA_TEMP, 'website-room-join'))
require('./mock-system-locale.cjs')
const handlers = new Map(), sent = [], opened = []
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (name, fn) => { handlers.set(name, fn); handle(name, fn) }
shell.openExternal = async value => { opened.push(value) }
const url = id => `oclr-irc://join?room=${id}`
process.argv.push(url(900000001))
const server = net.createServer(socket => {
  let buffer = '', username = ''
  socket.on('data', bytes => {
    buffer += bytes.toString()
    let end
    while ((end = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 2)
      sent.push(line.startsWith('PASS ') ? 'PASS <synthetic-redacted>' : line)
      if (line.startsWith('NICK ')) username = line.slice(5)
      if (line.startsWith('USER ')) socket.write(`:server 001 ${username} :Welcome\r\n`)
      if (line.startsWith('JOIN #mp_')) socket.write(`:server 366 ${username} ${line.slice(5)} :End\r\n`)
      if (line.startsWith('PING :')) socket.write(`:server PONG server :${line.slice(6)}\r\n`)
      const channel = line.split(' ')[1], id = channel?.slice(4)
      if (line.endsWith(':!mp settings')) socket.write(`:BanchoBot PRIVMSG ${channel} :Room name: SYNTHETIC JOIN, History: https://osu.ppy.sh/mp/${id}\r\n:BanchoBot PRIVMSG ${channel} :Team mode: TeamVs, Win condition: ScoreV2\r\n:BanchoBot PRIVMSG ${channel} :Players: 0\r\n`)
      if (line.endsWith(':!mp listrefs')) socket.write(`:BanchoBot PRIVMSG ${channel} :Match referees:\r\n:BanchoBot PRIVMSG ${channel} :${username}\r\n`)
    }
  })
})
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn) { for (let i = 0; i < 150; i++) { if (await fn()) return; await delay(40) } throw Error('Room handoff timed out') }
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const connect = net.createConnection
  net.createConnection = options => { assert.equal(options.host, 'irc.ppy.sh'); return connect({host: '127.0.0.1', port: server.address().port}) }
  require('./mock-beatmap-fetch.cjs')
  require('../out/main/index.js')
  await app.whenReady()
  await until(() => BrowserWindow.getAllWindows()[0]?.webContents.getURL())
  const window = BrowserWindow.getAllWindows()[0], event = {preventDefault() {}}
  window.setSize(900, 640)
  const js = code => window.webContents.executeJavaScript(code)
  await until(() => js('!!window.oclr && !!document.querySelector("main")'))
  const request = () => js('window.oclr.websiteRoomJoin.snapshot()')
  assert.equal((await request()).status, 'pending')
  assert.equal(sent.length, 0)
  assert.throws(() => handlers.get('app:website-room-join')({sender: {}, senderFrame: {url: 'https://evil.invalid'}}), /Untrusted/)
  app.emit('open-url', event, url(900000001) + '&command=!mp%20start')
  assert.equal((await request()).roomId, 900000001)
  assert.equal((await js('window.oclr.login({username:"SyntheticRef",password:"SYNTHETIC_ONLY"})')).ok, true)
  await until(async () => (await request())?.status === 'joined')
  await until(() => js('!!document.querySelector(".nav-item.selected[title=房間記錄]")'))
  assert.equal((await js('window.oclr.snapshot()')).room.id, 900000001)
  app.emit('second-instance', {}, [url(900000002)])
  await until(async () => (await request())?.roomId === 900000002 && (await request())?.status === 'joined')
  app.emit('open-url', event, url(900000001))
  await until(async () => (await js('window.oclr.snapshot()')).room.id === 900000001)
  assert.equal(sent.filter(line => line === 'JOIN #mp_900000001').length, 1)
  assert.equal(sent.filter(line => line === 'JOIN #mp_900000002').length, 1)
  assert.ok(sent.filter(line => line.startsWith('PRIVMSG ')).every(line => / :!mp (settings|listrefs)$/.test(line)))
  assert.equal((await js('window.oclr.website.snapshot()')).status, 'disconnected')
  assert.deepEqual(opened, [])
  await js('window.oclr.logout()')
  assert.equal(await request(), null)
  app.emit('open-url', event, url(900000003))
  assert.equal((await request()).status, 'pending')
  await js('window.oclr.websiteRoomJoin.clear()')
  assert.equal((await js('window.oclr.login({username:"SyntheticRef",password:"SYNTHETIC_ONLY"})')).ok, true)
  await until(async () => (await js('window.oclr.snapshot()')).connection === 'online')
  assert.equal(sent.filter(line => line === 'JOIN #mp_900000003').length, 0)
  console.log(JSON.stringify({evidence: 'synthetic-website-room-join', passed: ['offline handoff waits for login', 'successful login joins and shows room', 'second-instance changes room', 'already joined selects without duplicate JOIN', 'URI injection and untrusted IPC rejected', 'logout/cancel prevents replay', 'no OAuth or game-changing commands'], limitation: 'Injected OS events and local IRC; real browser protocol prompts and Bancho are not exercised.'}))
  app.quit()
}
main().catch(error => { console.error(error); app.exit(1) })
