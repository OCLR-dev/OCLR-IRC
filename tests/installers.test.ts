import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { distribution } = require('../scripts/distribution.cjs')
const { windowsConfiguration } = require('../scripts/create-installers.cjs')
const { appleVerify } = require('../scripts/apple-verify.cjs')
const { validateConfiguration } = require('app-builder-lib/out/util/config/config')

test('installer distribution uses fixed native formats and rejects path or platform confusion', () => {
  const commit = 'a'.repeat(40)
  assert.deepEqual(distribution('0.8.2', commit, 'windows', 'x64').installer, {file: 'OCLR-IRC-0.8.2-windows-x64-aaaaaaa-setup.exe', format: 'nsis'})
  assert.equal(distribution('0.8.2', commit, 'macos', 'arm64').installer.file, 'OCLR-IRC-0.8.2-macos-arm64-aaaaaaa.dmg')
  assert.equal(distribution('0.8.2', commit, 'linux', 'x64').installer, null)
  for (const args of [['../0.8.2', commit, 'windows', 'x64'], ['0.8.2', '../commit', 'macos', 'arm64'], ['0.8.2', commit, 'macos', 'x64'], ['0.8.2', commit, 'windows', 'arm64']]) assert.throws(() => distribution(...args))
})

test('NSIS uses the existing app identity, a per-user wizard and preserves user data', async () => {
  const config = windowsConfiguration('synthetic-setup.exe', 'release/installer-output')
  await validateConfiguration(config, {add() {}})
  assert.equal(config.appId, 'org.oclr.ref-tools')
  assert.equal(config.productName, 'OCLR IRC')
  assert.deepEqual(config.win.target, ['nsis'])
  assert.equal(config.nsis.perMachine, false)
  assert.equal(config.nsis.allowElevation, false)
  assert.equal(config.nsis.deleteAppDataOnUninstall, false)
  assert.equal(config.nsis.runAfterFinish, false)
  assert.equal(config.nsis.oneClick, false)
  assert.deepEqual(config.protocols[0].schemes, ['oclr-irc'])
  assert.equal(config.publish, null)
})

test('Apple transport checks retry only read-only network failures and never accept invalid tickets', async () => {
  let calls = 0
  await appleVerify('xcrun', ['stapler', 'validate', 'synthetic.app'], () => ++calls < 3 ? {status: 68, stderr: 'NSURLErrorDomain: The network connection was lost.'} : {status: 0}, async () => {})
  assert.equal(calls, 3)
  calls = 0
  await assert.rejects(appleVerify('xcrun', ['stapler', 'validate', 'synthetic.app'], () => {calls++; return {status: 68, stderr: 'ticket is invalid'}}, async () => {}))
  assert.equal(calls, 1)
  calls = 0
  await assert.rejects(appleVerify('xcrun', ['stapler', 'validate', 'synthetic.app'], () => {calls++; return {status: 68, stderr: 'network connection was lost'}}, async () => {}))
  assert.equal(calls, 3)
})
