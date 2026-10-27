import net from 'node:net'
import { EventEmitter } from 'node:events'
import type { Connection, Message, Pending, Room, Snapshot } from '../shared/types.ts'
import { chatText, credentials, Lines, normalize, parse, redact, roomId } from './protocol.ts'

interface RoomView {
  room: Room
  pending: Pending
  error: string | null
  totalMessages: number
  messages: Message[]
  unread: number
  mentions: number
  refsHeader: boolean
  timer: ReturnType<typeof setTimeout> | null
}
const MAX_ROOMS = 8

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

  constructor(createSocket = () => net.createConnection({ host: 'irc.ppy.sh', port: 6667 })) {
    super()
    this.createSocket = createSocket
  }
  get state(): Snapshot {
    const view = this.selected === null ? undefined : this.views.get(this.selected)
    return {
      connection: this.connection, username: this.username, leavingChannels: [...this.departing],
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
    if (view.messages.length > 1000) view.messages = view.messages.slice(-1000)
    if (view.room.id !== this.selected && kind !== 'self') {
      view.unread = Math.min(999, view.unread + 1)
      const nick = this.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('_', '[ _]')
      if (kind !== 'system' && new RegExp(`(^|[^a-z0-9_])${nick}($|[^a-z0-9_])`, 'i').test(text)) view.mentions = Math.min(999, view.mentions + 1)
    }
  }
  private send(line: string) {
    if (!this.socket || this.socket.destroyed || /[\r\n\0]/.test(line) || Buffer.byteLength(line) > 510) throw new Error('無法送出此請求。')
    this.socket.write(line + '\r\n')
  }
  logout() {
    this.generation++
    this.clearLoginTimer()
    for (const view of this.views.values()) this.clearTimer(view)
    this.views.clear(); this.selected = null; this.departing.clear()
    if (this.auth) this.auth.password = ''
    this.auth = null
    this.socket?.destroy(); this.socket = null
    this.connection = 'offline'; this.username = ''; this.error = null
    this.lastQueryAt = 0
    this.publish()
  }
  private fail(message: string) {
    this.logout(); this.connection = 'error'; this.error = message; this.publish()
  }
  login(input: unknown) {
    const auth = credentials(input)
    this.logout(); this.auth = auth
    this.connection = 'connecting'; this.username = auth.username; this.publish()
    const generation = this.generation
    const lines = new Lines()
    const socket = this.createSocket()
    this.socket = socket
    const current = () => generation === this.generation && socket === this.socket
    this.loginTimer = setTimeout(() => { if (current()) this.fail('登入逾時，請檢查網路後再試一次。') }, 15000)
    socket.once('connect', () => {
      if (!current()) return
      try {
        this.send('PASS ' + auth.password); auth.password = ''; this.auth = null
        this.send('NICK ' + auth.username); this.send(`USER ${auth.username} 0 * :OCLR-ref-tools`)
      } catch { if (current()) this.fail('登入連線失敗，請重新登入。') }
    })
    socket.on('data', chunk => {
      if (!current()) return
      this.batching = true
      try {
        for (const line of lines.feed(chunk)) { if (!current()) break; this.receive(line) }
      } catch { if (current()) this.fail('伺服器回覆無法安全讀取，已中斷連線。') }
      finally { this.batching = false; if (this.dirty) { this.dirty = false; this.publish() } }
    })
    socket.on('error', () => { if (current()) this.fail('無法連接 osu! IRC。請檢查網路，稍後再試。') })
    socket.on('close', () => { if (current()) this.fail('連線已中斷，請重新登入。') })
    socket.setTimeout(180000, () => { if (current()) this.fail('連線長時間沒有回應，請重新登入。') })
  }
  private target(input: unknown): RoomView {
    if (!input || typeof input !== 'object') throw new Error('無效的房間請求。')
    const { roomId: id, roomEpoch } = input as Record<string, unknown>
    const view = typeof id === 'number' ? this.views.get(id) : undefined
    if (!view || roomEpoch !== view.room.epoch) throw new Error('房間已切換或關閉，請確認目標後重新操作。')
    return view
  }
  selectRoom(input: unknown) {
    const view = this.target(input)
    this.selected = view.room.id; view.unread = 0; view.mentions = 0; this.publish()
  }
  leaveRoom(input: unknown) {
    const view = this.target(input)
    // PART only leaves this account's channel; it is never !mp close.
    if (view.room.joined || view.pending === 'join') {
      this.send('PART ' + view.room.channel); this.departing.add(view.room.channel)
      if (this.departing.size > 32) { this.fail('過多離開請求尚未確認，已中斷連線。請重新登入。'); return }
    }
    this.clearTimer(view); this.views.delete(view.room.id)
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
    if (!existing && this.views.size >= MAX_ROOMS) throw new Error('最多同時開啟 8 個房間，請先離開不需要的分頁。')
    if (existing) this.clearTimer(existing)
    const view: RoomView = {
      room: { id, epoch: ++this.roomEpoch, channel: `#mp_${id}`, joined: false, binding: 'unknown', referee: 'unknown', name: null, mode: null, players: null },
      pending: 'join', error: null, totalMessages: 0, messages: [], unread: 0, mentions: 0, refsHeader: false, timer: null
    }
    this.send('JOIN ' + view.room.channel)
    this.views.set(id, view); this.selected = id
    this.note(view, '正在加入房間…')
    this.timeout(view, '加入房間逾時。請確認房間仍開放，且目前帳號可加入。')
    this.publish()
  }
  private timeout(view: RoomView, message: string) {
    this.clearTimer(view)
    const generation = this.generation
    view.timer = setTimeout(() => {
      if (generation !== this.generation || this.views.get(view.room.id) !== view) return
      view.timer = null; view.pending = null; view.refsHeader = false; view.error = message
      this.note(view, message); this.publish()
    }, 8000)
  }
  private ready(view: RoomView) {
    if (this.connection !== 'online' || !view.room.joined) throw new Error('請先加入可用的比賽房間。')
    if (view.pending || Date.now() - this.lastQueryAt < 1000) throw new Error('請稍候再查詢或送出訊息。')
  }
  query(input: unknown) {
    const view = this.target(input)
    const { kind } = input as Record<string, unknown>
    if (kind !== 'settings' && kind !== 'listrefs') throw new Error('初版僅提供讀取設定與裁判名單。')
    this.ready(view)
    this.send(`PRIVMSG ${view.room.channel} :!mp ${kind}`); this.lastQueryAt = Date.now()
    view.pending = kind; view.error = null; view.refsHeader = false
    if (kind === 'settings') { view.room.binding = 'unknown'; view.room.name = null; view.room.mode = null; view.room.players = null }
    else view.room.referee = 'unknown'
    this.note(view, `!mp ${kind}`, 'self', this.username)
    this.timeout(view, '尚未收到完整回覆；請稍後重新查詢，不代表沒有權限。'); this.publish()
  }
  chat(input: unknown) {
    const view = this.target(input)
    const { text: value } = input as Record<string, unknown>
    const text = chatText(value, view.room.channel)
    this.ready(view)
    this.send(`PRIVMSG ${view.room.channel} :${text}`); this.lastQueryAt = Date.now()
    this.note(view, text, 'self', this.username, 'unconfirmed'); view.error = null; this.publish()
  }
  private unavailable(view: RoomView, message: string) {
    this.clearTimer(view); view.refsHeader = false; view.pending = null
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
    if (command === '001' && ownTarget && this.connection === 'connecting') { this.clearLoginTimer(); this.connection = 'online'; this.publish(); return }
    if (['464', '433', '432'].includes(command) && (ownTarget || params[0] === '*')) {
      this.fail(command === '464' ? '登入失敗。請使用 osu! 帳號設定中的 IRC 專用密碼。' : '使用者名稱無法登入，請確認名稱後重試。'); return
    }
    if (command === 'ERROR' || command === 'QUIT' && self) { this.fail('伺服器已中斷連線，請重新登入。'); return }
    if (command === 'PART' && self && this.departing.delete(params[0])) { this.publish(); return }
    // Resolve only the protocol's target field, never a channel-looking string in body text.
    const channel = ['353'].includes(command) ? params[2] : /^\d{3}$/.test(command) ? params[1] : params[0]
    const view = [...this.views.values()].find(v => v.room.channel === channel)
    if (!view) return
    const room = view.room
    if ((command === 'KICK' && normalize(params[1] || '') === normalize(this.username)) || (command === 'PART' && self)) {
      this.unavailable(view, '已離開或被移出房間，請確認房間後重新加入。'); return
    }
    if (['403', '404', '405', '471', '473', '474', '475'].includes(command) && ownTarget) {
      this.unavailable(view, command === '403' ? '找不到開放中的房間。請確認 MP 編號，或改用新的比賽房間。' : '目前無法加入或讀取此房間，請核對房間與帳號權限。'); return
    }
    if ((command === 'JOIN' && self || command === '366' && ownTarget) && view.pending === 'join') {
      this.clearTimer(view); view.pending = null; room.joined = true
      this.note(view, '已加入頻道。讀取設定以核對 MP 房間，再查詢裁判名單。'); this.publish(); return
    }
    if (command !== 'PRIVMSG' || params.length !== 2) return
    const body = params[1]; const bot = normalize(sender) === 'banchobot'
    this.note(view, body, bot ? 'bot' : self ? 'self' : 'chat', sender)
    if (bot && view.pending === 'settings') {
      const header = /^Room name: (.*), History: https:\/\/osu\.ppy\.sh\/(?:mp|community\/matches)\/(\d+)$/.exec(body)
      if (header) { room.name = redact(header[1]); room.binding = Number(header[2]) === room.id ? 'verified' : 'mismatch' }
      const mode = /^Team mode: (.+), Win condition: (.+)$/.exec(body)
      if (mode) room.mode = `${mode[1]} · ${mode[2]}`
      const players = /^Players: (\d+)$/.exec(body)
      if (players) { room.players = Number(players[1]); this.clearTimer(view); view.pending = null }
    } else if (bot && view.pending === 'listrefs') {
      const header = /^(?:Match referees|Referees):\s*(.*)$/.exec(body)
      if (header) view.refsHeader = true
      const names = header ? header[1].split(',') : view.refsHeader ? [body] : []
      if (names.some(name => normalize(name.trim()) === normalize(this.username))) {
        room.referee = 'listed'; this.clearTimer(view); view.pending = null; view.refsHeader = false
      }
    }
    this.publish()
  }
}
