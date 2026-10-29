import test from 'node:test'
import assert from 'node:assert/strict'
import { oclrOrigin } from '../src/main/oclr-origin.ts'

test('OCLR origin remains operator-bound and supports loopback development', () => {
  assert.equal(oclrOrigin(), 'https://oclr.org')
  assert.equal(oclrOrigin('http://127.0.0.1:3001'), 'http://127.0.0.1:3001')
  assert.equal(oclrOrigin('http://localhost:3001'), 'http://localhost:3001')
  assert.equal(oclrOrigin('https://staging.oclr.org/'), 'https://staging.oclr.org')
  for (const value of ['http://oclr.org', 'http://localhost.evil:3001', 'https://oclr.org/api', 'https://u:p@oclr.org', 'https://oclr.org/?token=x', 'file:///tmp/oclr']) assert.throws(() => oclrOrigin(value))
})
