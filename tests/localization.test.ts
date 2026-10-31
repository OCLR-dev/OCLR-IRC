import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { messages } from '../src/shared/locales/messages.ts'
import { localize } from '../src/shared/localization.ts'
import { MP_ACTIONS, PANEL_ACTIONS, MESSAGE_TEMPLATES } from '../src/shared/referee-tools.ts'

test('all UI keys and shared action labels have complete catalogs with matching interpolation values', () => {
  const tokens = (value: string) => [...value.matchAll(/{{(\w+)}}/g)].map(match => match[1]).sort()
  for (const [source, entries] of Object.entries(messages)) {
    assert.ok(entries.en.trim(), source); assert.ok(entries['zh-Hans'].trim(), source)
    assert.deepEqual(tokens(entries.en), tokens(source), source)
    assert.deepEqual(tokens(entries['zh-Hans']), tokens(source), source)
  }
  for (const file of readdirSync('src/renderer/src').filter(file => file.endsWith('.tsx'))) {
    const source = readFileSync(`src/renderer/src/${file}`, 'utf8')
    for (const match of source.matchAll(/tr\(("(?:[^"\\]|\\.)*"|'[^']*')/g)) {
      const key = match[1][0] === '"' ? JSON.parse(match[1]) : match[1].slice(1, -1)
      assert.ok(Object.hasOwn(messages, key), `${file}: ${key}`)
    }
  }
  for (const action of [...MP_ACTIONS, ...PANEL_ACTIONS, ...MESSAGE_TEMPLATES]) assert.ok(Object.hasOwn(messages, action.label), action.label)
})

test('localization preserves inserted names and translates owned dynamic status without rewriting unknown text', () => {
  assert.equal(localize('en', '設定'), 'Settings')
  assert.equal(localize('zh-Hans', '設定'), '设置')
  assert.equal(localize('zh-Hant', '設定'), '設定')
  assert.equal(localize('en', '已建立比賽房間 123。'), 'Created match room 123.')
  const name = '未知 {{v1}} <img> 日本語'
  assert.equal(localize('en', '傳送至 {{v0}}', { v0: name }), `Send to ${name}`)
  assert.equal(localize('en', 'Unrecognized server reply 中文'), 'Unrecognized server reply 中文')
  assert.equal(localize('en', '無效的設定。'), 'Invalid settings.')
})
