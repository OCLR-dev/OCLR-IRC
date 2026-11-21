import assert from 'node:assert/strict'
import { once } from 'node:events'
import http from 'node:http'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import test from 'node:test'
import { IrcSession } from '../src/main/irc.ts'
import { NetworkTransport } from '../src/main/network.ts'

async function listen(server: http.Server | net.Server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return (server.address() as net.AddressInfo).port
}

for (const mode of ['socks5', 'http'] as const) {
  test(`${mode} tunnels Bancho login and desktop fetches to the requested destinations`, { timeout: 5000 }, async t => {
    const targets: string[] = []
    const network = new NetworkTransport()
    const irc = new IrcSession(signal => network.connectIrc(signal), { retryBaseMs: 10000 })
    const sockets = new Set<net.Socket>()
    const track = (socket: net.Socket) => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
    }
    function serveTunnel(socket: Duplex, host: string, port: number) {
      targets.push(`${host}:${port}`)
      let received = ''
      socket.on('data', chunk => {
        received += chunk.toString()
        if (host === 'irc.ppy.sh' && received.endsWith('USER Referee 0 * :OCLR IRC\r\n')) {
          assert.equal(received, 'PASS synthetic-irc-password\r\nNICK Referee\r\nUSER Referee 0 * :OCLR IRC\r\n')
          socket.write(':server 001 Referee :Welcome\r\n')
        } else if (host === 'app.example.test' && received.includes('\r\n\r\n')) {
          assert.match(received, /^GET \/synthetic HTTP\/1\.1\r\n/)
          socket.end('HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 7\r\n\r\nproxied')
        }
      })
    }
    const proxy = mode === 'http' ? http.createServer().on('connect', (request, socket, head) => {
      assert.equal(head.length, 0)
      assert.ok(request.url)
      const [host, port] = request.url.split(':')
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      serveTunnel(socket, host, Number(port))
    }) : net.createServer(socket => {
      // The client waits for the no-auth reply before asking to connect.
      socket.once('data', greeting => {
        assert.deepEqual([...greeting], [5, 1, 0])
        socket.write(Buffer.from([5, 0]))
        socket.once('data', request => {
          assert.deepEqual([...request.subarray(0, 4)], [5, 1, 0, 3])
          const length = request[4]
          socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
          serveTunnel(socket, request.toString('ascii', 5, 5 + length), request.readUInt16BE(5 + length))
        })
      })
    })
    proxy.on('connection', track)
    const local = http.createServer((_request, response) => response.end('local'))
    local.on('connection', track)
    t.after(() => {
      irc.logout(); network.setProxy({ mode: 'direct' })
      for (const socket of sockets) socket.destroy()
      local.close(); proxy.close()
    })
    network.setProxy({ mode, host: '127.0.0.1', port: await listen(proxy) })
    const online = once(irc, 'authenticated')
    irc.login({ username: 'Referee', password: 'synthetic-irc-password' })
    await online
    assert.equal(irc.state.connection, 'online')
    const remote = await network.fetch('http://app.example.test:8080/synthetic', { redirect: 'error' })
    assert.equal(await remote.text(), 'proxied')
    assert.equal(await (await network.fetch(`http://127.0.0.1:${await listen(local)}/`)).text(), 'local')
    assert.deepEqual(targets, ['irc.ppy.sh:6667', 'app.example.test:8080'])

    network.setProxy({ mode: 'direct' })
    assert.equal(irc.state.connection, 'online')
  })
}

test('cancelling a pending proxy login closes the tunnel before sending IRC credentials', { timeout: 5000 }, async t => {
  const proxy = http.createServer()
  const network = new NetworkTransport()
  const irc = new IrcSession(signal => network.connectIrc(signal))
  t.after(() => { irc.logout(); network.setProxy({ mode: 'direct' }); proxy.close() })
  network.setProxy({ mode: 'http', host: '127.0.0.1', port: await listen(proxy) })
  const request = once(proxy, 'connect')
  irc.login({ username: 'Referee', password: 'synthetic-irc-password' })
  const [_, socket, head] = await request
  const disconnected = once(socket, 'end')
  t.after(() => socket.destroy())
  assert.equal(head.length, 0)
  let payload = ''
  socket.on('data', (chunk: Buffer) => { payload += chunk.toString() })
  irc.logout()
  await disconnected
  assert.equal(payload, '')
  assert.equal(irc.state.connection, 'offline')
})

test('a rejected HTTP CONNECT never receives credentials or falls back to direct login', { timeout: 5000 }, async t => {
  let attempts = 0
  const proxy = http.createServer().on('connect', (_request, socket) => {
    attempts++
    socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n')
  })
  const network = new NetworkTransport()
  const irc = new IrcSession(signal => network.connectIrc(signal), { retryBaseMs: 10000 })
  t.after(() => { irc.logout(); network.setProxy({ mode: 'direct' }); proxy.close() })
  network.setProxy({ mode: 'http', host: '127.0.0.1', port: await listen(proxy) })
  await new Promise<void>(resolve => {
    irc.on('state', state => { if (state.connection === 'reconnecting') resolve() })
    irc.login({ username: 'Referee', password: 'synthetic-irc-password' })
  })
  assert.equal(irc.state.error, '無法透過代理連線。請檢查代理設定。')
  assert.equal(attempts, 1)
})
