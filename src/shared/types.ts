import type { ManualPoolState, ManualPoolUpdate } from './manual-pool.ts'
import type { RoomPlanInput, RoomPlanPreview } from './room-plan.ts'
import type { LobbyIntent, LobbyPreview } from './lobby-command.ts'
import type { MapProfile, MapPlanState, MapPlanPreview } from './map-profile.ts'
import type { OperationRecord } from './operation.ts'
import type { Countdown } from './countdown.ts'
import type { MpIntent, MpPreview } from './mp-command.ts'
import type { OclrSnapshot } from './oclr-contracts.ts'
import type { AppPreferences, AppSettings } from './preferences.ts'

export type Connection = 'offline' | 'connecting' | 'online' | 'error' | 'reconnecting' | 'suspended'
export interface Message { id: number; time: string; sender: string; text: string; kind: 'system' | 'bot' | 'chat' | 'self'; delivery?: 'sent' | 'unconfirmed' }
export interface RoomTarget { roomId: number; roomEpoch: number }
export interface PlayerSlot { slot: number; osuId: number; username: string; status: string; team: 'red' | 'blue' | null; host: boolean }
export interface Room { timer?: Countdown | null; startCountdown?: Countdown | null; duration?: { beatmapId: number; milliseconds: number } | null; slotsVerified?: boolean; match?: { startedAt: string; beatmap: { id: number; title: string } | null; mods: string[] | null } | null; id: number; epoch: number; channel: string; joined: boolean; binding: 'unknown' | 'verified' | 'mismatch'; referee: 'unknown' | 'listed'; name: string | null; mode: string | null; players: number | null; kind: 'match' | 'channel' | 'private'; members: string[]; syncState: 'unknown' | 'loading' | 'partial' | 'complete' | 'stale'; observedAt: string | null; beatmap: { id: number; title: string } | null; mods: string[] | null; slots: PlayerSlot[]; phase: 'unknown' | 'idle' | 'playing' }
export type Pending = 'join' | 'settings' | 'listrefs' | null
export interface RoomTab { id: number; epoch: number; channel: string; joined: boolean; unread: number; mentions: number; pending: Pending; error: string | null }
export interface RoomCreation {
  status: 'unreviewed' | 'awaiting' | 'created' | 'unknown' | 'blocked'
  requestId: string
  roomId: number | null
  message: string | null
}
export interface Snapshot {
  manualPool?: ManualPoolState
  roomPlan?: MapPlanState | null
  mapPlan?: MapPlanState | null
  operations?: { records: OperationRecord[]; failed: boolean }
  creation: RoomCreation
  credentialError?: string | null
  retryAttempt: number
  retryAt: string | null
  connection: Connection
  username: string
  error: string | null
  room: Room | null
  rooms: RoomTab[]
  leavingChannels: string[]
  pending: Pending
  messageStartIndex: number
  messages: Message[]
}
export interface JournalEntry { time: number; room: string; text: string }
export interface JournalState { enabled: boolean; status: 'saving' | 'memory_only' | 'failed'; account: string | null }
export interface DesktopAPI {
  settings: {
    snapshot(): Promise<AppSettings>
    update(input: AppPreferences): Promise<{ ok: boolean; settings?: AppSettings; error?: string }>
    onState(listener: (state: AppSettings) => void): () => void
    openAboutLink(kind: 'repository' | 'license' | 'notices'): Promise<{ ok: boolean; error?: string }>
  }
  replaceManualPool(input: ManualPoolUpdate): Promise<{ok: boolean; error?: string}>
  previewPoolEntry(input: RoomTarget & {revision: string; entryId: string}): Promise<{ok: boolean; preview?: MapPlanPreview; error?: string}>
  previewRoomPlan(input: RoomTarget & { plan: RoomPlanInput }): Promise<{ok: boolean; preview?: RoomPlanPreview; error?: string}>
  executeRoomPlan(input: RoomTarget & {token: string; reviewed: boolean; names?: string[]; policyReviewed?: boolean}): Promise<{ok: boolean; error?: string}>
  cancelRoomPlan(input: {id: string}): Promise<{ok: boolean; error?: string}>
  previewLobby(input: RoomTarget & { intent: LobbyIntent }): Promise<{ ok: boolean; preview?: LobbyPreview; error?: string }>
  executeLobby(input: RoomTarget & { token: string; reviewed: boolean; password?: string; closeRoom?: string; playerName?: string }): Promise<{ ok: boolean; error?: string }>
  previewProfile(input: RoomTarget & { profile: MapProfile }): Promise<{ ok: boolean; preview?: MapPlanPreview; error?: string }>
  executeProfile(input: RoomTarget & { token: string; reviewed: boolean; individualReviewed: boolean }): Promise<{ ok: boolean; error?: string }>
  cancelProfile(input: { id: string }): Promise<{ ok: boolean; error?: string }>
  journal: {
    onInvalidate(listener: () => void): () => void
    status(): Promise<JournalState>
    setEnabled(enabled: boolean): Promise<{ ok: boolean; error?: string }>
    read(room?: string): Promise<{ ok: boolean; entries?: JournalEntry[]; error?: string }>
    clear(room?: string): Promise<{ ok: boolean; error?: string }>
    export(room?: string): Promise<{ ok: boolean; cancelled?: boolean; error?: string }>
  }

