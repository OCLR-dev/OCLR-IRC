import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PreferencesStore } from '../src/main/preferences-store.ts'
import { DEFAULT_PREFERENCES, preferencesInput, resolveLocale } from '../src/shared/preferences.ts'

test('preferences persist across new instances; invalid, corrupt and failed writes preserve safe state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oclr-settings-test-')), file = join(dir, 'preferences.json')
  try {
    const store = new PreferencesStore(file)
    assert.deepEqual(store.get(), DEFAULT_PREFERENCES)
    const desired = { closeToBackground: false, language: 'en' as const }
    store.set(desired)
    assert.deepEqual(new PreferencesStore(file).get(), desired)
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { schema: 1, preferences: desired })
    for (const bad of [null, [], {}, { ...desired, language: 'fr' }, { ...desired, closeToBackground: 'false' }, { ...desired, token: 'not-allowed' }]) {
      assert.throws(() => store.set(bad)); assert.deepEqual(store.get(), desired)
    }
    const copy = store.get(); copy.closeToBackground = true
    assert.equal(store.get().closeToBackground, false)
    writeFileSync(join(dir, 'not-a-directory'), '')
    const unavailable = new PreferencesStore(join(dir, 'not-a-directory', 'settings.json'))
    assert.throws(() => unavailable.set(desired)); assert.deepEqual(unavailable.get(), DEFAULT_PREFERENCES)
    for (const bad of ['bad json', JSON.stringify({ schema: 2, preferences: desired }), 'x'.repeat(1025)]) {
      writeFileSync(file, bad); assert.deepEqual(new PreferencesStore(file).get(), DEFAULT_PREFERENCES)
    }
    assert.throws(() => preferencesInput(Object.assign(Object.create(desired), {})))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('system language uses Chinese script, region and ordered supported languages', () => {
  for (const tag of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant-CN', 'zh_TW']) assert.equal(resolveLocale('system', [tag]), 'zh-Hant')
  for (const tag of ['zh', 'zh-CN', 'zh-SG', 'zh-Hans-TW']) assert.equal(resolveLocale('system', [tag]), 'zh-Hans')
  assert.equal(resolveLocale('system', ['fr-FR', 'zh-TW', 'en']), 'zh-Hant')
  assert.equal(resolveLocale('system', ['en-GB', 'zh-TW']), 'en')
  assert.equal(resolveLocale('system', ['!invalid', 'fr']), 'en')
  assert.equal(resolveLocale('zh-Hant', ['en-US']), 'zh-Hant')
})
