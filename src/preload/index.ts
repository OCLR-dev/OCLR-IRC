import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopAPI, Snapshot } from '../shared/types.ts'

const api: DesktopAPI = {
  snapshot: () => ipcRenderer.invoke('irc:snapshot'),
  login: input => ipcRenderer.invoke('irc:login', input),
  logout: () => ipcRenderer.invoke('irc:logout'),
  join: input => ipcRenderer.invoke('irc:join', input),
  query: input => ipcRenderer.invoke('irc:query', input),
  openAccountSettings: () => ipcRenderer.invoke('osu:account-settings'),
  onState: listener => {
    const handler = (_event: Electron.IpcRendererEvent, state: Snapshot) => listener(state)
    ipcRenderer.on('irc:state', handler)
    return () => ipcRenderer.removeListener('irc:state', handler)
  }
}
contextBridge.exposeInMainWorld('oclr', api)
