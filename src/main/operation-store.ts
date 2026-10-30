import { DatabaseSync } from 'node:sqlite'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { normalize } from './protocol.ts'
import type { OperationRecord } from '../shared/operation.ts'
export interface OperationStore {
  load(username: string): OperationRecord[]
  save(username: string, record: OperationRecord): void
  clear(username: string): void
}
const RETENTION = 7 * 86400000
const hash = (username: string) => createHash('sha256').update(normalize(username)).digest('hex')
/** Minimal anti-replay metadata only: no commands, names, messages or API context. */
export class SqliteOperationStore implements OperationStore {
  private db: DatabaseSync
  private timer: ReturnType<typeof setInterval>
  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(file)
    try {
      chmodSync(file, 0o600)
      this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;')
      const version = this.db.prepare('PRAGMA user_version').get()?.user_version
      if (version !== 0 && version !== 1) throw new Error('Unsupported operation recovery schema')
      this.db.exec(`BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS operations (
        account TEXT NOT NULL, id TEXT NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL,
        room_id INTEGER, room_epoch INTEGER NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL,
        reviewed INTEGER NOT NULL, PRIMARY KEY(account,id)); PRAGMA user_version=1; COMMIT;`)
      this.cleanup()
    } catch (error) { this.db.close(); throw error }
    this.timer = setInterval(() => { try { this.cleanup() } catch { /* Later load/save fails closed. */ } }, 3600000)
    this.timer.unref()
  }
  private cleanup() { this.db.prepare('DELETE FROM operations WHERE created_at<=?').run(Date.now() - RETENTION) }
  load(username: string) {
    this.cleanup()
    return this.db.prepare(`SELECT * FROM operations WHERE account=? AND (state='awaiting' OR (state='unknown' AND reviewed=0) OR id IN (SELECT id FROM operations WHERE account=? ORDER BY created_at DESC LIMIT 100)) ORDER BY created_at DESC`).all(hash(username), hash(username)).map(row => {
      if (!['manual','oclr'].includes(String(row.source)) || !['awaiting','observed','unknown'].includes(String(row.state)) || typeof row.id !== 'string' || typeof row.kind !== 'string' || !/^[a-z]+$/.test(row.kind)) throw new Error('Invalid recovery record')
      if ((row.room_id !== null && (!Number.isSafeInteger(row.room_id) || Number(row.room_id) < 1)) || !Number.isSafeInteger(row.room_epoch) || Number(row.room_epoch) < 0 || !Number.isSafeInteger(row.created_at) || Number(row.created_at) > Date.now() || ![0, 1].includes(Number(row.reviewed))) throw new Error('Invalid recovery metadata')
      return { id: row.id, source: row.source as OperationRecord['source'], kind: row.kind, roomId: row.room_id as number | null, roomEpoch: Number(row.room_epoch), state: row.state === 'awaiting' ? 'unknown' : row.state as OperationRecord['state'], createdAt: Number(row.created_at), reviewed: row.state === 'awaiting' ? false : row.reviewed === 1 }
    }).reverse()
  }
  save(username: string, record: OperationRecord) {
    this.cleanup()
    this.db.prepare('INSERT OR REPLACE INTO operations VALUES(?,?,?,?,?,?,?,?,?)').run(hash(username), record.id, record.source, record.kind, record.roomId, record.roomEpoch, record.state, record.createdAt, record.reviewed ? 1 : 0)
  }
  clear(username: string) { this.db.prepare('DELETE FROM operations WHERE account=?').run(hash(username)) }
  close() { clearInterval(this.timer); this.db.close() }
}
