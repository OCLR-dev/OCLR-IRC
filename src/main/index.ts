import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IrcSession } from './irc.ts'

const irc = new IrcSession()
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
  ipcMain.handle('irc:snapshot', event => { trusted(event); return irc.state })
  ipcMain.handle('irc:login', (event, value: unknown) => action(event, () => irc.login(value)))
  ipcMain.handle('irc:logout', event => { trusted(event); irc.logout() })
  ipcMain.handle('irc:join', (event, value: unknown) => action(event, () => irc.join(value)))
  ipcMain.handle('irc:query', (event, value: unknown) => action(event, () => irc.query(value)))
  ipcMain.handle('osu:account-settings', event => { trusted(event); return shell.openExternal('https://osu.ppy.sh/home/account/edit') })
  irc.on('state', state => { if (window && !window.isDestroyed()) window.webContents.send('irc:state', state) })
  function create() {
    window = new BrowserWindow({ width: 1180, height: 780, minWidth: 900, minHeight: 640,
      backgroundColor: '#111116', title: 'OCLR ref tools', autoHideMenuBar: true,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), nodeIntegration: false, contextIsolation: true, sandbox: true } })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => { if (url !== (devURL || productionURL)) event.preventDefault() })
    window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    window.on('closed', () => { window = null; irc.logout() })
    if (devURL) void window.loadURL(devURL)
    else void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  create()
  app.on('activate', () => { if (!window) create() })
})
app.on('before-quit', () => irc.logout())
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