  reviewOperation(input: { id: string; reviewed: boolean }): Promise<{ ok: boolean; error?: string }>
  runInBackground(): Promise<{ ok: boolean; error?: string }>
  quit(): Promise<{ ok: boolean; error?: string }>
  website: {
    confirmPairing(input: { token: string; reviewed: boolean }): Promise<{ ok: boolean; error?: string }>
    startRelay(): Promise<{ ok: boolean; error?: string }>
    stopRelay(): Promise<{ ok: boolean; error?: string }>
    snapshot(): Promise<OclrSnapshot>
    login(): Promise<{ ok: boolean; error?: string }>
    cancelLogin(): Promise<{ ok: boolean; error?: string }>
    logout(): Promise<{ ok: boolean; error?: string }>
    refreshFixtures(): Promise<{ ok: boolean; error?: string }>
    loadMoreFixtures(): Promise<{ ok: boolean; error?: string }>
    selectFixture(id: string): Promise<{ ok: boolean; error?: string }>
    refreshPanel(): Promise<{ ok: boolean; error?: string }>
    selectMap(id: string): Promise<{ ok: boolean; error?: string }>
    copyCommand(input: { previewId: string; commandId: string }): Promise<{ ok: boolean; error?: string }>
    openReview(id: string): Promise<{ ok: boolean; error?: string }>
    onState(listener: (state: OclrSnapshot) => void): () => void
  }
  snapshot(): Promise<Snapshot>
  login(input: { username: string; password: string; remember?: boolean }): Promise<{ ok: boolean; error?: string }>
  credentialStatus(): Promise<{ available: boolean; saved: boolean }>
  loginSaved(): Promise<{ ok: boolean; error?: string }>
  forgetCredentials(): Promise<{ ok: boolean; error?: string }>
  logout(): Promise<void>
  retry(): Promise<{ ok: boolean; error?: string }>
  openConversation(input: { kind: 'channel' | 'private'; name: string }): Promise<{ ok: boolean; error?: string }>
  join(input: string): Promise<{ ok: boolean; error?: string }>
  createRoom(input: { name: string; requestId: string; reviewed: boolean }): Promise<{ ok: boolean; error?: string }>
  selectRoom(input: RoomTarget): Promise<{ ok: boolean; error?: string }>
  leaveRoom(input: RoomTarget): Promise<{ ok: boolean; error?: string }>
  query(input: RoomTarget & { kind: 'settings' | 'listrefs' }): Promise<{ ok: boolean; error?: string }>
  previewMp(input: RoomTarget & { intent: MpIntent }): Promise<{ ok: boolean; preview?: MpPreview; error?: string }>
  executeMp(input: RoomTarget & { token: string; reviewed: boolean }): Promise<{ ok: boolean; error?: string }>
  chat(input: RoomTarget & { text: string }): Promise<{ ok: boolean; error?: string }>
  openMessageLink(input: string): Promise<{ ok: boolean; error?: string }>
  openAccountSettings(): Promise<void>
  onState(listener: (state: Snapshot) => void): () => void
}
