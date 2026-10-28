import { app, BrowserWindow, ipcMain, shell, powerMonitor, safeStorage } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IrcSession } from './irc.ts'
import { CredentialStore } from './credential-store.ts'
import { credentials } from './protocol.ts'
import { messageLink } from './links.ts'
import { SqliteCreationStore } from './creation-store.ts'

const irc = new IrcSession()
let loginGeneration = 0
let pendingSave: { username: string; password: string } | null = null
let credentialError: string | null = null
function logout() { loginGeneration++; pendingSave = null; irc.logout() }
function snapshot() { return { ...irc.state, credentialError } }
let window: BrowserWindow | null = null
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
  irc.setCreationStore(new SqliteCreationStore(join(app.getPath('userData'), 'room-creation.sqlite')))
  const store = new CredentialStore(join(app.getPath('userData'), 'irc-credentials.enc'), {
    // Linux async provider/fallback assurance is still unverified: fail closed.
    available: () => process.platform === 'linux' ? Promise.resolve(false) : safeStorage.isAsyncEncryptionAvailable(),
    encrypt: value => safeStorage.encryptStringAsync(value),
    decrypt: value => safeStorage.decryptStringAsync(value)
  })
  function changed() { if (window && !window.isDestroyed()) window.webContents.send('irc:state', snapshot()) }
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
  powerMonitor.on('suspend', () => irc.suspend())
  powerMonitor.on('resume', () => irc.resume())
  ipcMain.handle('irc:retry', event => action(event, () => irc.retry()))
  ipcMain.handle('irc:open-conversation', (event, value: unknown) => action(event, () => irc.openConversation(value)))
  ipcMain.handle('irc:join', (event, value: unknown) => action(event, () => irc.join(value)))
  ipcMain.handle('irc:create-room', (event, value: unknown) => action(event, () => irc.createRoom(value)))
  ipcMain.handle('irc:select-room', (event, value: unknown) => action(event, () => irc.selectRoom(value)))
  ipcMain.handle('irc:leave-room', (event, value: unknown) => action(event, () => irc.leaveRoom(value)))
  ipcMain.handle('irc:query', (event, value: unknown) => action(event, () => irc.query(value)))
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
      backgroundColor: '#111116', title: 'OCLR ref tools', autoHideMenuBar: true,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), nodeIntegration: false, contextIsolation: true, sandbox: true } })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => { if (url !== (devURL || productionURL)) event.preventDefault() })
    window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    window.on('closed', () => { window = null; logout() })
    if (devURL) void window.loadURL(devURL)
    else void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  create()
  app.on('activate', () => { if (!window) create() })
})
app.on('before-quit', () => logout())
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
