import { normalize } from './protocol.ts'
import type { AccountPairingState } from '../shared/oclr-contracts.ts'

/** Compare authenticated session names automatically; never an IRC UID proof. */
export class AccountPairing {
  private key = ''
  private value: AccountPairingState = { status: 'unknown', ircUsername: null }
  update(irc: { generation: number; online: boolean; username: string }, website: { generation: number; subject: { osuId: number; username: string } | null }) {
    const key = JSON.stringify([irc.generation, irc.online, irc.username, website.generation, website.subject?.osuId, website.subject?.username])
    if (key === this.key) return false
    this.key = key
    const available = irc.online && Boolean(irc.username) && Boolean(website.subject?.username)
    this.value = { status: !available ? 'unknown' : normalize(irc.username) === normalize(website.subject!.username) ? 'nickname_matched' : 'mismatch', ircUsername: irc.online ? irc.username : null }
    return true
  }
  get state() { return { ...this.value } }
  get ready() { return this.value.status === 'nickname_matched' }
}
