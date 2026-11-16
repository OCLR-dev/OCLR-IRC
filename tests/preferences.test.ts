import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PreferencesStore } from '../src/main/preferences-store.ts'
import { DEFAULT_PREFERENCES, preferencesInput, resolveLocale } from '../src/shared/preferences.ts'

const { chatTimestamp, notifyPlayersReady, notifyMatchFinished, notifyOnlyInBackground, chatSendShortcut, foldBanchoQueries, ...previousDefaults } = DEFAULT_PREFERENCES
const newDefaults = { chatTimestamp, notifyPlayersReady, notifyMatchFinished, notifyOnlyInBackground, chatSendShortcut, foldBanchoQueries }

test('preferences persist across new instances; invalid, corrupt and failed writes preserve safe state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oclr-settings-test-')), file = join(dir, 'preferences.json')
  try {
    const store = new PreferencesStore(file)
    assert.deepEqual(store.get(), DEFAULT_PREFERENCES)
    const desired = { ...DEFAULT_PREFERENCES, closeToBackground: false, language: 'en' as const, restoreIrcLogin: true, autoRefreshOclr: false, chatFontSize: 24 as const, chatFontFamily: 'serif' as const }
    store.set(desired)
    assert.deepEqual(new PreferencesStore(file).get(), desired)
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { schema: 7, preferences: desired, ircLoginActive: false })
    for (const bad of [null, [], {}, { ...desired, language: 'fr' }, { ...desired, closeToBackground: 'false' }, { ...desired, restoreIrcLogin: 'true' }, { ...desired, autoRefreshOclr: 'false' }, { ...desired, token: 'not-allowed' }]) {
      assert.throws(() => store.set(bad)); assert.deepEqual(store.get(), desired)
    }
    for (const chatFontSize of [8, 13, 24.5, 26, '24', NaN, null]) {
      assert.throws(() => store.set({ ...desired, chatFontSize }))
      assert.equal(new PreferencesStore(file).get().chatFontSize, 24)
    }
    for (const chatFontFamily of ['Arial', 'serif, monospace', '', null]) {
      assert.throws(() => store.set({ ...desired, chatFontFamily }))
      assert.equal(new PreferencesStore(file).get().chatFontFamily, 'serif')
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

test('legacy preferences keep language and background without granting login restoration; eligibility is explicit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oclr-settings-migration-')), file = join(dir, 'preferences.json')
  try {
    writeFileSync(file, JSON.stringify({ schema: 1, preferences: { closeToBackground: false, language: 'zh-Hant' } }))
    const store = new PreferencesStore(file)
    assert.deepEqual(store.get(), { ...DEFAULT_PREFERENCES, closeToBackground: false, language: 'zh-Hant' })
    store.setIrcLoginActive(true); assert.equal(new PreferencesStore(file).ircLoginActive, false)
    store.set({ ...store.get(), restoreIrcLogin: true, autoRefreshOclr: false }); assert.equal(store.ircLoginActive, false)
    store.setIrcLoginActive(true); assert.equal(new PreferencesStore(file).ircLoginActive, true)
    store.set({ ...store.get(), language: 'en' }); assert.equal(new PreferencesStore(file).ircLoginActive, true)
    store.setIrcLoginActive(false); assert.equal(new PreferencesStore(file).ircLoginActive, false)
    store.setIrcLoginActive(true); store.set({ ...store.get(), restoreIrcLogin: false })
    assert.equal(new PreferencesStore(file).ircLoginActive, false)
    for (const bad of [{ schema: 2, preferences: store.get(), ircLoginActive: 'true' }, { schema: 1, preferences: { ...store.get() } }]) {
      writeFileSync(file, JSON.stringify(bad)); assert.deepEqual(new PreferencesStore(file).get(), DEFAULT_PREFERENCES)
    }
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

test('schema 2 migration enables OCLR updates without losing existing login eligibility; the choice persists separately', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oclr-auto-refresh-settings-')), file = join(dir, 'preferences.json')
  try {
    writeFileSync(file, JSON.stringify({ schema: 2, preferences: { closeToBackground: false, language: 'en', restoreIrcLogin: true }, ircLoginActive: true }))
    const store = new PreferencesStore(file)
    assert.deepEqual(store.get(), { ...DEFAULT_PREFERENCES, closeToBackground: false, language: 'en', restoreIrcLogin: true })
    assert.equal(store.ircLoginActive, true)
    store.set({ ...store.get(), autoRefreshOclr: false })
    const restarted = new PreferencesStore(file)
    assert.equal(restarted.get().autoRefreshOclr, false)
    assert.equal(restarted.ircLoginActive, true)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).schema, 7)
    writeFileSync(file, JSON.stringify({ schema: 7, preferences: { ...store.get(), autoRefreshOclr: 'false' }, ircLoginActive: true }))
    assert.deepEqual(new PreferencesStore(file).get(), DEFAULT_PREFERENCES)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('schema 3 keeps existing settings and login eligibility while defaulting chat size to 12', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oclr-chat-size-settings-')), file = join(dir, 'preferences.json')
  try {
    const preferences = { closeToBackground: false, language: 'zh-Hans', restoreIrcLogin: true, autoRefreshOclr: false }
    writeFileSync(file, JSON.stringify({ schema: 3, preferences, ircLoginActive: true }))
    const store = new PreferencesStore(file)
    assert.deepEqual(store.get(), { ...DEFAULT_PREFERENCES, ...preferences })
    assert.equal(store.ircLoginActive, true)
    store.set({ ...store.get(), chatFontSize: 10 })
    const restarted = new PreferencesStore(file)
    assert.deepEqual(restarted.get(), { ...DEFAULT_PREFERENCES, ...preferences, chatFontSize: 10 })
    assert.equal(restarted.ircLoginActive, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('schema 4 preserves chat size, other preferences and login eligibility when adding the default font', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oclr-chat-font-settings-')), file = join(dir, 'preferences.json')
  try {
    const preferences = { closeToBackground: false, language: 'en', restoreIrcLogin: true, autoRefreshOclr: false, chatFontSize: 18 }
    writeFileSync(file, JSON.stringify({ schema: 4, preferences, ircLoginActive: true }))
    const store = new PreferencesStore(file)
    assert.deepEqual(store.get(), { ...DEFAULT_PREFERENCES, ...preferences })
    store.set({ ...store.get(), chatFontFamily: 'monospace' })
    const restarted = new PreferencesStore(file)
    assert.deepEqual(restarted.get(), { ...DEFAULT_PREFERENCES, ...preferences, chatFontFamily: 'monospace' })
    assert.equal(restarted.ircLoginActive, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('schema 5 supplies notification and timestamp defaults and preserves explicit choices after restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oclr-notification-settings-')), file = join(dir, 'preferences.json')
  try {
    const previous = { ...previousDefaults, restoreIrcLogin: true, chatFontSize: 18, chatFontFamily: 'serif' }
    writeFileSync(file, JSON.stringify({ schema: 5, preferences: previous, ircLoginActive: true }))
    const store = new PreferencesStore(file)
    assert.deepEqual(store.get(), { ...previous, ...newDefaults })
    const choices = { ...store.get(), chatTimestamp: 'minutes', notifyPlayersReady: false, notifyOnlyInBackground: true }
    store.set(choices)
    assert.deepEqual(new PreferencesStore(file).get(), choices)
    assert.equal(new PreferencesStore(file).ircLoginActive, true)
    for (const invalid of [{ chatTimestamp: 'full' }, { notifyPlayersReady: 'false' }, { notifyMatchFinished: 0 }, { notifyOnlyInBackground: null }]) {
      assert.throws(() => store.set({ ...choices, ...invalid }))
      assert.deepEqual(new PreferencesStore(file).get(), choices)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('schema 6 defaults to Enter and folding; both choices persist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oclr-send-shortcut-')), file = join(dir, 'preferences.json')
  try {
    const previous = { ...previousDefaults, chatTimestamp: 'hidden', notifyPlayersReady: false, notifyMatchFinished: true, notifyOnlyInBackground: true }
    writeFileSync(file, JSON.stringify({ schema: 6, preferences: previous, ircLoginActive: false }))
    const store = new PreferencesStore(file)
    assert.deepEqual(store.get(), { ...previous, chatSendShortcut: 'enter', foldBanchoQueries: true })
    assert.throws(() => store.set({ ...store.get(), chatSendShortcut: 'alt-enter' }))
    assert.throws(() => store.set({ ...store.get(), foldBanchoQueries: 'false' }))
    store.set({ ...store.get(), chatSendShortcut: 'modifier-enter', foldBanchoQueries: false })
    assert.deepEqual(new PreferencesStore(file).get(), { ...previous, chatSendShortcut: 'modifier-enter', foldBanchoQueries: false })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
