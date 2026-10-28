import { DatabaseSync } from 'node:sqlite'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface CreationRecord { id: string; status: 'pending' | 'created'; roomId: number | null; createdAt: string }
export interface CreationStore {
  latest(): CreationRecord | null
  begin(id: string, previousId: string | null): void
  complete(id: string, roomId: number): void
}

/** Install-wide manual-mode guard, not a chat log or proof of an osu! account ID.
 * Keep only the latest intent; never persist names, command bodies or credentials.
 * Missing/cleared data still requires explicit review on every new connection.
 */
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
      db.exec('PRAGMA busy_timeout=2000; PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE;')
      const version = db.prepare('PRAGMA user_version').get()?.user_version
      if (version !== 0 && version !== 1) throw new Error('Unsupported creation journal version')
      db.exec(`CREATE TABLE IF NOT EXISTS room_creation (
        slot INTEGER PRIMARY KEY CHECK (slot = 1), id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'created')),
        room_id INTEGER, created_at TEXT NOT NULL);
        PRAGMA user_version=1;`)
      this.db = db
      return db
    } catch (error) { db.close(); throw error }
  }
  latest(): CreationRecord | null {
    const row = this.open().prepare('SELECT id, status, room_id, created_at FROM room_creation WHERE slot=1').get()
    if (!row) return null
    if (typeof row.id !== 'string' || !['pending', 'created'].includes(String(row.status)) || typeof row.created_at !== 'string' || (row.room_id !== null && (!Number.isSafeInteger(row.room_id) || Number(row.room_id) <= 0))) throw new Error('Invalid creation journal')
    return { id: row.id, status: row.status as CreationRecord['status'], roomId: row.room_id as number | null, createdAt: row.created_at }
  }
  begin(id: string, previousId: string | null) {
    const db = this.open()
    db.exec('BEGIN IMMEDIATE')
    try {
      // Compare inside the transaction: a second app instance cannot overwrite an unseen intent.
      if ((this.latest()?.id ?? null) !== previousId) throw new Error('Creation journal changed; reconnect and review')
      db.prepare("INSERT OR REPLACE INTO room_creation VALUES (1, ?, 'pending', NULL, ?)").run(id, new Date().toISOString())
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  complete(id: string, roomId: number) {
    const result = this.open().prepare("UPDATE room_creation SET status='created', room_id=? WHERE slot=1 AND id=? AND status='pending'").run(roomId, id)
    if (result.changes !== 1) throw new Error('Creation journal changed')
  }
  close() { this.db?.close(); this.db = null }
}
