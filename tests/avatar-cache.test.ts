import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AvatarCache, AccountAvatar, profileAvatar } from '../src/main/avatar-cache.ts'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64')
const dataUrl = `data:image/png;base64,${png.toString('base64')}`
const day = 86_400_000
const profile = (username = 'Ref Name', avatar_url = 'https://a.ppy.sh/42?1.png', id = 42) => `<div data-initial-data="${JSON.stringify({ user: { id, username, avatar_url } }).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" data-react="profile-page"></div>`
const rasterize = (bytes: Buffer) => bytes.equals(png) ? png : null
const signal = () => new AbortController().signal
async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'oclr-avatar-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let now = Date.now(), calls: string[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input); calls.push(url)
    assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, url.includes('?key=username') ? 'manual' : 'error')
    assert.equal(new Headers(init?.headers).has('authorization'), false)
    assert.equal(new Headers(init?.headers).has('cookie'), false)
    return url.startsWith('https://osu.ppy.sh/users/') ? new Response(profile(), { headers: { 'Content-Type': 'text/html; charset=UTF-8' } }) : new Response(png, { headers: { 'Content-Type': 'image/png' } })
  }
  const cache = new AvatarCache(directory, rasterize, fetcher, () => now)
  return { directory, cache, fetcher, calls, advance: (ms: number) => { now += ms }, now: () => now }
}

test('public profile identity uses case/space/underscore matching and numeric usernames stay names', async t => {
  assert.equal(profileAvatar(profile(), 'ref_name'), 'https://a.ppy.sh/42?1.png')
  assert.equal(profileAvatar(profile().replace('data-react="profile-page"', '').replace('<div ', '<div data-react="profile-page" '), 'Ref Name'), 'https://a.ppy.sh/42?1.png')
  for (const html of [profile('Other'), profile('Ref Name', 'https://evil.invalid/42'), profile('Ref Name', 'http://a.ppy.sh/42'), profile('Ref Name', 'https://a.ppy.sh/43'), profile('Ref Name', 'https://user@a.ppy.sh/42'), profile('Ref Name', 'https://a.ppy.sh/42#bad'), profile('Ref Name', 'https://a.ppy.sh/42', -1), 'not a profile']) assert.equal(profileAvatar(html, 'Ref Name'), null)
  const f = await fixture(t), urls: string[] = []
  const cache = new AvatarCache(f.directory, rasterize, async input => { urls.push(String(input)); return new Response(profile('12345'), { headers: { 'content-type': 'text/html' } }) })
  await cache.load('12345', signal(), () => {})
  assert.equal(urls[0], 'https://osu.ppy.sh/users/12345?key=username')
})

test('valid avatar persists under a hashed name and a fresh restart cache avoids all network', async t => {
  const f = await fixture(t)
  assert.equal(await f.cache.load('Ref_Name', signal(), () => {}), dataUrl)
  assert.deepEqual(f.calls, ['https://osu.ppy.sh/users/Ref%20Name?key=username', 'https://a.ppy.sh/42?1.png'])
  const files = await readdir(f.directory)
  assert.equal(files.length, 1); assert.match(files[0], /^[a-f0-9]{64}\.json$/)
  const stored = await readFile(join(f.directory, files[0]), 'utf8')
  assert.equal(stored.includes('Ref'), false); assert.equal(stored.includes('avatar_url'), false)
  let cached: string | null = null
  const restarted = new AvatarCache(f.directory, rasterize, async () => { throw new Error('must remain offline') }, f.now)
  assert.equal(await restarted.load('ref name', signal(), value => { cached = value }), dataUrl)
  assert.equal(cached, dataUrl)
})

test('only one canonical numeric osu! profile redirect is allowed and identity is rechecked', async t => {
  const f = await fixture(t), urls: string[] = []
  const redirected: typeof fetch = async (input, init) => {
    const url = String(input); urls.push(url)
    if (url.includes('?key=username')) {
      assert.equal(init?.redirect, 'manual')
      return new Response(null, { status: 302, headers: { location: '/users/42' } })
    }
    assert.equal(init?.redirect, 'error')
    return f.fetcher(input, init)
  }
  assert.equal(await new AvatarCache(f.directory, rasterize, redirected).load('Ref Name', signal(), () => {}), dataUrl)
  assert.deepEqual(urls, ['https://osu.ppy.sh/users/Ref%20Name?key=username', 'https://osu.ppy.sh/users/42', 'https://a.ppy.sh/42?1.png'])
  await rm(f.directory, { recursive: true })
  for (const location of ['https://evil.invalid/users/42', 'http://osu.ppy.sh/users/42', 'https://user@osu.ppy.sh/users/42', '/api/private', '/users/Other', '/users/42?key=username', '/users/42#bad']) {
    let calls = 0
    const cache = new AvatarCache(f.directory, rasterize, async () => { calls++; return new Response(null, { status: 302, headers: { location } }) })
    assert.equal(await cache.load('Ref Name', signal(), () => {}), null); assert.equal(calls, 1)
  }
  let calls = 0
  const loop = new AvatarCache(f.directory, rasterize, async () => { calls++; return new Response(null, { status: 302, headers: { location: '/users/42' } }) })
  assert.equal(await loop.load('Ref Name', signal(), () => {}), null); assert.equal(calls, 2)
  const wrong = new AvatarCache(f.directory, rasterize, async input => String(input).includes('?key=username') ? new Response(null, { status: 302, headers: { location: '/users/42' } }) : new Response(profile('Other'), { headers: { 'content-type': 'text/html' } }))
  assert.equal(await wrong.load('Ref Name', signal(), () => {}), null)
})

