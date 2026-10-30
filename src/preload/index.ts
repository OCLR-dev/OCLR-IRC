import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopAPI, Snapshot } from '../shared/types.ts'
import type { OclrSnapshot } from '../shared/oclr-contracts.ts'

const api: DesktopAPI = {
  journal: {
    status: () => ipcRenderer.invoke('journal:status'),
    setEnabled: enabled => ipcRenderer.invoke('journal:enabled', enabled),
    read: room => ipcRenderer.invoke('journal:read', room),
    clear: room => ipcRenderer.invoke('journal:clear', room),
    export: room => ipcRenderer.invoke('journal:export', room)
  },
  runInBackground: () => ipcRenderer.invoke('app:background'),
  quit: () => ipcRenderer.invoke('app:quit'),
  website: {
    startRelay: () => ipcRenderer.invoke('oclr:relay-start'),
    stopRelay: () => ipcRenderer.invoke('oclr:relay-stop'),
    snapshot: () => ipcRenderer.invoke('oclr:snapshot'),
    login: () => ipcRenderer.invoke('oclr:login'),
    cancelLogin: () => ipcRenderer.invoke('oclr:cancel-login'),
    logout: () => ipcRenderer.invoke('oclr:logout'),
    refreshFixtures: () => ipcRenderer.invoke('oclr:fixtures'),
    loadMoreFixtures: () => ipcRenderer.invoke('oclr:more-fixtures'),
    selectFixture: input => ipcRenderer.invoke('oclr:select-fixture', input),
    refreshPanel: () => ipcRenderer.invoke('oclr:panel'),
    selectMap: input => ipcRenderer.invoke('oclr:select-map', input),
    copyCommand: input => ipcRenderer.invoke('oclr:copy-command', input),
    openReview: input => ipcRenderer.invoke('oclr:open-review', input),
    onState: listener => {
      const handler = (_event: Electron.IpcRendererEvent, state: OclrSnapshot) => listener(state)
      ipcRenderer.on('oclr:state', handler)
      return () => ipcRenderer.removeListener('oclr:state', handler)
    }
  },
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
  previewMp: input => ipcRenderer.invoke('irc:mp-preview', input),
  executeMp: input => ipcRenderer.invoke('irc:mp-execute', input),
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
