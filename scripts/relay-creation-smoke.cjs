// Real Main/preload with isolated profile, synthetic HTTP/IRC and crypto provider.
const { app, BrowserWindow, safeStorage, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
app.disableHardwareAcceleration()
const profile = path.join(process.env.OCLR_QA_TEMP, 'relay-creation')
fs.mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
require('./mock-system-locale.cjs')
safeStorage.isAsyncEncryptionAvailable = async () => true
safeStorage.encryptStringAsync = async value => Buffer.from(value)
safeStorage.decryptStringAsync = async value => ({ result: value.toString(), shouldReEncrypt: false })
shell.openExternal = async () => {}
const fixtures = JSON.parse(fs.readFileSync('tests/fixtures/oclr-fixtures.json', 'utf8'))
const panel = JSON.parse(fs.readFileSync('tests/fixtures/oclr-panel.json', 'utf8'))
const meta = fixtures.meta, fixtureId = fixtures.data.items[0].fixtureId
const roomId = 900000007, name = 'SYNTHETIC RELAY PRIVATE'
const commandId = '00000000-0000-4000-8000-000000000090'
const command = {id: commandId, text: `!mp make ${name}`, target: 'BanchoBot'}
const json = (data, status = 200) => new Response(JSON.stringify({data, meta}), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-OCLR-Desktop-Contract': '1.1.0', 'X-OCLR-Referee-Contract': '1.1.0', 'X-Request-Id': meta.requestId}})
const nativeFetch = global.fetch, syncs = [], sent = []
let auth, peer, username
global.fetch = async (value, init = {}) => {
  const url = new URL(String(value))
  assert.equal(url.origin, 'https://oclr.org')
  if (url.pathname.endsWith('/auth/requests')) {
    auth = JSON.parse(init.body)
    return json({authorization_request_id: meta.requestId, authorization_url: `https://oclr.org/desktop/authorize?request_id=${meta.requestId}`, verification_code: 'ABCD-2345', expires_at: '2026-10-28T08:10:00.000Z'}, 201)
  }
  if (url.pathname.endsWith('/auth/exchange')) return json({token_type: 'Bearer', access_token: 'oclr_desk_at_' + 'A'.repeat(43), refresh_token: 'oclr_desk_rt_' + 'D'.repeat(43), expires_in: 600, access_expires_at: '2026-10-28T08:10:00.000Z', refresh_expires_at: '2026-10-28T10:00:00.000Z', session_expires_at: '2026-10-28T20:00:00.000Z', session_id: meta.requestId, scope: auth.scope, subject: panel.data.viewer})
  if (url.pathname.endsWith('/auth/revoke')) return new Response(null, {status: 204})
  if (url.pathname.includes('/me/fixtures')) return json(fixtures.data)
  if (url.pathname.endsWith('/panel')) return json(panel.data)
  if (url.pathname.endsWith('/relay')) {
    const body = JSON.parse(init.body)
    if (body.action === 'sync') syncs.push(body)
    if (body.action === 'bind') assert.equal(body.roomId, 0)
    return json({connectionId: meta.requestId, receiptReasons: true, sequence: body.sequence ?? 0, command: body.action === 'sync' ? command : null})
  }
  throw Error('Unexpected synthetic endpoint')
}
const server = net.createServer(socket => {
  peer = socket; let pending = ''
  socket.on('data', chunk => {
    pending += chunk.toString()
    let end
    while ((end = pending.indexOf('\r\n')) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 2)
      if (!line.startsWith('PASS ')) sent.push(line)
      if (line.startsWith('NICK ')) username = line.slice(5)
      if (line.startsWith('USER ')) socket.write(`:server 001 ${username} :welcome\n`)
      if (line.startsWith('PING :')) socket.write(`:server PONG server :${line.slice(6)}\n`)
      if (line.startsWith('JOIN ')) socket.write(`:${username}!x JOIN :${line.slice(5)}\n`)
      if (line.endsWith(':!mp settings')) socket.write(`:BanchoBot PRIVMSG #mp_${roomId} :Room name: ${name}, History: https://osu.ppy.sh/mp/${roomId}\n:BanchoBot PRIVMSG #mp_${roomId} :Team mode: TeamVs, Win condition: ScoreV2\n:BanchoBot PRIVMSG #mp_${roomId} :Players: 0\n`)
      if (line.endsWith(':!mp listrefs')) socket.write(`:BanchoBot PRIVMSG #mp_${roomId} :Match referees: ${username}\n`)
    }
  })
})
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn) { for (let i = 0; i < 150; i++) { if (await fn()) return; await delay(50) } throw Error('Relay creation condition timed out') }
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const connect = net.createConnection
  net.createConnection = options => { assert.equal(options.host, 'irc.ppy.sh'); return connect({host: '127.0.0.1', port: server.address().port}) }
  require('../out/main/index.js')
  await app.whenReady()
  await until(() => BrowserWindow.getAllWindows().length)
  const window = BrowserWindow.getAllWindows()[0]
  await until(() => !window.webContents.isLoading())
  const js = code => window.webContents.executeJavaScript(code)
  await until(() => js('Boolean(window.oclr?.website)'))
  assert.equal((await js('window.oclr.login({username:"Synthetic_Referee",password:"SYNTHETIC_ONLY"})')).ok, true)
  await until(() => js('(async () => (await window.oclr.snapshot()).connection === "online")()'))
  assert.equal((await js('window.oclr.website.login()')).ok, true)
  assert.equal((await nativeFetch(`${auth.redirect_uri}?state=${auth.state}&code=${'C'.repeat(43)}`)).status, 200)
  await until(() => js('(async () => (await window.oclr.website.snapshot()).fixtures.length === 2)()'))
  assert.equal((await js(`window.oclr.website.selectFixture(${JSON.stringify(fixtureId)})`)).ok, true)
  await until(() => js('(async () => (await window.oclr.website.snapshot()).panelState === "fresh")()'))
  const pairing = (await js('window.oclr.website.snapshot()')).pairing
  assert.equal((await js(`window.oclr.website.confirmPairing({token:${JSON.stringify(pairing.token)},reviewed:true})`)).ok, true)
  assert.equal((await js('window.oclr.website.startRelay()')).ok, true)
  await until(() => syncs.some(body => body.receipts.some(r => r.commandId === commandId && r.status === 'sent')))
  await until(() => syncs.length >= 3)
  assert.equal(sent.filter(line => line.startsWith('PRIVMSG BanchoBot :!mp make ')).length, 1)
  assert.equal((await js('window.oclr.snapshot()')).operations.records.at(-1).source, 'oclr')
  assert.equal((await js('window.oclr.website.stopRelay()')).ok, true)
  peer.write(`:BanchoBot PRIVMSG ${username} :Created the tournament match https://osu.ppy.sh/mp/${roomId} ${name}\n`)
  await until(() => js(`(async () => (await window.oclr.snapshot()).room?.referee === 'listed')()`))
  assert.equal((await js('window.oclr.website.snapshot()')).relay.status, 'off')
  peer.write(`:Player PRIVMSG #mp_${roomId} :SYNTHETIC_PRIVATE_RELAY_HISTORY\n`)
  await until(() => js('(async () => (await window.oclr.snapshot()).messages.some(m => m.text === "SYNTHETIC_PRIVATE_RELAY_HISTORY"))()'))
  // Positive control: ordinary IRC history still works with the synthetic provider.
  assert.equal((await js('window.oclr.openConversation({kind:"channel",name:"#public-control"})')).ok, true)
  await until(() => js('(async () => (await window.oclr.snapshot()).room?.channel === "#public-control" && (await window.oclr.snapshot()).room.joined)()'))
  peer.write(':Player PRIVMSG #public-control :SYNTHETIC_PUBLIC_CONTROL\n')
  if (process.platform !== 'linux') {
    await until(() => js('(async () => (await window.oclr.journal.read()).entries?.some(e => e.text.includes("SYNTHETIC_PUBLIC_CONTROL")))()'))
    const history = await js('window.oclr.journal.read()')
    assert.equal(history.ok, true)
    assert.equal(history.entries.some(e => e.room === `#mp_${roomId}`), false)
  } else assert.equal((await js('window.oclr.journal.status()')).status, 'memory_only')
  const db = new DatabaseSync(path.join(profile, 'operation-recovery.sqlite'), {readOnly: true})
  try { assert.equal(db.prepare('SELECT COUNT(*) AS count FROM operations').get().count, 0) } finally { db.close() }
  assert.equal(sent.filter(line => line.startsWith('PRIVMSG BanchoBot :!mp make ')).length, 1)
  console.log(JSON.stringify({evidence: 'synthetic-relay-creation', passed: ['single make despite duplicate command ID', 'sent receipt at dispatch boundary', 'late creation after relay stop still joins and reads settings/listrefs', 'website operation history stays memory only', ...(process.platform !== 'linux' ? ['private room excluded before first journal message', 'ordinary IRC history positive control'] : ['Linux journal remains memory only'])], limitation: 'Synthetic HTTP/IRC and crypto provider; real OAuth, Bancho and native provider acceptance remain separate.'}))
  app.exit(0)
}
main().catch(error => {console.error(error); app.exit(1)})