test('stale avatar is delivered before refresh and remains usable when offline; expiry is bounded', async t => {
  const f = await fixture(t)
  await f.cache.load('Ref Name', signal(), () => {}); f.advance(2 * day)
  let cached = false
  const offline = new AvatarCache(f.directory, rasterize, async () => { assert.equal(cached, true); throw new Error('offline') }, f.now)
  assert.equal(await offline.load('Ref Name', signal(), () => { cached = true }), dataUrl)
  f.advance(30 * day)
  assert.equal(await offline.load('Ref Name', signal(), () => { assert.fail('expired image') }), null)
})

test('successful stale refresh atomically replaces the entry and renews its lifetime', async t => {
  const f = await fixture(t)
  await f.cache.load('Ref Name', signal(), () => {}); f.advance(2 * day)
  assert.equal(await f.cache.load('Ref_Name', signal(), () => {}), dataUrl)
  assert.equal(f.calls.length, 4)
  const files = await readdir(f.directory)
  assert.equal(files.length, 1)
  assert.equal(JSON.parse(await readFile(join(f.directory, files[0]), 'utf8')).fetchedAt, f.now())
  assert.equal(await f.cache.load('Ref Name', signal(), () => {}), dataUrl)
  assert.equal(f.calls.length, 4)
  for (const name of ['', '.', '..', 'x'.repeat(33), 'Ref\nQUIT']) assert.equal(await f.cache.load(name, signal(), () => {}), null)
  assert.equal(f.calls.length, 4)
})

test('bad disk contents, future timestamps and non-raster responses fall back without caching', async t => {
  const f = await fixture(t)
  await f.cache.load('Ref Name', signal(), () => {})
  const file = join(f.directory, (await readdir(f.directory))[0])
  const offline = new AvatarCache(f.directory, rasterize, async () => { throw new Error('offline') }, f.now)
  for (const content of ['{', JSON.stringify({ version: 1, fetchedAt: f.now() + day, png: png.toString('base64') }), JSON.stringify({ version: 1, fetchedAt: f.now(), png: Buffer.from('<svg/>').toString('base64') })]) {
    await writeFile(file, content)
    assert.equal(await offline.load('Ref Name', signal(), () => { assert.fail('corrupt cache') }), null)
  }
  await rm(file)
  for (const response of [new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }), new Response(png, { status: 302, headers: { location: 'http://localhost/secret' } }), new Response('<html>error</html>', { headers: { 'content-type': 'image/png' } }), new Response(png, { headers: { 'content-type': 'image/png', 'content-length': '3000000' } })]) {
    const cache = new AvatarCache(f.directory, rasterize, async input => String(input).startsWith('https://osu.ppy.sh/') ? new Response(profile(), { headers: { 'content-type': 'text/html' } }) : response)
    assert.equal(await cache.load('Ref Name', signal(), () => {}), null)
    assert.deepEqual(await readdir(f.directory), [])
  }
})

test('streamed overflow is cancelled and invalid or oversized decoded images are rejected', async t => {
  const f = await fixture(t)
  let cancelled = false
  const huge = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)) }, cancel() { cancelled = true } })
  const cache = new AvatarCache(f.directory, rasterize, async () => new Response(huge, { headers: { 'content-type': 'text/html' } }))
  assert.equal(await cache.load('Ref Name', signal(), () => {}), null); assert.equal(cancelled, true)
  for (const decode of [() => null, () => Buffer.alloc(300_000), () => { throw new Error('decoder failed') }]) {
    assert.equal(await new AvatarCache(f.directory, decode, f.fetcher).load('Ref Name', signal(), () => {}), null)
  }
  assert.deepEqual(await readdir(f.directory), [])
})

test('write failures do not hide a downloaded image and cache retains at most 20 entries', async t => {
  const f = await fixture(t)
  const file = join(f.directory, 'not-a-directory'); await writeFile(file, '')
  assert.equal(await new AvatarCache(file, rasterize, f.fetcher).load('Ref Name', signal(), () => {}), dataUrl)
  const cache = new AvatarCache(f.directory, rasterize, async input => {
    const url = new URL(String(input))
    return url.host === 'osu.ppy.sh' ? new Response(profile(decodeURIComponent(url.pathname.slice(7))), { headers: { 'content-type': 'text/html' } }) : new Response(png, { headers: { 'content-type': 'image/png' } })
  })
  for (let i = 0; i < 23; i++) assert.equal(await cache.load(`Ref${i}`, signal(), () => {}), dataUrl)
  assert.equal((await readdir(f.directory)).filter(f => f.endsWith('.json')).length, 20)
})

test('avatar controller starts only after authentication and fences logout and account changes', async () => {
  const pending: { username: string; signal: AbortSignal; cached: (value: string) => void; resolve: (value: string | null) => void }[] = []
  const cache = { load: (username: string, signal: AbortSignal, cached: (value: string) => void) => new Promise<string | null>(resolve => pending.push({ username, signal, cached, resolve })) } as AvatarCache
  const avatar = new AccountAvatar(cache)
  avatar.update('First', false, 1); assert.equal(pending.length, 0)
  avatar.update('First', true, 1); avatar.update('First', true, 1); assert.equal(pending.length, 1)
  pending[0].cached(dataUrl); assert.equal(avatar.state.dataUrl, dataUrl)
  avatar.update('', false, 2); pending[0].resolve(dataUrl); await Promise.resolve()
  assert.deepEqual(avatar.state, { username: '', dataUrl: null }); assert.equal(pending[0].signal.aborted, true)
  avatar.update('First', true, 3); avatar.update('Second', true, 4)
  pending[1].cached(dataUrl); pending[1].resolve(dataUrl); await Promise.resolve()
  assert.deepEqual(avatar.state, { username: 'Second', dataUrl: null })
  pending[2].resolve(dataUrl); await Promise.resolve(); assert.equal(avatar.state.dataUrl, dataUrl)
})
