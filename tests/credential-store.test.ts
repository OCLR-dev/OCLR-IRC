import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { CredentialStore } from '../src/main/credential-store.ts'

// Synthetic crypto adapter exercises file lifecycle; this is NOT an OS key-store claim.
test('optional credential file is encrypted, bounded, serialized and explicitly forgettable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oclr-credentials-test-')), file = join(dir, 'credentials.enc')
  const key = randomBytes(32)
  let available = true, rotate = false, encryptions = 0
  const store = new CredentialStore(file, {
    available: async () => available,
    encrypt: async value => {
      encryptions++
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
      const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), bytes])
    },
    decrypt: async bytes => {
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      decipher.setAuthTag(bytes.subarray(12, 28))
      return { result: Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(), shouldReEncrypt: rotate }
    }
  })
  const input = { username: 'Synthetic Ref', password: 'SYNTHETIC_PASSWORD_ONLY' }
  try {
    assert.deepEqual(await store.status(), { available: true, saved: false })
    available = false
    await assert.rejects(store.save(input)); assert.equal((await store.status()).saved, false)
    available = true
    await store.save(input)
    assert.ok(!(await readFile(file)).includes(input.password))
    if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600)
    assert.deepEqual(await store.load(), { ...input, username: 'Synthetic_Ref' })
    rotate = true; await store.load(); assert.equal(encryptions, 2)
    await Promise.all([store.save(input), store.forget()]); assert.equal((await store.status()).saved, false)
    await writeFile(file, Buffer.alloc(16385)); await assert.rejects(store.load())
    await writeFile(file, 'corrupt'); await assert.rejects(store.load())
    await store.forget()
  } finally { await rm(dir, { recursive: true, force: true }) }
})
