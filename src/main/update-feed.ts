import { createPublicKey, verify } from 'node:crypto'
import { z } from 'zod'

export const RELEASES_URL = 'https://github.com/OCLR-dev/OCLR-IRC/releases'
const latestRelease = 'https://api.github.com/repos/OCLR-dev/OCLR-IRC/releases/latest'
const versionPattern = /^(?:0|[1-9]\d{0,7})\.(?:0|[1-9]\d{0,7})\.(?:0|[1-9]\d{0,7})$/
const manifestSchema = z.strictObject({
  version: z.string().regex(versionPattern),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  sha512: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  size: z.number().int().positive().max(1024 * 1024 * 1024)
})
const signedEnvelope = z.strictObject({ payload: z.string().max(1024), signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/) })

async function readJson(fetcher: typeof fetch, url: string, maxBytes: number, redirect: 'error' | 'follow'): Promise<unknown> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(15000), credentials: 'omit', cache: 'no-store', redirect, headers: { Accept: 'application/json' } })
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel()
    throw new Error('Update response unavailable')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.length
      if (size > maxBytes) throw new Error('Update response too large')
      chunks.push(chunk.value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export function decodeUpdatePublicKey(value: string) {
  const raw = Buffer.from(value, 'base64')
  if (raw.length !== 32 || raw.toString('base64') !== value) throw new Error('Invalid update public key')
  return createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' })
}

export function parseWindowsUpdate(input: unknown, publicKey: ReturnType<typeof decodeUpdatePublicKey>) {
  const envelope = signedEnvelope.parse(input)
  const payload = Buffer.from(envelope.payload, 'base64')
  if (!verify(null, payload, publicKey, Buffer.from(envelope.signature, 'base64'))) throw new Error('Invalid update signature')
  const { version, commit, sha512, size } = manifestSchema.parse(JSON.parse(payload.toString('utf8')))
  const name = `OCLR-IRC-${version}-windows-x64-${commit.slice(0, 7)}-setup.exe`
  const url = `${RELEASES_URL}/download/v${version}/${name}`
  return { version, files: [{ url, size, sha512 }], path: url, sha512, releaseDate: '' }
}

export async function windowsUpdate(fetcher: typeof fetch, publicKey: ReturnType<typeof decodeUpdatePublicKey>) {
  const input = await readJson(fetcher, `${RELEASES_URL}/latest/download/windows-update.json`, 4096, 'follow')
  return parseWindowsUpdate(input, publicKey)
}

export async function publicRelease(fetcher: typeof fetch, current: string) {
  const data = z.object({ tag_name: z.string().startsWith('v'), draft: z.literal(false), prerelease: z.literal(false) }).parse(await readJson(fetcher, latestRelease, 1024 * 1024, 'error'))
  const version = data.tag_name.slice(1)
  const currentBase = current.split('-')[0]
  if (!versionPattern.test(version) || !versionPattern.test(currentBase)) throw new Error('Invalid release version')
  const parts = currentBase.split('.').map(Number)
  const latest = version.split('.').map(Number)
  const difference = latest.findIndex((part, index) => part !== parts[index])
  return difference === -1 ? (version !== current ? version : null) : (latest[difference] > parts[difference] ? version : null)
}
