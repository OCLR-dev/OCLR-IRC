import test from 'node:test'
import assert from 'node:assert/strict'
import { searchWorkspaceActions, PANEL_ACTIONS, searchMpActions, messageTemplate, commandSearchShortcut } from '../src/shared/referee-tools.ts'

test('search only returns registered intents and templates reject untrusted room substitutions', () => {
  assert.deepEqual(searchMpActions('開賽').map(v => v.value), ['start'])
  assert.deepEqual(searchMpActions('MODS').map(v => v.value), ['mods'])
  assert.deepEqual(searchMpActions('!mp password secret'), [])
  assert.equal(messageTemplate('room', '#mp_123'), '本場比賽房間：#mp_123')
  for (const room of ['#mp_123\n!mp start', 'Player', '#mp_0', '{secret}']) assert.throws(() => messageTemplate('room', room))
  assert.throws(() => messageTemplate('command', '#mp_123'))
})
test('Cmd/Ctrl K navigates only outside editors and composition; repeated or modified events are ignored', () => {
  const event = { key: 'k', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, keyCode: 75, repeat: false }
  assert.equal(commandSearchShortcut({ ...event, ctrlKey: true }, false, false), true)
  assert.equal(commandSearchShortcut({ ...event, metaKey: true }, false, false), true)
  assert.equal(commandSearchShortcut(event, false, false), false)
  for (const change of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { altKey: true }, { shiftKey: true }, { key: 'Enter' }]) assert.equal(commandSearchShortcut({ ...event, ctrlKey: true, ...change }, false, false), false)
  assert.equal(commandSearchShortcut({ ...event, ctrlKey: true }, true, false), false)
  assert.equal(commandSearchShortcut({ ...event, ctrlKey: true }, false, true), false)
})

test('workspace search reaches only registered panels and never interprets raw commands', () => {
  for (const [query,value] of [['圖池','profile'],['password','lobby'],['初始化','initialization'],['invite','player'],['替補','lineup']]) assert.ok(searchWorkspaceActions(query).some(action=>action.value===value))
  assert.deepEqual(searchWorkspaceActions('!mp close'),[])
  assert.deepEqual(searchWorkspaceActions('javascript:alert(1)'),[])
  assert.equal(new Set(PANEL_ACTIONS.map(action=>action.value)).size,PANEL_ACTIONS.length)
  assert.ok(PANEL_ACTIONS.every(action=>/^\.[a-z-]+$/.test(action.target)))
})
