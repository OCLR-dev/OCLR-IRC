import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopAPI, Snapshot } from '../shared/types.ts'

const api: DesktopAPI = {
  snapshot: () => ipcRenderer.invoke('irc:snapshot'),
  login: input => ipcRenderer.invoke('irc:login', input),
  credentialStatus: () => ipcRenderer.invoke('irc:credential-status'),
  loginSaved: () => ipcRenderer.invoke('irc:login-saved'),
  forgetCredentials: () => ipcRenderer.invoke('irc:forget-credentials'),
  logout: () => ipcRenderer.invoke('irc:logout'),
  retry: () => ipcRenderer.invoke('irc:retry'),
  openConversation: input => ipcRenderer.invoke('irc:open-conversation', input),
  join: input => ipcRenderer.invoke('irc:join', input),
  createRoom: input => ipcRenderer.invoke('irc:create-room', input),
  selectRoom: input => ipcRenderer.invoke('irc:select-room', input),
  leaveRoom: input => ipcRenderer.invoke('irc:leave-room', input),
  query: input => ipcRenderer.invoke('irc:query', input),
  chat: input => ipcRenderer.invoke('irc:chat', input),
  openMessageLink: input => ipcRenderer.invoke('irc:open-message-link', input),
  openAccountSettings: () => ipcRenderer.invoke('osu:account-settings'),
  onState: listener => {
    const handler = (_event: Electron.IpcRendererEvent, state: Snapshot) => listener(state)
    ipcRenderer.on('irc:state', handler)
    return () => ipcRenderer.removeListener('irc:state', handler)
  }
}
contextBridge.exposeInMainWorld('oclr', api)
