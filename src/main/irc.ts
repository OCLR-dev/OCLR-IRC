import net from 'node:net'
import { EventEmitter } from 'node:events'
import type { Snapshot } from '../shared/types.ts'
import { chatText, credentials, Lines, normalize, parse, redact, roomId } from './protocol.ts'

const empty = (): Snapshot => ({ connection: 'offline', username: '', error: null, room: null, pending: null, messages: [] })

export class IrcSession extends EventEmitter {
  state = empty()
  private socket: net.Socket | null = null
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private auth: { username: string; password: string } | null = null
  private nextMessage = 0
  private refsHeader = false
  private createSocket: () => net.Socket
  private lastQueryAt = 0
  private roomEpoch = 0
  private expectedPart: string | null = null
  private batching = false
  private dirty = false

  constructor(createSocket = () => net.createConnection({ host: 'irc.ppy.sh', port: 6667 })) {
    super()
    this.createSocket = createSocket
  }
  private publish() {
    if (this.batching) { this.dirty = true; return }
    this.emit('state', structuredClone(this.state))
  }
  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null }
  private note(text: string, kind: Snapshot['messages'][number]['kind'] = 'system', sender = '系統', delivery?: 'unconfirmed') {
    this.state.messages.push({ id: ++this.nextMessage, time: new Date().toISOString(), kind, sender: redact(sender), text: redact(text), ...(delivery ? { delivery } : {}) })
    this.state.messages = this.state.messages.slice(-1000)
  }
  private send(line: string) {
    if (!this.socket || this.socket.destroyed || /[\r\n\0]/.test(line) || Buffer.byteLength(line) > 510) throw new Error('無法送出此請求。')
    this.socket.write(line + '\r\n')
  }
  logout() {
    this.generation++
    this.clearTimer()
    if (this.auth) this.auth.password = ''
    this.auth = null
    this.socket?.destroy()
    this.socket = null
    this.state = empty()
    this.refsHeader = false
    this.lastQueryAt = 0
    this.expectedPart = null
    this.publish()
  }
  private fail(message: string) {
    this.logout()
    this.state.connection = 'error'
    this.state.error = message
    this.publish()
  }
  login(input: unknown) {
    const auth = credentials(input)
    this.logout()
    this.auth = auth
    this.state.connection = 'connecting'
    this.state.username = auth.username
    this.publish()
    const generation = this.generation
    const lines = new Lines()
    const socket = this.createSocket()
    this.socket = socket
    const current = () => generation === this.generation && socket === this.socket
    this.timer = setTimeout(() => { if (current()) this.fail('登入逾時，請檢查網路後再試一次。') }, 15000)
    socket.once('connect', () => {
      if (!current()) return
      this.send('PASS ' + auth.password)
      auth.password = ''
      this.auth = null
      this.send('NICK ' + auth.username)
      this.send(`USER ${auth.username} 0 * :OCLR-ref-tools`)
    })
    socket.on('data', chunk => {
      if (!current()) return
      this.batching = true
      try {
        for (const line of lines.feed(chunk)) {
          if (!current()) break
          this.receive(line)
        }
      } catch { if (current()) this.fail('伺服器回覆無法安全讀取，已中斷連線。') }
      finally { this.batching = false; if (this.dirty) { this.dirty = false; this.publish() } }
    })
    socket.on('error', () => { if (current()) this.fail('無法連接 osu! IRC。請檢查網路，稍後再試。') })
    socket.on('close', () => { if (current()) this.fail('連線已中斷，請重新登入。') })
    socket.setTimeout(180000, () => { if (current()) this.fail('連線長時間沒有回應，請重新登入。') })
  }
  join(input: unknown) {
    if (this.state.connection !== 'online') throw new Error('請先登入 osu! IRC。')
    if (this.state.pending) throw new Error('請等待目前的查詢完成。')
    const id = roomId(input)
    this.expectedPart = this.state.room?.joined ? this.state.room.channel : null
    if (this.expectedPart) this.send('PART ' + this.expectedPart)
    this.state.room = { id, epoch: ++this.roomEpoch, channel: `#mp_${id}`, joined: false, binding: 'unknown', referee: 'unknown', name: null, mode: null, players: null }
    this.state.messages = []
    this.state.error = null
    this.refsHeader = false
    this.state.pending = 'join'
    this.send('JOIN ' + this.state.room.channel)
    this.note('正在加入房間…')
    this.timeout('加入房間逾時。請確認房間仍開放，且目前帳號可加入。')
    this.publish()
  }
  private timeout(message: string) {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.state.pending = null
      this.refsHeader = false
      this.state.error = message
      this.note(message)
      this.publish()
    }, 8000)
  }
  query(input: unknown) {
    if (input !== 'settings' && input !== 'listrefs') throw new Error('初版僅提供讀取設定與裁判名單。')
    const room = this.state.room
    if (this.state.connection !== 'online' || !room?.joined) throw new Error('請先加入可用的比賽房間。')
    if (this.state.pending || Date.now() - this.lastQueryAt < 1000) throw new Error('請稍候再查詢。')
    this.lastQueryAt = Date.now()
    this.state.pending = input
    this.state.error = null
    this.refsHeader = false
    if (input === 'settings') { room.binding = 'unknown'; room.name = null; room.mode = null; room.players = null }
    else room.referee = 'unknown'
    this.send(`PRIVMSG ${room.channel} :!mp ${input}`)
    this.note(`!mp ${input}`, 'self', this.state.username)
    this.timeout('尚未收到完整回覆；請稍後重新查詢，不代表沒有權限。')
    this.publish()
  }
  chat(input: unknown) {
    if (!input || typeof input !== 'object') throw new Error('無效的聊天請求。')
    const { roomId: id, roomEpoch, text: value } = input as Record<string, unknown>
    const room = this.state.room
    if (this.state.connection !== 'online' || !room?.joined) throw new Error('請先加入可用的比賽房間。')
    if (id !== room.id || roomEpoch !== room.epoch) throw new Error('房間已切換，請確認目標後重新輸入。')
    const text = chatText(value, room.channel)
    if (this.state.pending || Date.now() - this.lastQueryAt < 1000) throw new Error('請稍候再送出訊息。')
    this.send(`PRIVMSG ${room.channel} :${text}`)
    this.lastQueryAt = Date.now()
    this.note(text, 'self', this.state.username, 'unconfirmed')
    this.state.error = null
    this.publish()
  }
  private unavailable(message: string) {
    const room = this.state.room
    if (!room) return
    this.clearTimer(); this.refsHeader = false; this.state.pending = null
    room.joined = false; room.binding = 'unknown'; room.referee = 'unknown'
    room.name = null; room.mode = null; room.players = null
    this.state.error = message
    this.note(message); this.publish()
  }
  private receive(line: string) {
    const message = parse(line)
    if (!message) return
    const { prefix, command, params } = message
    const sender = prefix.split('!')[0]
    const self = normalize(sender) === normalize(this.state.username)
    const ownTarget = normalize(params[0] || '') === normalize(this.state.username)
    if (command === 'PING' && params.length) { this.send('PONG :' + params.at(-1)); return }
    if (command === '001' && ownTarget && this.state.connection === 'connecting') {
      this.clearTimer(); this.state.connection = 'online'; this.publish(); return
    }
    if (['464', '433', '432'].includes(command) && ownTarget) {
      this.fail(command === '464' ? '登入失敗。請使用 osu! 帳號設定中的 IRC 專用密碼。' : '使用者名稱無法登入，請確認名稱後重試。'); return
    }
    if (command === 'ERROR') { this.fail('伺服器已中斷連線，請重新登入。'); return }
    const room = this.state.room
    if (!room) return
    // A deliberate rejoin may receive its old PART before the new JOIN/366.
    if (command === 'PART' && self && params[0] === this.expectedPart && this.state.pending === 'join') { this.expectedPart = null; return }
    if ((command === 'KICK' && params[0] === room.channel && normalize(params[1] || '') === normalize(this.state.username)) || (command === 'PART' && self && params[0] === room.channel) || (command === 'QUIT' && self)) {
      this.unavailable('已離開或被移出房間，請確認房間後重新加入。'); return
    }
    const matching = params.includes(room.channel)
    if (['403', '404', '405', '471', '473', '474', '475'].includes(command) && ownTarget && matching) {
      this.unavailable(command === '403' ? '找不到開放中的房間。請確認 MP 編號，或改用新的比賽房間。' : '目前無法加入或讀取此房間，請核對房間與帳號權限。')
      return
    }
    if ((command === 'JOIN' && self && matching || command === '366' && ownTarget && matching) && this.state.pending === 'join') {
      this.clearTimer(); this.state.pending = null; this.expectedPart = null; room.joined = true
      this.note('已加入頻道。讀取設定以核對 MP 房間，再查詢裁判名單。'); this.publish(); return
    }
    if (command !== 'PRIVMSG' || params[0] !== room.channel || params.length !== 2) return
    const body = params[1]
    const bot = normalize(sender) === 'banchobot'
    this.note(body, bot ? 'bot' : self ? 'self' : 'chat', sender)
    if (bot && this.state.pending === 'settings') {
      const header = /^Room name: (.*), History: https:\/\/osu\.ppy\.sh\/(?:mp|community\/matches)\/(\d+)$/.exec(body)
      if (header) { room.name = redact(header[1]); room.binding = Number(header[2]) === room.id ? 'verified' : 'mismatch' }
      const mode = /^Team mode: (.+), Win condition: (.+)$/.exec(body)
      if (mode) room.mode = `${mode[1]} · ${mode[2]}`
      const players = /^Players: (\d+)$/.exec(body)
      if (players) { room.players = Number(players[1]); this.clearTimer(); this.state.pending = null }
    } else if (bot && this.state.pending === 'listrefs') {
      const header = /^(?:Match referees|Referees):\s*(.*)$/.exec(body)
      if (header) this.refsHeader = true
      const names = header ? header[1].split(',') : this.refsHeader ? [body] : []
      if (names.some(name => normalize(name.trim()) === normalize(this.state.username))) {
        room.referee = 'listed'; this.clearTimer(); this.state.pending = null; this.refsHeader = false
      }
    }
    this.publish()
  }
}
