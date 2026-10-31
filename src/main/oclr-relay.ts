import { AccountPairing } from './account-pairing.ts'
import { z } from 'zod'
import { envelope, uuid } from '../shared/oclr-contracts.ts'
import { relayCommand, relayReply } from '../shared/relay-command.ts'
import type { Message, Snapshot } from '../shared/types.ts'
import type { OclrSession } from './oclr.ts'
import type { IrcSession } from './irc.ts'
import { normalize } from './protocol.ts'
import { OclrError } from './oclr-http.ts'

const replySchema = envelope(z.object({ connectionId: uuid, sequence: z.number().int().nonnegative(), command: z.object({ id: uuid, text: z.string().max(300), target: z.string().regex(/^(?:#mp_[1-9]\d*|BanchoBot)$/) }).nullable() }))
type Receipt = { commandId: string; status: 'sent' | 'confirmed' | 'failed' | 'unknown'; evidence?: {sender: string; target: string; text: string} }
const cleanProjectionText = (value: string) => value.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '')
const sensitiveProjectionText = (value: string) => /(?:password|access_token|refresh_token|code_verifier|oclr_desk_(?:at|rt)_|^\s*PASS\s|^\s*AUTHENTICATE\s)/i.test(value)
function projectedMessage(message: Message) {
  const sender = cleanProjectionText(message.sender), text = cleanProjectionText(message.text)
  // Drop before truncation and before HTTP, including markers separated by
  // format characters. The same gate also protects confirmation evidence.
  if ([message.sender, message.text, sender, text].some(sensitiveProjectionText)) return null
  return sender && text ? {id: String(message.id), sender: sender.slice(0, 100), text: text.slice(0, 1000), at: message.time} : null
}

/** Local explicit room binding. No token or IRC password enters the renderer/projection. */
export class OclrRelay {
  private identity = new AccountPairing()
  private binding: {subjectId: number; fixtureId: string; connectionId: string; roomId: number; roomEpoch: number; username: string; sequence: number} | null = null
  private receipts: Receipt[] = []
  private consumed = new Set<string>()
  private pending: {id: string; text: string; after: number; deadline: number} | null = null
  private privateCreationGeneration: number | null = null
  private creation: { id: string; requestId: string } | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  private running = false
  private oclr: OclrSession
  private irc: IrcSession
  constructor(oclr: OclrSession, irc: IrcSession) {
    this.oclr = oclr; this.irc = irc
    irc.on('state', () => {
      this.refreshPairing()
      const created = irc.state.creation
      if (this.privateCreationGeneration === irc.sessionGeneration && ['created', 'blocked'].includes(created?.status) && created.roomId) {
        this.privateCreationGeneration = null
        this.oclr.emit('private-room', created.roomId)
      }
    })
    irc.on('message', ({roomId, roomEpoch, message}: {roomId: number; roomEpoch: number; message: Message}) => {
      if (!this.pairingReady() || !this.sameRoom(this.irc.state) || !this.binding || roomId !== this.binding.roomId || roomEpoch !== this.binding.roomEpoch || !this.pending || message.kind !== 'bot' || normalize(message.sender) !== 'banchobot' || message.id <= this.pending.after) return
      const projected = projectedMessage(message)
      if (!projected) return
      const status = relayReply(this.pending.text, projected.text)
      if (status) { this.receipts.push({commandId: this.pending.id, status, evidence: {sender: 'BanchoBot', target: `#mp_${roomId}`, text: projected.text}}); this.pending = null }
    })
    oclr.on('state', () => {
      this.refreshPairing()
      if (this.binding && (!oclr.state.subject || oclr.state.subject.osuId !== this.binding.subjectId || oclr.state.selectedFixtureId !== this.binding.fixtureId || normalize(oclr.state.subject.username) !== this.binding.username)) void this.stop()
    })
  }
  refreshPairing() {
    const irc = this.irc.state, website = this.oclr.state
    if (this.identity.update({ generation: this.irc.sessionGeneration, online: irc.connection === 'online', username: irc.username }, { generation: this.oclr.sessionGeneration, subject: website.subject })) {
      this.oclr.updatePairing(this.identity.state)
      if (this.binding || this.running) void this.stop()
    }
  }
  confirmPairing(input: unknown) { this.refreshPairing(); this.identity.confirm(input); this.oclr.updatePairing(this.identity.state) }
  private pairingReady() { this.refreshPairing(); return this.identity.ready }
  private sameRoom(state: Snapshot) { const b = this.binding; return !!b && (b.roomId === 0 ? state.connection === 'online' && normalize(state.username) === b.username : state.room?.joined === true && state.room.kind === 'match' && state.room.id === b.roomId && state.room.epoch === b.roomEpoch && normalize(state.username) === b.username) }
  async start() {
    if (!this.pairingReady()) throw new OclrError('RELAY_LOCAL_NOT_READY')
    if (this.binding || this.running) throw new OclrError('RELAY_ALREADY_ACTIVE')
    const state = this.oclr.state, irc = this.irc.state
    const preparing = !irc.room && irc.creation.status === 'unreviewed' && irc.creation.roomId === null
    if (!state.subject || !state.selectedFixtureId || state.panelState !== 'fresh' || irc.connection !== 'online' || (!preparing && (!irc.room?.joined || irc.room.kind !== 'match' || irc.room.binding !== 'verified' || irc.room.referee !== 'listed')) || normalize(irc.username) !== normalize(state.subject.username)) throw new OclrError('RELAY_LOCAL_NOT_READY')
    const subjectId = state.subject.osuId, fixtureId = state.selectedFixtureId
    const roomId = preparing ? 0 : irc.room!.id, roomEpoch = preparing ? 0 : irc.room!.epoch, username = normalize(irc.username)
    const generation = ++this.generation
    this.running = true; this.oclr.updateRelay({status: 'connecting', roomId: roomId || null, error: null})
    try {
      const response = await this.oclr.relayRequest(state.selectedFixtureId, {action: 'bind', roomId, ircUsername: irc.username})
      const reply = replySchema.parse(response.value).data
      if (generation !== this.generation) return
      const current = this.irc.state, website = this.oclr.state
      if (!this.pairingReady() || generation !== this.generation || website.subject?.osuId !== subjectId || normalize(website.subject?.username ?? '') !== username || website.selectedFixtureId !== fixtureId || website.panelState !== 'fresh' || current.connection !== 'online' || (preparing ? !!current.room || current.creation.status !== 'unreviewed' || current.creation.roomId !== null : current.room?.id !== roomId || current.room.epoch !== roomEpoch || !current.room.joined || current.room.binding !== 'verified' || current.room.referee !== 'listed') || normalize(current.username) !== username) throw new Error('Binding identity changed')
      if (reply.sequence !== 0 || reply.command !== null) throw new Error('Unexpected bind response')
      this.binding = {subjectId, fixtureId, connectionId: reply.connectionId, roomId, roomEpoch, username: normalize(irc.username), sequence: 0}
      this.consumed.clear(); this.receipts = []; this.pending = null
      this.oclr.updateRelay({status: 'connected', roomId: roomId || null, error: null})
      this.timer = setTimeout(() => void this.tick(), 100)
    } catch { if (generation === this.generation) this.oclr.updateRelay({status: 'error', roomId: roomId || null, error: '無法建立網站投影，請重新授權或確認場次權限。'}) }
    finally { this.running = false }
  }
  private async tick() {
    const binding = this.binding, generation = this.generation
    if (!binding || this.running) return
    this.running = true
    try {
      if (!this.pairingReady()) { await this.stop(); return }
      const irc = this.irc.state, same = this.sameRoom(irc)
      if (this.pending && (!same || irc.connection !== 'online' || performance.now() >= this.pending.deadline)) { this.receipts.push({commandId: this.pending.id, status: 'unknown'}); this.pending = null }
      let createdRoomId: number | undefined
      if (this.creation && irc.creation.status === 'created' && irc.creation.roomId === irc.room?.id && irc.room.joined && irc.room.binding === 'verified' && irc.room.referee === 'listed') {
        createdRoomId = irc.room.id; binding.roomId = irc.room.id; binding.roomEpoch = irc.room.epoch
        this.oclr.updateRelay({status: 'connected', roomId: binding.roomId, error: null})
      }
      if (this.creation && (createdRoomId || !['awaiting', 'created'].includes(irc.creation.status))) {
        this.receipts.push({commandId: this.creation.id, status: 'unknown'}); this.creation = null
      }
      const receipts = this.receipts.splice(0, 10)
      const response = await this.oclr.relayRequest(binding.fixtureId, {action: 'sync', connectionId: binding.connectionId, sequence: ++binding.sequence, ...(createdRoomId ? {roomId: createdRoomId} : {}), projection: {status: same && irc.connection === 'online' ? 'connected' : 'disconnected', messages: same && binding.roomId !== 0 ? irc.messages.slice(-100).map(projectedMessage).filter(m => m !== null) : []}, receipts})
      const reply = replySchema.parse(response.value).data
      if (!this.pairingReady() || generation !== this.generation) return
      if (reply.connectionId !== binding.connectionId || reply.sequence !== binding.sequence) throw new Error('Unexpected relay generation')
      if (!this.sameRoom(this.irc.state)) { await this.stop(); return }
      const command = reply.command
      if (command && !this.consumed.has(command.id)) {
        // Consume before validation and socket write. Never retry after ambiguity.
        this.consumed.add(command.id)
        if (this.consumed.size > 2000) throw new Error('Relay session limit')
        if (binding.roomId === 0) {
          try {
            const current = this.irc.state
            const name = /^!mp make (.{1,200})$/u.exec(command.text)?.[1]
            if (!name || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(name) || command.target !== 'BanchoBot' || this.creation || !this.pairingReady() || this.oclr.state.panelState !== 'fresh' || current.room || current.creation.roomId !== null || current.creation.status !== 'unreviewed') throw new Error('Invalid creation')
            this.creation = {id: command.id, requestId: current.creation.requestId}
            this.privateCreationGeneration = this.irc.sessionGeneration
            this.irc.createRoom({name, requestId: current.creation.requestId, reviewed: true})
            this.receipts.push({commandId: command.id, status: 'sent'})
          } catch { const status = ['awaiting', 'unknown', 'blocked'].includes(this.irc.state.creation.status) ? 'unknown' : 'failed'; this.creation = null; this.receipts.push({commandId: command.id, status}) }
        } else if (!same || irc.connection !== 'online' || command.target !== `#mp_${binding.roomId}` || this.pending) this.receipts.push({commandId: command.id, status: 'failed'})
        else {
          try {
            const text = relayCommand(command.text)
            const target = {roomId: binding.roomId, roomEpoch: binding.roomEpoch}
            if (!this.irc.relayReady(target, text)) {
              this.irc.relayRefresh(target)
              const deadline = performance.now() + 8000
              while (!this.irc.relayReady(target, text) && performance.now() < deadline && generation === this.generation && this.sameRoom(this.irc.state)) await new Promise(resolve => setTimeout(resolve, 50))
            }
            if (!this.pairingReady() || generation !== this.generation || !this.sameRoom(this.irc.state) || !this.irc.relayReady(target, text)) throw new Error('Local room checks failed')
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
    this.creation = null
    this.generation++; this.binding = null; this.pending = null; this.receipts = []; this.consumed.clear()
    if (this.timer) clearTimeout(this.timer); this.timer = null
    this.oclr.updateRelay({status: 'off', roomId: null, error: null})
    if (binding) try { await this.oclr.relayRequest(binding.fixtureId, {action: 'disconnect', connectionId: binding.connectionId}) } catch { /* Local stop always wins; server heartbeat expires. */ }
  }
}
