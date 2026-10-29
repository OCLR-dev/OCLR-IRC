import { z } from 'zod'
import { metaSchema } from '../shared/oclr-contracts.ts'
import { oclrOrigin } from './oclr-origin.ts'

const errorSchema = z.object({ error: z.object({ code: z.string().regex(/^[A-Z_]{1,64}$/), message: z.string().max(2000), requestId: z.uuid(), retryable: z.boolean() }) })
export class OclrError extends Error {
  code: string
  status: number
  retryAfterMs: number
  constructor(code: string, status = 0, retryAfterMs = 0) { super(code); this.code = code; this.status = status; this.retryAfterMs = retryAfterMs }
}
export function publicOclrError(error: unknown): string {
  const code = error instanceof OclrError ? error.code : 'SERVICE_UNAVAILABLE'
  const messages: Record<string, string> = {
    INTEGRATION_UNAVAILABLE: 'OCLR 桌面 API 尚不可用或回應契約不相容，請等待網站端接入。',
    INVALID_RESPONSE: 'OCLR 回應未通過資料驗證，已停止使用此份資料。',
    RESPONSE_TOO_LARGE: 'OCLR 回應超過安全大小限制，請由網站端調整。',
    ACCESS_DENIED: '已拒絕 OCLR 授權。', AUTH_REQUEST_EXPIRED: 'OCLR 授權已逾時，請重新登入。',
    CALLBACK_UNAVAILABLE: '無法建立本機授權回呼，請檢查連接埠或防火牆。',
    RATE_LIMITED: 'OCLR 請求過於頻繁，請等待顯示的重試時間。',
    FIXTURE_NOT_AVAILABLE: '此場次已無法存取，已移除相關資料。',
    REFEREE_ACCESS_REQUIRED: '此 OCLR 帳號目前沒有可用的裁判資格。',
    REFEREE_ACCESS_REVOKED: 'OCLR 裁判資格已撤銷，已清除私人資料。',
    INSUFFICIENT_SCOPE: 'OCLR 授權缺少裁判面板讀取權限，請重新授權。',
    SESSION_LIMIT_REACHED: 'OCLR 有效桌面連線已達上限，請到網站撤銷舊連線。',
    SESSION_EXPIRED: 'OCLR 授權已過期，請重新登入。', SESSION_REVOKED: 'OCLR 授權已撤銷，請重新登入。',
    COLLECTION_CHANGED: '場次列表已變更，請重新整理。',
    RELAY_ALREADY_ACTIVE: '網站投影已啟用，請先停止。',
    RELAY_LOCAL_NOT_READY: '請先登入相同 osu! 帳號，選擇 OCLR 場次，並在 IRC 加入房間、讀取設定與裁判名單。',
    CANCELLED: '操作已取消。',
    SERVICE_UNAVAILABLE: '無法確認 OCLR 回應，請稍後重試；若正在登入或更新憑證，需重新授權。'
  }
  return messages[code] ?? 'OCLR 操作未完成，請重新整理或重新授權。'
}
export interface HttpReply { value: unknown; startedAt: number; receivedAt: number }
export class OclrHttp {
  private fetcher: typeof fetch
  private now: () => number
  readonly origin: string
  constructor(fetcher: typeof fetch = fetch, now = () => performance.now(), origin?: string) { this.fetcher = fetcher; this.now = now; this.origin = oclrOrigin(origin) }
  async request(path: string, options: { method?: 'GET' | 'POST'; body?: unknown; token?: string; signal?: AbortSignal; maxBytes?: number } = {}): Promise<HttpReply> {
    // Paths are built by Main, never accepted from IPC or from a response link.
    if (!/^\/api\/(?:desktop|referee)\/v1\//.test(path) || /[\r\n#]/.test(path)) throw new OclrError('INVALID_RESPONSE')
    const url = new URL(path, this.origin)
    if (url.origin !== this.origin) throw new OclrError('INVALID_RESPONSE')
    const maxBytes = options.maxBytes ?? 32768
    const timeout = AbortSignal.timeout(5000)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    const startedAt = this.now()
    try {
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (options.body !== undefined) headers['Content-Type'] = 'application/json'
      if (options.token) headers.Authorization = `Bearer ${options.token}`
      const response = await this.fetcher(url.href, { method: options.method ?? 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), credentials: 'omit', cache: 'no-store', redirect: 'error', signal })
      if (response.redirected || response.status >= 300 && response.status < 400) throw new OclrError('INTEGRATION_UNAVAILABLE')
      if (response.status === 204 && path === '/api/desktop/v1/auth/revoke') return { value: null, startedAt, receivedAt: this.now() }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !/(?:^|,)\s*no-store(?:\s*,|\s*$)/i.test(response.headers.get('cache-control') ?? '')) { await response.body?.cancel(); throw new OclrError('INTEGRATION_UNAVAILABLE') }
      if (Number(response.headers.get('content-length') ?? 0) > maxBytes) { await response.body?.cancel(); throw new OclrError('RESPONSE_TOO_LARGE') }
      const reader = response.body?.getReader()
      if (!reader) throw new OclrError('INVALID_RESPONSE')
      let size = 0
      const parts: Uint8Array[] = []
      try {
        while (true) {
          const next = await reader.read()
          if (next.done) break
          size += next.value.length
          if (size > maxBytes) throw new OclrError('RESPONSE_TOO_LARGE')
          parts.push(next.value)
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      let value: unknown
      try { value = JSON.parse(Buffer.concat(parts).toString('utf8')) } catch { throw new OclrError('INTEGRATION_UNAVAILABLE') }
      if (!response.ok) {
        const parsed = errorSchema.safeParse(value)
        if (!parsed.success) throw new OclrError('INTEGRATION_UNAVAILABLE')
        if (response.status === 404 && parsed.data.error.code !== 'FIXTURE_NOT_AVAILABLE') throw new OclrError('INTEGRATION_UNAVAILABLE')
        const retry = response.headers.get('retry-after')
        const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.ceil((Date.parse(retry) - Date.now()) / 1000) : 30
        throw new OclrError(parsed.data.error.code, response.status, response.status === 429 ? Math.max(1000, Math.min(3600000, Number.isFinite(seconds) ? seconds * 1000 : 30000)) : 0)
      }
      const meta = metaSchema.safeParse((value as { meta?: unknown } | null)?.meta)
      const contract = response.headers.get(path.startsWith('/api/desktop/') ? 'x-oclr-desktop-contract' : 'x-oclr-referee-contract')
      if (!meta.success || contract !== meta.data.contractVersion || response.headers.get('x-request-id') !== meta.data.requestId) throw new OclrError('INTEGRATION_UNAVAILABLE')
      return { value, startedAt, receivedAt: this.now() }
    } catch (error) {
      if (options.signal?.aborted) throw new OclrError('CANCELLED')
      if (error instanceof OclrError) throw error
      // Never expose fetch/Zod errors, bodies, URLs, token values or server-supplied messages.
      throw new OclrError('SERVICE_UNAVAILABLE')
    }
  }
}
