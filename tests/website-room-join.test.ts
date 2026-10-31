import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { parseWebsiteRoomJoin } from '../src/shared/website-room-join.ts'
import { WebsiteRoomJoin } from '../src/main/website-room-join.ts'
import type { IrcSession } from '../src/main/irc.ts'

const url = (id = 123) => `oclr-irc://join?room=${id}`
function harness(online = true) {
  const calls: string[] = []
  const irc = Object.assign(new EventEmitter(), {
    sessionGeneration: 1,
    state: {connection: online ? 'online' : 'offline', rooms: [] as {id: number; joined: boolean; error: string | null}[]},
    join(id: string) { calls.push(`join:${id}`); irc.emit('state') }
  })
  irc.on('private-room', id => calls.push(`private:${id}`))
  const request = new WebsiteRoomJoin(irc as unknown as IrcSession)
  return {irc, request, calls}
}
test('room URI accepts only a canonical positive safe MP number, never commands or host overrides', () => {
  assert.equal(parseWebsiteRoomJoin(url()), 123)
  assert.equal(parseWebsiteRoomJoin(url(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER)
  for (const value of [url(0), url(-1), url(1.5), url(Number.MAX_SAFE_INTEGER + 1), 'oclr-irc://join?room=001', url()+'&command=!mp start', url()+'&room=124', url()+'#x', url()+'\n', url().replace('123', '%31%32%33'), url().replace('join?', 'join/?'), url().replace('join?', 'user@join?'), 'https://oclr.org', null]) assert.equal(parseWebsiteRoomJoin(value), null)
})
test('online navigation joins once, excludes the room before messages, and needs observed JOIN to report joined', () => {
  const f = harness()
  try {
    assert.equal(f.request.receive(url()), true)
    assert.deepEqual(f.calls, ['private:123', 'join:123'])
    assert.equal(f.request.state?.status, 'joining')
    f.request.receive(url()); f.irc.emit('state')
    assert.equal(f.calls.length, 2)
    f.irc.state.rooms = [{id: 124, joined: true, error: null}]; f.irc.emit('state')
    assert.equal(f.request.state?.status, 'joining')
    f.irc.state.rooms = [{id: 123, joined: true, error: null}]; f.irc.emit('state')
    assert.equal(f.request.state?.status, 'joined')
    f.irc.state.connection = 'offline'; f.irc.emit('state')
    f.irc.state.connection = 'online'; f.irc.emit('state')
    assert.equal(f.calls.length, 2, 'a reconnect must not replay the website request')
  } finally { f.request.clear() }
})
test('offline links wait for successful IRC login; replacement and cancellation fence old rooms', () => {
  const f = harness(false)
  try {
    f.request.receive(url()); f.request.receive(url(124))
    assert.deepEqual(f.calls, [])
    f.irc.state.connection = 'connecting'; f.irc.emit('state')
    assert.deepEqual(f.calls, [])
    f.irc.state.connection = 'online'; f.irc.emit('state')
    assert.deepEqual(f.calls, ['private:124', 'join:124'])
    f.irc.sessionGeneration++; f.irc.emit('state')
    assert.equal(f.request.state, null)
    f.irc.state.connection = 'offline'; f.request.receive(url()); f.request.clear()
    f.irc.state.connection = 'online'; f.irc.emit('state')
    assert.equal(f.calls.length, 2)
  } finally { f.request.clear() }
})
test('local JOIN rejection stays failed until an explicit retry and rejects stale IPC identifiers', () => {
  const f = harness()
  try {
    const join = f.irc.join
    f.irc.join = () => { throw Error('departing or room limit') }
    f.request.receive(url())
    assert.equal(f.request.state?.status, 'error')
    assert.throws(() => f.request.retry('stale'))
    f.irc.emit('state'); assert.deepEqual(f.calls, ['private:123'])
    f.irc.join = join; f.request.retry(f.request.state!.requestId)
    assert.equal(f.request.state?.status, 'joining')
    assert.deepEqual(f.calls, ['private:123', 'private:123', 'join:123'])
    f.irc.state.rooms = [{id: 123, joined: false, error: 'join timeout'}]; f.irc.emit('state')
    assert.equal(f.request.state?.status, 'error')
    f.irc.state.connection = 'online'; f.irc.emit('state')
    assert.equal(f.calls.length, 3)
  } finally { f.request.clear() }
})
