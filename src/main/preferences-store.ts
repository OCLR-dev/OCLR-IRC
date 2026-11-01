import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_PREFERENCES, preferencesInput, type AppPreferences } from '../shared/preferences.ts'

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
      if (saved.schema === 1 && saved.preferences && Object.keys(saved.preferences).length === 2) this.value = preferencesInput({ ...saved.preferences, restoreIrcLogin: false })
      if (saved.schema === 2 && typeof saved.ircLoginActive === 'boolean') {
        this.value = preferencesInput(saved.preferences)
        this.active = this.value.restoreIrcLogin && saved.ircLoginActive
      }
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
      writeFileSync(temp, JSON.stringify({ schema: 2, preferences: value, ircLoginActive: active }), { mode: 0o600 })
      renameSync(temp, this.file)
    } finally { rmSync(temp, { force: true }) }
    this.value = value; this.active = active
  }
}
