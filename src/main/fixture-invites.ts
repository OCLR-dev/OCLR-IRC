import { z } from 'zod'
import { uuid, positiveId } from '../shared/oclr-contracts.ts'
import { fixtureInviteSource, type FixtureInvitePreview } from '../shared/fixture-tools.ts'
import type { RoomTarget } from '../shared/types.ts'
import type { OclrSession } from './oclr.ts'
import type { OclrRelay } from './oclr-relay.ts'
import type { IrcSession } from './irc.ts'
const target = z.object({roomId: positiveId, roomEpoch: positiveId})
const input = target.extend({previewId: uuid, teamId: uuid, osuId: positiveId}).strict()
/** Explicit, one-player local action; never a general panel command executor. */
export class FixtureInvites {
  private oclr: OclrSession
  private irc: IrcSession
  private relay: OclrRelay
  private generation = 0
  private preview: {value: FixtureInvitePreview; target: RoomTarget; teamId: string; fingerprint: string; scope: string} | null = null
  private previewTimer: ReturnType<typeof setTimeout> | null = null
  constructor(oclr: OclrSession, irc: IrcSession, relay: OclrRelay) {
    this.oclr = oclr; this.irc = irc; this.relay = relay
    const invalidate = () => {
      if (!this.preview) return
      try {
        if (this.scope(this.preview.target) !== this.preview.scope || fixtureInviteSource(oclr.state, this.preview.teamId, this.preview.value.osuId).fingerprint !== this.preview.fingerprint) throw new Error('Changed source')
      } catch {this.generation++; this.clearPreview()}
    }
    oclr.on('state', invalidate); irc.on('state', invalidate)
  }
  private clearPreview(cancelLocal = true) {
    const preview = this.preview; this.preview = null
    if (this.previewTimer) clearTimeout(this.previewTimer); this.previewTimer = null
    if (cancelLocal && preview) this.irc.cancelWebsiteInvite(preview.value.token)
  }
  private scope(room: RoomTarget) {return JSON.stringify([this.oclr.sessionGeneration, this.irc.sessionGeneration, this.relay.localBinding(room)])}
  private async recheck() {
    const fixtureId = this.oclr.state.selectedFixtureId, generation = this.oclr.sessionGeneration
    await this.oclr.loadFixtures()
    // An assigned fixture can be on a later page. Never retain an old summary
    // when its current assignment/result permission has not been re-read.
    while (generation === this.oclr.sessionGeneration && fixtureId === this.oclr.state.selectedFixtureId && !this.oclr.state.error && this.oclr.state.hasMore && !this.oclr.state.fixtures.some(fixture => fixture.fixtureId === fixtureId)) await this.oclr.loadFixtures(true)
    const state = this.oclr.state, fixture = state.fixtures.find(fixture => fixture.fixtureId === fixtureId)
    if (generation !== this.oclr.sessionGeneration || state.selectedFixtureId !== fixtureId || state.error || !fixture?.operational || fixture.resultReviewState === 'approved' || fixture.status === 'cancelled') throw new Error('場次資料已失效，請重新同步。')
    await this.oclr.readPanel()
  }
  async prepare(value: unknown): Promise<FixtureInvitePreview> {
    this.clearPreview()
    const generation = ++this.generation, parsed = input.parse(value), before = this.oclr.state
    if (parsed.previewId !== before.previewId) throw new Error('場次資料已失效，請重新同步。')
    const source = fixtureInviteSource(before, parsed.teamId, parsed.osuId), scope = this.scope(parsed)
    await this.recheck()
    const current = fixtureInviteSource(this.oclr.state, parsed.teamId, parsed.osuId)
    if (generation !== this.generation || scope !== this.scope(parsed) || source.fingerprint !== current.fingerprint) throw new Error('場次資料已失效，請重新同步。')
    if (this.irc.relayBlocked(parsed, current.command)) throw new Error('此房間有待核對操作，請先在操作記錄核對結果。')
    if (!this.irc.relayReady(parsed, current.command)) {
      this.irc.relayRefresh(parsed)
      const deadline = performance.now() + 8000
      while (!this.irc.relayReady(parsed, current.command) && performance.now() < deadline && generation === this.generation && scope === this.scope(parsed)) await new Promise(resolve => setTimeout(resolve, 50))
    }
    if (generation !== this.generation || scope !== this.scope(parsed) || current.fingerprint !== fixtureInviteSource(this.oclr.state, parsed.teamId, parsed.osuId).fingerprint) throw new Error('場次資料已失效，請重新同步。')
    const local = this.irc.previewWebsiteInvite({...parsed, intent: {kind: 'invite', osuId: String(parsed.osuId), name: current.player.username}})
    const preview = {...local, fixtureLabel: this.oclr.state.panel!.workspace.fixture.label, teamName: current.team.name, osuId: parsed.osuId}
    this.preview = {value: preview, target: {roomId: parsed.roomId, roomEpoch: parsed.roomEpoch}, teamId: parsed.teamId, fingerprint: current.fingerprint, scope}
    this.previewTimer = setTimeout(() => this.clearPreview(), 10000); this.previewTimer.unref()
    return {...preview}
  }
  async execute(value: unknown) {
    const preview = this.preview; this.clearPreview(false); this.generation++
    try {
      const parsed = target.extend({token: uuid, reviewed: z.literal(true), playerName: z.string().max(50)}).strict().parse(value)
      if (!preview || parsed.token !== preview.value.token || parsed.roomId !== preview.target.roomId || parsed.roomEpoch !== preview.target.roomEpoch || parsed.playerName !== preview.value.playerName || this.scope(parsed) !== preview.scope) throw new Error('房間設定確認已失效。')
      const generation = this.generation
      await this.recheck()
      if (generation !== this.generation || this.scope(parsed) !== preview.scope || fixtureInviteSource(this.oclr.state, preview.teamId, preview.value.osuId).fingerprint !== preview.fingerprint) throw new Error('場次資料已失效，請重新同步。')
      this.irc.executeWebsiteInvite(parsed)
    } finally {if (preview) this.irc.cancelWebsiteInvite(preview.value.token)}
  }
}
