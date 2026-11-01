import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopAPI, Snapshot } from '../shared/types.ts'
import type { OclrSnapshot } from '../shared/oclr-contracts.ts'

const api: DesktopAPI = {
  avatar: {
    snapshot: () => ipcRenderer.invoke('app:avatar'),
    onState: listener => {
      const handler = (_event: Electron.IpcRendererEvent, state: import('../shared/avatar.ts').AvatarState) => listener(state)
      ipcRenderer.on('app:avatar-state', handler)
      return () => ipcRenderer.removeListener('app:avatar-state', handler)
    }
  },
  websiteRoomJoin: {
    snapshot: () => ipcRenderer.invoke('app:website-room-join'),
    retry: id => ipcRenderer.invoke('app:website-room-join-retry', id),
    clear: () => ipcRenderer.invoke('app:website-room-join-clear'),
    onState: listener => {
      const handler = (_event: Electron.IpcRendererEvent, state: import('../shared/website-room-join.ts').WebsiteRoomJoinState | null) => listener(state)
      ipcRenderer.on('app:website-room-join', handler)
      return () => ipcRenderer.removeListener('app:website-room-join', handler)
    }
  },
  websiteLaunch: {
    snapshot: () => ipcRenderer.invoke('app:website-launch'),
    continue: id => ipcRenderer.invoke('app:website-launch-continue', id),
    clear: () => ipcRenderer.invoke('app:website-launch-clear'),
    onState: listener => {
      const handler = (_event: Electron.IpcRendererEvent, state: import('../shared/website-launch.ts').WebsiteLaunchState | null) => listener(state)
      ipcRenderer.on('app:website-launch', handler)
      return () => ipcRenderer.removeListener('app:website-launch', handler)
    }
  },
  settings: {
    snapshot: () => ipcRenderer.invoke('app:settings'),
    update: input => ipcRenderer.invoke('app:settings-update', input),
    onState: listener => {
      const handler = (_event: Electron.IpcRendererEvent, state: import('../shared/preferences.ts').AppSettings) => listener(state)
      ipcRenderer.on('app:settings-state', handler)
      return () => ipcRenderer.removeListener('app:settings-state', handler)
    },
    openAboutLink: kind => ipcRenderer.invoke('app:about-link', kind)
  },
  replaceManualPool: input => ipcRenderer.invoke('irc:manual-pool-replace', input),
  previewPoolEntry: input => ipcRenderer.invoke('irc:pool-entry-preview', input),
  previewRoomPlan: input => ipcRenderer.invoke('irc:room-plan-preview', input),
  executeRoomPlan: input => ipcRenderer.invoke('irc:room-plan-execute', input),
  cancelRoomPlan: input => ipcRenderer.invoke('irc:room-plan-cancel', input),
  journal: {
    onInvalidate: listener => {
      const handler = () => listener()
      ipcRenderer.on('journal:invalidate', handler)
      return () => ipcRenderer.removeListener('journal:invalidate', handler)
    },
    status: () => ipcRenderer.invoke('journal:status'),
    setEnabled: enabled => ipcRenderer.invoke('journal:enabled', enabled),
    read: room => ipcRenderer.invoke('journal:read', room),
    clear: room => ipcRenderer.invoke('journal:clear', room),
    export: room => ipcRenderer.invoke('journal:export', room)
  },
  reviewOperation: input => ipcRenderer.invoke('irc:operation-review', input),
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
    previewInvite: input => ipcRenderer.invoke('oclr:invite-preview', input),
    executeInvite: input => ipcRenderer.invoke('oclr:invite-execute', input),
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
  previewLobby: input => ipcRenderer.invoke('irc:lobby-preview', input),
  executeLobby: input => ipcRenderer.invoke('irc:lobby-execute', input),
  previewProfile: input => ipcRenderer.invoke('irc:profile-preview', input),
  executeProfile: input => ipcRenderer.invoke('irc:profile-execute', input),
  cancelProfile: input => ipcRenderer.invoke('irc:profile-cancel', input),
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
