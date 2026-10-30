// Desktop UI integration QA. Transport is replaced in this process only, before
// loading the built Main. No production environment flag or renderer host override.
const { app, BrowserWindow, shell, powerMonitor } = require('electron')
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
// Synthetic capture must also work with an occluded window / virtual display.
// Keep the renderer sandbox enabled; avoid platform GPU capture failures.
app.disableHardwareAcceleration()
app.setPath('userData', process.env.OCLR_QA_TEMP)
const output = path.resolve('artifacts')
fs.mkdirSync(output, { recursive: true })
const sent = []
let username = ''
let playing = false
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
      if (line.endsWith(':!mp settings')) socket.write(`:BanchoBot PRIVMSG ${channel} :Room name: SYNTHETIC QA ROOM, History: https://osu.ppy.sh/mp/${id}\n:BanchoBot PRIVMSG ${channel} :Beatmap: https://osu.ppy.sh/b/123 Synthetic Artist - Map\n:BanchoBot PRIVMSG ${channel} :Team mode: TeamVs, Win condition: ScoreV2\n:BanchoBot PRIVMSG ${channel} :Active mods: None\n:BanchoBot PRIVMSG ${channel} :Players: 2\n:BanchoBot PRIVMSG ${channel} :Slot 1 ${playing ? 'Playing' : 'Ready'} https://osu.ppy.sh/u/101 Synthetic Red [Host / Team Red]\n:BanchoBot PRIVMSG ${channel} :Slot 4 Not Ready https://osu.ppy.sh/u/102 Synthetic Blue [Team Blue]\n`)
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
  require('./mock-beatmap-fetch.cjs')
  require('../out/main/index.js')
  await app.whenReady()
  await until(() => BrowserWindow.getAllWindows().length > 0)
  const window = BrowserWindow.getAllWindows()[0]
  // Keep virtualized UI measurement active when the test window is occluded.
  window.webContents.setBackgroundThrottling(false)
  async function capture() {
    // Native compositor can briefly invalidate a frame during resize/show.
    for (let attempt = 0; ; attempt++) {
      try { return await window.webContents.capturePage() }
      catch (error) {
        if (attempt >= 2 || !String(error).includes('UnknownVizError')) throw error
        window.show(); await delay(200)
      }
    }
  }
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
  await until(() => js('Boolean(document.querySelector(".mp-controls button"))'))
  await js('document.querySelector(".mp-controls").open = true')
  assert.equal(await js('Array.from(document.querySelectorAll(".mp-controls button")).find(b => b.textContent === "預覽指令").disabled'), true)
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
    await js(`document.querySelector('button[aria-label="房內操作"]').click()`)
    await until(() => js('Boolean(document.querySelector("[role=option]"))'))
    const labels = { map: '換圖', mods: '設定 Mods', start: '開始比賽', timer: '一般計時', aborttimer: '取消倒數', abort: '中止比賽' }
    await js(`Array.from(document.querySelectorAll('[role=option]')).find(e => e.textContent === ${JSON.stringify(labels[kind])}).click()`)
  }
  for (const [kind, command] of [['map','!mp map 456'],['mods','!mp mods HD HR'],['start','!mp start'],['abort','!mp abort'],['timer','!mp timer 30'],['aborttimer','!mp aborttimer'],['start','!mp start 30']]) {
    await refresh()
    await choose(kind)
    if (kind === 'map') await js(`(() => {const e=document.querySelector('input[name=beatmapId]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'456');e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    if (command === '!mp start 30') await js('document.querySelector(".mp-controls fieldset input[type=checkbox]").click()')
    if (kind === 'mods') await js(`Array.from(document.querySelectorAll('.mp-mods label')).filter(e => ['HD','HR'].includes(e.textContent)).forEach(e => e.querySelector('input').click())`)
    await button('預覽指令')
    await until(() => js('Boolean(document.querySelector(".mp-confirm"))'))
    assert.equal(await js('document.querySelector(".mp-confirm code").textContent'), command)
    assert.equal(await js('Array.from(document.querySelectorAll(".mp-confirm button")).find(b => b.textContent === "確認送出").disabled'), true)
    assert.ok(!sent.some(line => line === 'PRIVMSG #mp_900000001 :' + command))
    if (kind === 'start') {
      window.setSize(900, 640); await delay(200)
      await js('document.querySelector(".mp-confirm").scrollIntoView({block:"nearest"})')
      assert.equal(await js('document.querySelector(".composer").getBoundingClientRect().bottom <= innerHeight'), true)
      fs.writeFileSync(path.join(output,'mp-confirm-synthetic.png'), (await capture()).toPNG())
    }
    await js('document.querySelector(".mp-confirm input[type=checkbox]").click()')
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
  peer.write(':BanchoBot PRIVMSG #mp_900000001 :Countdown ends in 1 second\n:BanchoBot PRIVMSG #mp_900000001 :Match starts in 1 second\n')
  await until(() => js('document.querySelector(".match-status").textContent.includes("一般計時") && document.querySelector(".match-status").textContent.includes("開賽倒數")'))
  await until(() => js('document.querySelector(".match-status").textContent.includes("等待伺服器確認")'))
  assert.equal((await js('window.oclr.snapshot()')).room.phase, 'unknown')
  assert.equal(await js('document.querySelector(".composer").getBoundingClientRect().bottom <= innerHeight'), true)
  assert.equal(await js('Array.from(document.querySelectorAll(".countdown-status span")).every(e => e.getBoundingClientRect().right <= document.querySelector(".match-status").getBoundingClientRect().right)'), true)
  fs.writeFileSync(path.join(output, 'countdown-synthetic.png'), (await capture()).toPNG())
  peer.write(':BanchoBot PRIVMSG #mp_900000001 :Countdown aborted\n:BanchoBot PRIVMSG #mp_900000001 :Aborted the match start timer\n')
  await until(() => js('(async () => (await window.oclr.snapshot()).room.startCountdown?.status === "cancelled")()'))
  const readsBeforeStart = sent.filter(line => line.endsWith(':!mp settings')).length
  playing = true
  peer.write(':BanchoBot PRIVMSG #mp_900000001 :The match has started!\n')
  await until(() => sent.filter(line => line.endsWith(':!mp settings')).length > readsBeforeStart)
  await until(() => js('document.querySelector(".match-status").textContent.includes("In progress") && document.querySelector(".slot-status").textContent.includes("Playing")'))
  assert.ok(await js('document.querySelector(".match-status").textContent.includes("Synthetic Artist - Map")'))
  assert.ok(await js('document.querySelector(".match-status").textContent.includes("NoMod")'))
  await until(() => js('document.querySelector(".match-status").textContent.includes("剩餘約")'))
  assert.equal(await js('document.querySelector(".composer").getBoundingClientRect().bottom <= innerHeight'), true)
  fs.writeFileSync(path.join(output, 'match-status-synthetic.png'), (await capture()).toPNG())
  playing = false
  peer.write(':BanchoBot PRIVMSG #mp_900000001 :Aborted the match\n')
  await until(() => js('document.querySelector(".match-status").textContent.includes("比賽未進行")'))
  assert.deepEqual(errors, [])
  const report = { evidence: 'synthetic-manual-mp-ui', platform: process.platform, arch: process.arch, recordedAt: new Date().toISOString(), passed: ['disabled before room/permission sync', 'map/mods/start/abort/timer/aborttimer and delayed start preview exact target and wire text', 'separate countdowns expire to waiting, not playing', 'explicit confirmation checkbox', 'single send and stale permission after execution', '900x640 composer remains visible', 'cancel sends nothing', 'forged IPC rejected', 'no close/password commands or renderer errors'], sent, limitation: 'Local synthetic IRC only; no real Bancho mutation or server acknowledgement validation.' }
  fs.writeFileSync(path.join(output,'mp-smoke.json'), JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report,null,2)); app.exit(0)
}
main().catch(error => { console.error(error.stack); app.exit(1) })
