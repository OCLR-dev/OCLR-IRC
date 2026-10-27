import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { IrcSession } from '../src/main/irc.ts'
import { chatText, credentials, Lines, parse, redact, roomId, webURL } from '../src/main/protocol.ts'
import { messageLink } from '../src/main/links.ts'
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


test('chat validates UTF-8 wire bytes and forbids command/control injection', () => {
  const channel = '#mp_900000001'
  const available = 510 - Buffer.byteLength(`PRIVMSG ${channel} :`)
  assert.equal(chatText('x'.repeat(available), channel).length, available)
  assert.throws(() => chatText('x'.repeat(available + 1), channel))
  assert.throws(() => chatText('測'.repeat(Math.floor(available / 3) + 1), channel))
  for (const text of ['!mp start', ' !MP close', '/join #other', '／join', '\u0001ACTION wave\u0001', 'a\r\nQUIT', 'a\t!mp close', '']) assert.throws(() => chatText(text, channel))
  assert.equal(chatText('  比賽準備中  ', channel), '比賽準備中')
})

test('message links must be safe HTTP(S) URLs still present in retained messages', () => {
  const messages = [{ id: 1, time: '', kind: 'chat' as const, sender: 'Example', text: 'See https://osu.ppy.sh/mp/900000001 and example.org' }]
  assert.equal(messageLink('https://osu.ppy.sh/mp/900000001', messages), 'https://osu.ppy.sh/mp/900000001')
  assert.equal(messageLink('http://example.org', messages), 'http://example.org/')
  assert.throws(() => messageLink('https://unknown.invalid', messages))
  assert.throws(() => messageLink('https://osu.ppy.sh/mp/900000001', []))
  for (const value of ['file:///tmp/a', 'javascript:alert(1)', 'osu://mp/9', 'https://user:password@example.org', 'https://example.org/\n']) assert.throws(() => webURL(value))
})

test('chat fixes target epoch, shares query throttle and labels local send as unconfirmed', async () => {
  const f = await fixture((line, socket) => { welcome(line, socket); if (line.startsWith('PART ')) socket.write(':Example!u@h PART #mp_900000001 :leaving\n'); if (line.startsWith('JOIN ')) socket.write(':server 366 Example #mp_900000001 :End\n') })
  try {
    f.session.login(login); await until(f.session, s => s.connection === 'online')
    f.session.join('900000001'); await until(f.session, s => Boolean(s.room?.joined))
    const input = { roomId: 900000001, roomEpoch: f.session.state.room!.epoch, text: '測試聊天' }
    f.session.chat(input)
    assert.equal(f.session.state.messages.at(-1)?.delivery, 'unconfirmed')
    assert.throws(() => f.session.query('settings'))
    assert.throws(() => f.session.chat(input))
    f.session.join('900000001'); await until(f.session, s => Boolean(s.room?.joined))
    assert.notEqual(f.session.state.room!.epoch, input.roomEpoch)
    assert.throws(() => f.session.chat(input), /房間已切換/)
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(f.sent.filter(line => line.endsWith(':測試聊天')).length, 1)
  } finally { await f.close() }
})

test('KICK/PART invalidate room observations and block subsequent queries and chat', async () => {
  let peer: net.Socket | undefined
  const f = await fixture((line, socket) => { peer = socket; welcome(line, socket); if (line.startsWith('JOIN ')) socket.write(':server 366 Example #mp_900000001 :End\n') })
  try {
    f.session.login(login); await until(f.session, s => s.connection === 'online')
    for (const event of [':Operator KICK #mp_900000001 Example :bye', ':Example!u@h PART #mp_900000001 :bye']) {
      f.session.join('900000001'); await until(f.session, s => Boolean(s.room?.joined))
      f.session.query('settings')
      peer!.write(event + '\n')
      await until(f.session, s => !s.room?.joined)
      assert.equal(f.session.state.pending, null)
      assert.equal(f.session.state.room?.binding, 'unknown')
      assert.equal(f.session.state.room?.mode, null)
      assert.throws(() => f.session.chat({ roomId: 900000001, roomEpoch: f.session.state.room!.epoch, text: 'hello' }))
      assert.throws(() => f.session.query('settings'))
      await new Promise(resolve => setTimeout(resolve, 1050))
    }
  } finally { await f.close() }
})

test('burst input retains at most 1000 rows and emits once per input chunk, not per line', async () => {
  let peer: net.Socket | undefined
  const f = await fixture((line, socket) => { peer = socket; welcome(line, socket); if (line.startsWith('JOIN ')) socket.write(':server 366 Example #mp_900000001 :End\n') })
  try {
    f.session.login(login); await until(f.session, s => s.connection === 'online')
    f.session.join('900000001'); await until(f.session, s => Boolean(s.room?.joined))
    let updates = 0
    f.session.on('state', () => updates++)
    peer!.write(Array.from({ length: 1200 }, (_, i) => `:Player PRIVMSG #mp_900000001 :message ${i}\n`).join(''))
    await until(f.session, s => s.messages.at(-1)?.text === 'message 1199')
    assert.equal(f.session.state.messages.length, 1000)
    assert.equal(f.session.state.messages[0].text, 'message 200')
    assert.ok(updates < 100, `unexpected snapshot count ${updates}`)
    peer!.write('ERROR :Closing link\n')
    await until(f.session, s => s.connection === 'error')
    assert.equal(f.session.state.room, null)
  } finally { await f.close() }
})
