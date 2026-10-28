import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { OclrSession } from '../src/main/oclr.ts'
import { OclrHttp, OclrError } from '../src/main/oclr-http.ts'
import { openLoopback } from '../src/main/oclr-loopback.ts'
import type { Loopback } from '../src/main/oclr-loopback.ts'
import { panelSchema } from '../src/shared/oclr-contracts.ts'
import { refereeCommands } from '../src/shared/oclr-website/referee-commands.ts'
import { apiError, at, fixture, fixtures, id, jsonResponse, meta, pair, panel, scopes } from './fixtures/oclr.ts'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(test: () => boolean) { for (let n = 0; n < 100; n++) { if (test()) return; await delay(5) }; throw new Error('condition timed out') }
interface Request { path: string; init: RequestInit; body: Record<string, unknown> }
function harness(handler?: (request: Request) => Promise<Response | void> | Response | void) {
  const requests: Request[] = [], opened: string[] = [], clipboard: string[] = []
  let resolveCallback: (value: { code: string } | { error: string }) => void = () => {}, clock = 1000
  const session = new OclrSession({ version: '0.6.0', platform: 'darwin', now: () => clock,
    openExternal: async url => { opened.push(url) }, writeClipboard: async text => { clipboard.push(text) },
    loopback: async () => { const result = new Promise<{ code: string } | { error: string }>(resolve => { resolveCallback = resolve }); return { redirectUri: 'http://127.0.0.1:49152/oclr/callback', result, cancel: () => resolveCallback({ error: 'CANCELLED' }), expireAfter() {} } satisfies Loopback },
    fetcher: async (url, init = {}) => {
      const request = { path: new URL(String(url)).pathname + new URL(String(url)).search, init, body: init.body ? JSON.parse(String(init.body)) : {} }
      requests.push(request)
      const override = await handler?.(request)
      if (override) return override
      if (request.path.endsWith('/auth/requests')) return jsonResponse({ data: { authorization_request_id: id(1), authorization_url: `https://oclr.org/desktop/authorize?request_id=${id(1)}`, verification_code: 'ABCD-2345', expires_at: at(600) }, meta: meta() }, 201)
      if (request.path.endsWith('/auth/exchange')) return jsonResponse(pair())
      if (request.path.endsWith('/auth/refresh')) return jsonResponse(pair(1))
      if (request.path.endsWith('/auth/revoke')) return new Response(null, { status: 204 })
      if (request.path.startsWith('/api/referee/v1/me/fixtures')) return jsonResponse(fixtures())
      if (request.path.endsWith('/panel')) return jsonResponse(panel(request.path.includes(id(103)) ? 103 : 101))
      throw new Error('Unexpected synthetic endpoint')
    }
  })
  return { session, requests, opened, clipboard, advance: (ms: number) => { clock += ms }, approve: () => resolveCallback({ code: 'C'.repeat(43) }), async login() { await session.login(); resolveCallback({ code: 'C'.repeat(43) }); await until(() => session.state.fixtures.length === 2) } }
}

test('loopback rejects wrong host/state, duplicate or unknown params, methods and replay without consuming the transaction', async () => {
  const state = 'S'.repeat(43), code = 'C'.repeat(43)
  const listener = await openLoopback(state)
  try {
    const url = listener.redirectUri
    for (const query of [`state=${'X'.repeat(43)}&code=${code}`, `state=${state}&state=${state}&code=${code}`, `state=${state}&code=${code}&extra=x`, `state=${state}&code=bad`]) assert.equal((await fetch(url + '?' + query)).status, 400)
    assert.equal((await fetch(url + `?state=${state}&code=${code}`, { method: 'POST' })).status, 400)
    const wrongHost = await new Promise<number>(resolve => { const request = http.get(url + `?state=${state}&code=${code}`, { headers: { Host: 'attacker.invalid' } }, res => { res.resume(); resolve(res.statusCode!) }); request.on('error', () => resolve(0)) })
    assert.equal(wrongHost, 400)
    const response = await fetch(url + `?state=${state}&code=${code}`)
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
    const body = await response.text(); assert.ok(!body.includes(code)); assert.ok(!body.includes(state))
    assert.deepEqual(await listener.result, { code })
    await assert.rejects(fetch(url + `?state=${state}&code=${code}`))
  } finally { listener.cancel() }
})

