import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { generateKeyPairSync } from 'node:crypto'
const { configuration } = createRequire(import.meta.url)('../scripts/apple-ci-credentials.cjs')
test('Apple setup validates complete credentials and distinguishes Team ID from Issuer UUID', () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1', privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
  const env = { MAC_CERTIFICATE_P12_BASE64: Buffer.from('synthetic P12').toString('base64'), MAC_CERTIFICATE_PASSWORD: 'synthetic-password', APPLE_API_PRIVATE_KEY: privateKey, APPLE_API_KEY_ID: 'ABCDEF1234', APPLE_API_ISSUER_ID: '12345678-1234-1234-1234-123456789abc', MAC_TEAM_ID: 'ABCDEF5678' }
  assert.equal(configuration(env).team, env.MAC_TEAM_ID)
  for (const key of Object.keys(env)) assert.throws(() => configuration({ ...env, [key]: '' }))
  assert.throws(() => configuration({ ...env, MAC_TEAM_ID: env.APPLE_API_ISSUER_ID }))
  assert.throws(() => configuration({ ...env, APPLE_API_ISSUER_ID: env.MAC_TEAM_ID }))
  assert.throws(() => configuration({ ...env, APPLE_API_PRIVATE_KEY: 'not-a-key' }))
  assert.throws(() => configuration({ ...env, MAC_CERTIFICATE_P12_BASE64: 'invalid !!!' }))
})
