// Test-only public osu! profile/CDN responses, installed before loading Main.
const { nativeImage } = require('electron')
const assert = require('node:assert/strict')
const pixels = Buffer.alloc(64 * 64 * 4)
for (let i = 0; i < 64 * 64; i++) { pixels[i * 4] = 180; pixels[i * 4 + 1] = Math.floor(i / 64) * 3; pixels[i * 4 + 2] = 120; pixels[i * 4 + 3] = 255 }
const png = nativeImage.createFromBitmap(pixels, { width: 64, height: 64 }).toPNG()
const original = global.fetch, requests = [], profiles = new Map()
let available = true
global.fetch = async (value, init = {}) => {
  const url = new URL(String(value))
  if (url.origin === 'https://osu.ppy.sh' && url.pathname.startsWith('/users/') || url.origin === 'https://a.ppy.sh') {
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, url.origin === 'https://osu.ppy.sh' && url.searchParams.get('key') === 'username' ? 'manual' : 'error')
    assert.equal(new Headers(init.headers).has('authorization'), false)
    requests.push(url.href)
    if (!available) return new Response(null, { status: 503 })
    if (url.origin === 'https://a.ppy.sh') return new Response(png, { headers: { 'content-type': 'image/png' } })
    if (url.searchParams.get('key') === 'username') {
      const id = String(101 + profiles.size)
      profiles.set(id, decodeURIComponent(url.pathname.slice('/users/'.length)))
      return new Response(null, { status: 302, headers: { location: `https://osu.ppy.sh/users/${id}` } })
    }
    const id = url.pathname.slice('/users/'.length), username = profiles.get(id)
    if (!username) return new Response(null, { status: 404 })
    const data = JSON.stringify({ user: { id: Number(id), username, avatar_url: `https://a.ppy.sh/${id}?1.png` } }).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    return new Response(`<div data-initial-data="${data}" data-react="profile-page"></div>`, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
  return original(value, init)
}
module.exports = { requests, setAvailable(value) { available = value } }
