import { relayCommand } from '../shared/relay-command.ts'
import { mpCommand } from '../shared/mp-command.ts'
import net from 'node:net'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { Connection, Message, Pending, Room, RoomCreation, Snapshot, RoomTarget } from '../shared/types.ts'
import type { CreationStore } from './creation-store.ts'
import { blankObservation, SettingsCollector } from './settings.ts'
import { chatText, credentials, Lines, matchName, normalize, parse, redact, roomId } from './protocol.ts'

interface RoomView {
  room: Room
  pending: Pending
  error: string | null
  totalMessages: number
  messages: Message[]
  unread: number
  mentions: number
  refsHeader: boolean
  joinSent: boolean
  needsSync: boolean
  restore: boolean
  collector: SettingsCollector | null
  timer: ReturnType<typeof setTimeout> | null
}
const MAX_ROOMS = 8
interface Timing { retryBaseMs: number; retryMaxMs: number; stableMs: number; floodMs: number; queryMs: number; creationMs: number; loginMs: number; heartbeatMs: number; heartbeatTimeoutMs: number }
const defaults: Timing = { retryBaseMs: 1000, retryMaxMs: 30000, stableMs: 60000, floodMs: 1000, queryMs: 8000, creationMs: 15000, loginMs: 15000, heartbeatMs: 30000, heartbeatTimeoutMs: 15000 }

export class IrcSession extends EventEmitter {
  private connection: Connection = 'offline'
  private username = ''
  private error: string | null = null
  private views = new Map<number, RoomView>()
  private selected: number | null = null
  private socket: net.Socket | null = null
  private generation = 0
  private loginTimer: ReturnType<typeof setTimeout> | null = null
  private auth: { username: string; password: string } | null = null
  private nextMessage = 0
  private lastQueryAt = 0
  private roomEpoch = 0
  private departing = new Set<string>()
  private batching = false
  private dirty = false
  private createSocket: () => net.Socket
  private timing: Timing
  private retryAttempt = 0
  private retryAt: string | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private stableTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null
  private pingToken: string | null = null
  private workTimer: ReturnType<typeof setTimeout> | null = null
  private work: Array<{ view: RoomView; epoch: number; kind: 'join' | 'settings' | 'listrefs' | 'part' }> = []
  private nextLocalId = -1
  private freshTimers = new Map<RoomView, ReturnType<typeof setTimeout>>()
  private creation: RoomCreation = { status: 'unreviewed', requestId: '', roomId: null, message: null }
  private creationStore: CreationStore | null = null
  private previousCreationId: string | null = null
  private creationName: string | null = null
  private mpPreview: { token: string; command: string; view: RoomView; fingerprint: string; deadline: number } | null = null
  private refereeSeen = new WeakMap<RoomView, number>()
  private creationTimer: ReturnType<typeof setTimeout> | null = null

