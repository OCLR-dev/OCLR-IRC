import { addAbortListener, once } from 'node:events'
import http from 'node:http'
import net from 'node:net'
import { SocksClient } from 'socks'
import { Agent, buildConnector } from 'undici'
import type { NetworkProxy } from '../shared/network-proxy.ts'

type ProxyServer = Exclude<NetworkProxy, { mode: 'direct' }>
type Destination = { host: string; port: number }
export const BANCHO_DESTINATION = { host: 'irc.ppy.sh', port: 6667 }
const tunnelTimeout = 8000
const unbracket = (host: string) => host.replace(/^\[(.*)\]$/, '$1')

export class ProxyConnectionError extends Error {
  constructor() { super('無法透過代理連線。請檢查代理設定。') }
}

async function openTunnel(proxy: ProxyServer, destination: Destination, signal: AbortSignal): Promise<net.Socket> {
  signal.throwIfAborted()
  if (proxy.mode === 'http') {
    const authority = `${net.isIPv6(destination.host) ? `[${destination.host}]` : destination.host}:${destination.port}`
    return new Promise((resolve, reject) => {
      const request = http.request({ hostname: proxy.host, port: proxy.port, agent: false, method: 'CONNECT', path: authority, headers: { Host: authority }, signal })
      request.once('error', reject)
      request.once('connect', (response, socket: net.Socket, head) => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          socket.destroy(); reject(new Error('Proxy refused CONNECT')); return
        }
        socket.pause()
        if (head.length) socket.unshift(head)
        resolve(socket)
      })
      request.end()
    })
  }

  const socket = net.createConnection({ host: proxy.host, port: proxy.port })
  const abort = addAbortListener(signal, () => socket.destroy())
  try {
    await once(socket, 'connect', { signal })
    await SocksClient.createConnection({ proxy: { host: proxy.host, port: proxy.port, type: 5 }, command: 'connect', destination, existing_socket: socket, timeout: tunnelTimeout })
    signal.throwIfAborted()
    return socket
  } catch (error) {
    socket.destroy()
    throw error
  } finally { abort[Symbol.dispose]() }
}

export class NetworkTransport {
  private proxy: NetworkProxy = { mode: 'direct' }
  private agent: Agent | null = null

  setProxy(proxy: NetworkProxy) {
    if (JSON.stringify(proxy) === JSON.stringify(this.proxy)) return
    const previous = this.agent
    if (proxy.mode === 'direct') this.agent = null
    else {
      const connectTls = buildConnector({ timeout: tunnelTimeout, rejectUnauthorized: true })
      this.agent = new Agent({ connect(options, callback) {
        const host = unbracket(options.hostname)
        const port = Number(options.port || (options.protocol === 'https:' ? 443 : 80))
        void openTunnel(proxy, { host, port }, AbortSignal.timeout(tunnelTimeout)).then(
          socket => {
            if (options.protocol === 'https:') connectTls({ ...options, httpSocket: socket }, callback)
            else { callback(null, socket); socket.resume() }
          },
          () => callback(new Error('Proxy connection failed'), null)
        )
      } })
    }
    this.proxy = proxy
    void previous?.close().catch(() => {})
  }

  connectIrc(signal: AbortSignal) {
    if (this.proxy.mode === 'direct') return net.createConnection(BANCHO_DESTINATION)
    return openTunnel(this.proxy, BANCHO_DESTINATION, AbortSignal.any([signal, AbortSignal.timeout(tunnelTimeout)]))
      .catch(() => { throw new ProxyConnectionError() })
  }

  fetch: typeof fetch = (input, init) => {
    if (!this.agent) return fetch(input, init)
    const { hostname } = new URL(input instanceof Request ? input.url : input)
    // Requests to a local development site must stay on the machine.
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return fetch(input, init)
    const options = { ...init, dispatcher: this.agent }
    return fetch(input, options)
  }
}
