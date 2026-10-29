import { z } from 'zod'
import { envelope, uuid } from '../shared/oclr-contracts.ts'
import { relayCommand, relayReply } from '../shared/relay-command.ts'
import type { Message, Snapshot } from '../shared/types.ts'
import type { OclrSession } from './oclr.ts'
import type { IrcSession } from './irc.ts'
import { normalize } from './protocol.ts'
import { OclrError } from './oclr-http.ts'

const replySchema = envelope(z.object({ connectionId: uuid, sequence: z.number().int().nonnegative(), command: z.object({ id: uuid, text: z.string().max(300), target: z.string().regex(/^#mp_[1-9]\d*$/) }).nullable() }))
type Receipt = { commandId: string; status: 'sent' | 'confirmed' | 'failed' | 'unknown'; evidence?: {sender: string; target: string; text: string} }
const cleanProjectionText = (value: string, length: number) => value.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '').slice(0, length)
function projectedMessage(message: Message) {
  const sender = cleanProjectionText(message.sender, 100), text = cleanProjectionText(message.text, 1000)
  return sender && text ? {id: String(message.id), sender, text, at: message.time} : null
}

/** Local explicit room binding. No token or IRC password enters the renderer/projection. */
export class OclrRelay {
  private binding: {fixtureId: string; connectionId: string; roomId: number; roomEpoch: number; username: string; sequence: number} | null = null
  private receipts: Receipt[] = []
  private consumed = new Set<string>()
  private pending: {id: string; text: string; after: number; deadline: number} | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  private running = false
  private oclr: OclrSession
  private irc: IrcSession
  constructor(oclr: OclrSession, irc: IrcSession) {
    this.oclr = oclr; this.irc = irc
    irc.on('message', ({roomId, roomEpoch, message}: {roomId: number; roomEpoch: number; message: Message}) => {
      if (!this.binding || roomId !== this.binding.roomId || roomEpoch !== this.binding.roomEpoch || !this.pending || message.kind !== 'bot' || normalize(message.sender) !== 'banchobot' || message.id <= this.pending.after) return
      const projected = projectedMessage(message)
      if (!projected) return
      const status = relayReply(this.pending.text, projected.text)
      if (status) { this.receipts.push({commandId: this.pending.id, status, evidence: {sender: 'BanchoBot', target: `#mp_${roomId}`, text: projected.text}}); this.pending = null }
    })
    oclr.on('state', () => {
      if (this.binding && (!oclr.state.subject || oclr.state.selectedFixtureId !== this.binding.fixtureId || normalize(oclr.state.subject.username) !== this.binding.username)) void this.stop()
    })
  }
  private sameRoom(state: Snapshot) { const b = this.binding; return !!b && state.room?.id === b.roomId && state.room.epoch === b.roomEpoch && normalize(state.username) === b.username }
  async start() {
    if (this.binding || this.running) throw new OclrError('RELAY_ALREADY_ACTIVE')
    const state = this.oclr.state, irc = this.irc.state
    if (!state.subject || !state.selectedFixtureId || state.panelState !== 'fresh' || irc.connection !== 'online' || !irc.room?.joined || irc.room.kind !== 'match' || irc.room.binding !== 'verified' || irc.room.referee !== 'listed' || normalize(irc.username) !== normalize(state.subject.username)) throw new OclrError('RELAY_LOCAL_NOT_READY')
    const generation = ++this.generation
    this.running = true; this.oclr.updateRelay({status: 'connecting', roomId: irc.room.id, error: null})
    try {
      const response = await this.oclr.relayRequest(state.selectedFixtureId, {action: 'bind', roomId: irc.room.id, ircUsername: irc.username})
      const reply = replySchema.parse(response.value).data
      if (generation !== this.generation) return
      if (reply.sequence !== 0 || reply.command !== null) throw new Error('Unexpected bind response')
      this.binding = {fixtureId: state.selectedFixtureId, connectionId: reply.connectionId, roomId: irc.room.id, roomEpoch: irc.room.epoch, username: normalize(irc.username), sequence: 0}
      this.consumed.clear(); this.receipts = []; this.pending = null
      this.oclr.updateRelay({status: 'connected', roomId: irc.room.id, error: null})
      this.timer = setTimeout(() => void this.tick(), 100)
    } catch { if (generation === this.generation) this.oclr.updateRelay({status: 'error', roomId: irc.room.id, error: '無法建立網站投影，請重新授權或確認場次權限。'}) }
    finally { this.running = false }
  }
  private async tick() {
    const binding = this.binding, generation = this.generation
    if (!binding || this.running) return
    this.running = true
    try {
      const irc = this.irc.state, same = this.sameRoom(irc)
      if (this.pending && (!same || irc.connection !== 'online' || performance.now() >= this.pending.deadline)) { this.receipts.push({commandId: this.pending.id, status: 'unknown'}); this.pending = null }
      const receipts = this.receipts.splice(0, 10)
      const response = await this.oclr.relayRequest(binding.fixtureId, {action: 'sync', connectionId: binding.connectionId, sequence: ++binding.sequence, projection: {status: same && irc.connection === 'online' ? 'connected' : 'disconnected', messages: same ? irc.messages.slice(-100).map(projectedMessage).filter(m => m !== null) : []}, receipts})
      const reply = replySchema.parse(response.value).data
      if (generation !== this.generation) return
      if (reply.connectionId !== binding.connectionId || reply.sequence !== binding.sequence) throw new Error('Unexpected relay generation')
      const command = reply.command
      if (command && !this.consumed.has(command.id)) {
        // Consume before validation and socket write. Never retry after ambiguity.
        this.consumed.add(command.id)
        if (this.consumed.size > 2000) throw new Error('Relay session limit')
        if (!same || irc.connection !== 'online' || command.target !== `#mp_${binding.roomId}` || this.pending) this.receipts.push({commandId: command.id, status: 'failed'})
        else {
          try {
            const text = relayCommand(command.text)
            const target = {roomId: binding.roomId, roomEpoch: binding.roomEpoch}
            if (!this.irc.relayReady(target)) {
              this.irc.relayRefresh(target)
              const deadline = performance.now() + 8000
              while (!this.irc.relayReady(target) && performance.now() < deadline && generation === this.generation && this.sameRoom(this.irc.state)) await new Promise(resolve => setTimeout(resolve, 50))
            }
            if (generation !== this.generation || !this.sameRoom(this.irc.state) || !this.irc.relayReady(target)) throw new Error('Local room checks failed')
            this.pending = {id: command.id, text, after: this.irc.state.messages.at(-1)?.id ?? 0, deadline: performance.now() + 15000}
            this.irc.relaySend({roomId: binding.roomId, roomEpoch: binding.roomEpoch, text})
            this.receipts.push({commandId: command.id, status: 'sent'})
          } catch { const status = this.pending ? 'unknown' : 'failed'; this.pending = null; this.receipts.push({commandId: command.id, status}) }
        }
      }
      if (!same) { await this.stop(); return }
    } catch {
      if (generation === this.generation) { this.binding = null; this.pending = null; this.receipts = []; this.oclr.updateRelay({status: 'error', roomId: binding.roomId, error: '投影同步中斷，結果不明的指令不會重送。請重新連接。'}) }
    } finally {
      this.running = false
      if (generation === this.generation && this.binding) this.timer = setTimeout(() => void this.tick(), 1000)
    }
  }
  async stop() {
    const binding = this.binding
    this.generation++; this.binding = null; this.pending = null; this.receipts = []; this.consumed.clear()
    if (this.timer) clearTimeout(this.timer); this.timer = null
    this.oclr.updateRelay({status: 'off', roomId: null, error: null})
    if (binding) try { await this.oclr.relayRequest(binding.fixtureId, {action: 'disconnect', connectionId: binding.connectionId}) } catch { /* Local stop always wins; server heartbeat expires. */ }
  }
}
