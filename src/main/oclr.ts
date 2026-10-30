import { EventEmitter } from 'node:events'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { authRequestSchema, fixturePageSchema, OCLR_SCOPES, panelSchema, tokenSchema, uuid } from '../shared/oclr-contracts.ts'
import { emptyOclrState } from '../shared/oclr-state.ts'
import type { FixtureSummary, OclrCommand, OclrSnapshot, OclrRelayState } from '../shared/oclr-contracts.ts'
import { refereeCommands } from '../shared/oclr-website/referee-commands.ts'
import { OclrError, OclrHttp, publicOclrError } from './oclr-http.ts'
import type { HttpReply } from './oclr-http.ts'
import { openLoopback } from './oclr-loopback.ts'
import type { Loopback } from './oclr-loopback.ts'

interface Options {
  origin?: string
  version: string
  platform: string
  openExternal(url: string): Promise<unknown>
  writeClipboard(text: string): Promise<void>
  fetcher?: typeof fetch
  now?: () => number
  loopback?: typeof openLoopback
}
type Pair = z.infer<typeof tokenSchema>['data'] & { accessUntil: number; refreshUntil: number; sessionUntil: number }
const fatalCodes = new Set(['INVALID_ACCESS_TOKEN', 'SESSION_REVOKED', 'SESSION_EXPIRED', 'INVALID_REFRESH_TOKEN', 'REFEREE_ACCESS_REVOKED', 'REFEREE_ACCESS_REQUIRED', 'INSUFFICIENT_SCOPE'])

