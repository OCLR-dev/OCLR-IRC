import { randomUUID } from 'node:crypto'
import type { OperationRecord } from '../shared/operation.ts'
import type { OperationStore } from './operation-store.ts'
import { relayReply } from '../shared/relay-command.ts'

/** Shared single-step intent tracker. Observation is explicitly not causal proof. */
export class Operations {
  private records: OperationRecord[] = []
  private active = new Map<string, { command: string; generation: number; timer: ReturnType<typeof setTimeout> }>()
  private account = ''
  private failed = false
  private changed: () => void
  private store?: OperationStore
  private deadlineMs: number
  constructor(changed: () => void, store?: OperationStore, deadlineMs = 15000) { this.changed = changed; this.store = store; this.deadlineMs = deadlineMs }
  setStore(store: OperationStore) { this.store = store }
  authenticate(username: string) {
    this.interrupt()
    if (this.account === username) return
    this.account = username
    try { this.records = this.store?.load(username) ?? []; this.failed = false }
    catch { this.records = []; this.failed = true }
  }
  get snapshot() { return { records: structuredClone(this.records), failed: this.failed } }
  private save(record: OperationRecord) {
    if (this.failed) throw new Error('操作恢復記錄不可用，目前禁止變更。')
    // Website-derived history requires subject/fixture reauthorization, not IRC identity alone.
    if (record.source === 'oclr') return
    try { this.store?.save(this.account, record) }
    catch { this.failed = true; throw new Error('操作恢復記錄保存失敗，請先檢查本機儲存。') }
  }
  begin(source: OperationRecord['source'], kind: string, roomId: number | null, roomEpoch: number, generation: number, command: string, deadlineMs = this.deadlineMs) {
    if (!this.account) throw new Error('請先登入。')
    const emergency = kind === 'abort' || kind === 'aborttimer'
    if (emergency && roomId !== null) this.interrupt(roomId)
    if (!emergency && this.records.some(r => r.roomId === roomId && (r.state === 'awaiting' || r.state === 'unknown' && !r.reviewed))) throw new Error('此房間有待核對操作，請先在操作記錄核對結果。')
    if (this.records.filter(r => r.state === 'awaiting' || r.state === 'unknown' && !r.reviewed).length >= 100) throw new Error('待核對操作過多，請先核對歷史記錄。')
    const record: OperationRecord = { id: randomUUID(), source, kind, roomId, roomEpoch, state: 'awaiting', createdAt: Date.now(), reviewed: false }
    this.save(record) // Must succeed before socket write.
    this.records.push(record)
    if (this.records.length > 100) this.records = this.records.filter((r, index) => index >= this.records.length - 100 || r.state === 'awaiting' || r.state === 'unknown' && !r.reviewed)
    const timer = setTimeout(() => this.finish(record.id, 'unknown'), Math.min(60000, Math.max(1, deadlineMs)))
    timer.unref()
    this.active.set(record.id, { command, generation, timer })
    return record.id
  }
  finish(id: string, state: 'observed' | 'unknown', roomId?: number) {
    const record = this.records.find(r => r.id === id)
    if (!record || record.state !== 'awaiting') return
    const active = this.active.get(id)
    if (active) clearTimeout(active.timer)
    this.active.delete(id)
    record.state = state
    if (roomId !== undefined) record.roomId = roomId
    try { this.save(record) } catch { record.state = 'unknown' }
    this.changed()
  }
  observe(roomId: number, roomEpoch: number, generation: number, body: string) {
    for (const record of this.records) {
      const active = this.active.get(record.id)
      if (!active || record.roomId !== roomId || record.roomEpoch !== roomEpoch || active.generation !== generation) continue
      // Only exact scoped supported replies count as an observed effect.
      // Generic errors and unsupported semantics remain unknown for manual review.
      if (relayReply(active.command, body) === 'confirmed') this.finish(record.id, 'observed')
    }
  }
  review(input: unknown) {
    if (!input || typeof input !== 'object' || (input as { reviewed?: unknown }).reviewed !== true) throw new Error('請確認已核對房間與伺服器回覆。')
    const record = this.records.find(r => r.id === (input as { id?: unknown }).id)
    if (!record || record.state === 'observed') throw new Error('操作狀態已變更。')
    if (record.state === 'awaiting') this.finish(record.id, 'unknown')
    const next = { ...record, reviewed: true }
    this.save(next); Object.assign(record, next); this.changed()
  }
  interrupt(roomId?: number) {
    for (const record of [...this.records]) if (record.state === 'awaiting' && (roomId === undefined || roomId === record.roomId)) this.finish(record.id, 'unknown')
  }
  clearWebsite() {
    for (const record of this.records.filter(r => r.source === 'oclr')) {
      const active = this.active.get(record.id)
      if (active) clearTimeout(active.timer)
      this.active.delete(record.id)
    }
    this.records = this.records.filter(r => r.source !== 'oclr')
    this.changed()
  }
  logout(preserve = false) {
    this.interrupt()
    if (!preserve && this.account) { try { this.store?.clear(this.account) } catch { this.failed = true } }
    this.account = ''; this.records = []; this.active.clear()
  }
}
