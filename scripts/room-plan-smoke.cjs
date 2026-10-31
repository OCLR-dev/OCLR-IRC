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
let playing = false, individualSlots = false
let roomName = 'SYNTHETIC QA ROOM', teamMode = 'HeadToHead', playerSlot = 1, playerTeam = 'Red'
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
      if (line.includes(':!mp name ')) roomName = line.split(':!mp name ')[1]
      if (line.includes(':!mp set ')) teamMode = 'TeamVs'
      if (/:!mp move #101 (\d+)$/.test(line)) playerSlot = Number(/:!mp move #101 (\d+)$/.exec(line)[1])
      if (line.includes(':!mp team #101 blue')) playerTeam = 'Blue'
      const channel = line.split(' ')[1]
      const id = channel?.replace('#mp_', '')
      if (line.endsWith(':!mp settings')) socket.write(`:BanchoBot PRIVMSG ${channel} :Room name: ${roomName}, History: https://osu.ppy.sh/mp/${id}\n:BanchoBot PRIVMSG ${channel} :Beatmap: https://osu.ppy.sh/b/123 Synthetic Artist - Map\n:BanchoBot PRIVMSG ${channel} :Team mode: ${teamMode}, Win condition: ScoreV2\n:BanchoBot PRIVMSG ${channel} :Active mods: None\n:BanchoBot PRIVMSG ${channel} :Players: 2\n:BanchoBot PRIVMSG ${channel} :Slot ${playerSlot} ${playing ? 'Playing' : 'Ready'} https://osu.ppy.sh/u/101 Synthetic Red [${teamMode === 'HeadToHead' && individualSlots ? 'Host' : `Host / Team ${playerTeam}` }]\n:BanchoBot PRIVMSG ${channel} :Slot 4 Not Ready https://osu.ppy.sh/u/102 Synthetic Blue${teamMode === 'HeadToHead' && individualSlots ? '' : ' [Team Blue]'}\n`)
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
async function until(fn, attempts = 60) {
  for (let i = 0; i < attempts; i++) { if (await fn()) return; await delay(100) }
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
  await until(() => js('Boolean(document.querySelector(".join-room-button"))'))
  assert.equal((await js('window.oclr.join("900000001")')).ok, true)
  await until(() => js('(async () => (await window.oclr.snapshot()).room?.joined)()'))
  await until(() => js('Boolean(document.querySelector(".mp-controls button"))'))
  await js('document.querySelector(".mp-controls").open = true')
  assert.equal(await js('Array.from(document.querySelectorAll(".mp-controls button")).find(b => b.textContent === "預覽指令").disabled'), true)
  async function refresh() {
    for (const kind of ['settings', 'listrefs']) {
      await delay(1100)
      await until(async () => (await js(`(async () => { const s = await window.oclr.snapshot(); return window.oclr.query({roomId:s.room.id,roomEpoch:s.room.epoch,kind:${JSON.stringify(kind)}}) })()`)).ok)
      await until(() => js('(async () => !(await window.oclr.snapshot()).pending)()'))
    }
    await delay(1100)
  }
  async function button(text) {
    await js(`Array.from(document.querySelectorAll('.mp-controls button')).find(b => b.textContent === ${JSON.stringify(text)}).click()`)
  }
  async function fill(name,value) { await js(`(() => {const e=document.querySelector('input[name=${name}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`) }
  async function choose(label,value) { await js(`document.querySelector('button[aria-label="${label}"]').click()`); await until(()=>js('Boolean(document.querySelector("[role=option]"))')); await js(`Array.from(document.querySelectorAll('[role=option]')).find(e=>e.textContent===${JSON.stringify(value)}).click()`) }
  await refresh()
  await js('document.querySelector(".room-initialization").open = true')
  await fill('planRoomName','SYNTHETIC initialized')
  await button('預覽房名與規則計畫')
  await until(()=>js('Boolean(document.querySelector(".room-plan-confirm"))'))
  assert.equal(await js('Array.from(document.querySelectorAll(".room-plan-confirm button")).find(b=>b.textContent==="執行逐步計畫").disabled'),true)
  await js('document.querySelector(".room-plan-confirm input[type=checkbox]").click()')
  await button('執行逐步計畫')
  await until(()=>js('(async()=>(await window.oclr.snapshot()).roomPlan?.state === "observed")()'),150)
  assert.deepEqual(sent.filter(line=>/:!mp (name|set) /.test(line)),['PRIVMSG #mp_900000001 :!mp name SYNTHETIC initialized','PRIVMSG #mp_900000001 :!mp set 2 3'])
  await js('document.querySelector(".room-initialization").open = false; document.querySelector(".manual-lineup").open = true')
  await fill('lineupUid','101');await fill('lineupName','Synthetic Red')
  await js('Array.from(document.querySelectorAll(".manual-lineup button")).find(b=>b.textContent==="加入手動名單").click()')
  await until(()=>js('Boolean(document.querySelector(".lineup-entry"))'))
  await js('document.querySelector(".lineup-entry input[type=checkbox]").click()')
  await choose('Synthetic Red 隊伍','藍隊');await choose('Synthetic Red 槽位','2')
  await js('Array.from(document.querySelectorAll(".manual-lineup button")).find(b=>b.textContent==="預覽陣容計畫").click()')
  await until(()=>js('Boolean(document.querySelector(".manual-lineup .room-plan-confirm"))'))
  await js('document.querySelectorAll(".manual-lineup .room-plan-confirm input[type=checkbox]").forEach(e=>e.click())')
  assert.equal(await js('Array.from(document.querySelectorAll(".manual-lineup .room-plan-confirm button")).find(b=>b.textContent==="執行逐步計畫").disabled'),true)
  await js(`(() => {const e=document.querySelector('.manual-lineup .room-plan-confirm input:not([type=checkbox])');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Synthetic Red');e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await until(()=>js('Array.from(document.querySelectorAll(".manual-lineup .room-plan-confirm button")).find(b=>b.textContent==="執行逐步計畫").disabled === false'))
  await js('Array.from(document.querySelectorAll(".manual-lineup .room-plan-confirm button")).find(b=>b.textContent==="執行逐步計畫").click()')
  await until(()=>js('(async()=>(await window.oclr.snapshot()).roomPlan?.steps[0].command === "!mp move #101 2" && (await window.oclr.snapshot()).roomPlan.state === "observed")()'),150)
  assert.deepEqual(sent.filter(line=>/:!mp (move|team) /.test(line)),['PRIVMSG #mp_900000001 :!mp move #101 2','PRIVMSG #mp_900000001 :!mp team #101 blue'])
  // Switching to a known individual mode removes team choices and sends only move.
  teamMode = 'HeadToHead'; individualSlots = true
  await refresh()
  await until(()=>js(`!document.querySelector('.manual-lineup button[aria-label="Synthetic Red 隊伍"]')`))
  await choose('Synthetic Red 槽位','3')
  await js('Array.from(document.querySelectorAll(".manual-lineup button")).find(b=>b.textContent==="預覽陣容計畫").click()')
  await until(()=>js('Boolean(document.querySelector(".manual-lineup .room-plan-confirm"))'))
  assert.equal(await js('document.querySelector(".manual-lineup .room-plan-confirm").textContent.includes("!mp team")'), false)
  await js('document.querySelectorAll(".manual-lineup .room-plan-confirm input[type=checkbox]").forEach(e=>e.click())')
  await js(`(() => {const e=document.querySelector('.manual-lineup .room-plan-confirm input:not([type=checkbox])');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Synthetic Red');e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await until(()=>js('Array.from(document.querySelectorAll(".manual-lineup .room-plan-confirm button")).find(b=>b.textContent==="執行逐步計畫").disabled === false'))
  await js('Array.from(document.querySelectorAll(".manual-lineup .room-plan-confirm button")).find(b=>b.textContent==="執行逐步計畫").click()')
  await until(()=>js('(async()=>(await window.oclr.snapshot()).roomPlan?.steps[0].command === "!mp move #101 3" && (await window.oclr.snapshot()).roomPlan.state === "observed")()'),150)
  assert.equal(sent.filter(line=>line.includes(':!mp team ')).length, 1)
  assert.equal(sent.filter(line=>line.includes(':!mp move #101 3')).length, 1)
  window.setContentSize(900,640);await delay(200)
  assert.equal(await js('document.querySelector(".composer").getBoundingClientRect().bottom <= innerHeight'),true)
  fs.writeFileSync(path.join(output,'room-plan-synthetic.png'),(await capture()).toPNG())
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({evidence:'synthetic-room-lineup-plans',passed:['room name then rules UI','lineup names and policy confirmations','ordered move then team observations','HeadToHead move without team commands','900x640 composer'],sent}));app.exit(0)
}
main().catch(error=>{console.error(error.stack);app.exit(1)})
