import test from 'node:test'
import assert from 'node:assert/strict'
import { AccountPairing } from '../src/main/account-pairing.ts'

test('authenticated names pair automatically with osu! space/underscore and case equivalence', () => {
  const pair = new AccountPairing()
  const irc = { generation: 1, online: true, username: 'Ref_Name' }
  const website = { generation: 1, subject: { osuId: 42, username: 'Ref Name' } }
  assert.equal(pair.ready, false)
  assert.equal(pair.update(irc, website), true)
  assert.equal(pair.state.status, 'nickname_matched'); assert.equal(pair.ready, true)
  assert.equal(pair.update(irc, website), false)
  for (const [ircName, websiteName] of [['REF_NAME', 'ref name'], ['Ref_Name', 'Ref_Name'], ['Ref_Name_2', 'Ref Name 2'], ['Ref Name', 'Ref_Name']]) {
    pair.update({ ...irc, username: ircName }, { ...website, subject: { osuId: 42, username: websiteName } })
    assert.equal(pair.ready, true, `${ircName} / ${websiteName}`)
  }
  // Similar punctuation, collapsed spaces and Unicode lookalikes are not equivalent.
  for (const name of ['Other', 'Ref__Name', 'RefName', 'Ref-Name', 'Ref_Ｎame', 'Ref_Name ']) {
    pair.update({ ...irc, username: name }, website)
    assert.equal(pair.state.status, 'mismatch'); assert.equal(pair.ready, false)
  }
})

test('pairing requires both authenticated sessions and detects every identity generation change', () => {
  const pair = new AccountPairing()
  const irc = { generation: 1, online: true, username: 'Ref_Name' }
  const website = { generation: 1, subject: { osuId: 42, username: 'Ref Name' } }
  pair.update({ ...irc, online: false }, website)
  assert.equal(pair.state.status, 'unknown'); assert.equal(pair.state.ircUsername, null); assert.equal(pair.ready, false)
  pair.update(irc, { generation: 1, subject: null })
  assert.equal(pair.state.status, 'unknown'); assert.equal(pair.ready, false)
  pair.update({ ...irc, username: '' }, website)
  assert.equal(pair.ready, false)
  pair.update(irc, website)
  for (const change of [() => irc.generation++, () => website.generation++, () => website.subject.osuId++, () => website.subject.username = 'REF NAME', () => irc.username = 'ref_name']) {
    change()
    // The relay uses this change signal to stop the old binding, even if names still match.
    assert.equal(pair.update(irc, website), true)
    assert.equal(pair.ready, true)
    assert.equal(pair.update(irc, website), false)
  }
  const snapshot = pair.state
  snapshot.status = 'mismatch'
  assert.equal(pair.ready, true, 'renderer snapshots cannot change Main pairing')
})
