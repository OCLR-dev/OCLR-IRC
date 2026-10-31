import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { parseWebsiteLaunch, type WebsiteLaunchState } from '../shared/website-launch.ts'
import type { OclrSession } from './oclr.ts'

/** Memory-only handoff; local confirmation precedes browser auth and fixture navigation. */
export class WebsiteLaunch extends EventEmitter {
  private value: WebsiteLaunchState | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  private selecting = false
  private oclr: OclrSession
  private stopRelay: () => Promise<void>
  constructor(oclr: OclrSession, stopRelay: () => Promise<void>) {
    super()
    this.oclr = oclr; this.stopRelay = stopRelay
    oclr.on('state', () => {
      if (this.value?.status === 'ready' && !oclr.state.subject) { this.clear(); return }
      if (this.value?.status !== 'authorizing') return
      if (oclr.state.status === 'connected') void this.select()
      else if (['error', 'disconnected'].includes(oclr.state.status)) this.clear()
    })
  }
  get state() { return this.value ? {...this.value} : null }
  private publish() { this.emit('state', this.state) }
  receive(url: unknown) {
    const fixtureId = parseWebsiteLaunch(url)
    if (!fixtureId) return false
    if (this.value?.fixtureId === fixtureId) return true
    this.clear()
    this.value = {requestId: randomUUID(), fixtureId, status: 'pending'}
    this.timer = setTimeout(() => this.clear(), 10 * 60_000); this.timer.unref()
    this.publish(); return true
  }
  clear() {
    this.generation++; this.value = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null; this.publish()
  }
  async continue(requestId: unknown) {
    if (!this.value || requestId !== this.value.requestId || !['pending', 'error'].includes(this.value.status)) throw new Error('Invalid launch request')
    const generation = this.generation
    this.value.status = 'loading'; this.publish()
    try {
      await this.stopRelay()
      if (generation !== this.generation || !this.value) return
      if (!this.oclr.state.subject) {
        this.value.status = 'authorizing'; this.publish()
        if (this.oclr.state.status !== 'authorizing') await this.oclr.login()
      } else await this.select()
    } catch { if (generation === this.generation && this.value) { this.value.status = 'error'; this.publish() } }
  }
  private async select() {
    if (this.selecting || !this.value) return
    this.selecting = true
    const generation = this.generation, fixtureId = this.value.fixtureId
    const session = this.oclr.sessionGeneration, subject = this.oclr.state.subject?.osuId
    const current = () => generation === this.generation && !!subject && this.oclr.sessionGeneration === session && this.oclr.state.subject?.osuId === subject
    this.value.status = 'loading'; this.publish()
    try {
      await this.oclr.loadFixtures()
      for (let page = 0; current() && !this.oclr.state.fixtures.some(f => f.fixtureId === fixtureId) && this.oclr.state.hasMore && page < 10; page++) await this.oclr.loadFixtures(true)
      if (!current()) { if (generation === this.generation) this.clear(); return }
      if (!this.oclr.state.fixtures.some(f => f.fixtureId === fixtureId)) throw new Error('Not assigned')
      await this.oclr.selectFixture(fixtureId)
      if (!current()) { if (generation === this.generation) this.clear(); return }
      if (this.oclr.state.panelState !== 'fresh') throw new Error('Panel unavailable')
      this.value!.status = 'ready'; this.publish()
    } catch { if (generation === this.generation && this.value) { this.value.status = 'error'; this.publish() } }
    finally {
      this.selecting = false
      if (generation !== this.generation && this.value?.status === 'loading') { this.value.status = 'pending'; this.publish() }
    }
  }
}