test('PKCE browser login keeps secrets in Main, requests exact read scopes and atomically reads PR409 workspace', async () => {
  const f = harness()
  try {
    await f.login()
    const request = f.requests[0].body, exchange = f.requests.find(r => r.path.endsWith('/auth/exchange'))!.body
    assert.deepEqual(request.scope, scopes)
    assert.equal(request.code_challenge_method, 'S256')
    assert.equal(request.code_challenge, createHash('sha256').update(String(exchange.code_verifier), 'ascii').digest('base64url'))
    assert.equal(f.opened[0], `https://oclr.org/desktop/authorize?request_id=${id(1)}`)
    assert.equal(exchange.redirect_uri, request.redirect_uri)
    for (const r of f.requests) { assert.equal(r.init.credentials, 'omit'); assert.equal(r.init.redirect, 'error'); assert.equal(r.init.cache, 'no-store') }
    await f.session.selectFixture(id(101)); assert.equal(f.session.state.panelState, 'fresh')
    f.session.selectMap(id(301))
    const state = f.session.state
    assert.equal(state.commands.find(c => c.kind === 'map')?.text, '!mp map 900000101 0')
    assert.equal(state.commands.find(c => c.kind === 'mods')?.text, '!mp mods NF HD')
    await f.session.copyCommand({ previewId: state.previewId, commandId: 'mods' })
    assert.deepEqual(f.clipboard, ['!mp mods NF HD'])
    assert.ok(!JSON.stringify(state).includes('oclr_desk_'))
    assert.ok(!JSON.stringify(state).includes(String(exchange.code_verifier)))
    assert.ok(!f.requests.some(r => r.init.method === 'PATCH' || r.path.includes('/api/admin/')))
    await f.session.openReview(id(101)); assert.equal(f.opened.at(-1), fixture().reviewUrl)
  } finally { f.session.dispose() }
})

test('website builder parity, nullable missing policies and unknown enum rejection', () => {
  const data = panelSchema.parse(panel()).data.workspace
  const commands = refereeCommands({ settings: data.defaultSettings, teams: data.teams, rules: data.rules, policy: data.policy?.commands ?? null, selectedMap: data.maps[0] })
  assert.equal(commands.find(c => c.kind === 'set')?.text, '!mp set 0 3 2')
  assert.deepEqual(commands.filter(c => c.kind === 'invite').map(c => c.text), ['!mp invite Player_A', '!mp invite Player_B'])
  const missing = panel(); (missing.data.workspace as Record<string, unknown>).policy = null
  const parsed = panelSchema.parse(missing).data.workspace
  assert.equal(refereeCommands({ settings: parsed.defaultSettings, teams: parsed.teams, rules: parsed.rules, policy: null, selectedMap: parsed.maps[0] }).find(c => c.kind === 'mods')?.text, null)
  const unknown = panel(); unknown.data.workspace.rules.mode = 'future-mode'
  assert.equal(panelSchema.safeParse(unknown).success, false)
})

test('two concurrent expired GETs share one refresh; each GET retries once with new access token', async () => {
  let expired = false, refreshes = 0
  const f = harness(async request => {
    if (request.path.endsWith('/auth/refresh')) { refreshes++; await delay(15) }
    if (expired && request.path.startsWith('/api/referee/') && (request.init.headers as Record<string, string>).Authorization === 'Bearer ' + pair().data.access_token) return apiError('ACCESS_TOKEN_EXPIRED', 401)
  })
  try {
    await f.login(); expired = true
    await Promise.all([f.session.selectFixture(id(101)), f.session.loadFixtures()])
    assert.equal(refreshes, 1); assert.equal(f.session.state.status, 'connected'); assert.equal(f.session.state.panelState, 'fresh')
    assert.ok(f.requests.some(r => (r.init.headers as Record<string, string>).Authorization === 'Bearer ' + pair(1).data.access_token))
  } finally { f.session.dispose() }
})

