import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { parseWebsiteRoomJoin, type WebsiteRoomJoinState } from '../shared/website-room-join.ts'
import type { IrcSession } from './irc.ts'

/** A user-clicked room link uses the ordinary JOIN path; never enables a relay. */
export class WebsiteRoomJoin extends EventEmitter {
  private value: WebsiteRoomJoinState | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private session: number | null = null
  private irc: IrcSession
  constructor(irc: IrcSession) {
    super()
    this.irc = irc
    irc.on('state', () => this.progress())
  }
  get state() { return this.value ? {...this.value} : null }
  private publish() { this.emit('state', this.state) }
  receive(url: unknown) {
    const roomId = parseWebsiteRoomJoin(url)
    if (!roomId) return false
    if (this.value?.roomId === roomId && ['pending', 'joining'].includes(this.value.status)) { this.publish(); return true }
    this.clear()
    this.value = {requestId: randomUUID(), roomId, status: 'pending'}
    this.timer = setTimeout(() => this.clear(), 10 * 60_000); this.timer.unref()
    this.publish(); this.progress(); return true
  }
  clear() {
    this.value = null; this.session = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null; this.publish()
  }
  retry(requestId: unknown) {
    if (!this.value || requestId !== this.value.requestId || this.value.status !== 'error') throw new Error('Invalid room request')
    this.session = null; this.value.status = 'pending'; this.publish(); this.progress()
  }
  private progress() {
    const value = this.value
    if (!value) return
    if (this.session !== null && this.session !== this.irc.sessionGeneration) { this.clear(); return }
    if (value.status === 'pending' && this.irc.state.connection === 'online') {
      // Mark before JOIN: its synchronous state events cannot dispatch a second JOIN.
      this.session = this.irc.sessionGeneration; value.status = 'joining'; this.publish()
      if (this.value !== value) return
      try {
        this.irc.emit('private-room', value.roomId)
        this.irc.join(String(value.roomId))
      } catch { if (this.value === value) { value.status = 'error'; this.publish() } }
    }
    if (this.value !== value || value.status !== 'joining') return
    const room = this.irc.state.rooms.find(room => room.id === value.roomId)
    if (this.irc.state.connection !== 'online' || room?.error) { value.status = 'error'; this.publish() }
    else if (room?.joined) { value.status = 'joined'; this.publish() }
  }
}
