import { DatabaseSync } from 'node:sqlite'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import { normalize, redact } from './protocol.ts'

export interface JournalEncryption {
  available(): Promise<boolean>
  encrypt(value: string): Promise<Buffer>
  decrypt(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}
export interface JournalEvent { time: number; room: string; text: string }
function clean(value: string) {
  const normalized = value.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '')
  return /(?:password|access_token|refresh_token|code_verifier|oclr_desk_|\bPASS\b|\bAUTHENTICATE\b|[?&]code=)/i.test(normalized) ? '〔含敏感資訊，已隱藏〕' : redact(normalized)
}
const RETENTION = 7 * 24 * 60 * 60 * 1000
/** Main-only storage primitive. Callers must establish an authenticated IRC account.
 * OCLR projections are deliberately unsupported until per-fixture reauthorization is wired.
 */
export class EncryptedJournal {
  private timer: ReturnType<typeof setInterval> | null = null
  private db: DatabaseSync
  private encryption: JournalEncryption
  private clock: () => number
  private generation = 0
  private account: string | null = null
  private key: Buffer | null = null
  private enabled = true
  private tail: Promise<unknown> = Promise.resolve()
  status: 'saving' | 'memory_only' | 'failed' = 'memory_only'
  constructor(file: string, encryption: JournalEncryption, clock = Date.now) {
    this.encryption = encryption; this.clock = clock
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(file)
    chmodSync(file, 0o600)
    try {
      this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;')
      const version = this.db.prepare('PRAGMA user_version').get()!.user_version
      if (version !== 0 && version !== 1) throw new Error('Unsupported journal schema')
      this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS journal_keys (account TEXT PRIMARY KEY, wrapped BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS journal_events (id INTEGER PRIMARY KEY, account TEXT NOT NULL, time INTEGER NOT NULL, payload BLOB NOT NULL);
        CREATE INDEX IF NOT EXISTS journal_expiry ON journal_events(time);
        PRAGMA user_version=1; COMMIT;`)
      this.cleanup()
      this.timer = setInterval(() => { try { this.cleanup() } catch { this.clearKey(); this.status = 'failed' } }, 3600000)
      this.timer.unref()
    } catch (error) { this.db.close(); throw error }
  }
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn); this.tail = next.catch(() => {}); return next
  }
  private clearKey() { this.key?.fill(0); this.key = null; this.status = 'memory_only' }
  authenticate(username: string) {
    const generation = ++this.generation
    this.clearKey(); this.account = null
    if (!/^[a-zA-Z0-9_\[\] -]{1,32}$/.test(username)) return Promise.reject(new Error('Invalid journal account'))
    const account = createHash('sha256').update(normalize(username)).digest('hex')
    this.account = account
    return this.run(async () => {
      try {
        if (!this.enabled || generation !== this.generation || !await this.encryption.available()) return
        if (generation !== this.generation) return
        const row = this.db.prepare('SELECT wrapped FROM journal_keys WHERE account=?').get(account)
        let key: Buffer
        let wrapped: Buffer | undefined
        if (row) {
          const decrypted = await this.encryption.decrypt(Buffer.from(row.wrapped as Uint8Array))
          if (!/^[a-f0-9]{64}$/.test(decrypted.result)) throw new Error('Invalid key')
          key = Buffer.from(decrypted.result, 'hex')
          if (decrypted.shouldReEncrypt) wrapped = await this.encryption.encrypt(decrypted.result)
        } else {
          key = randomBytes(32)
          wrapped = await this.encryption.encrypt(key.toString('hex'))
        }
        if (generation !== this.generation || !this.enabled) { key.fill(0); return }
        if (wrapped) {
          if (!wrapped.length) { key.fill(0); throw new Error('Invalid wrapped key') }
          this.db.prepare('INSERT OR REPLACE INTO journal_keys VALUES (?,?)').run(account, wrapped)
        }
        this.key = key; this.status = 'saving'
      } catch { if (generation === this.generation) { this.clearKey(); this.status = 'failed' } }
    })
  }
  append(event: JournalEvent) {
    const generation = this.generation
    // Copy and sanitize before queueing; never retain caller-owned event objects.
    const value = { time: event.time, room: clean(event.room), text: clean(event.text) }
    return this.run(async () => {
      if (generation !== this.generation || !this.enabled || !this.key || !this.account) return
      try {
        const now = this.clock()
        if (!Number.isSafeInteger(value.time) || value.time <= now - RETENTION || value.time > now || value.room.length > 128 || value.text.length > 8192) throw new Error('Invalid journal event')
        this.cleanup()
        const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, nonce)
        cipher.setAAD(Buffer.from(JSON.stringify([1, this.account, value.time])))
        const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
        this.db.prepare('INSERT INTO journal_events(account,time,payload) VALUES (?,?,?)').run(this.account, value.time, Buffer.concat([nonce, cipher.getAuthTag(), encrypted]))
      } catch { this.clearKey(); this.status = 'failed' }
    })
  }
  read() { return this.run(async (): Promise<JournalEvent[]> => {
    this.cleanup()
    if (!this.key || !this.account || !this.enabled) return []
    try {
      return this.db.prepare('SELECT time,payload FROM journal_events WHERE account=? ORDER BY id DESC LIMIT 1000').all(this.account).map(row => {
        const data = Buffer.from(row.payload as Uint8Array)
        const decipher = createDecipheriv('aes-256-gcm', this.key!, data.subarray(0, 12))
        decipher.setAuthTag(data.subarray(12, 28)); decipher.setAAD(Buffer.from(JSON.stringify([1, this.account, row.time])))
        return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')) as JournalEvent
      }).reverse()
    } catch { this.clearKey(); this.status = 'failed'; return [] }
  }) }
  cleanup() { this.db.prepare('DELETE FROM journal_events WHERE time<=?').run(this.clock() - RETENTION) }
  logout() {
    const account = this.account; ++this.generation; this.clearKey(); this.account = null
    return this.run(async () => {
      if (account) {
        this.db.prepare('DELETE FROM journal_events WHERE account=?').run(account)
        this.db.prepare('DELETE FROM journal_keys WHERE account=?').run(account)
      }
    })
  }
  disable() {
    ++this.generation; this.enabled = false; this.clearKey()
    return this.run(async () => { this.db.exec('DELETE FROM journal_events; DELETE FROM journal_keys;') })
  }
  async close() { if (this.timer) clearInterval(this.timer); this.timer = null; ++this.generation; this.clearKey(); await this.tail; this.db.close() }
}
