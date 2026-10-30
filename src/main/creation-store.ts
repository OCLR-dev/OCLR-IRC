import { DatabaseSync } from 'node:sqlite'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { normalize } from './protocol.ts'

export interface CreationRecord { id: string; status: 'pending' | 'created'; roomId: number | null; createdAt: string; legacy?: boolean }
export interface CreationStore {
  latest(username: string): CreationRecord | null
  begin(username: string, id: string, previousId: string | null): void
  complete(username: string, id: string, roomId: number): void
}
function account(username: string) {
  if (typeof username !== 'string' || !username.trim()) throw new Error('Missing recovery account')
  return createHash('sha256').update(normalize(username)).digest('hex')
}
function record(row: Record<string, unknown>): CreationRecord {
  if (typeof row.id !== 'string' || !row.id || !['pending', 'created'].includes(String(row.status)) || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at)) || (row.room_id !== null && (!Number.isSafeInteger(row.room_id) || Number(row.room_id) <= 0))) throw new Error('Invalid creation journal')
  return { id: row.id, status: row.status as CreationRecord['status'], roomId: row.room_id as number | null, createdAt: row.created_at }
}

/** Minimal account-scoped guard. Legacy ownership is unknown, never inferred from the next login. */
export class SqliteCreationStore implements CreationStore {
  private db: DatabaseSync | null = null
  private file: string
  constructor(file: string) { this.file = file }
  private open() {
    if (this.db) return this.db
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const db = new DatabaseSync(this.file)
    try {
      chmodSync(this.file, 0o600)
      db.exec('PRAGMA busy_timeout=2000; PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON;')
      const version = db.prepare('PRAGMA user_version').get()?.user_version
      if (version !== 0 && version !== 1 && version !== 2) throw new Error('Unsupported creation journal version')
      if (version !== 2) {
        db.exec('BEGIN IMMEDIATE')
        try {
          db.exec(`CREATE TABLE IF NOT EXISTS account_creation (
            account TEXT PRIMARY KEY, id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending', 'created')),
            room_id INTEGER, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS legacy_creation (slot INTEGER PRIMARY KEY CHECK(slot=1), id TEXT NOT NULL, created_at TEXT NOT NULL);`)
          const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='room_creation'").get()
          if (version === 1 && !exists) throw new Error('Missing legacy recovery table')
          if (exists) {
            const row = db.prepare('SELECT id, status, room_id, created_at FROM room_creation WHERE slot=1').get()
            if (row) {
              const old = record(row)
              // Keep only uncertainty; a room ID cannot be disclosed to an unproven account.
              db.prepare('INSERT INTO legacy_creation VALUES(1,?,?)').run(old.id, old.createdAt)
            }
            db.exec('DROP TABLE room_creation')
          }
          db.exec('PRAGMA user_version=2; COMMIT;')
        } catch (error) { db.exec('ROLLBACK'); throw error }
      }
      this.db = db
      return db
    } catch (error) { db.close(); throw error }
  }
  latest(username: string): CreationRecord | null {
    const key = account(username), db = this.open()
    const row = db.prepare('SELECT id, status, room_id, created_at FROM account_creation WHERE account=?').get(key)
    if (row) return record(row)
    const legacy = db.prepare('SELECT id, created_at FROM legacy_creation WHERE slot=1').get()
    return legacy ? { ...record({ ...legacy, status: 'pending', room_id: null }), legacy: true } : null
  }
  begin(username: string, id: string, previousId: string | null) {
    const key = account(username), db = this.open()
    db.exec('BEGIN IMMEDIATE')
    try {
      if ((this.latest(username)?.id ?? null) !== previousId) throw new Error('Creation journal changed; reconnect and review')
      db.prepare("INSERT OR REPLACE INTO account_creation VALUES (?, ?, 'pending', NULL, ?)").run(key, id, new Date().toISOString())
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  complete(username: string, id: string, roomId: number) {
    const result = this.open().prepare("UPDATE account_creation SET status='created', room_id=? WHERE account=? AND id=? AND status='pending'").run(roomId, account(username), id)
    if (result.changes !== 1) throw new Error('Creation journal changed')
  }
  close() { this.db?.close(); this.db = null }
}
