// Desktop UI integration QA. Transport is replaced in this process only, before
// loading the built Main. No production environment flag or renderer host override.
const { app, BrowserWindow, shell, powerMonitor } = require('electron')
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
// Hosted Linux has a virtual display, not a hardware GPU. Keep renderer sandbox enabled.
if (process.env.CI && process.platform === 'linux') app.disableHardwareAcceleration()
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
      if (line.startsWith('PART ')) socket.write(`:${username}!u@h PART ${line.slice(5)} :leaving\n`)
      if (line.startsWith('PING :')) socket.write(':server PONG server :' + line.slice(6) + '\n')
      if (line.startsWith('NICK ')) username = line.slice(5)
      if (line.startsWith('USER ')) socket.write(`:server 001 ${username} :Welcome\r\n`)
      if (/^JOIN (?:#mp_90000000[123]|#osu)$/.test(line)) socket.write(`:server 366 ${username} ${line.slice(5)} :End\r\n`)
      if (line.startsWith('PRIVMSG BanchoBot :!mp make ')) socket.write(`:BanchoBot PRIVMSG ${username} :Created the tournament match https://osu.ppy.sh/mp/900000003 ${line.slice('PRIVMSG BanchoBot :!mp make '.length)}\n`)
      const channel = line.split(' ')[1]
      const id = channel?.replace('#mp_', '')
      if (line.endsWith(':!mp settings')) socket.write(`:BanchoBot PRIVMSG ${channel} :Room name: SYNTHETIC QA ROOM, History: https://osu.ppy.sh/mp/${id}\n:BanchoBot PRIVMSG ${channel} :Beatmap: https://osu.ppy.sh/b/123 Synthetic Artist - Map\n:BanchoBot PRIVMSG ${channel} :Team mode: TeamVs, Win condition: ScoreV2\n:BanchoBot PRIVMSG ${channel} :Active mods: None\n:BanchoBot PRIVMSG ${channel} :Players: 2\n:BanchoBot PRIVMSG ${channel} :Slot 1 Ready https://osu.ppy.sh/u/101 Synthetic Red [Host / Team Red]\n:BanchoBot PRIVMSG ${channel} :Slot 4 Not Ready https://osu.ppy.sh/u/102 Synthetic Blue [Team Blue]\n`)
      if (line.endsWith(':!mp listrefs')) socket.write(`:BanchoBot PRIVMSG ${channel} :Match referees:\n:BanchoBot PRIVMSG ${channel} :${username}\n`)
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
  const js = code => window.webContents.executeJavaScript(code).catch(error => { throw new Error(`Synthetic UI evaluation failed: ${code.slice(0, 200)}; ${error.message}; console: ${errors.join(' | ')}`) })
  await until(() => js('Boolean(document.querySelector("input[name=username]"))'))
  assert.equal(await js('typeof window.oclr.login'), 'function')
  assert.equal(await js('typeof window.require'), 'undefined')
  assert.equal(window.webContents.getLastWebPreferences().sandbox, true)
  assert.equal((await js('window.oclr.login({username:"SyntheticRef",password:"SYNTHETIC_PASSWORD_ONLY"})')).ok, true)
  await until(() => js('Boolean(document.querySelector(".join-form"))'))
  assert.equal((await js('window.oclr.join("900000001")')).ok, true)
  await until(() => js('(async () => (await window.oclr.snapshot()).room?.joined)()'))
  await js('document.querySelector(".mp-controls").open = true')
  assert.equal(await js('document.querySelector(".mp-controls button").disabled'), true)
  async function refresh() {
    for (const kind of ['settings', 'listrefs']) {
      await delay(1100)
      assert.equal((await js(`(async () => { const s = await window.oclr.snapshot(); return window.oclr.query({roomId:s.room.id,roomEpoch:s.room.epoch,kind:${JSON.stringify(kind)}}) })()`)).ok, true)
      await until(() => js('(async () => !(await window.oclr.snapshot()).pending)()'))
    }
    await delay(1100)
  }
  async function button(text) {
    await js(`Array.from(document.querySelectorAll('.mp-controls button')).find(b => b.textContent === ${JSON.stringify(text)}).click()`)
  }
  async function choose(kind) {
    await js(`(() => {const e=document.querySelector('select[aria-label="房內操作"]'); e.value=${JSON.stringify(kind)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  }
  for (const [kind, command] of [['map','!mp map 456'],['mods','!mp mods HD HR'],['start','!mp start'],['abort','!mp abort']]) {
    await refresh()
    await choose(kind)
    if (kind === 'map') await js(`(() => {const e=document.querySelector('input[name=beatmapId]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'456');e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    if (kind === 'mods') await js(`Array.from(document.querySelectorAll('.mp-mods label')).filter(e => ['HD','HR'].includes(e.textContent)).forEach(e => e.querySelector('input').click())`)
    await button('預覽指令')
    await until(() => js('Boolean(document.querySelector(".mp-confirm"))'))
    assert.equal(await js('document.querySelector(".mp-confirm code").textContent'), command)
    assert.equal(await js('document.querySelector(".mp-confirm button").disabled'), true)
    assert.ok(!sent.some(line => line === 'PRIVMSG #mp_900000001 :' + command))
    if (kind === 'start') {
      window.setSize(900, 640); await delay(200)
      await js('document.querySelector(".mp-confirm").scrollIntoView({block:"nearest"})')
      assert.equal(await js('document.querySelector(".composer").getBoundingClientRect().bottom <= innerHeight'), true)
      fs.writeFileSync(path.join(output,'mp-confirm-synthetic.png'), (await window.webContents.capturePage()).toPNG())
    }
    await js('document.querySelector(".mp-confirm input").click()')
    await button('確認送出')
    await until(() => sent.includes('PRIVMSG #mp_900000001 :' + command))
    await until(() => js('!document.querySelector(".mp-confirm")'))
    assert.equal(sent.filter(line => line === 'PRIVMSG #mp_900000001 :' + command).length, 1)
    await until(() => js('Array.from(document.querySelectorAll(".mp-controls button")).find(b => b.textContent === "預覽指令")?.disabled'))
    assert.equal((await js('window.oclr.snapshot()')).room.referee, 'unknown')
  }
  await refresh(); await button('預覽指令')
  await until(() => js('Boolean(document.querySelector(".mp-confirm"))'))
  const beforeCancel = sent.length
  await button('取消'); await delay(100)
  assert.equal(sent.length, beforeCancel)
  assert.equal((await js('window.oclr.executeMp({roomId:900000001,roomEpoch:0,token:"forged",reviewed:true})')).ok,false)
  assert.ok(!sent.some(line => /!mp (close|password)/.test(line)))
  assert.deepEqual(errors, [])
  const report = { evidence: 'synthetic-manual-mp-ui', platform: process.platform, arch: process.arch, recordedAt: new Date().toISOString(), passed: ['disabled before room/permission sync', 'four commands preview exact target and wire text', 'explicit confirmation checkbox', 'single send and stale permission after execution', '900x640 composer remains visible', 'cancel sends nothing', 'forged IPC rejected', 'no close/password commands or renderer errors'], sent, limitation: 'Local synthetic IRC only; no real Bancho mutation or server acknowledgement validation.' }
  fs.writeFileSync(path.join(output,'mp-smoke.json'), JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report,null,2)); app.exit(0)
}
main().catch(error => { console.error(error.stack); app.exit(1) })
