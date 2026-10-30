import { fetchBeatmapDuration } from './beatmap-duration.ts'
import { app, BrowserWindow, ipcMain, shell, powerMonitor, safeStorage, clipboard } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IrcSession } from './irc.ts'
import { CredentialStore } from './credential-store.ts'
import { credentials } from './protocol.ts'
import { messageLink } from './links.ts'
import { SqliteCreationStore } from './creation-store.ts'
import { OclrRelay } from './oclr-relay.ts'
import { OclrSession } from './oclr.ts'
import { publicOclrError } from './oclr-http.ts'
import { DesktopBackground } from './background.ts'

// Preserve the existing profile (and test overrides) when changing the display name.
app.setPath('userData', app.getPath('userData'))
app.setName('OCLR IRC')

const irc = new IrcSession(undefined, {}, fetchBeatmapDuration)
const oclr = new OclrSession({ origin: process.env.OCLR_SERVER_ORIGIN, version: app.getVersion(), platform: process.platform, openExternal: url => shell.openExternal(url), writeClipboard: text => clipboard.writeText(text) })
const relay = new OclrRelay(oclr, irc)
let loginGeneration = 0
let pendingSave: { username: string; password: string } | null = null
let credentialError: string | null = null
function logout() { loginGeneration++; pendingSave = null; irc.logout() }
function snapshot() { return { ...irc.state, credentialError } }
let window: BrowserWindow | null = null
let background: DesktopBackground | null = null
let quitting = false
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()
app.on('second-instance', () => background?.show())
const productionURL = pathToFileURL(join(__dirname, '../renderer/index.html')).href
const devURL = process.env.ELECTRON_RENDERER_URL
function trusted(event: Electron.IpcMainInvokeEvent) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted IPC sender')
  const url = event.senderFrame.url
  if (devURL ? new URL(url).origin !== new URL(devURL).origin : url !== productionURL) throw new Error('Untrusted IPC origin')
}
function action(event: Electron.IpcMainInvokeEvent, fn: () => void) {
  trusted(event)
  try { fn(); return { ok: true } } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '操作未完成，請再試一次。' } }
}
app.whenReady().then(() => {
  if (!primaryInstance) return
  irc.setCreationStore(new SqliteCreationStore(join(app.getPath('userData'), 'room-creation.sqlite')))
  const store = new CredentialStore(join(app.getPath('userData'), 'irc-credentials.enc'), {
    // Linux async provider/fallback assurance is still unverified: fail closed.
    available: () => process.platform === 'linux' ? Promise.resolve(false) : safeStorage.isAsyncEncryptionAvailable(),
    encrypt: value => safeStorage.encryptStringAsync(value),
    decrypt: value => safeStorage.decryptStringAsync(value)
  })
  function changed() { if (window && !window.isDestroyed()) window.webContents.send('irc:state', snapshot()) }
  oclr.on('state', state => { if (window && !window.isDestroyed()) window.webContents.send('oclr:state', state) })
  async function websiteAction(event: Electron.IpcMainInvokeEvent, fn: () => unknown) {
    trusted(event)
    try { await fn(); return { ok: true } } catch (error) { return { ok: false, error: publicOclrError(error) } }
  }
  ipcMain.handle('oclr:relay-start', event => websiteAction(event, () => relay.start()))
  ipcMain.handle('oclr:relay-stop', event => websiteAction(event, () => relay.stop()))
  ipcMain.handle('oclr:snapshot', event => { trusted(event); return oclr.state })
  ipcMain.handle('oclr:login', event => websiteAction(event, () => oclr.login()))
  ipcMain.handle('oclr:cancel-login', event => websiteAction(event, () => oclr.cancelLogin()))
  ipcMain.handle('oclr:logout', event => websiteAction(event, () => oclr.logout()))
  ipcMain.handle('oclr:fixtures', event => websiteAction(event, () => oclr.loadFixtures()))
  ipcMain.handle('oclr:more-fixtures', event => websiteAction(event, () => oclr.loadFixtures(true)))
  ipcMain.handle('oclr:select-fixture', (event, id: unknown) => websiteAction(event, () => oclr.selectFixture(id)))
  ipcMain.handle('oclr:panel', event => websiteAction(event, () => oclr.readPanel()))
  ipcMain.handle('oclr:select-map', (event, id: unknown) => websiteAction(event, () => oclr.selectMap(id)))
  ipcMain.handle('oclr:copy-command', (event, input: unknown) => websiteAction(event, () => oclr.copyCommand(input)))
  ipcMain.handle('oclr:open-review', (event, id: unknown) => websiteAction(event, () => oclr.openReview(id)))
  irc.on('authenticated', () => {
    const generation = loginGeneration
    const value = pendingSave; pendingSave = null
    if (value) void store.save(value).catch(() => { if (generation !== loginGeneration) return; credentialError = '已連線，但系統安全保存失敗；下次請手動登入。'; changed() })
  })
  irc.on('state', state => { if (!state.username) pendingSave = null })
  ipcMain.handle('irc:snapshot', event => { trusted(event); return snapshot() })
  ipcMain.handle('irc:credential-status', event => { trusted(event); return store.status() })
  ipcMain.handle('irc:forget-credentials', async event => {
    trusted(event); loginGeneration++; pendingSave = null
    try { await store.forget(); credentialError = null; changed(); return { ok: true } }
    catch { return { ok: false, error: '無法刪除保存資料，請檢查本機檔案權限。' } }
  })
  ipcMain.handle('irc:login', async (event, value: unknown) => {
    trusted(event)
    let auth: { username: string; password: string }
    try { auth = credentials(value) } catch { return { ok: false, error: '請檢查使用者名稱與 IRC 專用密碼。' } }
    const generation = ++loginGeneration
    pendingSave = null; credentialError = null
    const remember = (value as { remember?: unknown }).remember === true
    try {
      if (remember && !(await store.status()).available) return { ok: false, error: '系統安全儲存不可用，請取消保存後登入。' }
      if (!remember) await store.forget()
      if (generation !== loginGeneration) return { ok: false, error: '登入已取消。' }
      irc.login(auth)
      pendingSave = remember ? auth : null
      return { ok: true }
    } catch { return { ok: false, error: '無法更新安全登入資料，請重試。' } }
  })
  ipcMain.handle('irc:login-saved', async event => {
    trusted(event)
    const generation = ++loginGeneration
    pendingSave = null; credentialError = null
    try {
      const auth = await store.load()
      if (generation !== loginGeneration) return { ok: false, error: '登入已取消。' }
      irc.login(auth); return { ok: true }
    } catch { return { ok: false, error: '無法解密已保存的登入資料，請忘記後重新輸入。' } }
  })
  ipcMain.handle('irc:logout', event => { trusted(event); logout() })
  powerMonitor.on('suspend', () => { void relay.stop(); irc.suspend() })
  powerMonitor.on('suspend', () => oclr.suspend())
  powerMonitor.on('resume', () => irc.resume())
  ipcMain.handle('irc:retry', event => action(event, () => irc.retry()))
  ipcMain.handle('irc:open-conversation', (event, value: unknown) => action(event, () => irc.openConversation(value)))
  ipcMain.handle('irc:join', (event, value: unknown) => action(event, () => irc.join(value)))
  ipcMain.handle('irc:create-room', (event, value: unknown) => action(event, () => irc.createRoom(value)))
  ipcMain.handle('irc:select-room', (event, value: unknown) => action(event, () => irc.selectRoom(value)))
  ipcMain.handle('irc:leave-room', (event, value: unknown) => action(event, () => irc.leaveRoom(value)))
  ipcMain.handle('irc:query', (event, value: unknown) => action(event, () => irc.query(value)))
  ipcMain.handle('irc:mp-preview', (event, value: unknown) => {
    trusted(event)
    try { return { ok: true, preview: irc.previewMp(value) } }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '無法預覽操作。' } }
  })
  ipcMain.handle('irc:mp-execute', (event, value: unknown) => action(event, () => irc.executeMp(value)))
  ipcMain.handle('irc:chat', (event, value: unknown) => action(event, () => irc.chat(value)))
  ipcMain.handle('irc:open-message-link', async (event, value: unknown) => {
    trusted(event)
    try {
      const url = messageLink(value, irc.state.messages)
      await shell.openExternal(url)
      return { ok: true }
    } catch { return { ok: false, error: '無法開啟此訊息連結。' } }
  })
  ipcMain.handle('osu:account-settings', event => { trusted(event); return shell.openExternal('https://osu.ppy.sh/home/account/edit') })
  ipcMain.handle('app:background', event => action(event, () => background?.hide()))
  ipcMain.handle('app:quit', event => { trusted(event); setImmediate(() => app.quit()); return { ok: true } })
  let update: ReturnType<typeof setTimeout> | null = null
  irc.on('state', () => {
    if (update) return
    update = setTimeout(() => {
      update = null
      if (window && !window.isDestroyed()) window.webContents.send('irc:state', snapshot())
    }, 32)
  })
  function create() {
    window = new BrowserWindow({ width: 1180, height: 780, minWidth: 900, minHeight: 640,
      backgroundColor: '#111116', title: 'OCLR IRC', autoHideMenuBar: true,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), nodeIntegration: false, contextIsolation: true, sandbox: true } })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => { if (url !== (devURL || productionURL)) event.preventDefault() })
    window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    window.on('focus', () => oclr.setForeground(true))
    window.on('blur', () => oclr.setForeground(false))
    window.on('hide', () => oclr.setForeground(false))
    window.on('minimize', () => oclr.setForeground(false))
    window.on('close', event => { if (!quitting && background) { event.preventDefault(); background.hide() } })
    // The shutdown query may be cancelled by the user; clean up only on confirmed end.
    window.on('session-end', () => { quitting = true; logout(); oclr.dispose() })
    window.on('closed', () => { window = null; logout(); oclr.dispose() })
    if (devURL) void window.loadURL(devURL)
    else void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  create()
  background = new DesktopBackground(() => window, value => oclr.setForeground(value), () => app.quit())
  app.on('activate', () => { if (!window) create(); background?.show() })
})
app.on('before-quit', () => { quitting = true; logout(); oclr.dispose(); background?.destroy() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