test('ambiguous refresh failure clears all private data and never replays a rotating token', async () => {
  let fail = false
  const f = harness(request => {
    if (fail && request.path.endsWith('/auth/refresh')) throw new Error('Synthetic lost response containing SECRET must not surface')
    if (fail && request.path.endsWith('/panel')) return apiError('ACCESS_TOKEN_EXPIRED', 401)
  })
  try {
    await f.login(); await f.session.selectFixture(id(101)); fail = true
    await f.session.readPanel()
    assert.equal(f.session.state.status, 'error'); assert.equal(f.session.state.subject, null); assert.equal(f.session.state.panel, null); assert.deepEqual(f.session.state.fixtures, [])
    assert.equal(f.requests.filter(r => r.path.endsWith('/auth/refresh')).length, 1)
    assert.ok(!JSON.stringify(f.session.state).includes('SECRET'))
  } finally { f.session.dispose() }
})

test('logout clears immediately, rejects late reads and reports unconfirmed remote revocation', async () => {
  let release: (response: Response) => void = () => {}, hold = false
  const f = harness(request => {
    if (request.path.endsWith('/panel') && hold) return new Promise<Response>(resolve => { release = resolve })
    if (request.path.endsWith('/auth/revoke')) return apiError('SERVICE_UNAVAILABLE', 503)
  })
  try {
    await f.login(); hold = true
    const reading = f.session.selectFixture(id(101)); await until(() => f.requests.some(r => r.path.endsWith('/panel')))
    const logout = f.session.logout()
    assert.equal(f.session.state.subject, null); assert.deepEqual(f.session.state.fixtures, [])
    release(jsonResponse(panel())); await Promise.all([reading, logout])
    assert.equal(f.session.state.panel, null); assert.equal(f.session.state.remoteRevocation, 'unconfirmed')
  } finally { f.session.dispose() }
})

test('switching fixtures, invalid viewer and expired monotonic deadlines cannot retain usable previews', async () => {
  let release: (response: Response) => void = () => {}, hold = false, wrong = false
  const f = harness(request => {
    if (request.path.includes(id(101)) && hold) return new Promise<Response>(resolve => { release = resolve })
    if (request.path.endsWith('/panel') && wrong) { const data = panel(103); data.data.viewer.osuId++; return jsonResponse(data) }
  })
  try {
    await f.login(); hold = true
    const old = f.session.selectFixture(id(101)); await until(() => f.requests.some(r => r.path.includes(id(101))))
    await f.session.selectFixture(id(103)); release(jsonResponse(panel())); await old
    assert.equal(f.session.state.panel?.workspace.fixture.id, id(103))
    const preview = f.session.state.previewId
    f.session.selectMap(id(301)); await assert.rejects(f.session.copyCommand({ previewId: preview, commandId: 'make' }))
    f.advance(31000)
    assert.equal(f.session.state.panelState, 'stale'); assert.ok(f.session.state.commands.every(c => c.text === null))
    await assert.rejects(f.session.copyCommand({ previewId: f.session.state.previewId, commandId: 'make' }))
    wrong = true; await f.session.readPanel(); assert.equal(f.session.state.panel, null)
    wrong = false; await f.session.readPanel(); f.advance(300001)
    assert.equal(f.session.state.panel, null); assert.deepEqual(f.session.state.fixtures, [])
  } finally { f.session.dispose() }
})

test('403 clears all data; fixture 404 clears only affected fixture; 429 blocks repeated GETs', async () => {
  let code: string | null = null, status = 0
  const f = harness(request => request.path.endsWith('/panel') && code ? apiError(code, status, status === 429 ? { 'Retry-After': '10' } : {}) : undefined)
  try {
    await f.login(); await f.session.selectFixture(id(101)); code = 'RATE_LIMITED'; status = 429
    await f.session.readPanel(); const before = f.requests.length
    await f.session.readPanel(); assert.equal(f.requests.length, before); assert.ok(f.session.state.retryAt)
    f.advance(10001); code = 'FIXTURE_NOT_AVAILABLE'; status = 404; await f.session.readPanel()
    assert.equal(f.session.state.panel, null); assert.equal(f.session.state.fixtures.length, 1)
    code = null; await f.session.selectFixture(id(103)); code = 'REFEREE_ACCESS_REVOKED'; status = 403
    await f.session.readPanel(); assert.equal(f.session.state.subject, null); assert.deepEqual(f.session.state.fixtures, [])
  } finally { f.session.dispose() }
})

