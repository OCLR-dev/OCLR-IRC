export const PROXY_MODES = ['direct', 'socks5', 'http'] as const
export type ProxyMode = typeof PROXY_MODES[number]
export type NetworkProxy = { mode: 'direct' } | { mode: 'socks5' | 'http'; host: string; port: number }

export function networkProxyInput(input: unknown): NetworkProxy {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('無效的設定。')
  const { mode, host, port } = input as Record<string, unknown>
  if (mode === 'direct' && Object.keys(input).length === 1) return { mode }
  if ((mode === 'socks5' || mode === 'http') && Object.keys(input).length === 3
    && typeof host === 'string' && typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535) {
    const address = host.trim()
    if (address.length <= 253) {
      const ipv6 = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address
      if (ipv6.includes(':') && /^[\da-f:.]+$/i.test(ipv6)) {
        try { return { mode, host: new URL(`http://[${ipv6}]`).hostname.slice(1, -1), port } }
        catch { /* Invalid IPv6 literal. */ }
      } else if (address.replace(/\.$/, '').split('.').every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))) {
        return { mode, host: address.toLowerCase(), port }
      }
    }
  }
  throw new Error('請輸入有效的代理主機和連接埠（1–65535）。')
}
