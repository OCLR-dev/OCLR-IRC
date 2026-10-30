import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { callbackCodeSchema } from '../shared/oclr-contracts.ts'

export interface Loopback {
  redirectUri: string
  result: Promise<{ code: string } | { error: string }>
  cancel(reason?: string): void
  expireAfter(ms: number): void
}
export async function openLoopback(state: string): Promise<Loopback> {
  let settle: (value: { code: string } | { error: string }) => void
  const result = new Promise<{ code: string } | { error: string }>(resolve => { settle = resolve })
  let done = false, redirectUri = '', timer: ReturnType<typeof setTimeout> | null = null
  const finish = (value: { code: string } | { error: string }) => {
    if (done) return
    done = true
    if (timer) clearTimeout(timer)
    server.close(); server.closeIdleConnections()
    settle(value)
  }
  const server = http.createServer({ maxHeaderSize: 4096, requestTimeout: 5000, headersTimeout: 5000, keepAliveTimeout: 1 }, (req, res) => {
    const respond = (status: number, message: string) => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', Connection: 'close' })
      res.end(message)
    }
    const hostCount = req.rawHeaders.filter((header, i) => i % 2 === 0 && header.toLowerCase() === 'host').length
    if (done || req.method !== 'GET' || hostCount !== 1 || req.headers.host !== new URL(redirectUri).host || !req.url || req.url.length > 2048 || !req.url.startsWith('/oclr/callback?')) { respond(400, '無效的授權回呼。'); return }
    const url = new URL(req.url, redirectUri)
    const entries = [...url.searchParams.entries()], params = url.searchParams
    const received = params.get('state') ?? ''
    if (url.pathname !== '/oclr/callback' || url.hash || entries.length !== 2 || new Set(entries.map(([key]) => key)).size !== 2 || !/^[A-Za-z0-9_-]{43}$/.test(received) || !timingSafeEqual(Buffer.from(received), Buffer.from(state))) { respond(400, '無效的授權回呼。'); return }
    if (params.has('code') && callbackCodeSchema.safeParse(params.get('code')).success) {
      respond(200, '授權回呼已收到，請返回 OCLR IRC 查看登入結果。')
      finish({ code: params.get('code')! })
    } else if (params.get('error') === 'access_denied') {
      respond(200, '已拒絕授權，可以關閉此頁。'); finish({ error: 'ACCESS_DENIED' })
    } else respond(400, '無效的授權回呼。')
  })
  server.maxConnections = 8; server.maxRequestsPerSocket = 1
  server.setTimeout(5000, socket => socket.destroy())
  server.on('clientError', (_error, socket) => socket.destroy())
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  server.on('error', () => finish({ error: 'CALLBACK_UNAVAILABLE' }))
  const address = server.address()
  if (!address || typeof address === 'string' || address.port < 1024) { finish({ error: 'CALLBACK_UNAVAILABLE' }); throw new Error('CALLBACK_UNAVAILABLE') }
  redirectUri = `http://127.0.0.1:${address.port}/oclr/callback`
  const expireAfter = (ms: number) => { if (timer) clearTimeout(timer); timer = setTimeout(() => finish({ error: 'AUTH_REQUEST_EXPIRED' }), Math.max(1, Math.min(ms, 600000))) }
  expireAfter(600000)
  return { redirectUri, result, cancel: (reason = 'CANCELLED') => finish({ error: reason }), expireAfter }
}
