import { randomUUID } from 'node:crypto'
import { normalize } from './protocol.ts'
import type { AccountPairingState } from '../shared/oclr-contracts.ts'

/** Nickname comparison and explicit human review, never an IRC UID proof. */
export class AccountPairing {
  private key = ''
  private value: AccountPairingState = { status: 'unknown', token: '', reviewed: false, ircUsername: null }
  update(irc: { generation: number; online: boolean; username: string }, website: { generation: number; subject: { osuId: number; username: string } | null }) {
    const key = JSON.stringify([irc.generation, irc.online, irc.username, website.generation, website.subject?.osuId, website.subject?.username])
    if (key === this.key) return false
    this.key = key
    const available = irc.online && Boolean(irc.username) && Boolean(website.subject?.username)
    this.value = { status: !available ? 'unknown' : normalize(irc.username) === normalize(website.subject!.username) ? 'nickname_matched' : 'mismatch', token: randomUUID(), reviewed: false, ircUsername: irc.online ? irc.username : null }
    return true
  }
  get state() { return { ...this.value } }
  get ready() { return this.value.status === 'nickname_matched' && this.value.reviewed }
  confirm(input: unknown) {
    if (!input || typeof input !== 'object' || !('token' in input) || !('reviewed' in input) || input.token !== this.value.token || input.reviewed !== true || this.value.status !== 'nickname_matched') throw new Error('帳號配對已變更，請重新核對。')
    this.value.reviewed = true
  }
}
