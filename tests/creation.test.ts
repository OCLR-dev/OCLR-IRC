import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IrcSession } from '../src/main/irc.ts'
import { Lines, matchName } from '../src/main/protocol.ts'
import { SqliteCreationStore } from '../src/main/creation-store.ts'
import type { CreationStore } from '../src/main/creation-store.ts'
import type { OperationRecord } from '../src/shared/operation.ts'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate: () => boolean) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(10) }
  throw new Error('condition timed out')
}
async function fixture(replyJoin = true) {
  const dir = mkdtempSync(join(tmpdir(), 'oclr-creation-test-'))
  const store = new SqliteCreationStore(join(dir, 'creation.sqlite'))
  const sent: string[] = [], sockets = new Set<net.Socket>()
  let peer: net.Socket
  const server = net.createServer(socket => {
    peer = socket; sockets.add(socket); socket.on('close', () => sockets.delete(socket))
    const parser = new Lines()
    socket.on('data', chunk => { for (const line of parser.feed(chunk)) {
      sent.push(line)
      if (line.startsWith('USER ')) socket.write(':server 001 Example :welcome\n')
      if (replyJoin && line.startsWith('JOIN ')) socket.write(`:server 366 Example ${line.slice(5)} :End\n`)
      if (line.endsWith(':!mp settings')) socket.write(`:BanchoBot PRIVMSG #mp_9 :Room name: 測試, History: https://osu.ppy.sh/mp/9\n:BanchoBot PRIVMSG #mp_9 :Team mode: TeamVs, Win condition: ScoreV2\n:BanchoBot PRIVMSG #mp_9 :Players: 0\n`)
      if (line.endsWith(':!mp listrefs')) socket.write(':BanchoBot PRIVMSG #mp_9 :Match referees:\n:BanchoBot PRIVMSG #mp_9 :Example\n')
    } })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  const session = new IrcSession(() => net.createConnection({ host: '127.0.0.1', port }), { floodMs: 20, creationMs: 180, queryMs: 150, retryBaseMs: 30 })
  session.setCreationStore(store)
  return { session, store, sent, peer: () => peer, async close() {
    session.logout(); for (const socket of sockets) socket.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
    store.close(); rmSync(dir, { recursive: true, force: true })
  } }
}
async function login(session: IrcSession) {
  session.login({ username: 'Example', password: 'SYNTHETIC_ONLY' })
  await until(() => session.state.connection === 'online')
}
function input(session: IrcSession, name = '測試') { return { name, reviewed: true, requestId: session.state.creation.requestId } }
function confirmed(socket: net.Socket, name = '測試') { socket.write(`:BanchoBot!bot@ppy.sh PRIVMSG Example :Created the tournament match https://osu.ppy.sh/mp/9 ${name}\n`) }

test('room names reject commands via line injection and bound Unicode titles', () => {
  assert.equal(matchName('  OCLR: (甲) vs (乙)  '), 'OCLR: (甲) vs (乙)')
  assert.equal([...matchName('🎵'.repeat(50))].length, 50)
  for (const name of ['', ' ', 'x'.repeat(51), 'test\r\nPRIVMSG BanchoBot :!mp close', 'test\0', 'x\u2028y', 123]) assert.throws(() => matchName(name))
})

test('SQLite intent survives restart, compares competing writes and stores no command/name/plaintext account', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oclr-journal-test-')), file = join(dir, 'creation.sqlite')
  let store = new SqliteCreationStore(file)
  try {
    assert.equal(store.latest('Example'), null)
    store.begin('Example', 'synthetic-operation-a', null); store.close()
    store = new SqliteCreationStore(file)
    assert.equal(store.latest('Example')?.status, 'pending')
    assert.throws(() => store.begin('Example', 'synthetic-operation-b', null))
    store.complete('Example', 'synthetic-operation-a', 9)
    assert.equal(store.latest('Example')?.roomId, 9)
    assert.throws(() => store.complete('Example', 'stale-operation', 10))
    store.begin('Example', 'synthetic-operation-b', 'synthetic-operation-a')
    assert.equal(store.latest('Example')?.status, 'pending')
    const bytes = readFileSync(file)
    for (const forbidden of ['!mp make', 'SYNTHETIC_ONLY', 'Example', '測試']) assert.equal(bytes.includes(forbidden), false)
    store.close(); writeFileSync(file, 'corrupt')
    store = new SqliteCreationStore(file); assert.throws(() => store.latest('Example'))
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('make persists before write, trusts only scoped bot PM with matching title, joins and reads once', async () => {
  const f = await fixture()
  try {
    await login(f.session)
    assert.throws(() => f.session.createRoom({ ...input(f.session), reviewed: false }))
    assert.throws(() => f.session.createRoom({ ...input(f.session), requestId: 'stale' }))
    const intent = input(f.session)
    f.session.createRoom(intent)
    assert.equal(f.store.latest('Example')?.status, 'pending')
    assert.throws(() => f.session.createRoom(intent))
    await until(() => f.sent.includes('PRIVMSG BanchoBot :!mp make 測試'))
    f.peer().write(':Player PRIVMSG Example :Created the tournament match https://osu.ppy.sh/mp/9 測試\n:BanchoBot PRIVMSG #osu :Created the tournament match https://osu.ppy.sh/mp/9 測試\n')
    confirmed(f.peer(), 'wrong name')
    await delay(20)
    assert.equal(f.session.state.creation.status, 'awaiting')
    assert.equal(f.sent.some(l => l === 'JOIN #mp_9'), false)
    confirmed(f.peer())
    await until(() => f.session.state.room?.referee === 'listed')
    assert.equal(f.session.state.creation.status, 'created')
    assert.equal(f.session.state.creation.roomId, 9)
    assert.equal(f.session.state.room?.binding, 'verified')
    assert.equal(f.store.latest('Example')?.status, 'created')
    assert.throws(() => f.session.createRoom(intent))
    confirmed(f.peer()); await delay(30)
    assert.equal(f.sent.filter(l => l === 'PRIVMSG BanchoBot :!mp make 測試').length, 1)
    assert.equal(f.sent.filter(l => l === 'JOIN #mp_9').length, 1)
    assert.equal(f.sent.filter(l => l.endsWith(':!mp settings')).length, 1)
    assert.ok(!JSON.stringify(f.session.state).includes('SYNTHETIC_ONLY'))
  } finally { await f.close() }
})

test('unknown bot error/timeout locks creation; late confirmation cannot bind; login requires review again', async () => {
  const f = await fixture()
  try {
    await login(f.session)
    const old = input(f.session); f.session.createRoom(old)
    await until(() => f.sent.some(l => l.includes('!mp make')))
    f.peer().write(':BanchoBot PRIVMSG Example :Synthetic room limit error\n')
    await until(() => f.session.state.creation.status === 'unknown')
    assert.match(f.session.state.creation.message!, /Synthetic room limit error/)
    confirmed(f.peer()); await delay(20)
    assert.equal(f.sent.includes('JOIN #mp_9'), false)
    assert.throws(() => f.session.createRoom(input(f.session)))
    await login(f.session)
    assert.equal(f.session.state.creation.status, 'unreviewed')
    assert.match(f.session.state.creation.message!, /上次開房結果不明/)
    assert.notEqual(f.session.state.creation.requestId, old.requestId)
    assert.throws(() => f.session.createRoom(old))
    assert.throws(() => f.session.createRoom({ ...input(f.session), reviewed: false }))
    assert.equal(f.sent.filter(l => l.includes('!mp make')).length, 1)
  } finally { await f.close() }
})

test('website creation stays out of IRC operation history and is private before its first room message', async () => {
  for (const source of ['manual', 'oclr'] as const) {
    const f = await fixture(); const saved: OperationRecord[] = [], events: string[] = [], completions: any[] = []
    f.session.setOperationStore({load: () => [], save: (_account, value) => saved.push(structuredClone(value)), clear() {}})
    f.session.on('private-room', roomId => events.push(`private:${roomId}`))
    f.session.on('private-conversation', name => events.push(`private:${name}`))
    f.session.on('room-created', value => completions.push(value))
    f.session.on('message', ({roomId}) => events.push(`message:${roomId}`))
    try {
      await login(f.session)
      const intent = {...input(f.session), source: 'oclr'}
      let dispatched = 0
      if (source === 'manual') f.session.createRoom(intent)
      else f.session.createWebsiteRoom(intent, () => {dispatched++})
      assert.equal(dispatched, source === 'oclr' ? 1 : 0)
      await until(() => f.sent.some(line => line.includes('!mp make')))
      // Clearing website context while waiting must not remove the privacy fence.
      if (source === 'oclr') f.session.clearWebsiteOperations()
      f.peer().write(':Other PRIVMSG Example :Created the tournament match https://osu.ppy.sh/mp/9 測試\n')
      await delay(10); assert.equal(completions.length, 0)
      confirmed(f.peer()); await until(() => f.session.state.room?.referee === 'listed')
      assert.deepEqual(completions, [{source, roomId: 9, requestId: intent.requestId, generation: f.session.sessionGeneration}])
      if (source === 'oclr') {
        assert.equal(saved.length, 0)
        assert.equal(events[0], 'private:BanchoBot')
        assert.ok(events.indexOf('private:9') >= 0 && events.indexOf('private:9') < events.indexOf('message:9'))
      } else {
        assert.equal(events.includes('private:9'), false)
        assert.equal(events.includes('private:BanchoBot'), false)
        assert.equal(saved.at(-1)?.source, 'manual', 'renderer input cannot spoof the source')
        assert.equal(saved.at(-1)?.state, 'observed')
      }
      assert.equal(f.store.latest('Example')?.roomId, 9, 'minimal anti-replay guard remains durable for both sources')
    } finally { await f.close() }
  }
})

test('operation recovery write failure blocks creation before the dispatch boundary', async () => {
  const f = await fixture(); let dispatched = 0
  f.session.setOperationStore({load: () => [], save() {throw Error('synthetic disk full')}, clear() {}})
  try {
    await login(f.session)
    assert.throws(() => f.session.createRoom(input(f.session)))
    assert.equal(f.session.state.creation.status, 'blocked')
    assert.throws(() => f.session.createWebsiteRoom(input(f.session), () => {dispatched++}))
    assert.equal(dispatched, 0)
    assert.equal(f.sent.some(line => line.includes('!mp make')), false)
    assert.equal(f.store.latest('Example')?.status, 'pending', 'retain conservative recovery guard; never retry')
  } finally { await f.close() }
})

test('disconnect never replays make; restored connection fences old requests and exposes pending intent', async () => {
  const f = await fixture()
  try {
    await login(f.session)
    const old = input(f.session); f.session.createRoom(old)
    await until(() => f.sent.some(l => l.includes('!mp make')))
    f.peer().destroy()
    await until(() => f.session.state.connection === 'reconnecting')
    assert.equal(f.session.state.creation.status, 'unknown')
    await until(() => f.session.state.connection === 'online')
    assert.match(f.session.state.creation.message!, /結果不明/)
    assert.throws(() => f.session.createRoom(old))
    await delay(40)
    assert.equal(f.sent.filter(l => l.includes('!mp make')).length, 1)
  } finally { await f.close() }
})

test('recovery storage failures prevent make; completion failure keeps actual room ID but blocks another make', async () => {
  const f = await fixture()
  try {
    const unavailable: CreationStore = { latest() { throw new Error('read failed') }, begin() { throw new Error('write failed') }, complete() {} }
    f.session.setCreationStore(unavailable); await login(f.session)
    assert.equal(f.session.state.creation.status, 'blocked')
    assert.throws(() => f.session.createRoom(input(f.session)))
    f.session.setCreationStore({ ...unavailable, latest: () => null }); await login(f.session)
    assert.throws(() => f.session.createRoom(input(f.session)))
    assert.equal(f.sent.some(l => l.includes('!mp make')), false)
    f.session.setCreationStore({ latest: () => f.store.latest('Example'), begin: (...args) => f.store.begin(...args), complete() { throw new Error('disk full') } })
    await login(f.session); f.session.createRoom(input(f.session))
    await until(() => f.sent.some(l => l.includes('!mp make')))
    confirmed(f.peer()); await until(() => f.session.state.room?.id === 9 && f.session.state.room.joined)
    assert.equal(f.session.state.creation.status, 'blocked')
    assert.equal(f.session.state.creation.roomId, 9)
    assert.throws(() => f.session.createRoom(input(f.session)))
    assert.equal(f.store.latest('Example')?.status, 'pending')
  } finally { await f.close() }
})

test('creation shares flood limit and reserves capacity against joins and unsolicited private messages', async () => {
  const f = await fixture()
  try {
    await login(f.session)
    f.session.openConversation({ kind: 'private', name: 'Friend0' })
    f.session.chat({ roomId: f.session.state.room!.id, roomEpoch: f.session.state.room!.epoch, text: 'hello' })
    assert.throws(() => f.session.createRoom(input(f.session)), /等待/)
    await delay(25)
    for (let i = 1; i < 6; i++) f.session.openConversation({ kind: 'private', name: `Friend${i}` })
    f.session.createRoom(input(f.session))
    f.session.openConversation({ kind: 'private', name: 'Friend6' })
    assert.throws(() => f.session.openConversation({ kind: 'private', name: 'Friend7' }))
    assert.throws(() => f.session.join('10'))
    f.peer().write(':Unsolicited PRIVMSG Example :hello\n')
    confirmed(f.peer()); await until(() => f.session.state.room?.id === 9 && f.session.state.room.joined)
    assert.equal(f.session.state.rooms.length, 8)
    assert.equal(f.session.state.room?.id, 9)
    assert.equal(f.session.state.rooms.some(r => r.channel === 'Unsolicited'), false)
    await delay(25)
    assert.throws(() => f.session.createRoom(input(f.session)), /8/)
  } finally { await f.close() }
})

for (const order of ['before', 'after'] as const) test(`own JOIN ${order} creation reply cancels redundant JOIN and reads settings once`, async () => {
  const f = await fixture(false)
  try {
    await login(f.session)
    f.session.createRoom(input(f.session))
    await until(() => f.sent.some(line => line.includes('!mp make')))
    const joined = ':Example!user@host JOIN :#mp_9\r\n'
    const created = ':BanchoBot PRIVMSG Example :Created the tournament match https://osu.ppy.sh/mp/9 測試\r\n'
    f.peer().write(order === 'before' ? joined + created : created + joined)
    await until(() => f.session.state.room?.referee === 'listed')
    await delay(180)
    assert.equal(f.session.state.room?.joined, true)
    assert.equal(f.session.state.error, null)
    assert.equal(f.sent.filter(line => line === 'JOIN #mp_9').length, 0)
    assert.equal(f.sent.filter(line => line.endsWith(':!mp settings')).length, 1)
    assert.equal(f.session.state.room?.binding, 'verified')
  } finally { await f.close() }
})

test('foreign, unrelated and revoked early JOIN do not confirm a created room', async () => {
  for (const early of [':Other JOIN :#mp_9\n', ':Example JOIN :#mp_8\n', ':Example JOIN :#mp_9\n:Example PART #mp_9 :bye\n']) {
    const f = await fixture(false)
    try {
      await login(f.session); f.session.createRoom(input(f.session))
      await until(() => f.sent.some(line => line.includes('!mp make')))
      f.peer().write(early); confirmed(f.peer())
      await until(() => Boolean(f.session.state.error))
      assert.equal(f.session.state.room?.joined, false)
      assert.equal(f.sent.filter(line => line === 'JOIN #mp_9').length, 1)
    } finally { await f.close() }
  }
})

test('late own JOIN recovers timeout but cannot resurrect kicked or closed rooms', async () => {
  const f = await fixture(false)
  try {
    await login(f.session); f.session.join('9')
    await until(() => Boolean(f.session.state.error))
    f.peer().write(':Other JOIN :#mp_9\n:server 366 Other #mp_9 :End\n')
    await delay(20); assert.equal(f.session.state.room?.joined, false)
    f.peer().write(':Example!user@host JOIN :#mp_9\n')
    await until(() => f.session.state.room?.joined === true)
    assert.equal(f.session.state.error, null)
    assert.equal(f.session.state.room?.referee, 'unknown')
    f.peer().write(':server KICK #mp_9 Example :removed\n:Example JOIN :#mp_9\n')
    await until(() => f.session.state.room?.joined === false)
    assert.equal(f.session.state.room?.joined, false)
    const room = f.session.state.room!
    f.session.leaveRoom({ roomId: room.id, roomEpoch: room.epoch })
    f.peer().write(':Example JOIN :#mp_9\n')
    await delay(20); assert.equal(f.session.state.room, null)
  } finally { await f.close() }
})

test('legacy creation migration never assigns ownership or discloses the old room; repeat opens remain safe', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oclr-legacy-test-')), file = join(dir, 'creation.sqlite')
  let store: SqliteCreationStore | null = null
  try {
    const db = new DatabaseSync(file)
    db.exec("CREATE TABLE room_creation(slot INTEGER PRIMARY KEY, id TEXT, status TEXT, room_id INTEGER, created_at TEXT); PRAGMA user_version=1;")
    db.prepare('INSERT INTO room_creation VALUES(1,?,?,?,?)').run('legacy-intent', 'created', 987654321, new Date().toISOString())
    db.close()
    store = new SqliteCreationStore(file)
    for (const name of ['Example', 'Other']) {
      assert.deepEqual({ ...store.latest(name), createdAt: '' }, { id: 'legacy-intent', status: 'pending', roomId: null, createdAt: '', legacy: true })
      assert.throws(() => store!.complete(name, 'legacy-intent', 12))
    }
    assert.throws(() => store!.begin('Example', 'next-intent', null))
    store.begin('Example', 'next-intent', 'legacy-intent'); store.complete('Example', 'next-intent', 12)
    store.close(); store = new SqliteCreationStore(file)
    assert.equal(store.latest('example')?.roomId, 12)
    assert.equal(store.latest('Other')?.roomId, null)
    assert.equal(store.latest('Other')?.legacy, true)
    const check = new DatabaseSync(file)
    assert.equal(check.prepare('PRAGMA user_version').get()?.user_version, 2)
    assert.equal(check.prepare("SELECT name FROM sqlite_master WHERE name='room_creation'").get(), undefined)
    check.close()
  } finally { store?.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('creation compare-and-set and completion stay within normalized account scope', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oclr-scope-test-')), file = join(dir, 'creation.sqlite')
  const first = new SqliteCreationStore(file), second = new SqliteCreationStore(file)
  try {
    first.begin('Ref Name', 'first', null)
    assert.equal(second.latest('ref_name')?.id, 'first')
    assert.equal(second.latest('Other'), null)
    assert.throws(() => second.begin('Ref_Name', 'race', null))
    assert.throws(() => second.complete('Other', 'first', 42))
    second.begin('Other', 'second', null); second.complete('Other', 'second', 43)
    first.complete('Ref Name', 'first', 42)
    assert.equal(first.latest('Ref_Name')?.roomId, 42)
    assert.equal(first.latest('Other')?.roomId, 43)
  } finally { first.close(); second.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('invalid legacy migration rolls back rather than discarding the recovery guard', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oclr-bad-legacy-')), file = join(dir, 'creation.sqlite')
  const db = new DatabaseSync(file)
  db.exec("CREATE TABLE room_creation(slot INTEGER PRIMARY KEY, id TEXT, status TEXT, room_id INTEGER, created_at TEXT); INSERT INTO room_creation VALUES(1,'legacy','invalid',9,'invalid'); PRAGMA user_version=1;")
  db.close()
  const store = new SqliteCreationStore(file)
  try {
    assert.throws(() => store.latest('Example'))
    const check = new DatabaseSync(file)
    assert.equal(check.prepare('PRAGMA user_version').get()?.user_version, 1)
    assert.equal(check.prepare('SELECT id FROM room_creation').get()?.id, 'legacy')
    check.close()
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})
