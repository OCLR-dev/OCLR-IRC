import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { EncryptedJournal } from '../src/main/encrypted-journal.ts'

function fixture(available = true) {
  const dir = mkdtempSync(join(tmpdir(), 'oclr-journal-test-')), file = join(dir, 'journal.sqlite'), wrappingKey = randomBytes(32)
  let now = 1000000000
  const encryption = {
    available: async () => available,
    encrypt: async (value: string) => {
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', wrappingKey, nonce)
      const payload = Buffer.concat([cipher.update(value), cipher.final()])
      return Buffer.concat([nonce, cipher.getAuthTag(), payload])
    },
    decrypt: async (value: Buffer) => {
      const decipher = createDecipheriv('aes-256-gcm', wrappingKey, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12, 28))
      return { result: Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString(), shouldReEncrypt: false }
    }
  }
  const journal = new EncryptedJournal(file, encryption, () => now)
  return { journal, file, encryption, now: () => now, advance: (ms: number) => { now += ms }, async close() { await journal.close(); rmSync(dir, { recursive: true, force: true }) } }
}
test('encrypted records survive reopen, isolate accounts and expire without renewed age', async () => {
  const f = fixture()
  try {
    await f.journal.authenticate('Alice')
    await f.journal.append({ time: f.now(), room: '#mp_9', text: 'PRIVATE_SYNTHETIC_CHAT' })
    assert.equal(f.journal.status, 'saving')
    assert.equal(readFileSync(f.file).includes(Buffer.from('PRIVATE_SYNTHETIC_CHAT')), false)
    assert.equal(readFileSync(f.file).includes(Buffer.from('#mp_9')), false)
    await f.journal.authenticate('Bob'); assert.deepEqual(await f.journal.read(), [])
    await f.journal.authenticate('Alice'); assert.equal((await f.journal.read()).length, 1)
    const reopened = new EncryptedJournal(f.file, f.encryption, f.now)
    await reopened.authenticate('Alice'); assert.equal((await reopened.read()).length, 1); await reopened.close()
    f.advance(7 * 86400000); assert.deepEqual(await f.journal.read(), [])
  } finally { await f.close() }
})
test('missing provider never persists plaintext and logout discards queued writes', async () => {
  const missing = fixture(false)
  try {
    await missing.journal.authenticate('Alice')
    await missing.journal.append({ time: missing.now(), room: 'room', text: 'PRIVATE_SECRET' })
    assert.equal(missing.journal.status, 'memory_only'); assert.deepEqual(await missing.journal.read(), [])
    assert.equal(readFileSync(missing.file).includes(Buffer.from('PRIVATE_SECRET')), false)
  } finally { await missing.close() }
  const f = fixture()
  try {
    await f.journal.authenticate('Alice')
    const write = f.journal.append({ time: f.now(), room: 'room', text: 'queued' })
    await f.journal.logout(); await write
    await f.journal.authenticate('Alice'); assert.deepEqual(await f.journal.read(), [])
    await f.journal.append({ time: f.now(), room: 'room', text: 'saved' })
    await f.journal.disable(); assert.deepEqual(await f.journal.read(), [])
  } finally { await f.close() }
})
test('sensitive markers are removed before encryption and corrupt ciphertext fails closed', async () => {
  const f = fixture()
  try {
    await f.journal.authenticate('Alice')
    await f.journal.append({ time: f.now(), room: 'room', text: 'access_\u200btoken=PRIVATE_SYNTHETIC_TOKEN' })
    assert.equal((await f.journal.read())[0].text.includes('PRIVATE_SYNTHETIC_TOKEN'), false)
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(f.file)
    db.prepare('UPDATE journal_events SET payload=?').run(Buffer.alloc(32)); db.close()
    assert.deepEqual(await f.journal.read(), [])
    assert.equal(f.journal.status, 'failed')
  } finally { await f.close() }
})
