import test from 'node:test'
import assert from 'node:assert/strict'
import { AccountPairing } from '../src/main/account-pairing.ts'

test('nickname matching requires human review and resets for each identity or login change', () => {
  const pair = new AccountPairing()
  const irc = { generation: 1, online: true, username: 'Ref_Name' }
  const website = { generation: 1, subject: { osuId: 42, username: 'Ref Name' } }
  pair.update(irc, website)
  assert.equal(pair.state.status, 'nickname_matched'); assert.equal(pair.ready, false)
  assert.throws(() => pair.confirm({ token: pair.state.token, reviewed: false }))
  pair.confirm({ token: pair.state.token, reviewed: true }); assert.equal(pair.ready, true)
  assert.equal(pair.update(irc, website), false); assert.equal(pair.ready, true)
  for (const change of [() => irc.generation++, () => website.generation++, () => website.subject.osuId++, () => website.subject.username = 'REF NAME', () => irc.username = 'ref_name']) {
    const token = pair.state.token
    change(); pair.update(irc, website)
    assert.equal(pair.ready, false); assert.throws(() => pair.confirm({ token, reviewed: true }))
    pair.confirm({ token: pair.state.token, reviewed: true })
  }
  pair.update({ ...irc, username: 'Other' }, website)
  assert.equal(pair.state.status, 'mismatch')
  assert.throws(() => pair.confirm({ token: pair.state.token, reviewed: true }))
  pair.update({ ...irc, online: false }, website)
  assert.equal(pair.state.status, 'unknown'); assert.equal(pair.state.ircUsername, null)
  pair.update(irc, { generation: 2, subject: null })
  assert.equal(pair.state.status, 'unknown'); assert.equal(pair.ready, false)
})
