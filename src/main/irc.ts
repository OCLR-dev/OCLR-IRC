import { isBpNotice } from '../shared/bp-notice.ts'
import { ManualPool } from './manual-pool.ts'
import { roomPlan, roomPlanMatches } from '../shared/room-plan.ts'
import type { RoomPlanDefinition, RoomPlanPreview } from '../shared/room-plan.ts'
import { lobbyIntent, lobbyCommand } from '../shared/lobby-command.ts'
import type { LobbyIntent, LobbyPreview } from '../shared/lobby-command.ts'
import { OperationPlan } from './operation-plan.ts'
import { mapProfile, profileCommands } from '../shared/map-profile.ts'
import type { MapProfile, MapPlanPreview } from '../shared/map-profile.ts'
import { Operations } from './operations.ts'
import type { OperationStore } from './operation-store.ts'
import { countdownEvent } from '../shared/countdown.ts'
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
  private creationSource: 'manual' | 'oclr' = 'manual'
  private mpPreview: { token: string; command: string; view: RoomView; fingerprint: string; deadline: number } | null = null
  private durationLookup: (id: number) => Promise<number | null>
  private durationRequests = new WeakMap<RoomView, string>()
  private settingsEvidence = new WeakMap<RoomView, ReturnType<SettingsCollector['observations']>>()
  private refereeSeen = new WeakMap<RoomView, number>()
  private creationJoins = new Set<string>()
  private creationTimer: ReturnType<typeof setTimeout> | null = null

  private lobbyPreview: { source: 'manual' | 'oclr'; command: string; playerName?: string; token: string; intent: LobbyIntent; view: RoomView; fingerprint: string; deadline: number } | null = null
  private roomPlan: OperationPlan | null = null
  private roomPlanPreview: { definition: RoomPlanDefinition; view: RoomView; token: string; fingerprint: string; deadline: number } | null = null
  private manualPool = new ManualPool()
  private appliedPoolRevision: string | null = null
  private mapPlan: OperationPlan | null = null
  private appliedProfile: MapProfile | null = null
  private profilePreview: { poolRevision?: string; token: string; profile: MapProfile; view: RoomView; fingerprint: string; deadline: number } | null = null
  private operations = new Operations(() => this.publish())
  private creationOperation: string | null = null
  setOperationStore(store: OperationStore) { this.operations.setStore(store) }
  clearWebsiteOperations() { this.operations.clearWebsite(); this.cancelWebsiteInvite() }
  cancelWebsiteInvite(token?: string) { if (this.lobbyPreview?.source === 'oclr' && (!token || token === this.lobbyPreview.token)) this.lobbyPreview = null }
  reviewOperation(input: unknown) { if ((input as { id?: string })?.id === this.mapPlan?.state.id) this.mapPlan?.cancel(); if ((input as { id?: string })?.id === this.roomPlan?.state.id) this.roomPlan?.cancel(); this.operations.review(input) }
  constructor(createSocket = () => net.createConnection({ host: 'irc.ppy.sh', port: 6667 }), timing: Partial<Timing> = {}, durationLookup: (id: number) => Promise<number | null> = async () => null) {
    super()
    this.durationLookup = durationLookup
    this.createSocket = createSocket
    this.timing = { ...defaults, ...timing }
  }
  get state(): Snapshot {
    const view = this.selected === null ? undefined : this.views.get(this.selected)
    return {
      manualPool: this.manualPool.state,
      roomPlan: this.roomPlan?.state ?? null,
      mapPlan: this.mapPlan?.state ?? null,
      operations: this.operations.snapshot,
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
  private note(view: RoomView, text: string, kind: Message['kind'] = 'system', sender = '系統', delivery?: Message['delivery']) {
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
  get sessionGeneration() { return this.generation }
  /** Main-only access for opt-in encrypted persistence; never exposed over IPC. */
  get authenticatedCredentials() { return this.connection === 'online' && this.auth ? { ...this.auth } : null }
  private disconnect() {
    this.roomPlan?.cancel(); this.roomPlanPreview = null; this.mapPlan?.cancel(); this.profilePreview = null; this.lobbyPreview = null
    this.operations.interrupt()
    this.creationJoins.clear()
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
  logout(preserveRecovery = false) {
    this.disconnect()
    this.operations.logout(preserveRecovery)
    this.manualPool.clear(); this.appliedPoolRevision = null; this.roomPlan = null; this.mapPlan = null; this.appliedProfile = null
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
        this.send('NICK ' + this.username); this.send(`USER ${this.username} 0 * :OCLR IRC`)
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
    this.operations.authenticate(this.username)
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
    this.operations.interrupt(view.room.id)
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
      const record = this.creationStore.latest(this.username)
      this.previousCreationId = record?.id ?? null
      this.creation = { status: 'unreviewed', requestId: randomUUID(), roomId: record?.roomId ?? null,
        message: record?.legacy ? '舊版開房記錄無法確認帳號歸屬，請先核對既有房間；不會自動重送。' : record?.status === 'pending' ? '上次開房結果不明。請先核對 BanchoBot 訊息及既有房間，避免重複建立。' : null }
    } catch {
      this.creation = { status: 'blocked', requestId: '', roomId: null, message: '無法讀取開房防重送記錄。請檢查本機儲存後重新登入；目前禁止開房。' }
    }
  }
  private creationUnknown(message: string) {
    if (this.creationOperation) this.operations.finish(this.creationOperation, 'unknown')
    this.creationOperation = null
    this.creationJoins.clear()
    if (this.creationTimer) clearTimeout(this.creationTimer)
    this.creationTimer = null; this.creationName = null
    this.creation = { ...this.creation, status: 'unknown', message: [message, this.creation.message?.startsWith('BanchoBot：') ? this.creation.message : null].filter(Boolean).join(' ') }
    this.publish()
  }
  createRoom(input: unknown) { this.createRoomIntent(input, 'manual') }
  /** Main-only website entry point; the renderer cannot choose an operation source. */
  createWebsiteRoom(input: unknown, onDispatch?: () => void) { this.createRoomIntent(input, 'oclr', onDispatch) }
  private createRoomIntent(input: unknown, source: 'manual' | 'oclr', onDispatch?: () => void) {
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
      this.creationStore.begin(this.username, this.creation.requestId, this.previousCreationId)
      this.creationOperation = this.operations.begin(source, 'make', null, 0, this.generation, '!mp make')
    } catch {
      this.creation = { ...this.creation, status: 'blocked', message: '無法保存開房記錄，或其他視窗已開房。本次指令未送出，請重新登入後核對。' }
      this.publish(); throw new Error(this.creation.message!)
    }
    this.creationJoins.clear()
    this.creationName = name
    this.creationSource = source
    this.creation = { ...this.creation, status: 'awaiting', roomId: null, message: null }
    this.lastQueryAt = Date.now()
    // Persist before any socket write. A write error is ambiguous, never an invitation to retry.
    try {
      // Late/duplicate creation replies become private Bot chat after the intent
      // closes; they still contain website-derived names and must stay private.
      if (source === 'oclr') this.emit('private-conversation', 'BanchoBot')
      onDispatch?.(); this.send(`PRIVMSG BanchoBot :!mp make ${name}`)
    }
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
    try { this.creationStore!.complete(this.username, operationId, id); this.previousCreationId = operationId }
    catch { this.creation = { ...this.creation, status: 'blocked', message: `房間 ${id} 已建立，但防重送記錄更新失敗；禁止再次開房，請核對後重新登入。` } }
    // Quarantine before any room message, even if relay/context was stopped in flight.
    if (this.creationSource === 'oclr') this.emit('private-room', id)
    this.emit('room-created', { roomId: id, requestId: operationId, generation: this.generation, source: this.creationSource })
    if (this.creationOperation) this.operations.finish(this.creationOperation, 'observed', id)
    this.creationOperation = null
    this.join(String(id))
    const view = this.views.get(id)!
    view.needsSync = true
    if (this.creationJoins.has(view.room.channel)) this.confirmJoin(view)
    this.creationJoins.clear()
    this.note(view, `BanchoBot 已確認建立房間 ${id}；權限與設定仍需查詢核對。`)
    this.publish(); return true
  }
  private confirmJoin(view: RoomView) {
    this.clearTimer(view); view.pending = null; view.error = null; view.room.joined = true
    // Bancho may auto-join during make, before the queued JOIN is written.
    this.work = this.work.filter(job => job.view !== view || job.kind !== 'join')
    this.note(view, '已加入頻道。')
    if (view.needsSync && view.room.kind === 'match') {
      view.needsSync = false; this.enqueue(view, 'settings'); this.enqueue(view, 'listrefs')
    }
    this.publish()
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
  private loadDuration(view: RoomView) {
    const id = view.room.beatmap?.id, epoch = view.room.epoch, generation = this.generation
    const requestKey = `${generation}:${epoch}:${id}`
    if (!id || view.room.duration?.beatmapId === id || this.durationRequests.get(view) === requestKey) return
    this.durationRequests.set(view, requestKey)
    void this.durationLookup(id).then(milliseconds => {
      if (generation !== this.generation || epoch !== view.room.epoch || this.views.get(view.room.id) !== view || view.room.beatmap?.id !== id) return
      if (milliseconds !== null) { view.room.duration = { beatmapId: id, milliseconds }; this.publish() }
    })
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
    if (kind === 'settings') { this.settingsEvidence.delete(view); this.clearFresh(view); view.collector = new SettingsCollector(view.room.id, this.generation); Object.assign(view.room, blankObservation(), { syncState: 'loading', phase: view.room.phase, match: view.room.match, duration: view.room.duration, timer: view.room.timer, startCountdown: view.room.startCountdown }); view.room.binding = 'unknown'; view.room.name = null; view.room.mode = null; view.room.players = null }
    else { view.room.referee = 'unknown'; this.refereeSeen.delete(view) }
    this.note(view, `!mp ${kind}`, 'self', this.username)
    this.timeout(view, '尚未收到完整回覆；請稍後重新查詢，不代表沒有權限。'); this.publish()
  }
  private mpReady(view: RoomView, command = '', roomOnly = false) {
    this.ready(view)
    const room = view.room
    if (room.kind !== 'match' || this.selected !== room.id || room.binding !== 'verified') throw new Error('請先選取並核對比賽房間。')
    if (command.startsWith('!mp start') && this.appliedPoolRevision && this.appliedPoolRevision !== this.manualPool.state.revision) throw new Error('圖池已更新，請重新選圖並核對 Mods。')
    if (command.startsWith('!mp start') && this.mapPlan?.state.roomId === room.id && this.appliedProfile) {
      const p = this.appliedProfile, desired = [...p.roomMods, ...(p.freemod ? ['Freemod'] : [])].map(normalize).sort().join(',')
      if (this.mapPlan.state.state !== 'observed' || room.beatmap?.id !== Number(p.beatmapId) || room.mods === null || room.mods.map(normalize).sort().join(',') !== desired) throw new Error('選圖計畫尚未完成或地圖／Mods 已變更，請重新套用與核對。')
    }
    const timingOnly = /^!mp (?:timer |aborttimer$)/.test(command)
    const replacingMap = command.startsWith('!mp map ')
    const replacingMods = command.startsWith('!mp mods ')
    const replacingSettings = replacingMap || replacingMods || timingOnly || roomOnly
    if ((room.syncState !== 'complete' && !(replacingSettings && room.syncState === 'partial')) || !room.observedAt || Date.now() - Date.parse(room.observedAt) >= 10000) throw new Error('請先重新讀取完整房間設定。')
    const evidence = this.settingsEvidence.get(view)
    const required = evidence ? [evidence.name, evidence.mode, evidence.players, evidence.slots, ...(replacingMap || timingOnly || roomOnly ? [] : [evidence.beatmap]), ...(replacingSettings ? [] : [evidence.mods])] : []
    if (!evidence || !required.every(field =>
      field.knowledge === 'known' && field.connectionGeneration === this.generation && field.roomEpoch === room.epoch &&
      Number.isFinite(Date.parse(field.observedAt)) && Date.now() >= Date.parse(field.observedAt) && Date.now() - Date.parse(field.observedAt) < 10000
    )) throw new Error('房間觀測已失效，請重新讀取設定。')
    if (room.referee !== 'listed' || performance.now() - (this.refereeSeen.get(view) ?? -Infinity) >= 60000) throw new Error('請先重新讀取裁判名單，確認你的裁判權限。')
  }
  private mpFingerprint(room: Room) {
    const { timer: _timer, startCountdown, ...rest } = room
    return JSON.stringify({ ...rest, startCountdown: startCountdown?.status ?? null })
  }
  previewLobby(input: unknown): LobbyPreview { return this.previewLobbyIntent(input, 'manual') }
  /** Main-only, fixed invitation intent. No website command text is accepted from IPC. */
  previewWebsiteInvite(input: unknown): LobbyPreview { return this.previewLobbyIntent(input, 'oclr') }
  private previewLobbyIntent(input: unknown, source: 'manual' | 'oclr'): LobbyPreview {
    this.lobbyPreview = null
    const view = this.target(input), intent = lobbyIntent((input as { intent?: unknown }).intent)
    if (source === 'oclr' && intent.kind !== 'invite') throw new Error('無效的玩家邀請。')
    this.mpReady(view, '', true); this.profileIdle(view)
    if (this.mapPlan?.active || this.roomPlan?.active) throw new Error('請先停止目前的選圖計畫。')
    if (intent.kind === 'host' && !view.room.slots.some(slot => slot.osuId === Number(intent.osuId))) throw new Error('玩家不在目前已核對的槽位內。')
    let playerName: string | undefined
    if (['invite', 'move', 'team', 'kick'].includes(intent.kind) && 'osuId' in intent) {
      const slot = view.room.slots.find(player => player.osuId === Number(intent.osuId))
      if (intent.kind === 'invite') {
        if (slot) throw new Error('玩家已在目前房間內。')
        playerName = intent.name
      } else {
        if (!slot) throw new Error('玩家不在目前已核對的槽位內。')
        playerName = slot.username
      }
      if (intent.kind === 'move' && view.room.slots.some(player => player.slot === Number(intent.slot) && player.osuId !== Number(intent.osuId))) throw new Error('目標槽位已有其他玩家。')
      if (intent.kind === 'team' && !/^(?:TeamVs|TagTeamVs)\b/.test(view.room.mode ?? '')) throw new Error('目前不是已核對的分隊模式。')
    }
    const token = randomUUID()
    const command = source === 'oclr' && intent.kind === 'invite' ? relayCommand(`!mp invite ${intent.name.replace(/\s+/gu, '_')}`) : lobbyCommand(intent)
    this.lobbyPreview = { source, command, playerName, token, intent, view, fingerprint: this.mpFingerprint(view.room), deadline: performance.now() + 10000 }
    return { token, channel: view.room.channel, command, kind: intent.kind, ...(playerName ? { playerName } : {}), ...(intent.kind === 'password' ? { passwordMode: intent.mode } : {}), expiresAt: new Date(Date.now() + 10000).toISOString() }
  }
  executeLobby(input: unknown) { this.executeLobbyIntent(input, 'manual') }
  executeWebsiteInvite(input: unknown) { this.executeLobbyIntent(input, 'oclr') }
  private executeLobbyIntent(input: unknown, source: 'manual' | 'oclr') {
    const preview = this.lobbyPreview; this.lobbyPreview = null
    const view = this.target(input), value = input as Record<string, unknown>
    if (!preview || preview.source !== source || preview.view !== view || preview.token !== value.token || value.reviewed !== true || performance.now() >= preview.deadline || preview.fingerprint !== this.mpFingerprint(view.room) || this.mapPlan?.active || this.roomPlan?.active) throw new Error('房間設定確認已失效。')
    this.mpReady(view, '', true); this.profileIdle(view)
    if (preview.playerName !== undefined && value.playerName !== preview.playerName) throw new Error('請輸入預覽中的玩家名稱以確認身份。')
    if (preview.intent.kind === 'close' && value.closeRoom !== view.room.channel) throw new Error('請輸入完整頻道名稱以確認關房。')
    if (preview.intent.kind === 'password' && preview.intent.mode === 'set' && value.password === undefined) throw new Error('請輸入房間密碼。')
    const command = source === 'oclr' ? preview.command : lobbyCommand(preview.intent, value.password), masked = source === 'oclr' ? preview.command : lobbyCommand(preview.intent)
    if (Buffer.byteLength(`PRIVMSG ${view.room.channel} :${command}`, 'utf8') > 510) throw new Error('房間設定過長。')
    const id = this.operations.begin(source, preview.intent.kind, view.room.id, view.room.epoch, this.generation, masked)
    this.lastQueryAt = Date.now(); this.clearFresh(view); view.room.syncState = 'stale'; view.room.referee = 'unknown'; this.refereeSeen.delete(view)
    this.note(view, masked, 'self', this.username, 'unconfirmed')
    try { this.send(`PRIVMSG ${view.room.channel} :${command}`) } catch (error) { this.operations.finish(id, 'unknown'); throw error }
    finally { this.publish() }
  }
  previewRoomPlan(input: unknown): RoomPlanPreview {
    this.roomPlanPreview = null
    const view = this.target(input)
    this.mpReady(view, '', true); this.profileIdle(view)
    if (this.mapPlan?.active || this.roomPlan?.active) throw new Error('請先停止目前的計畫。')
    const definition = roomPlan((input as { plan?: unknown }).plan, view.room), token = randomUUID()
    this.roomPlanPreview = { definition, view, token, fingerprint: this.mpFingerprint(view.room), deadline: performance.now() + 10000 }
    return { token, channel: view.room.channel, kind: definition.kind, commands: definition.steps.map(s => s.command), names: definition.names, expiresAt: new Date(Date.now() + 10000).toISOString() }
  }
  cancelRoomPlan(input: unknown) {
    if (!input || typeof input !== 'object' || (input as { id?: unknown }).id !== this.roomPlan?.state.id) throw new Error('計畫已變更。')
    this.roomPlan?.cancel()
  }
  executeRoomPlan(input: unknown) {
    const preview = this.roomPlanPreview; this.roomPlanPreview = null
    const view = this.target(input), value = input as Record<string, unknown>
    if (!preview || preview.view !== view || preview.token !== value.token || value.reviewed !== true || performance.now() >= preview.deadline || preview.fingerprint !== this.mpFingerprint(view.room) || this.mapPlan?.active || this.roomPlan?.active) throw new Error('計畫確認已失效。')
    const definition = preview.definition
    if (definition.kind === 'lineup' && (value.policyReviewed !== true || JSON.stringify(value.names) !== JSON.stringify(definition.names))) throw new Error('請核對所有玩家名稱與本次換人政策。')
    this.mpReady(view, '', true); this.profileIdle(view)
    const generation = this.generation, epoch = view.room.epoch, stepMs = this.timing.queryMs * 2 + this.timing.floodMs * 4
    const id = this.operations.begin('manual', definition.kind === 'room' ? 'roomplan' : 'lineupplan', view.room.id, epoch, generation, '', stepMs + 1000)
    const queries: (string | undefined)[] = []
    const valid = () => this.connection === 'online' && this.generation === generation && this.views.get(view.room.id) === view && view.room.epoch === epoch && view.room.joined && this.selected === view.room.id && this.operations.snapshot.records.some(r => r.id === id && r.state === 'awaiting')
    this.roomPlan = new OperationPlan({id, roomId:view.room.id, roomEpoch:epoch, revision:randomUUID(), state:'queued', steps:definition.steps.map(s=>({command:s.command,state:'queued'}))}, {
      ready: index => {
        if (!valid()) return 'invalid'
        try { this.profileIdle(view) } catch { return 'invalid' }
        if (view.pending || this.work.length || this.workTimer || Date.now() - this.lastQueryAt < this.timing.floodMs) return 'wait'
        try { this.mpReady(view, '', true); return roomPlanMatches(definition, view.room, index) ? 'ready' : 'invalid' } catch { return 'invalid' }
      },
      send: index => {
        if (!this.operations.extend(id, stepMs + 1000)) throw new Error('操作已失效。')
        queries[index] = this.settingsEvidence.get(view)?.name.queryId
        this.lastQueryAt = Date.now(); this.clearFresh(view); view.room.syncState = 'stale'
        const command = definition.steps[index].command
        this.note(view, command, 'self', this.username, 'unconfirmed'); this.send(`PRIVMSG ${view.room.channel} :${command}`)
        this.enqueue(view, 'settings'); this.enqueue(view, 'listrefs')
      },
      observe: index => {
        if (!valid()) return 'invalid'
        try { this.profileIdle(view) } catch { return 'invalid' }
        const evidence = this.settingsEvidence.get(view)?.name
        if (!evidence || evidence.queryId === queries[index] || view.pending || this.work.length || this.workTimer || Date.now() - this.lastQueryAt < this.timing.floodMs) return 'wait'
        if (evidence.connectionGeneration !== generation || evidence.roomEpoch !== epoch) return 'invalid'
        try { this.mpReady(view, '', true) } catch { return 'invalid' }
        return roomPlanMatches(definition, view.room, index + 1) ? 'match' : 'invalid'
      },
      changed: () => this.publish(),
      finished: state => { this.operations.finish(id, state.state === 'observed' ? 'observed' : 'unknown'); this.publish() }
    }, stepMs)
    this.roomPlan.start(); this.publish()
  }
  replaceManualPool(input: unknown) {
    if (this.connection !== 'online') throw new Error('請先登入 IRC。')
    this.manualPool.replace(input)
    if (this.profilePreview?.poolRevision) this.profilePreview = null
    if (this.appliedPoolRevision) this.mapPlan?.cancel()
    this.publish()
  }
  previewPoolEntry(input: unknown): MapPlanPreview {
    this.target(input)
    const profile = this.manualPool.profile(input), result = this.previewProfile({ ...(input as object), profile })
    this.profilePreview!.poolRevision = this.manualPool.state.revision
    return result
  }
  previewProfile(input: unknown): MapPlanPreview {
    this.profilePreview = null
    const view = this.target(input), profile = mapProfile((input as { profile?: unknown }).profile)
    const command = profileCommands(profile)[0]
    this.mpReady(view, command)
    this.profileIdle(view)
    if (this.mapPlan?.active || this.roomPlan?.active) throw new Error('請先停止目前的選圖計畫。')
    const token = randomUUID()
    this.profilePreview = { token, profile, view, fingerprint: this.mpFingerprint(view.room), deadline: performance.now() + 10000 }
    return { token, channel: view.room.channel, commands: profileCommands(profile), freemod: profile.freemod, expiresAt: new Date(Date.now() + 10000).toISOString() }
  }
  private profileIdle(view: RoomView) {
    if (view.room.phase === 'playing' || view.room.slots.some(slot => /^playing$/i.test(slot.status)) || view.room.startCountdown && ['active', 'unknown'].includes(view.room.startCountdown.status)) throw new Error('比賽進行中或開賽倒數待核對。')
  }
  cancelProfile(input: unknown) {
    if (!input || typeof input !== 'object' || (input as { id?: unknown }).id !== this.mapPlan?.state.id) throw new Error('計畫已變更。')
    this.mapPlan?.cancel()
  }
  executeProfile(input: unknown) {
    const preview = this.profilePreview; this.profilePreview = null
    const view = this.target(input), value = input as Record<string, unknown>
    if (!preview || value.token !== preview.token || value.reviewed !== true || preview.profile.freemod && value.individualReviewed !== true || preview.poolRevision && preview.poolRevision !== this.manualPool.state.revision || preview.view !== view || performance.now() >= preview.deadline || preview.fingerprint !== this.mpFingerprint(view.room) || this.mapPlan?.active || this.roomPlan?.active) throw new Error('選圖確認已失效，請重新預覽與核對。')
    const commands = profileCommands(preview.profile), epoch = view.room.epoch, generation = this.generation
    this.mpReady(view, commands[0]); this.profileIdle(view)
    const id = this.operations.begin('manual', 'mapprofile', view.room.id, epoch, generation, '', (this.timing.queryMs * 2 + this.timing.floodMs * 4) * 2 + 1000)
    this.appliedPoolRevision = preview.poolRevision ?? null
    this.appliedProfile = preview.profile
    const priorQueries: (string | undefined)[] = []
    const scope = () => this.connection === 'online' && this.generation === generation && this.views.get(view.room.id) === view && view.room.epoch === epoch && view.room.joined && this.selected === view.room.id
    const desiredMods = [...preview.profile.roomMods, ...(preview.profile.freemod ? ['Freemod'] : [])].map(normalize).sort().join(',')
    this.mapPlan = new OperationPlan({ id, roomId: view.room.id, roomEpoch: epoch, revision: preview.profile.revision, state: 'queued', steps: commands.map(command => ({ command, state: 'queued' })) }, {
      ready: index => {
        if (!scope()) return 'invalid'
        try { this.profileIdle(view) } catch { return 'invalid' }
        if (view.pending || this.work.length || this.workTimer || Date.now() - this.lastQueryAt < this.timing.floodMs) return 'wait'
        try { this.mpReady(view, commands[index]); if (index && view.room.beatmap?.id !== Number(preview.profile.beatmapId)) return 'invalid'; return 'ready' } catch { return 'invalid' }
      },
      send: index => {
        priorQueries[index] = this.settingsEvidence.get(view)?.beatmap.queryId
        this.lastQueryAt = Date.now(); this.clearFresh(view); view.room.syncState = 'stale'
        this.note(view, commands[index], 'self', this.username, 'unconfirmed')
        this.send(`PRIVMSG ${view.room.channel} :${commands[index]}`)
        this.enqueue(view, 'settings'); this.enqueue(view, 'listrefs')
      },
      observe: index => {
        if (!scope()) return 'invalid'
        try { this.profileIdle(view) } catch { return 'invalid' }
        const evidence = this.settingsEvidence.get(view), map = evidence?.beatmap, mods = evidence?.mods
        if (!map || map.queryId === priorQueries[index] || map.connectionGeneration !== generation || map.roomEpoch !== epoch || view.pending || this.work.length || this.workTimer) return 'wait'
        if (map.knowledge !== 'known' || map.value?.id !== Number(preview.profile.beatmapId) || view.room.binding !== 'verified' || view.room.referee !== 'listed') return 'invalid'
        if (index && (!mods || mods.knowledge !== 'known' || mods.queryId !== map.queryId || mods.value?.map(normalize).sort().join(',') !== desiredMods)) return 'invalid'
        return 'match'
      },
      changed: () => this.publish(),
      finished: state => { this.operations.finish(id, state.state === 'observed' ? 'observed' : 'unknown'); this.publish() }
    }, this.timing.queryMs * 2 + this.timing.floodMs * 4)
    this.mapPlan.start(); this.publish()
  }
  previewMp(input: unknown) {
    this.mpPreview = null
    const view = this.target(input)
    const command = mpCommand((input as Record<string, unknown>).intent)
    this.mpReady(view, command)
    if (!/^!mp (?:abort|aborttimer|timer)(?: |$)/.test(command) && view.room.startCountdown && ['active', 'unknown'].includes(view.room.startCountdown.status)) throw new Error('開賽倒數中，請先取消倒數並核對房間。')
    if (!/^!mp (?:abort|aborttimer|timer)(?: |$)/.test(command) && (view.room.phase === 'playing' || view.room.slots.some(slot => /^playing$/i.test(slot.status)))) throw new Error('比賽進行中，請先核對或中止比賽。')
    if (command.startsWith('!mp start') && !view.room.slots.length) throw new Error('房內沒有玩家，不能開始比賽。')
    const token = randomUUID()
    this.mpPreview = { token, command, view, fingerprint: this.mpFingerprint(view.room), deadline: performance.now() + 10000 }
    return { token, command, channel: view.room.channel, expiresAt: new Date(Date.now() + 10000).toISOString() }
  }
  executeMp(input: unknown) {
    const preview = this.mpPreview
    this.mpPreview = null // Consume before every attempt, including validation and transport failure.
    const view = this.target(input)
    const value = input as Record<string, unknown>
    if (!preview || value.token !== preview.token || value.reviewed !== true || preview.view !== view || performance.now() >= preview.deadline || this.mpFingerprint(view.room) !== preview.fingerprint) throw new Error('確認已失效或房間狀態已變更，請重新預覽。')
    this.mpReady(view, preview.command)
    if (/^!mp (?:abort|aborttimer)$/.test(preview.command)) { this.mapPlan?.cancel(); this.roomPlan?.cancel() }
    const operationId = this.operations.begin('manual', preview.command.split(' ')[1], view.room.id, view.room.epoch, this.generation, preview.command)
    this.clearFresh(view)
    view.room.syncState = 'stale'; view.room.referee = 'unknown'; this.refereeSeen.delete(view)
    this.lastQueryAt = Date.now()
    if (preview.command === '!mp aborttimer') {
      for (const key of ['timer', 'startCountdown'] as const) if (view.room[key]) view.room[key] = { ...view.room[key]!, status: 'unknown', deadline: null }
    }
    this.note(view, preview.command, 'self', this.username, 'unconfirmed')
    this.note(view, '房內操作已嘗試送出，結果未確認；請核對 BanchoBot 回覆，再讀取設定與裁判名單。不會自動重送。')
    try { this.send(`PRIVMSG ${view.room.channel} :${preview.command}`) }
    catch (error) { this.operations.finish(operationId, 'unknown'); throw error }
    finally { this.publish() }
  }
  relayBlocked(input: RoomTarget, text: string) { return !/^!mp (?:abort|aborttimer)$/.test(text) && this.operations.hasUnreviewed(this.target(input).room.id) }
  relayReady(input: RoomTarget, text?: string) {
    // A still-fresh snapshot is not ready if queued reads are about to replace
    // it. Fence both the queue and its scheduled pump before creating a preview.
    if (this.work.length || this.workTimer) return false
    try { const command = text === undefined ? '' : relayCommand(text); this.mpReady(this.target(input), command, /^!mp (?:addref|invite|set) /.test(command)); return true } catch { return false }
  }
  relayRefresh(input: RoomTarget) {
    const view = this.target(input)
    if (this.connection !== 'online' || !view.room.joined || view.room.kind !== 'match' || this.selected !== view.room.id) throw new Error('請先加入並選取比賽房間。')
    this.enqueue(view, 'settings'); this.enqueue(view, 'listrefs')
  }
  relaySend(input: RoomTarget & { text: string }, onDispatch?: () => void) {
    const view = this.target(input)
    const text = relayCommand(input.text)
    this.mpReady(view, text, /^!mp (?:addref|invite|set) /.test(text))
    if (/^!mp (?:map|mods|set|start)\b/.test(text) && view.room.startCountdown && ['active', 'unknown'].includes(view.room.startCountdown.status)) throw new Error('開賽倒數待取消或核對。')
    if (/^!mp (?:map|mods|set|start)\b/.test(text) && (view.room.phase === 'playing' || view.room.slots.some(slot => /^playing$/i.test(slot.status)))) throw new Error('比賽進行中，請先核對或中止比賽。')
    if (/^!mp (?:abort|aborttimer)$/.test(text)) { this.mapPlan?.cancel(); this.roomPlan?.cancel() }
    const operationId = this.operations.begin('oclr', text.split(' ')[1], view.room.id, view.room.epoch, this.generation, text)
    this.lastQueryAt = Date.now()
    this.clearFresh(view); view.room.syncState = 'stale'
    this.note(view, text, 'self', this.username, 'unconfirmed')
    onDispatch?.()
    try { this.send(`PRIVMSG ${view.room.channel} :${text}`) }
    catch (error) { this.operations.finish(operationId, 'unknown'); throw error }
    finally { this.enqueue(view, 'settings'); this.enqueue(view, 'listrefs'); this.publish() }
  }
  relayNotice(input: RoomTarget & { text: string }, onDispatch?: () => void) {
    const view = this.target(input)
    if (!isBpNotice(input.text) || view.room.kind !== 'match' || view.room.binding !== 'verified' || view.room.referee !== 'listed') throw new Error('無效的 BP 通知或房間權限。')
    const text = chatText(input.text, view.room.channel)
    this.ready(view)
    onDispatch?.()
    this.send(`PRIVMSG ${view.room.channel} :${text}`)
    this.note(view, text, 'self', this.username, 'sent'); this.publish()
  }
  chat(input: unknown) {
    const view = this.target(input)
    const { text: value } = input as Record<string, unknown>
    if (view.room.kind === 'private' && normalize(view.room.channel) === 'banchobot') throw new Error('BanchoBot 私訊僅供讀取。')
    const text = chatText(value, view.room.channel)
    this.ready(view)
    this.send(`PRIVMSG ${view.room.channel} :${text}`); this.lastQueryAt = Date.now()
    this.note(view, text, 'self', this.username, 'sent'); view.error = null; this.publish()
  }
  private unavailable(view: RoomView, message: string) {
    this.operations.interrupt(view.room.id)
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
    if ((command === 'PART' && self) || (command === 'KICK' && normalize(params[1] || '') === normalize(this.username))) this.creationJoins.delete(normalize(params[0] || ''))
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
    if (!view) {
      // Only retain own JOINs during this one pending creation, in memory and bounded.
      // They are consumed only by a matching trusted creation reply, never as permissions.
      if (command === 'JOIN' && self && this.creation.status === 'awaiting' && /^#mp_[1-9]\d*$/.test(channel || '') && this.creationJoins.size < MAX_ROOMS) this.creationJoins.add(normalize(channel))
      return
    }
    const room = view.room
    if ((command === 'KICK' && normalize(params[1] || '') === normalize(this.username)) || (command === 'PART' && self)) {
      this.unavailable(view, '已離開或被移出房間，請確認房間後重新加入。'); return
    }
    if (command === '401' && ownTarget && room.kind === 'private') { this.unavailable(view, '此使用者目前無法接收私訊，請核對名稱後重新開啟對話。'); return }
    if (['403', '404', '405', '471', '473', '474', '475'].includes(command) && ownTarget) {
      this.unavailable(view, command === '403' ? '找不到開放中的房間。請確認 MP 編號，或改用新的比賽房間。' : '目前無法加入或讀取此房間，請核對房間與帳號權限。'); return
    }
    if ((command === 'JOIN' && self || command === '366' && ownTarget && view.joinSent) && view.restore && !room.joined && (view.pending === 'join' || view.joinSent && !view.pending)) {
      this.confirmJoin(view); return
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
    if (bot && room.joined && room.kind === 'match') this.operations.observe(room.id, room.epoch, this.generation, body)
    const countdown = bot && room.kind === 'match' && room.joined ? countdownEvent(body) : null
    if (countdown) {
      if (countdown.kind === 'start' && room.startCountdown?.status !== countdown.value.status) this.mpPreview = null
      room[countdown.kind === 'timer' ? 'timer' : 'startCountdown'] = countdown.value
      this.publish(); return
    }
    const started = bot && /^The match has started[!.]?$/.test(body)
    const ended = bot && /^(?:The match has finished|Aborted the match)[!.]?$/.test(body)
    if (room.kind === 'match' && room.joined && (started || ended)) {
      if (started && room.phase !== 'playing') room.match = { startedAt: new Date().toISOString(), beatmap: structuredClone(room.beatmap), mods: structuredClone(room.mods) }
      room.startCountdown = null
      room.phase = started ? 'playing' : 'idle'
      if (ended) room.match = null
      // A lifecycle event invalidates an in-progress settings collection; query again
      // through the shared bounded read queue, never replay a mutation.
      if (view.pending === 'settings') { view.collector = null; this.clearTimer(view); view.pending = null }
      this.settingsEvidence.delete(view); room.syncState = 'stale'
      this.enqueue(view, 'settings'); this.publish(); return
    }
    if (bot && view.pending !== 'settings' && room.startCountdown?.status === 'active' && /^(?:Beatmap changed|Changed (?:beatmap|match|team|win)|Active mods:|.+ (?:joined in slot|left the game|moved to slot|changed to))/.test(body)) {
      room.startCountdown = { ...room.startCountdown, status: 'unknown', deadline: null }; this.mpPreview = null
    }
    const observing = bot && view.pending === 'settings'
    const readingRefs = bot && view.pending === 'listrefs'
    if (observing) {
      if (view.collector?.feed(body)) {
        view.collector.apply(room); this.loadDuration(view); this.settingsEvidence.set(view, view.collector.observations(room.epoch)); this.expire(view); view.collector = null; this.clearTimer(view); view.pending = null
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
    if (bot && view.pending !== 'settings' && /^(?:Beatmap changed|Changed (?:beatmap|match|team|win)|Active mods:|.+ (?:joined in slot|left the game|moved to slot|changed to)|The match has (?:started|finished)|Aborted the match)/.test(body)) {
      room.syncState = 'stale'
      if (body.startsWith('The match has started')) room.phase = 'playing'
      else if (/^(?:The match has finished|Aborted the match)/.test(body)) room.phase = 'idle'
      else { if (/^(?:Beatmap changed|Changed beatmap)/.test(body)) { room.phase = 'unknown'; room.match = null }; if (room.kind === 'match' && room.joined) this.enqueue(view, 'settings') }
    }
    this.publish()
  }
}
