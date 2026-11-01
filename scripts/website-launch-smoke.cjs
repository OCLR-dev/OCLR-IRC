// Synthetic OS handoff events; never opens the system browser or real IRC.
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('node:path')
const assert = require('node:assert/strict')
app.disableHardwareAcceleration()
app.setPath('userData', path.join(process.env.OCLR_QA_TEMP, 'website-launch'))
app.getPreferredSystemLanguages = () => ['zh-TW']
const handlers = new Map(), opened = []
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (name, fn) => { handlers.set(name, fn); handle(name, fn) }
shell.openExternal = async value => { opened.push(value) }
const fixture = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const url = n => `oclr-irc://connect?fixture=${fixture(n)}`
process.argv.push(url(101))
require('./mock-avatar-fetch.cjs')
require('../out/main/index.js')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn) { for (let i = 0; i < 100; i++) { if (await fn()) return; await delay(50) } throw Error('Launch UI timed out') }
async function main() {
  await app.whenReady()
  await until(() => BrowserWindow.getAllWindows()[0]?.webContents.getURL())
  const window = BrowserWindow.getAllWindows()[0]
  await until(() => window.webContents.executeJavaScript('!!window.oclr && !!document.querySelector("main")'))
  const snapshot = () => window.webContents.executeJavaScript('window.oclr.websiteLaunch.snapshot()')
  await until(async () => (await snapshot())?.fixtureId === fixture(101))
  const initial = await snapshot()
  await until(() => window.webContents.executeJavaScript('!!document.querySelector("[aria-label=網站連接請求]")'))
  assert.equal(window.webContents.getURL().startsWith('file:'), true)
  const prevented = { preventDefault() { this.called = true }, called: false }
  app.emit('open-url', prevented, url(102))
  await until(async () => (await snapshot())?.fixtureId === fixture(102))
  assert.equal(prevented.called, true)
  const accepted = await snapshot()
  app.emit('open-url', prevented, url(102) + '&command=!mp%20make%20Bad')
  assert.deepEqual(await snapshot(), accepted)
  window.hide()
  app.emit('second-instance', {}, ['ignored', url(103)])
  await until(async () => window.isVisible() && (await snapshot())?.fixtureId === fixture(103))
  assert.throws(() => handlers.get('app:website-launch')({sender: {}, senderFrame: {url: 'https://evil.invalid'}}), /Untrusted/)
  await window.webContents.executeJavaScript('window.oclr.websiteLaunch.clear()')
  assert.equal(await snapshot(), null)
  assert.deepEqual(opened, [])
  assert.notEqual(initial.requestId, accepted.requestId)
  assert.equal((await window.webContents.executeJavaScript('window.oclr.website.snapshot()')).status, 'disconnected')
  console.log(JSON.stringify({evidence: 'synthetic-website-launch', passed: ['cold argv queues fixture without login', 'early open-url and repeated validation', 'second-instance focuses original window', 'unknown parameters rejected', 'trusted IPC and cancel', 'no browser auth or IRC commands from URL'], limitation: 'Injected OS events; native protocol registration and browser prompts require platform acceptance.'}))
  app.quit()
}
main().catch(error => { console.error(error); app.exit(1) })
