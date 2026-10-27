export type Connection = 'offline' | 'connecting' | 'online' | 'error' | 'reconnecting' | 'suspended'
export interface Message { id: number; time: string; sender: string; text: string; kind: 'system' | 'bot' | 'chat' | 'self'; delivery?: 'unconfirmed' }
export interface RoomTarget { roomId: number; roomEpoch: number }
export interface PlayerSlot { slot: number; osuId: number; username: string; status: string; team: 'red' | 'blue' | null; host: boolean }
export interface Room { id: number; epoch: number; channel: string; joined: boolean; binding: 'unknown' | 'verified' | 'mismatch'; referee: 'unknown' | 'listed'; name: string | null; mode: string | null; players: number | null; kind: 'match' | 'channel' | 'private'; members: string[]; syncState: 'unknown' | 'loading' | 'partial' | 'complete' | 'stale'; observedAt: string | null; beatmap: { id: number; title: string } | null; mods: string[] | null; slots: PlayerSlot[]; phase: 'unknown' | 'idle' | 'playing' }
export type Pending = 'join' | 'settings' | 'listrefs' | null
export interface RoomTab { id: number; epoch: number; channel: string; joined: boolean; unread: number; mentions: number; pending: Pending; error: string | null }
export interface Snapshot {
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
export interface DesktopAPI {
  snapshot(): Promise<Snapshot>
  login(input: { username: string; password: string; remember?: boolean }): Promise<{ ok: boolean; error?: string }>
  credentialStatus(): Promise<{ available: boolean; saved: boolean }>
  loginSaved(): Promise<{ ok: boolean; error?: string }>
  forgetCredentials(): Promise<{ ok: boolean; error?: string }>
  logout(): Promise<void>
  retry(): Promise<{ ok: boolean; error?: string }>
  openConversation(input: { kind: 'channel' | 'private'; name: string }): Promise<{ ok: boolean; error?: string }>
  join(input: string): Promise<{ ok: boolean; error?: string }>
  selectRoom(input: RoomTarget): Promise<{ ok: boolean; error?: string }>
  leaveRoom(input: RoomTarget): Promise<{ ok: boolean; error?: string }>
  query(input: RoomTarget & { kind: 'settings' | 'listrefs' }): Promise<{ ok: boolean; error?: string }>
  chat(input: RoomTarget & { text: string }): Promise<{ ok: boolean; error?: string }>
  openMessageLink(input: string): Promise<{ ok: boolean; error?: string }>
  openAccountSettings(): Promise<void>
  onState(listener: (state: Snapshot) => void): () => void
}