test('pagination restarts once on collection conflict, caps duplicates and forbids unsafe review URLs', async () => {
  let mode = 0, pageReads = 0
  const f = harness(request => {
    if (!request.path.includes('/me/fixtures')) return
    pageReads++
    if (mode === 1 && request.path.includes('cursor=')) return apiError('COLLECTION_CHANGED', 409)
    if (mode === 2) { const value = fixtures(); value.data.items[0].reviewUrl = 'https://attacker.invalid/'; return jsonResponse(value) }
    const value = fixtures(); value.data.nextCursor = 'opaque-cursor'; return jsonResponse(value)
  })
  try {
    await f.login(); mode = 1; const before = pageReads
    await f.session.loadFixtures(true); assert.equal(pageReads - before, 2); assert.equal(f.session.state.fixtures.length, 2)
    mode = 2; await f.session.loadFixtures(); assert.ok(f.session.state.error)
    await assert.rejects(f.session.openReview(id(999)))
    assert.equal(f.opened.length, 1)
  } finally { f.session.dispose() }
})

test('cancelled auth, cross-origin authorization URL, bad scope and HTML never fall back to cookie/admin endpoints', async () => {
  const cancelled = harness()
  try { await cancelled.session.login(); cancelled.session.cancelLogin(); cancelled.approve(); await delay(10); assert.equal(cancelled.requests.some(r => r.path.endsWith('/exchange')), false) } finally { cancelled.session.dispose() }
  const redirected = harness(request => request.path.endsWith('/requests') ? jsonResponse({ data: { authorization_request_id: id(1), authorization_url: `https://attacker.invalid/desktop/authorize?request_id=${id(1)}`, verification_code: 'ABCD-2345', expires_at: at(600) }, meta: meta() }) : undefined)
  try { await assert.rejects(redirected.session.login()); assert.deepEqual(redirected.opened, []) } finally { redirected.session.dispose() }
  for (const scenario of ['scope', 'html']) {
    const f = harness(request => { if (!request.path.endsWith('/exchange')) return; if (scenario === 'html') return new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }); const value = pair(); value.data.scope = ['referee:fixtures:read']; return jsonResponse(value) })
    try { await f.session.login(); f.approve(); await until(() => f.session.state.status === 'error'); assert.equal(f.session.state.subject, null); assert.equal(f.requests.some(r => r.path.includes('/api/admin/')), false) } finally { f.session.dispose() }
  }
})

test('HTTP transport rejects redirects, oversized streams and missing contract headers', async () => {
  const cases = [
    { response: new Response(null, { status: 302, headers: { Location: 'https://attacker.invalid' } }), maxBytes: 512 },
    { response: new Response('x'.repeat(60), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }), maxBytes: 50 },
    { response: new Response(JSON.stringify({ data: {}, meta: meta() }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }), maxBytes: 4096 }
  ]
  for (const { response, maxBytes } of cases) {
    const client = new OclrHttp(async () => response)
    await assert.rejects(client.request('/api/desktop/v1/me', { maxBytes }), OclrError)
  }
})

test('repeated captured snapshots never extend freshness and suspend clears OCLR without restoring old data', async () => {
  const f = harness()
  try {
    await f.login(); await f.session.selectFixture(id(101))
    f.advance(29000); await f.session.readPanel()
    f.advance(2000)
    assert.equal(f.session.state.panelState, 'stale')
    assert.ok(f.session.state.commands.every(c => c.text === null))
    f.session.suspend()
    assert.equal(f.session.state.subject, null); assert.equal(f.session.state.panel, null)
    await delay(5); assert.equal(f.session.state.status, 'disconnected')
  } finally { f.session.dispose() }
})

test('workspace strips unexpected fields and rejects cross-team identities and inconsistent event ordinals', () => {
  const value = panel()
  const workspace = value.data.workspace as unknown as Record<string, unknown>
  workspace.access_token = 'SYNTHETIC_NOT_FOR_RENDERER'
  assert.equal(JSON.stringify(panelSchema.parse(value)).includes('SYNTHETIC_NOT_FOR_RENDERER'), false)
  value.data.workspace.teams[0].id = id(999)
  assert.equal(panelSchema.safeParse(value).success, false)
  const event = panel()
  ;(event.data.workspace.events as unknown[]).push({ id: id(401), ordinal: 3, actorId: 900000001, createdAt: at(0), payload: { type: 'dependencies_reconfirmed' } })
  assert.equal(panelSchema.safeParse(event).success, false)
})