export class OclrSession extends EventEmitter {
  private value = emptyOclrState()
  private pair: Pair | null = null
  private http: OclrHttp
  private options: Options
  private now: () => number
  private generation = 0
  private panelGeneration = 0
  private tokenGeneration = 0
  private controller = new AbortController()
  private panelController = new AbortController()
  private loopback: Loopback | null = null
  private refreshing: Promise<void> | null = null
  private listing: Promise<void> | null = null
  private reading: Promise<void> | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private expiryTimer: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private freshTimer: ReturnType<typeof setTimeout> | null = null
  private clearTimer: ReturnType<typeof setTimeout> | null = null
  private listClearTimer: ReturnType<typeof setTimeout> | null = null
  private listPollTimer: ReturnType<typeof setTimeout> | null = null
  private selectedFixture: FixtureSummary | null = null
  private panelFreshUntil = 0
  private panelPurgeUntil = 0
  private captureTime = 0
  private captureAnchor = 0
  private listPurgeUntil = 0
  private blockedUntil = 0
  private foreground = true
  private nextCursor: string | null = null
  private collectionRevision: string | null = null
  private pollAfterSeconds = 15
  constructor(options: Options) {
    super(); this.options = options; this.now = options.now ?? (() => performance.now())
    this.http = new OclrHttp(options.fetcher, this.now, options.origin)
  }
  get state(): OclrSnapshot {
    // Timer callbacks can be delayed; monotonic deadlines also gate every IPC snapshot.
    if (this.pair && this.now() >= Math.min(this.pair.refreshUntil, this.pair.sessionUntil)) { this.reset(); this.value.status = 'error'; this.value.error = publicOclrError(new OclrError('SESSION_EXPIRED')) }
    if (this.value.fixtures.length && this.now() >= this.listPurgeUntil) { this.value.fixtures = []; this.value.hasMore = false; this.nextCursor = null; this.clearPanel() }
    if (this.value.panel && this.now() >= this.panelPurgeUntil) { this.value.panel = null; this.value.panelState = 'unavailable'; this.value.selectedMapId = null; this.value.previewId = '' }
    const state = structuredClone(this.value)
    if (state.panelState === 'fresh' && this.now() >= this.panelFreshUntil) state.panelState = 'stale'
    state.commands = this.commands()
    return state
  }
  private publish() { this.emit('state', this.state) }
  private clearTimers() {
    for (const timer of [this.refreshTimer, this.expiryTimer, this.pollTimer, this.freshTimer, this.clearTimer, this.listClearTimer, this.listPollTimer]) if (timer) clearTimeout(timer)
    this.refreshTimer = this.expiryTimer = this.pollTimer = this.freshTimer = this.clearTimer = this.listClearTimer = this.listPollTimer = null
  }
  private reset() {
    this.generation++; this.panelGeneration++; this.tokenGeneration++
    this.controller.abort(); this.controller = new AbortController()
    this.panelController.abort(); this.panelController = new AbortController()
    this.loopback?.cancel(); this.loopback = null
    this.clearTimers(); this.pair = null; this.refreshing = this.listing = this.reading = null
    this.nextCursor = this.collectionRevision = null; this.panelFreshUntil = this.panelPurgeUntil = this.listPurgeUntil = this.captureTime = this.captureAnchor = 0; this.selectedFixture = null
    // A 429 is an origin-wide backoff; logout/login must not bypass it.
    const retryAt = this.blockedUntil > this.now() ? this.value.retryAt : null
    this.value = { ...emptyOclrState(), retryAt }
  }
  dispose() { this.reset(); this.publish() }
  private fatal(error: unknown) {
    this.reset(); this.value.status = 'error'; this.value.error = publicOclrError(error); this.publish()
  }
  private backoff(error: unknown) {
    if (error instanceof OclrError && error.status === 429) {
      this.blockedUntil = Math.max(this.blockedUntil, this.now() + error.retryAfterMs)
      this.value.retryAt = new Date(Date.now() + this.blockedUntil - this.now()).toISOString()
    }
  }
  private available() {
    if (this.now() < this.blockedUntil) throw new OclrError('RATE_LIMITED', 429, this.blockedUntil - this.now())
    this.value.retryAt = null
  }
  private validate<T>(schema: z.ZodType<T>, reply: HttpReply): T {
    const parsed = schema.safeParse(reply.value)
    if (!parsed.success) throw new OclrError('INVALID_RESPONSE')
    return parsed.data
  }
  updateRelay(value: OclrRelayState) { this.value.relay = value; this.publish() }
  async relayRequest(fixtureId: string, body: unknown) {
    this.available()
    if (!this.pair || !this.value.fixtures.some(f => f.fixtureId === fixtureId)) throw new OclrError('FIXTURE_NOT_AVAILABLE')
    const generation = this.generation
    if (this.refreshing) await this.refreshing
    if (this.pair && this.now() >= this.pair.accessUntil) await this.refresh()
    if (!this.pair || generation !== this.generation) throw new OclrError('CANCELLED')
    // Relay mutations have at-most-once delivery: never retry a lost response.
    return this.http.request(`/api/referee/v1/fixtures/${fixtureId}/relay`, {method: 'POST', token: this.pair.access_token, body, signal: this.controller.signal, maxBytes: 131072})
  }
  async login() {
    this.available()
    if (this.value.status === 'authorizing' || this.pair) throw new OclrError('INVALID_RESPONSE')
    this.reset(); const generation = this.generation
    this.value.status = 'authorizing'; this.publish()
    const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url')
    let listener: Loopback | null = null
    try {
      listener = await (this.options.loopback ?? openLoopback)(state)
      if (generation !== this.generation) { listener.cancel(); return }
      this.loopback = listener
      const response = await this.http.request('/api/desktop/v1/auth/requests', { method: 'POST', signal: this.controller.signal,
        body: { client_id: 'oclr-ref-tools', client_version: this.options.version, platform: this.options.platform, device_name: 'OCLR IRC', redirect_uri: listener.redirectUri, scope: [...OCLR_SCOPES], state, code_challenge: challenge, code_challenge_method: 'S256' } })
      if (generation !== this.generation) return
      const { data, meta } = this.validate(authRequestSchema, response)
      const url = new URL(data.authorization_url)
      const expected = `${this.http.origin}/desktop/authorize?request_id=${data.authorization_request_id}`
      const remaining = Date.parse(data.expires_at) - Date.parse(meta.serverTime) - (response.receivedAt - response.startedAt)
      if (url.href !== expected || url.username || url.password || remaining <= 0 || remaining > 600000) throw new OclrError('INVALID_RESPONSE')
      listener.expireAfter(remaining)
      this.value.authorization = { verificationCode: data.verification_code, expiresAt: data.expires_at }; this.publish()
      await this.options.openExternal(expected)
      if (generation !== this.generation) return
      void this.finishLogin(listener, data.authorization_request_id, verifier, generation)
    } catch (error) {
      listener?.cancel()
      if (generation === this.generation) { this.backoff(error); this.fatal(error) }
      throw new OclrError(error instanceof OclrError ? error.code : 'SERVICE_UNAVAILABLE')
    }
  }
  private async finishLogin(listener: Loopback, requestId: string, verifier: string, generation: number) {
    try {
      const result = await listener.result
      if (generation !== this.generation) return
      this.loopback = null
      if ('error' in result) throw new OclrError(result.error)
      const response = await this.http.request('/api/desktop/v1/auth/exchange', { method: 'POST', signal: this.controller.signal, body: { authorization_request_id: requestId, client_id: 'oclr-ref-tools', code: result.code, code_verifier: verifier, redirect_uri: listener.redirectUri } })
      if (generation !== this.generation) return
      this.acceptPair(response)
      this.value.authorization = null; this.value.status = 'connected'; this.value.error = null; this.publish()
      await this.loadFixtures()
    } catch (error) { if (generation === this.generation && this.value.status === 'authorizing') { this.backoff(error); this.fatal(error) } }
  }
  cancelLogin() { if (this.value.status === 'authorizing') { this.reset(); this.publish() } }
  private acceptPair(response: HttpReply, previous?: Pair) {
    const { data, meta } = this.validate(tokenSchema, response)
    const server = Date.parse(meta.serverTime), access = Date.parse(data.access_expires_at), refresh = Date.parse(data.refresh_expires_at), absolute = Date.parse(data.session_expires_at)
    const rtt = response.receivedAt - response.startedAt
    if (access <= server + rtt || refresh <= server + rtt || absolute <= server + rtt || access > absolute || refresh > absolute || absolute - server > 12 * 3600000 || refresh - server > 2 * 3600000 || Math.abs(access - Math.min(server + 600000, absolute)) > 1000 || Math.abs(access - server - data.expires_in * 1000) > 1000) throw new OclrError('INVALID_RESPONSE')
    if (previous && (data.session_id !== previous.session_id || data.subject.osuId !== previous.subject.osuId || data.session_expires_at !== previous.session_expires_at || data.refresh_token === previous.refresh_token)) throw new OclrError('INVALID_RESPONSE')
    const sessionUntil = Math.min(response.receivedAt + absolute - server - rtt, previous?.sessionUntil ?? Infinity)
    this.pair = { ...data, accessUntil: Math.min(response.receivedAt + access - server - rtt, sessionUntil), refreshUntil: Math.min(response.receivedAt + refresh - server - rtt, sessionUntil), sessionUntil }
    this.tokenGeneration++; this.value.subject = data.subject
    this.scheduleRefresh()
    if (this.expiryTimer) clearTimeout(this.expiryTimer)
    this.expiryTimer = setTimeout(() => this.fatal(new OclrError('SESSION_EXPIRED')), Math.max(1, Math.min(this.pair.refreshUntil, this.pair.sessionUntil) - this.now()))
  }
  private scheduleRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    if (!this.pair) return
    if (Date.parse(this.pair.access_expires_at) >= Date.parse(this.pair.session_expires_at)) return
    const remaining = this.pair.accessUntil - this.now()
    const delay = Math.max(1000, remaining > 60000 ? remaining - 60000 : remaining / 2, this.blockedUntil - this.now())
    this.refreshTimer = setTimeout(() => { void this.refresh().catch(() => {}) }, delay)
  }
  private refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing
    const generation = this.generation, previous = this.pair
    if (!previous) return Promise.reject(new OclrError('SESSION_EXPIRED'))
    this.value.status = 'refreshing'; this.publish()
    const task = (async () => {
      try {
        this.available()
        if (this.now() >= Math.min(previous.refreshUntil, previous.sessionUntil)) throw new OclrError('SESSION_EXPIRED')
        const response = await this.http.request('/api/desktop/v1/auth/refresh', { method: 'POST', signal: this.controller.signal, body: { client_id: 'oclr-ref-tools', refresh_token: previous.refresh_token } })
        if (generation !== this.generation) throw new OclrError('CANCELLED')
        this.acceptPair(response, previous); this.value.status = 'connected'; this.value.error = null; this.publish()
      } catch (error) {
        if (generation === this.generation) {
          this.backoff(error)
          if (error instanceof OclrError && error.status === 429) { this.value.status = 'connected'; this.value.error = publicOclrError(error); this.scheduleRefresh(); this.publish() }
          else this.fatal(error)
        }
        throw error
      }
    })()
    this.refreshing = task
    void task.finally(() => { if (this.refreshing === task) this.refreshing = null }).catch(() => {})
    return task
  }
  private async get(path: string, maxBytes: number, signal?: AbortSignal): Promise<HttpReply> {
    this.available()
    const generation = this.generation
    if (!this.pair) throw new OclrError('SESSION_EXPIRED')
    if (this.refreshing) await this.refreshing
    if (this.pair && this.now() >= this.pair.accessUntil) await this.refresh()
    const tokenGeneration = this.tokenGeneration
    const request = () => {
      if (!this.pair || generation !== this.generation) throw new OclrError('CANCELLED')
      return this.http.request(path, { token: this.pair.access_token, maxBytes, signal: signal ? AbortSignal.any([this.controller.signal, signal]) : this.controller.signal })
    }
    try { return await request() }
    catch (error) {
      if (generation !== this.generation) throw new OclrError('CANCELLED')
      this.backoff(error)
      if (error instanceof OclrError && error.status === 401 && error.code === 'ACCESS_TOKEN_EXPIRED') {
        if (this.tokenGeneration === tokenGeneration) await this.refresh()
        try { return await request() } catch (retryError) { if (generation === this.generation) { this.backoff(retryError); if (retryError instanceof OclrError && (retryError.status === 401 || fatalCodes.has(retryError.code))) this.fatal(retryError) }; throw retryError }
      }
      if (error instanceof OclrError && (error.status === 401 || fatalCodes.has(error.code))) this.fatal(error)
      throw error
    }
  }
  loadFixtures(more = false): Promise<void> {
    if (this.listing) return this.listing
    if (more && !this.nextCursor) return Promise.resolve()
    const generation = this.generation
    this.value.fixturesLoading = true; this.publish()
    const task = (async () => {
      try {
        let cursor = more ? this.nextCursor : null, base = more ? [...this.value.fixtures] : [], expectedRevision = more ? this.collectionRevision : null
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const query = new URLSearchParams({ view: 'active', limit: '50' })
            if (cursor) query.set('cursor', cursor)
            const response = await this.get('/api/referee/v1/me/fixtures?' + query, 262144)
            if (generation !== this.generation) return
            const { data } = this.validate(fixturePageSchema, response)
            if (expectedRevision && expectedRevision !== data.collectionRevision) throw new OclrError('COLLECTION_CHANGED', 409)
            for (const item of data.items) this.reviewUrl(item)
            if (data.items.some(item => base.some(previous => previous.fixtureId === item.fixtureId)) || new Set(data.items.map(item => item.fixtureId)).size !== data.items.length || base.length + data.items.length > 500) throw new OclrError('INVALID_RESPONSE')
            this.value.fixtures = [...base, ...data.items]; this.nextCursor = data.nextCursor; this.collectionRevision = data.collectionRevision; this.value.hasMore = data.nextCursor !== null; this.value.error = null
            this.listPurgeUntil = response.startedAt + 300000
            const selected = this.value.fixtures.find(f => f.fixtureId === this.value.selectedFixtureId)
            if (selected) this.selectedFixture = selected
            else if (this.value.selectedFixtureId && !more && !data.nextCursor) this.clearPanel()
            if (this.listClearTimer) clearTimeout(this.listClearTimer)
            // Lists are private too: failed refresh cannot retain them indefinitely.
            this.listClearTimer = setTimeout(() => { this.value.fixtures = []; this.value.hasMore = false; this.nextCursor = null; this.clearPanel(); this.publish() }, 300000)
            return
          } catch (error) {
            if (error instanceof OclrError && error.code === 'COLLECTION_CHANGED' && attempt === 0) { base = []; cursor = expectedRevision = null; continue }
            throw error
          }
        }
      } catch (error) { if (generation === this.generation) {
        this.backoff(error); this.value.error = publicOclrError(error)
        if (error instanceof OclrError && ['INVALID_RESPONSE', 'INTEGRATION_UNAVAILABLE', 'RESPONSE_TOO_LARGE'].includes(error.code)) { this.value.fixtures = []; this.value.hasMore = false; this.nextCursor = this.collectionRevision = null; this.clearPanel() }
      } }
      finally { if (generation === this.generation) { this.value.fixturesLoading = false; this.publish(); this.scheduleList() } }
    })()
    this.listing = task; void task.finally(() => { if (this.listing === task) this.listing = null }).catch(() => {})
    return task
  }
  private clearPanel() {
    this.panelGeneration++; this.panelController.abort(); this.panelController = new AbortController(); this.reading = null
    for (const timer of [this.pollTimer, this.freshTimer, this.clearTimer]) if (timer) clearTimeout(timer)
    this.pollTimer = this.freshTimer = this.clearTimer = null
    this.selectedFixture = null; this.value.selectedFixtureId = null; this.value.panel = null; this.value.panelState = 'empty'; this.value.selectedMapId = null; this.value.previewId = ''
    this.captureTime = this.captureAnchor = this.panelFreshUntil = this.panelPurgeUntil = 0
  }
  selectFixture(input: unknown) {
    if (!uuid.safeParse(input).success || !this.pair || !this.value.fixtures.some(item => item.fixtureId === input)) throw new OclrError('FIXTURE_NOT_AVAILABLE')
    if (this.value.selectedFixtureId === input) return this.readPanel()
    this.clearPanel(); this.value.selectedFixtureId = input as string; this.selectedFixture = this.value.fixtures.find(f => f.fixtureId === input)!; this.publish()
    return this.readPanel()
  }
  readPanel(): Promise<void> {
    if (this.reading) return this.reading
    if (!this.value.selectedFixtureId) return Promise.resolve()
    const generation = this.generation, panelGeneration = this.panelGeneration, id = this.value.selectedFixtureId
    const fixture = this.selectedFixture
    if (!fixture) return Promise.resolve()
    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.value.panelState = this.value.panel ? 'stale' : 'loading'; this.publish()
    const task = (async () => {
      try {
        const response = await this.get(`/api/referee/v1/fixtures/${id}/panel`, 524288, this.panelController.signal)
        if (generation !== this.generation || panelGeneration !== this.panelGeneration) return
        const { data, meta } = this.validate(panelSchema, response)
        const server = Date.parse(meta.serverTime), captured = Date.parse(data.capturedAt), fresh = Date.parse(data.freshUntil)
        const rtt = response.receivedAt - response.startedAt
        if (!/^1\.(?:[1-9]\d*)\.\d+$/.test(meta.contractVersion) || data.viewer.osuId !== this.pair?.subject.osuId || data.workspace.fixture.id !== id || data.edition.slug !== fixture.edition.slug || data.workspace.round.id !== fixture.round.id || captured > server || captured < this.captureTime || fresh < captured || fresh - captured > 30000 || server - captured + rtt >= 300000) throw new OclrError('INVALID_RESPONSE')
        const anchor = response.receivedAt - (server - captured) - rtt
        this.captureAnchor = captured === this.captureTime ? Math.min(this.captureAnchor, anchor) : anchor
        this.captureTime = captured
        this.panelPurgeUntil = this.captureAnchor + 300000
        if (this.now() >= this.panelPurgeUntil) throw new OclrError('INVALID_RESPONSE')
        this.value.panel = data; this.panelFreshUntil = this.captureAnchor + fresh - captured
        this.value.panelState = this.now() < this.panelFreshUntil ? 'fresh' : 'stale'
        this.value.previewId = randomUUID(); this.value.error = null
        if (!data.workspace.maps.some(m => m.id === this.value.selectedMapId)) this.value.selectedMapId = null
        this.pollAfterSeconds = meta.pollAfterSeconds ?? 15
        if (this.freshTimer) clearTimeout(this.freshTimer)
        if (this.clearTimer) clearTimeout(this.clearTimer)
        this.freshTimer = setTimeout(() => { this.value.panelState = 'stale'; this.publish() }, Math.max(1, this.panelFreshUntil - this.now()))
        this.clearTimer = setTimeout(() => { if (generation === this.generation && panelGeneration === this.panelGeneration) { this.value.panel = null; this.value.panelState = 'unavailable'; this.value.selectedMapId = null; this.value.previewId = ''; this.publish() } }, Math.max(1, this.panelPurgeUntil - this.now()))
      } catch (error) {
        if (generation !== this.generation || panelGeneration !== this.panelGeneration) return
        this.backoff(error); this.value.error = publicOclrError(error)
        if (error instanceof OclrError && error.status === 404) { this.value.fixtures = this.value.fixtures.filter(f => f.fixtureId !== id); this.clearPanel() }
        else if (error instanceof OclrError && ['INVALID_RESPONSE', 'INTEGRATION_UNAVAILABLE', 'RESPONSE_TOO_LARGE'].includes(error.code)) { this.value.panel = null; this.value.panelState = 'unavailable'; this.value.selectedMapId = null; this.value.previewId = '' }
        else this.value.panelState = this.value.panel ? 'stale' : 'unavailable'
      } finally {
        if (generation === this.generation && panelGeneration === this.panelGeneration) { this.publish(); this.schedulePoll() }
      }
    })()
    this.reading = task; void task.finally(() => { if (this.reading === task) this.reading = null }).catch(() => {})
    return task
  }
  private schedulePoll() {
    if (this.pollTimer) clearTimeout(this.pollTimer)
    if (!this.pair || !this.value.selectedFixtureId) return
    const delay = Math.max((this.foreground ? 15 : 60) * 1000, this.pollAfterSeconds * 1000, this.blockedUntil - this.now())
    this.pollTimer = setTimeout(() => { void this.readPanel() }, delay)
  }
  private scheduleList() {
    if (this.listPollTimer) clearTimeout(this.listPollTimer)
    if (!this.pair) return
    this.listPollTimer = setTimeout(() => { void this.loadFixtures() }, Math.max(this.foreground ? 60000 : 120000, this.blockedUntil - this.now()))
  }
  setForeground(foreground: boolean) {
    const resumed = foreground && !this.foreground
    this.foreground = foreground
    if (resumed && this.pair) { void this.loadFixtures(); if (this.value.selectedFixtureId) void this.readPanel() }
    else this.schedulePoll()
    this.scheduleList()
  }
  suspend() { void this.logout(); this.value.error = '電腦已休眠，OCLR 資料已清除；恢復後請重新授權。'; this.publish() }
  selectMap(input: unknown) {
    if (!this.value.panel?.workspace.maps.some(map => map.id === input) || !this.fresh()) throw new OclrError('INVALID_RESPONSE')
    this.value.selectedMapId = input as string; this.value.previewId = randomUUID(); this.publish()
  }
  private fresh() { return this.value.status === 'connected' && this.pair !== null && this.now() < this.pair.accessUntil && this.value.panelState === 'fresh' && this.now() < this.panelFreshUntil }
  private commands(): OclrCommand[] {
    const panel = this.value.panel
    if (!panel) return []
    const w = panel.workspace
    const selectedMap = w.maps.find(m => m.id === this.value.selectedMapId) ?? null
    const commands = refereeCommands({ settings: w.session?.settings ?? w.defaultSettings, policy: w.policy?.commands ?? null, rules: w.rules, teams: w.teams, selectedMap })
    const staleDependencies = w.session && w.session.dependencyFingerprint !== w.dependencyFingerprint
    return commands.map(command => {
      const supported = w.rules?.mode === 'osu' && w.rules.scoringType === 'scorev2' && (w.rules.teamType !== 'head-to-head' || w.rules.playersPerTeam === 1)
      const reason = !this.fresh() ? '資料已過期或連線尚未就緒，請重新整理。' : staleDependencies ? '網站場次依賴已變更，請先在網站重新核對。' : !this.selectedFixture?.operational || w.fixture.status === 'cancelled' || this.selectedFixture.resultReviewState === 'approved' ? '此場次僅供查閱，不能準備操作指令。' : !supported ? '此規則超出桌面首期支援範圍。' : command.text && (Buffer.byteLength(`PRIVMSG ${command.kind === 'make' ? 'BanchoBot' : '#mp_9007199254740991'} :${command.text}`) > 510 || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(command.text)) ? '指令超過 IRC 長度或包含控制字元。' : command.reason
      return { ...command, text: reason ? null : command.text, reason }
    })
  }
  async copyCommand(input: unknown) {
    const parsed = z.object({ previewId: uuid, commandId: z.string().min(1).max(200) }).strict().safeParse(input)
    if (!parsed.success || parsed.data.previewId !== this.value.previewId || !this.fresh()) throw new OclrError('INVALID_RESPONSE')
    const command = this.commands().find(command => command.id === parsed.data.commandId)
    if (!command?.text) throw new OclrError('INVALID_RESPONSE')
    await this.options.writeClipboard(command.text)
  }
  private reviewUrl(fixture: FixtureSummary) {
    const expected = `${this.http.origin}/admin/tournaments/${fixture.edition.slug}/matches/${fixture.fixtureId}`
    if (fixture.reviewUrl !== expected) throw new OclrError('INVALID_RESPONSE')
    return expected
  }
  async openReview(input: unknown) {
    const fixture = this.value.fixtures.find(f => f.fixtureId === input)
    if (!fixture || !this.pair) throw new OclrError('FIXTURE_NOT_AVAILABLE')
    await this.options.openExternal(this.reviewUrl(fixture))
  }
  async logout() {
    const pair = this.pair
    this.reset(); const generation = this.generation
    this.value.remoteRevocation = pair ? 'unconfirmed' : 'none'; this.publish()
    if (!pair) return
    try {
      await this.http.request('/api/desktop/v1/auth/revoke', { method: 'POST', body: { client_id: 'oclr-ref-tools', refresh_token: pair.refresh_token } })
      if (generation === this.generation) { this.value.remoteRevocation = 'none'; this.publish() }
    } catch { /* Local privacy cleanup is already complete. No token retained for retries. */ }
  }
}
