import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_PREFERENCES, preferencesInput, type AppPreferences } from '../shared/preferences.ts'

const schema6Defaults = {
  chatTimestamp: DEFAULT_PREFERENCES.chatTimestamp,
  notifyPlayersReady: DEFAULT_PREFERENCES.notifyPlayersReady,
  notifyMatchFinished: DEFAULT_PREFERENCES.notifyMatchFinished,
  notifyOnlyInBackground: DEFAULT_PREFERENCES.notifyOnlyInBackground
}

/** Only non-sensitive application preferences; no identity, room, credential or token data. */
export class PreferencesStore {
  private value = { ...DEFAULT_PREFERENCES }
  private active = false
  private file: string
  constructor(file: string) {
    this.file = file
    let fd: number | undefined
    try {
      fd = openSync(file, 'r')
      const stat = fstatSync(fd)
      if (!stat.isFile() || stat.size > 1024) return
      const saved = JSON.parse(readFileSync(fd, 'utf8'))
      const { schema, preferences, ircLoginActive } = saved
      if (![1, 2, 3, 4, 5, 6, 7].includes(schema) || !preferences) return
      if (schema !== 1 && typeof ircLoginActive !== 'boolean') return
      if (schema < 7 && (Object.hasOwn(preferences, 'chatSendShortcut') || Object.hasOwn(preferences, 'foldBanchoQueries'))) return
      if (schema < 6 && Object.keys(schema6Defaults).some(key => Object.hasOwn(preferences, key))) return
      if (schema < 5 && Object.hasOwn(preferences, 'chatFontFamily')) return
      if (schema < 4 && Object.hasOwn(preferences, 'chatFontSize')) return
      if (schema < 3 && Object.hasOwn(preferences, 'autoRefreshOclr')) return
      if (schema === 1 && Object.hasOwn(preferences, 'restoreIrcLogin')) return
      this.value = preferencesInput({
        ...preferences,
        ...(schema === 1 ? { restoreIrcLogin: false } : {}),
        ...(schema < 3 ? { autoRefreshOclr: DEFAULT_PREFERENCES.autoRefreshOclr } : {}),
        ...(schema < 4 ? { chatFontSize: DEFAULT_PREFERENCES.chatFontSize } : {}),
        ...(schema < 5 ? { chatFontFamily: DEFAULT_PREFERENCES.chatFontFamily } : {}),
        ...(schema < 6 ? schema6Defaults : {}),
        ...(schema < 7 ? { chatSendShortcut: DEFAULT_PREFERENCES.chatSendShortcut, foldBanchoQueries: DEFAULT_PREFERENCES.foldBanchoQueries } : {})
      })
      this.active = this.value.restoreIrcLogin && ircLoginActive === true
    } catch { /* Missing/corrupt preferences use defaults without touching other application data. */ }
    finally { if (fd !== undefined) closeSync(fd) }
  }
  get(): AppPreferences { return { ...this.value } }
  get ircLoginActive() { return this.active }
  set(input: unknown): AppPreferences {
    const value = preferencesInput(input)
    this.write(value, value.restoreIrcLogin && this.active)
    return this.get()
  }
  setIrcLoginActive(active: boolean) {
    this.write(this.value, this.value.restoreIrcLogin && active)
  }
  private write(value: AppPreferences, active: boolean) {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const temp = this.file + '.tmp'
    try {
      writeFileSync(temp, JSON.stringify({ schema: 7, preferences: value, ircLoginActive: active }), { mode: 0o600 })
      renameSync(temp, this.file)
    } finally { rmSync(temp, { force: true }) }
    this.value = value; this.active = active
  }
}
