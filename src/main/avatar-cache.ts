import { createHash, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalize } from './protocol.ts'
import type { AvatarState } from '../shared/avatar.ts'

const DAY = 86_400_000
const MAX_IMAGE = 2 * 1024 * 1024
const MAX_PNG = 256 * 1024
type Rasterize = (bytes: Buffer) => Buffer | null

/** Read only the public profile's initial user data; never execute its HTML. */
export function profileAvatar(html: string, username: string): string | null {
  try {
    const tag = html.match(/<div\b[^>]*\bdata-react="profile-page"[^>]*>/)?.[0]
    const raw = tag?.match(/\bdata-initial-data="([^"]*)"/)?.[1]
    if (!raw) return null
    const entities: Record<string, string> = { quot: '"', amp: '&', lt: '<', gt: '>', '#039': "'", '#39': "'", '#x27': "'" }
    const user = JSON.parse(raw.replace(/&(quot|amp|lt|gt|#039|#39|#x27);/g, (_, key: string) => entities[key])).user
    if (!Number.isSafeInteger(user?.id) || user.id < 1 || typeof user.username !== 'string' || normalize(user.username) !== normalize(username)) return null
    const url = new URL(user.avatar_url)
    if (url.origin !== 'https://a.ppy.sh' || url.username || url.password || url.hash || url.pathname !== `/${user.id}` || !/^\?(?:[\w.=-]{0,128})$|^$/.test(url.search)) return null
    return url.href
  } catch { return null }
}

function raster(bytes: Buffer) {
  return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
    (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii')) ||
    (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP')
}
function pngUrl(bytes: Buffer) { return `data:image/png;base64,${bytes.toString('base64')}` }

/** Public raster cache only. Contains no profile HTML, credentials or OCLR data. */
export class AvatarCache {
  private directory: string
  private rasterize: Rasterize
  private fetcher: typeof fetch
  private now: () => number
  constructor(directory: string, rasterize: Rasterize, fetcher: typeof fetch = fetch, now = Date.now) {
    this.directory = directory; this.rasterize = rasterize; this.fetcher = fetcher; this.now = now
  }
  private key(username: string) { return createHash('sha256').update(normalize(username)).digest('hex') + '.json' }
  private async download(url: string, type: RegExp, limit: number, signal: AbortSignal, profile = false) {
    const options: RequestInit = { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), redirect: profile ? 'manual' : 'error', credentials: 'omit', headers: { 'User-Agent': 'OCLR-IRC-avatar/1 (+https://github.com/OCLR-dev/OCLR-IRC)' } }
    let response = await this.fetcher(url, options)
    // osu! canonicalizes a username URL to /users/<id>. Follow exactly this one
    // same-origin hop; the returned profile must still match the authenticated nick.
    if (profile && [301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) throw new Error('Missing canonical profile')
      const target = new URL(location, url)
      if (target.origin !== 'https://osu.ppy.sh' || target.username || target.password || target.hash || target.search || !/^\/users\/[1-9]\d{0,15}$/.test(target.pathname)) throw new Error('Invalid canonical profile')
      response = await this.fetcher(target.href, { ...options, redirect: 'error' })
    }
    if (!response.ok || !type.test(response.headers.get('content-type') ?? '') || Number(response.headers.get('content-length')) > limit || !response.body) {
      await response.body?.cancel(); throw new Error('Avatar response unavailable')
    }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > limit) throw new Error('Avatar response too large')
        chunks.push(value)
      }
      return Buffer.concat(chunks)
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  }
  private async cached(username: string) {
    try {
      const path = join(this.directory, this.key(username))
      if ((await stat(path)).size > MAX_PNG * 1.5) return null
      const data = JSON.parse(await readFile(path, 'utf8'))
      const age = this.now() - data.fetchedAt
      if (data.version !== 1 || !Number.isSafeInteger(data.fetchedAt) || age < 0 || age > 30 * DAY || typeof data.png !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.png)) return null
      const bytes = Buffer.from(data.png, 'base64')
      if (bytes.length > MAX_PNG || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return null
      const png = this.rasterize(bytes)
      return png?.length && png.length <= MAX_PNG ? { dataUrl: pngUrl(png), fresh: age < DAY } : null
    } catch { return null }
  }
  private async save(username: string, png: Buffer) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const target = join(this.directory, this.key(username)), temp = target + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(temp, JSON.stringify({ version: 1, fetchedAt: this.now(), png: png.toString('base64') }), { mode: 0o600, flag: 'wx' })
      await rename(temp, target)
      const entries = await Promise.all((await readdir(this.directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(async name => ({ name, modified: (await stat(join(this.directory, name))).mtimeMs })))
      entries.sort((a, b) => b.modified - a.modified)
      await Promise.all(entries.filter((entry, index) => index >= 20 || this.now() - entry.modified > 30 * DAY).map(entry => rm(join(this.directory, entry.name), { force: true })))
    } finally { await rm(temp, { force: true }).catch(() => {}) }
  }
  async load(username: string, signal: AbortSignal, onCached: (dataUrl: string) => void): Promise<string | null> {
    if (!username || username === '.' || username === '..' || username.length > 32 || /[\x00-\x1f\x7f]/.test(username)) return null
    const cached = await this.cached(username)
    if (signal.aborted) return null
    if (cached) { onCached(cached.dataUrl); if (cached.fresh) return cached.dataUrl }
    try {
      // key=username prevents all-numeric nicknames from being treated as user IDs.
      const profile = await this.download(`https://osu.ppy.sh/users/${encodeURIComponent(username.replace(/_/g, ' '))}?key=username`, /^text\/html\b/i, MAX_IMAGE, signal, true)
      const url = profileAvatar(profile.toString('utf8'), username)
      if (!url) return cached?.dataUrl ?? null
      const bytes = await this.download(url, /^image\/(?:png|jpeg|gif|webp)\b/i, MAX_IMAGE, signal)
      if (!raster(bytes) || signal.aborted) return cached?.dataUrl ?? null
      const png = this.rasterize(bytes)
      if (!png?.length || png.length > MAX_PNG || signal.aborted) return cached?.dataUrl ?? null
      await this.save(username, png).catch(() => {})
      return pngUrl(png)
    } catch { return cached?.dataUrl ?? null }
  }
}

/** Login generation fences both disk and network responses, including same-name relogin. */
export class AccountAvatar extends EventEmitter {
  private scope = ''
  private abort: AbortController | null = null
  private value: AvatarState = { username: '', dataUrl: null }
  private cache: AvatarCache
  constructor(cache: AvatarCache) { super(); this.cache = cache }
  get state() { return { ...this.value } }
  update(username: string, online: boolean, generation: number) {
    const scope = username && online ? JSON.stringify([username, generation]) : ''
    if (scope === this.scope) return
    this.scope = scope; this.abort?.abort(); this.abort = null
    this.value = { username: scope ? username : '', dataUrl: null }; this.emit('state', this.state)
    if (!scope) return
    const controller = this.abort = new AbortController()
    const receive = (dataUrl: string | null) => {
      if (this.abort !== controller || controller.signal.aborted || this.scope !== scope || this.value.dataUrl === dataUrl) return
      this.value = { username, dataUrl }; this.emit('state', this.state)
    }
    void this.cache.load(username, controller.signal, receive).then(receive).catch(() => {})
  }
}
