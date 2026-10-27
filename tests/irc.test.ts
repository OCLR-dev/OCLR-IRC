import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { IrcSession } from '../src/main/irc.ts'
import { credentials, Lines, parse, redact, roomId } from '../src/main/protocol.ts'
import type { Snapshot } from '../src/shared/types.ts'

function until(session: IrcSession, predicate: (state: Snapshot) => boolean): Promise<Snapshot> {
  if (predicate(session.state)) return Promise.resolve(session.state)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { session.off('state', check); reject(new Error('state timeout')) }, 2000)
    const check = (state: Snapshot) => { if (predicate(state)) { clearTimeout(timer); session.off('state', check); resolve(state) } }
    session.on('state', check)
  })
}
async function fixture(onLine: (line: string, socket: net.Socket) => void) {
  const sockets = new Set<net.Socket>()
  const sent: string[] = []
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket))
    const lines = new Lines()
    socket.on('data', chunk => { for (const line of lines.feed(chunk)) { sent.push(line); onLine(line, socket) } })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  const session = new IrcSession(() => net.createConnection({ host: '127.0.0.1', port }))
  return { session, sent, async close() { session.logout(); for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}
const login = { username: 'Example', password: 'SYNTHETIC_IRC_PASSWORD' }
function welcome(line: string, socket: net.Socket) { if (line.startsWith('USER ')) socket.write(':server 001 Example :Welcome\r\n') }

test('mixed CRLF/LF and UTF-8 preserve every message at every byte split', () => {
  const text = ':server 001 Example :Welcome\r\n:BanchoBot PRIVMSG #mp_9 :測試🎵\n:BanchoBot PRIVMSG #mp_9 :Players: 0\n'
  const data = Buffer.from(text)
  for (let split = 0; split <= data.length; split++) {
    const lines = new Lines()
    assert.deepEqual([...lines.feed(data.subarray(0, split)), ...lines.feed(data.subarray(split))], text.trimEnd().split(/\r?\n/))
  }
  assert.deepEqual(parse('@tag=value :BanchoBot!u@h   PRIVMSG #mp_9 :Match referees:'), { prefix: 'BanchoBot!u@h', command: 'PRIVMSG', params: ['#mp_9', 'Match referees:'] })
  assert.throws(() => new Lines().feed(Buffer.alloc(16385, 120)))
})

test('input validation forbids arbitrary hosts, unsafe IDs and IRC line injection', () => {
  assert.equal(roomId('https://osu.ppy.sh/mp/900000001'), 900000001)
  assert.equal(roomId('https://osu.ppy.sh/community/matches/900000001'), 900000001)
  for (const bad of ['https://evil.invalid/mp/9', '0', '9007199254740992', '9\r\nPRIVMSG #other :text']) assert.throws(() => roomId(bad))
  assert.throws(() => credentials({ username: 'Example\r\nQUIT', password: 'synthetic' }))
  assert.throws(() => credentials({ username: 'Example', password: 'a\nQUIT' }))
  assert.equal(credentials({ username: 'Example Ref', password: 'synthetic' }).username, 'Example_Ref')
  assert.equal(redact('!mp password PRIVATE'), '〔含敏感資訊，已隱藏〕')
})

test('online requires own welcome; snapshots never carry password and logout clears state', async () => {
  const f = await fixture(welcome)
  try {
    f.session.login(login)
    assert.equal(f.session.state.connection, 'connecting')
    await until(f.session, s => s.connection === 'online')
    assert.ok(f.sent.includes('PASS ' + login.password))
    assert.ok(!JSON.stringify(f.session.state).includes(login.password))
    f.session.logout()
    assert.equal(f.session.state.connection, 'offline')
    assert.equal(f.session.state.username, '')
    assert.deepEqual(f.session.state.messages, [])
  } finally { await f.close() }
})

test('bad password is a clear failure, not a reconnect loop or secret-bearing transcript', async () => {
  const f = await fixture((line, socket) => { if (line.startsWith('USER ')) socket.write(':server 464 Example :Bad token\r\n') })
  try {
    f.session.login(login)
    await until(f.session, s => s.connection === 'error')
    assert.match(f.session.state.error!, /IRC 專用密碼/)
    assert.equal(f.sent.filter(x => x.startsWith('PASS ')).length, 1)
    assert.ok(!JSON.stringify(f.session.state).includes(login.password))
  } finally { await f.close() }
})

test('LF settings bind History to target MP; split listrefs confirms account, fake bot cannot', async () => {
  const f = await fixture((line, socket) => {
    welcome(line, socket)
    if (line === 'JOIN #mp_900000001') socket.write(':server 366 Example #mp_900000001 :End\r\n')
    if (line.endsWith(':!mp settings')) socket.write(':Player PRIVMSG #mp_900000001 :Room name: fake, History: https://osu.ppy.sh/mp/999\n:BanchoBot PRIVMSG #mp_900000001 :Room name: synthetic, History: https://osu.ppy.sh/mp/900000001\n:BanchoBot PRIVMSG #mp_900000001 :Team mode: TeamVs, Win condition: ScoreV2\n:BanchoBot PRIVMSG #mp_900000001 :Players: 0\n')
    if (line.endsWith(':!mp listrefs')) socket.write(':BanchoBot PRIVMSG #mp_900000001 :Match referees:\n:BanchoBot PRIVMSG #mp_900000001 :Example\n')
  })
  try {
    f.session.login(login); await until(f.session, s => s.connection === 'online')
    f.session.join('900000001'); await until(f.session, s => Boolean(s.room?.joined))
    assert.equal(f.session.state.room?.binding, 'unknown')
    f.session.query('settings'); await until(f.session, s => s.pending === null)
    assert.equal(f.session.state.room?.binding, 'verified')
    assert.equal(f.session.state.room?.name, 'synthetic')
    assert.equal(f.session.state.room?.players, 0)
    assert.equal(f.session.state.room?.referee, 'unknown')
    await new Promise(resolve => setTimeout(resolve, 1050))
    f.session.query('listrefs'); await until(f.session, s => s.room?.referee === 'listed')
    assert.throws(() => f.session.query('start'))
    assert.ok(f.sent.every(x => !x.includes('!mp start') && !x.includes('!mp close')))
  } finally { await f.close() }
})

test('403 clears room readiness and blocks queries; no silent success on unavailable room', async () => {
  const f = await fixture((line, socket) => { welcome(line, socket); if (line.startsWith('JOIN ')) socket.write(':server 403 Example #mp_900000001 :No such channel\r\n') })
  try {
    f.session.login(login); await until(f.session, s => s.connection === 'online')
    f.session.join('900000001'); await until(f.session, s => Boolean(s.error))
    assert.equal(f.session.state.room?.joined, false)
    assert.throws(() => f.session.query('settings'))
    assert.ok(!f.sent.some(x => x.startsWith('PRIVMSG ')))
  } finally { await f.close() }
})

test('cancel immediately prevents late welcome from restoring a logged-out account', async () => {
  const f = await fixture(welcome)
  try {
    f.session.login(login); f.session.logout()
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(f.session.state.connection, 'offline')
    assert.equal(f.session.state.room, null)
  } finally { await f.close() }
})