  constructor(createSocket = () => net.createConnection({ host: 'irc.ppy.sh', port: 6667 }), timing: Partial<Timing> = {}) {
    super()
    this.createSocket = createSocket
    this.timing = { ...defaults, ...timing }
  }
  get state(): Snapshot {
    const view = this.selected === null ? undefined : this.views.get(this.selected)
    return {
      creation: { ...this.creation },
      retryAttempt: this.retryAttempt, retryAt: this.retryAt, connection: this.connection, username: this.username, leavingChannels: [...this.departing],
      error: this.error || view?.error || null, room: view?.room || null,
      pending: view?.pending || null, messageStartIndex: view ? view.totalMessages - view.messages.length + 1 : 1, messages: view?.messages || [],
      rooms: [...this.views.values()].map(v => ({ id: v.room.id, epoch: v.room.epoch, channel: v.room.channel, joined: v.room.joined, unread: v.unread, mentions: v.mentions, pending: v.pending, error: v.error }))
    }
  }
  private publish() {
    if (this.batching) { this.dirty = true; return }
    this.emit('state', structuredClone(this.state))
  }
  private clearLoginTimer() { if (this.loginTimer) clearTimeout(this.loginTimer); this.loginTimer = null }
  private clearTimer(view: RoomView) { if (view.timer) clearTimeout(view.timer); view.timer = null }
  private note(view: RoomView, text: string, kind: Message['kind'] = 'system', sender = '系統', delivery?: 'unconfirmed') {
    view.totalMessages++
    view.messages.push({ id: ++this.nextMessage, time: new Date().toISOString(), kind, sender: redact(sender), text: redact(text), ...(delivery ? { delivery } : {}) })
    this.emit('message', { roomId: view.room.id, roomEpoch: view.room.epoch, message: { ...view.messages.at(-1)! } })
    if (view.messages.length > 1000) view.messages = view.messages.slice(-1000)
    if (view.room.id !== this.selected && kind !== 'self') {
      view.unread = Math.min(999, view.unread + 1)
      const nick = this.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('_', '[ _]')
      if (kind !== 'system' && new RegExp(`(^|[^a-z0-9_])${nick}($|[^a-z0-9_])`, 'i').test(text)) view.mentions = Math.min(999, view.mentions + 1)
    }
  }
  private send(line: string) {
    if (!this.socket || this.socket.destroyed || /[\r\n\0]/.test(line) || Buffer.byteLength(line) > 510) throw new Error('無法送出此請求。')
    if (this.socket.writableLength > 65536) throw new Error('連線傳送緩衝已滿，請稍後再試。')
    this.socket.write(line + '\r\n')
  }
  private disconnect() {
    this.mpPreview = null
    if (this.creation.status === 'awaiting') this.creationUnknown('開房時連線中斷，結果不明。請核對既有房間；不會自動重送。')
    if (this.creationTimer) clearTimeout(this.creationTimer)
    this.creationTimer = null; this.creationName = null
    this.generation++
    for (const timer of this.freshTimers.values()) clearTimeout(timer)
    this.freshTimers.clear()
    this.clearLoginTimer()
    for (const timer of [this.retryTimer, this.stableTimer, this.pongTimer, this.workTimer]) if (timer) clearTimeout(timer)
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.retryTimer = this.stableTimer = this.pongTimer = this.workTimer = null
    this.heartbeat = null; this.pingToken = null; this.work = []; this.retryAt = null
    this.socket?.destroy(); this.socket = null; this.departing.clear()
    for (const view of this.views.values()) {
      this.clearTimer(view); view.pending = null; view.collector = null; view.refsHeader = false
      view.joinSent = false; view.needsSync = true; view.room.epoch = ++this.roomEpoch; view.room.joined = false
      view.room.binding = 'unknown'; view.room.referee = 'unknown'
      Object.assign(view.room, blankObservation(), { syncState: 'stale', name: null, mode: null, players: null, members: [] })
    }
  }
  logout() {
    this.disconnect()
    this.views.clear(); this.selected = null
    if (this.auth) this.auth.password = ''
    this.auth = null; this.retryAttempt = 0
    this.connection = 'offline'; this.username = ''; this.error = null
    this.creation = { status: 'unreviewed', requestId: '', roomId: null, message: null }
    this.lastQueryAt = 0; this.publish()
  }
  private fail(message: string) { this.logout(); this.connection = 'error'; this.error = message; this.publish() }
  private lost(message: string) {
    if (!this.auth || this.connection === 'suspended') return
    this.disconnect(); this.error = message
    for (const view of this.views.values()) this.note(view, '連線中斷；聊天與操作不會重送，房間狀態需重新核對。')
    if (this.retryAttempt >= 5) { this.connection = 'error'; this.publish(); return }
    const delay = Math.min(this.timing.retryBaseMs * 2 ** this.retryAttempt, this.timing.retryMaxMs)
    this.retryAttempt++; this.connection = 'reconnecting'
    this.retryAt = new Date(Date.now() + delay).toISOString()
    const generation = this.generation
    this.retryTimer = setTimeout(() => { if (generation === this.generation && this.auth) this.connect() }, delay)
    this.publish()
  }
  retry() {
    if (!this.auth || this.connection !== 'error') throw new Error('請重新輸入帳號與 IRC 密碼。')
    this.retryAttempt = 0; this.connect()
  }
  suspend() {
    if (!this.auth) return
    this.disconnect(); this.connection = 'suspended'; this.error = '電腦休眠，已暫停連線。'; this.publish()
  }
  resume() { if (this.auth && this.connection === 'suspended') { this.retryAttempt = 0; this.connect() } }
  login(input: unknown) {
    const auth = credentials(input)
    this.logout(); this.auth = auth; this.username = auth.username; this.connect()
  }
  private connect() {
    if (!this.auth) return
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null; this.retryAt = null
    this.connection = this.views.size ? 'reconnecting' : 'connecting'; this.publish()
    const generation = this.generation
    const lines = new Lines()
    let socket: net.Socket
    try { socket = this.createSocket() } catch { this.lost('無法建立連線，稍後重試。'); return }
    this.socket = socket
    const current = () => generation === this.generation && socket === this.socket
    this.loginTimer = setTimeout(() => { if (current()) this.lost('登入逾時，正在嘗試恢復連線。') }, this.timing.loginMs)
    socket.once('connect', () => {
      if (!current() || !this.auth) return
      try {
        this.send('PASS ' + this.auth.password)
        this.send('NICK ' + this.username); this.send(`USER ${this.username} 0 * :OCLR-ref-tools`)
      } catch { if (current()) this.lost('登入連線失敗，正在重試。') }
    })
    socket.on('data', chunk => {
      if (!current()) return
      this.batching = true
      try { for (const line of lines.feed(chunk)) { if (!current()) break; this.receive(line) } }
      catch { if (current()) this.fail('伺服器回覆無法安全讀取，已停止連線。') }
      finally { this.batching = false; if (this.dirty) { this.dirty = false; this.publish() } }
    })
    socket.on('error', () => { if (current()) this.lost('網路連線失敗，正在嘗試恢復。') })
    socket.on('close', () => { if (current()) this.lost('連線已中斷，正在嘗試恢復。') })
    socket.setTimeout(180000, () => { if (current()) this.lost('連線長時間沒有回應。') })
  }
  private online() {
    this.clearLoginTimer(); this.connection = 'online'; this.error = null
    this.prepareCreation()
    this.emit('authenticated')
    const generation = this.generation
    this.stableTimer = setTimeout(() => { if (generation === this.generation) { this.retryAttempt = 0; this.publish() } }, this.timing.stableMs)
    this.heartbeat = setInterval(() => {
      if (generation !== this.generation || this.pingToken) return
      this.pingToken = `oclr-${generation}-${Date.now()}`
      try { this.send('PING :' + this.pingToken) } catch { this.lost('心跳傳送失敗。'); return }
      this.pongTimer = setTimeout(() => { if (generation === this.generation) this.lost('心跳回覆逾時。') }, this.timing.heartbeatTimeoutMs)
    }, this.timing.heartbeatMs)
    for (const view of this.views.values()) if (view.restore) {
      if (view.room.kind === 'private') { view.room.joined = true; continue }
      view.pending = 'join'; this.enqueue(view, 'join')
    }
    this.publish()
  }
  private enqueue(view: RoomView, kind: 'join' | 'settings' | 'listrefs' | 'part') {
    if (!this.work.some(job => job.view === view && job.kind === kind)) this.work.push({ view, kind, epoch: view.room.epoch })
    this.pump()
  }
  private pump() {
    if (this.workTimer || this.connection !== 'online' || !this.work.length) return
    this.workTimer = setTimeout(() => {
      this.workTimer = null
      if (this.connection !== 'online') return
      if (Date.now() - this.lastQueryAt < this.timing.floodMs) { this.pump(); return }
      const job = this.work.shift()
      if (!job) return
      const { view, kind } = job
      if (kind === 'part') {
        if (this.departing.has(view.room.channel)) { try { this.send('PART ' + view.room.channel); this.lastQueryAt = Date.now() } catch { this.lost('離開頻道時連線中斷。'); return } }
        this.pump(); return
      }
      if (this.views.get(view.room.id) !== view || view.room.epoch !== job.epoch || !view.restore) { this.pump(); return }
      if (kind !== 'join' && view.pending) { this.work.push(job); this.workTimer = setTimeout(() => { this.workTimer = null; this.pump() }, 50); return }
      try {
        if (kind === 'join') {
          this.send('JOIN ' + view.room.channel); view.joinSent = true; this.lastQueryAt = Date.now()
          this.timeout(view, '加入房間逾時，請手動重新加入。')
        } else if (view.room.joined) this.query({ roomId: view.room.id, roomEpoch: view.room.epoch, kind })
      } catch { view.error = '重新同步未完成，請手動查詢。' }
      this.publish(); this.pump()
    }, Math.max(0, this.timing.floodMs - (Date.now() - this.lastQueryAt)))
  }
  private target(input: unknown): RoomView {
    if (!input || typeof input !== 'object') throw new Error('無效的房間請求。')
    const { roomId: id, roomEpoch } = input as Record<string, unknown>
    const view = typeof id === 'number' ? this.views.get(id) : undefined
    if (!view || roomEpoch !== view.room.epoch) throw new Error('房間已切換或關閉，請確認目標後重新操作。')
    return view
  }
  selectRoom(input: unknown) {
    this.mpPreview = null
    const view = this.target(input)
    this.selected = view.room.id; view.unread = 0; view.mentions = 0; this.publish()
  }
  leaveRoom(input: unknown) {
    const view = this.target(input)
    // PART only leaves this account's channel; it is never !mp close.
    const part = this.connection === 'online' && view.room.kind !== 'private' && (view.room.joined || view.joinSent)
    if (part) {
      this.departing.add(view.room.channel)
      if (this.departing.size > 32) { this.fail('過多離開請求尚未確認，已中斷連線。請重新登入。'); return }
    }
    this.clearFresh(view); this.clearTimer(view); view.restore = false; this.work = this.work.filter(job => job.view !== view); this.views.delete(view.room.id)
    if (part) this.enqueue(view, 'part')
    if (this.selected === view.room.id) {
      this.selected = this.views.keys().next().value ?? null
      const next = this.selected === null ? undefined : this.views.get(this.selected)
      if (next) { next.unread = 0; next.mentions = 0 }
    }
    this.publish()
  }
  join(input: unknown) {
    if (this.connection !== 'online') throw new Error('請先登入 osu! IRC。')
    const id = roomId(input)
    if (this.departing.has(`#mp_${id}`)) throw new Error('正在等待離開房間確認，請稍後再加入；持續未確認時請重新登入。')
    const existing = this.views.get(id)
    if (existing?.room.joined || existing?.pending === 'join') {
      this.selectRoom({ roomId: id, roomEpoch: existing.room.epoch }); return
    }
    if (!existing && this.views.size >= this.roomLimit()) throw new Error('最多同時開啟 8 個房間；開房中會預留一個分頁，請先離開不需要的分頁。')
    if (existing) { this.clearTimer(existing); this.clearFresh(existing) }
    const view: RoomView = {
      room: { ...blankObservation(), kind: 'match', members: [], id, epoch: ++this.roomEpoch, channel: `#mp_${id}`, joined: false, binding: 'unknown', referee: 'unknown', name: null, mode: null, players: null },
      joinSent: false, needsSync: false, restore: true, collector: null, pending: 'join', error: null, totalMessages: 0, messages: [], unread: 0, mentions: 0, refsHeader: false, timer: null
    }
    this.views.set(id, view); this.selected = id
    this.note(view, '正在加入房間…')
    this.enqueue(view, 'join')
    this.publish()
  }
  openConversation(input: unknown) {
    if (this.connection !== 'online') throw new Error('請先登入 osu! IRC。')
    if (!input || typeof input !== 'object') throw new Error('無效的對話。')
    const { kind, name: raw } = input as Record<string, unknown>
    if (typeof raw !== 'string' || !['channel', 'private'].includes(String(kind))) throw new Error('無效的對話。')
    const name = kind === 'private' ? raw.trim().replaceAll(' ', '_') : raw.trim().toLowerCase()
    if (kind === 'channel' ? !/^#[a-zA-Z0-9_-]{1,64}$/.test(name) : !/^[a-zA-Z0-9_\[\]-]{1,32}$/.test(name)) throw new Error('請輸入有效的頻道或 osu! 使用者名稱。')
    if (/^#mp_/i.test(name)) { this.join(name.slice(4)); return }
    if (this.departing.has(name)) throw new Error('正在等待離開頻道確認，請稍後再加入。')
    // BanchoBot private messages can execute commands without !mp. Keep them read-only.
    const existing = [...this.views.values()].find(v => normalize(v.room.channel) === normalize(name))
    if (existing?.room.joined || existing?.pending === 'join') { this.selectRoom({ roomId: existing.room.id, roomEpoch: existing.room.epoch }); return }
    if (!existing && this.views.size >= this.roomLimit()) throw new Error('最多同時開啟 8 個對話；開房中會預留一個分頁，請先關閉不需要的分頁。')
    if (existing) { this.clearTimer(existing); this.views.delete(existing.room.id) }
    const id = this.nextLocalId--
    const view: RoomView = {
      room: { ...blankObservation(), kind: kind as 'channel' | 'private', members: [], id, epoch: ++this.roomEpoch, channel: name, joined: kind === 'private', binding: 'unknown', referee: 'unknown', name: null, mode: null, players: null },
      joinSent: false, needsSync: false, restore: true, collector: null, pending: kind === 'channel' ? 'join' : null, error: null, totalMessages: 0, messages: [], unread: 0, mentions: 0, refsHeader: false, timer: null
    }
    this.views.set(id, view); this.selected = id
    if (kind === 'channel') this.enqueue(view, 'join')
    this.publish()
  }
  private roomLimit() { return MAX_ROOMS - (this.creation.status === 'awaiting' ? 1 : 0) }
  setCreationStore(store: CreationStore) { this.creationStore = store }
  private prepareCreation() {
    this.creationName = null
    try {
      if (!this.creationStore) throw new Error('No recovery store')
      const record = this.creationStore.latest()
      this.previousCreationId = record?.id ?? null
      this.creation = { status: 'unreviewed', requestId: randomUUID(), roomId: record?.roomId ?? null,
        message: record?.status === 'pending' ? '上次開房結果不明。請先核對 BanchoBot 訊息及既有房間，避免重複建立。' : null }
    } catch {
      this.creation = { status: 'blocked', requestId: '', roomId: null, message: '無法讀取開房防重送記錄。請檢查本機儲存後重新登入；目前禁止開房。' }
    }
  }
  private creationUnknown(message: string) {
    if (this.creationTimer) clearTimeout(this.creationTimer)
    this.creationTimer = null; this.creationName = null
    this.creation = { ...this.creation, status: 'unknown', message: [message, this.creation.message?.startsWith('BanchoBot：') ? this.creation.message : null].filter(Boolean).join(' ') }
    this.publish()
  }
  createRoom(input: unknown) {
    if (this.connection !== 'online') throw new Error('請先登入 osu! IRC。')
    if (!input || typeof input !== 'object') throw new Error('無效的開房請求。')
    const { name: raw, requestId, reviewed } = input as Record<string, unknown>
    const name = matchName(raw)
    if (this.creation.status !== 'unreviewed' && this.creation.status !== 'created') throw new Error('開房尚未確認或已鎖定。請先核對既有房間，再重新連線。')
    if (!requestId || requestId !== this.creation.requestId || reviewed !== true) throw new Error('請重新開啟表單，確認既有房間與本次開房意圖。')
    if (this.views.size >= MAX_ROOMS) throw new Error('最多同時開啟 8 個對話，請先關閉一個分頁再開房。')
    if (Date.now() - this.lastQueryAt < this.timing.floodMs || this.work.length || this.workTimer) throw new Error('請等待目前房間請求完成，再建立房間。')
    try {
      if (!this.creationStore) throw new Error('No recovery store')
      this.creationStore.begin(this.creation.requestId, this.previousCreationId)
    } catch {
      this.creation = { ...this.creation, status: 'blocked', message: '無法保存開房記錄，或其他視窗已開房。本次指令未送出，請重新登入後核對。' }
      this.publish(); throw new Error(this.creation.message!)
    }
    this.creationName = name
    this.creation = { ...this.creation, status: 'awaiting', roomId: null, message: null }
    this.lastQueryAt = Date.now()
    // Persist before any socket write. A write error is ambiguous, never an invitation to retry.
    try { this.send(`PRIVMSG BanchoBot :!mp make ${name}`) }
    catch { this.creationUnknown('開房傳送未能確認，結果不明。請核對既有房間，再重新連線。'); throw new Error(this.creation.message!) }
    const generation = this.generation
    this.creationTimer = setTimeout(() => {
      if (generation === this.generation && this.creation.status === 'awaiting') this.creationUnknown('開房回覆逾時，結果不明。請核對 BanchoBot 訊息與既有房間，再登出並重新登入；不會自動重送。')
    }, this.timing.creationMs)
    this.publish()
  }
  private creationReply(body: string) {
    if (this.creation.status !== 'awaiting') return false
    this.creation.message = `BanchoBot：${redact(body)}`
    const match = /^Created the tournament match (https:\/\/osu\.ppy\.sh\/(?:mp|community\/matches)\/[1-9]\d*) (.+)$/.exec(body)
    const id = match ? Number(match[1].split('/').at(-1)) : NaN
    // Bancho has no operation ID. Match only this connection's one intent and exact requested name.
    if (!match || !Number.isSafeInteger(id) || match[2] !== this.creationName || this.views.has(id) || this.departing.has(`#mp_${id}`)) { this.publish(); return true }
    if (this.creationTimer) clearTimeout(this.creationTimer)
    this.creationTimer = null; this.creationName = null
    const operationId = this.creation.requestId
    this.creation = { status: 'created', requestId: randomUUID(), roomId: id, message: `已建立比賽房間 ${id}。` }
    try { this.creationStore!.complete(operationId, id); this.previousCreationId = operationId }
    catch { this.creation = { ...this.creation, status: 'blocked', message: `房間 ${id} 已建立，但防重送記錄更新失敗；禁止再次開房，請核對後重新登入。` } }
    this.join(String(id))
    const view = this.views.get(id)!
    view.needsSync = true
    this.note(view, `BanchoBot 已確認建立房間 ${id}；權限與設定仍需查詢核對。`)
    this.publish(); return true
  }
  private timeout(view: RoomView, message: string) {
    this.clearTimer(view)
    const generation = this.generation
    view.timer = setTimeout(() => {
      if (generation !== this.generation || this.views.get(view.room.id) !== view) return
      if (view.collector) { view.collector.apply(view.room, true); this.expire(view); view.collector = null }
      view.timer = null; view.pending = null; view.refsHeader = false; view.error = message
      this.note(view, message); this.publish()
    }, this.timing.queryMs)
  }
  private clearFresh(view: RoomView) {
    const timer = this.freshTimers.get(view)
    if (timer) clearTimeout(timer)
    this.freshTimers.delete(view)
  }
  private expire(view: RoomView) {
    this.clearFresh(view)
    this.freshTimers.set(view, setTimeout(() => {
      this.freshTimers.delete(view)
      if (this.views.get(view.room.id) !== view) return
      view.room.syncState = 'stale'; this.publish()
    }, 10000))
  }
  private ready(view: RoomView) {
    if (this.connection !== 'online' || !view.room.joined) throw new Error('請先加入可用的比賽房間。')
    if (view.pending || Date.now() - this.lastQueryAt < this.timing.floodMs) throw new Error('請稍候再查詢或送出訊息。')
  }
  query(input: unknown) {
    const view = this.target(input)
    const { kind } = input as Record<string, unknown>
    if (kind !== 'settings' && kind !== 'listrefs') throw new Error('初版僅提供讀取設定與裁判名單。')
    if (view.room.kind !== 'match') throw new Error('此分頁不是比賽房間。')
    this.ready(view)
    this.send(`PRIVMSG ${view.room.channel} :!mp ${kind}`); this.lastQueryAt = Date.now()
    view.pending = kind; view.error = null; view.refsHeader = false
    if (kind === 'settings') { this.clearFresh(view); view.collector = new SettingsCollector(view.room.id); Object.assign(view.room, blankObservation(), { syncState: 'loading' }); view.room.binding = 'unknown'; view.room.name = null; view.room.mode = null; view.room.players = null }
    else { view.room.referee = 'unknown'; this.refereeSeen.delete(view) }
    this.note(view, `!mp ${kind}`, 'self', this.username)
    this.timeout(view, '尚未收到完整回覆；請稍後重新查詢，不代表沒有權限。'); this.publish()
  }
  private mpReady(view: RoomView) {
    this.ready(view)
    const room = view.room
    if (room.kind !== 'match' || this.selected !== room.id || room.binding !== 'verified') throw new Error('請先選取並核對比賽房間。')
    if (room.syncState !== 'complete' || !room.observedAt || Date.now() - Date.parse(room.observedAt) >= 10000) throw new Error('請先重新讀取完整房間設定。')
    if (room.referee !== 'listed' || performance.now() - (this.refereeSeen.get(view) ?? -Infinity) >= 60000) throw new Error('請先重新讀取裁判名單，確認你的裁判權限。')
  }
  previewMp(input: unknown) {
    this.mpPreview = null
    const view = this.target(input)
    this.mpReady(view)
    const command = mpCommand((input as Record<string, unknown>).intent)
    if (command !== '!mp abort' && (view.room.phase === 'playing' || view.room.slots.some(slot => /^playing$/i.test(slot.status)))) throw new Error('比賽進行中，請先核對或中止比賽。')
    if (command === '!mp start' && !view.room.slots.length) throw new Error('房內沒有玩家，不能開始比賽。')
    const token = randomUUID()
    this.mpPreview = { token, command, view, fingerprint: JSON.stringify(view.room), deadline: performance.now() + 10000 }
    return { token, command, channel: view.room.channel, expiresAt: new Date(Date.now() + 10000).toISOString() }
  }
  executeMp(input: unknown) {
    const preview = this.mpPreview
    this.mpPreview = null // Consume before every attempt, including validation and transport failure.
    const view = this.target(input)
    const value = input as Record<string, unknown>
    if (!preview || value.token !== preview.token || value.reviewed !== true || preview.view !== view || performance.now() >= preview.deadline || JSON.stringify(view.room) !== preview.fingerprint) throw new Error('確認已失效或房間狀態已變更，請重新預覽。')
    this.mpReady(view)
    this.clearFresh(view)
    view.room.syncState = 'stale'; view.room.referee = 'unknown'; this.refereeSeen.delete(view)
    this.lastQueryAt = Date.now()
    this.note(view, preview.command, 'self', this.username, 'unconfirmed')
    this.note(view, '房內操作已嘗試送出，結果未確認；請核對 BanchoBot 回覆，再讀取設定與裁判名單。不會自動重送。')
    try { this.send(`PRIVMSG ${view.room.channel} :${preview.command}`) }
    finally { this.publish() }
  }
  relayReady(input: RoomTarget) { try { this.mpReady(this.target(input)); return true } catch { return false } }
  relayRefresh(input: RoomTarget) {
    const view = this.target(input)
    if (this.connection !== 'online' || !view.room.joined || view.room.kind !== 'match' || this.selected !== view.room.id) throw new Error('請先加入並選取比賽房間。')
    this.enqueue(view, 'settings'); this.enqueue(view, 'listrefs')
  }
  relaySend(input: RoomTarget & { text: string }) {
    const view = this.target(input)
    const text = relayCommand(input.text)
    this.mpReady(view)
    if (/^!mp (?:map|mods|set|start)\b/.test(text) && (view.room.phase === 'playing' || view.room.slots.some(slot => /^playing$/i.test(slot.status)))) throw new Error('比賽進行中，請先核對或中止比賽。')
    this.lastQueryAt = Date.now()
    this.clearFresh(view); view.room.syncState = 'stale'
    this.note(view, text, 'self', this.username, 'unconfirmed')
    try { this.send(`PRIVMSG ${view.room.channel} :${text}`) }
    finally { this.enqueue(view, 'settings'); this.enqueue(view, 'listrefs'); this.publish() }
  }
  chat(input: unknown) {
    const view = this.target(input)
    const { text: value } = input as Record<string, unknown>
    if (view.room.kind === 'private' && normalize(view.room.channel) === 'banchobot') throw new Error('BanchoBot 私訊僅供讀取。')
    const text = chatText(value, view.room.channel)
    this.ready(view)
    this.send(`PRIVMSG ${view.room.channel} :${text}`); this.lastQueryAt = Date.now()
    this.note(view, text, 'self', this.username, 'unconfirmed'); view.error = null; this.publish()
  }
  private unavailable(view: RoomView, message: string) {
    this.clearFresh(view); this.clearTimer(view); view.restore = false; view.collector = null; view.refsHeader = false; view.pending = null
    Object.assign(view.room, blankObservation())
    view.room.joined = false; view.room.binding = 'unknown'; view.room.referee = 'unknown'
    view.room.name = null; view.room.mode = null; view.room.players = null
    view.error = message; this.note(view, message); this.publish()
  }
  private receive(line: string) {
    const message = parse(line)
    if (!message) return
    const { prefix, command, params } = message
    const sender = prefix.split('!')[0]
    const self = normalize(sender) === normalize(this.username)
    const ownTarget = normalize(params[0] || '') === normalize(this.username)
    if (command === 'PING' && params.length) { this.send('PONG :' + params.at(-1)); return }
    if (command === '001' && ownTarget && (this.connection === 'connecting' || this.connection === 'reconnecting')) { this.online(); return }
    if (command === 'PONG' && params.at(-1) === this.pingToken) { if (this.pongTimer) clearTimeout(this.pongTimer); this.pongTimer = null; this.pingToken = null; return }
    if (['464', '433', '432'].includes(command) && (ownTarget || params[0] === '*')) {
      this.fail(command === '464' ? '登入失敗。請使用 osu! 帳號設定中的 IRC 專用密碼。' : '使用者名稱無法登入，請確認名稱後重試。'); return
    }
    if (command === 'ERROR' || command === 'QUIT' && self) { this.lost('伺服器已中斷連線，正在嘗試恢復。'); return }
    if (command === 'PART' && self && this.departing.delete(params[0])) { this.publish(); return }
    if ((command === 'QUIT' || command === 'NICK') && !self) {
      for (const view of this.views.values()) view.room.members = view.room.members.flatMap(n => normalize(n) !== normalize(sender) ? [n] : command === 'NICK' && /^[a-zA-Z0-9_\[\]-]{1,32}$/.test(params[0] || '') ? [params[0]] : [])
      this.publish(); return
    }
    if (command === 'PRIVMSG' && params.length === 2 && ownTarget && normalize(sender) === 'banchobot' && this.creationReply(params[1])) return
    // Unsolicited private messages may open a bounded tab, never change selection.
    if (command === 'PRIVMSG' && ownTarget && this.connection === 'online' && this.views.size < this.roomLimit() && ![...this.views.values()].some(v => normalize(v.room.channel) === normalize(sender))) {
      const selected = this.selected
      try { this.openConversation({ kind: 'private', name: sender }); this.selected = selected ?? this.selected } catch { /* Invalid remote target is ignored. */ }
    }
    // Resolve only the protocol's target field, never a channel-looking string in body text.
    const channel = ['353'].includes(command) ? params[2] : /^\d{3}$/.test(command) ? params[1] : params[0]
    const target = command === 'PRIVMSG' && ownTarget ? sender : channel
    const view = [...this.views.values()].find(v => normalize(v.room.channel) === normalize(target || ''))
    if (!view) return
    const room = view.room
    if ((command === 'KICK' && normalize(params[1] || '') === normalize(this.username)) || (command === 'PART' && self)) {
      this.unavailable(view, '已離開或被移出房間，請確認房間後重新加入。'); return
    }
    if (command === '401' && ownTarget && room.kind === 'private') { this.unavailable(view, '此使用者目前無法接收私訊，請核對名稱後重新開啟對話。'); return }
    if (['403', '404', '405', '471', '473', '474', '475'].includes(command) && ownTarget) {
      this.unavailable(view, command === '403' ? '找不到開放中的房間。請確認 MP 編號，或改用新的比賽房間。' : '目前無法加入或讀取此房間，請核對房間與帳號權限。'); return
    }
    if ((command === 'JOIN' && self || command === '366' && ownTarget) && view.pending === 'join') {
      this.clearTimer(view); view.pending = null; room.joined = true
      this.note(view, '已加入頻道。房間狀態需以新查詢核對。')
      if (view.needsSync && room.kind === 'match') { view.needsSync = false; this.enqueue(view, 'settings'); this.enqueue(view, 'listrefs') }
      this.publish(); return
    }
    if (command === '353' && ownTarget) {
      room.members = [...new Set([...room.members, ...(params[3] || '').split(' ').map(n => n.replace(/^[@+%&~]+/, '')).filter(n => /^[a-zA-Z0-9_\[\]-]{1,32}$/.test(n))])].slice(0, 1000)
      this.publish(); return
    }
    if (command === 'JOIN' && !self) { if (!room.members.some(n => normalize(n) === normalize(sender)) && room.members.length < 1000) room.members.push(sender); this.publish(); return }
    if (command === 'PART' || command === 'KICK') { room.members = room.members.filter(n => normalize(n) !== normalize(command === 'KICK' ? params[1] : sender)); this.publish(); return }
    if (command !== 'PRIVMSG' || params.length !== 2) return
    const body = params[1]; const bot = normalize(sender) === 'banchobot'
    this.note(view, body, bot ? 'bot' : self ? 'self' : 'chat', sender)
    const observing = bot && view.pending === 'settings'
    const readingRefs = bot && view.pending === 'listrefs'
    if (observing) {
      if (view.collector?.feed(body)) {
        view.collector.apply(room); this.expire(view); view.collector = null; this.clearTimer(view); view.pending = null
      }
    } else if (bot && view.pending === 'listrefs') {
      const header = /^(?:Match referees|Referees):\s*(.*)$/.exec(body)
      if (header) view.refsHeader = true
      const names = header ? header[1].split(',') : view.refsHeader ? [body] : []
      if (names.some(name => normalize(name.trim()) === normalize(this.username))) {
        this.refereeSeen.set(view, performance.now()); room.referee = 'listed'; this.clearTimer(view); view.pending = null; view.refsHeader = false
      }
    }
    if (bot && !observing && !readingRefs && room.syncState !== 'unknown') room.syncState = 'stale'
    if (bot && view.pending !== 'settings' && /^(?:Beatmap changed|Changed (?:match|team|win)|Active mods:|.+ (?:joined in slot|left the game|moved to slot|changed to)|The match has (?:started|finished)|Aborted the match)/.test(body)) {
      room.syncState = 'stale'
      if (body.startsWith('The match has started')) room.phase = 'playing'
      else if (/^(?:The match has finished|Aborted the match)/.test(body)) room.phase = 'idle'
      else { room.phase = 'unknown'; if (room.kind === 'match' && room.joined) this.enqueue(view, 'settings') }
    }
    this.publish()
  }
}
