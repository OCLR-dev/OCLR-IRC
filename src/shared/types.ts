export type Connection = 'offline' | 'connecting' | 'online' | 'error'
export interface Message { id: number; time: string; sender: string; text: string; kind: 'system' | 'bot' | 'chat' | 'self'; delivery?: 'unconfirmed' }
export interface Snapshot {
  connection: Connection
  username: string
  error: string | null
  room: { id: number; epoch: number; channel: string; joined: boolean; binding: 'unknown' | 'verified' | 'mismatch'; referee: 'unknown' | 'listed'; name: string | null; mode: string | null; players: number | null } | null
  pending: 'join' | 'settings' | 'listrefs' | null
  messages: Message[]
}
export interface DesktopAPI {
  snapshot(): Promise<Snapshot>
  login(input: { username: string; password: string }): Promise<{ ok: boolean; error?: string }>
  logout(): Promise<void>
  join(input: string): Promise<{ ok: boolean; error?: string }>
  query(input: 'settings' | 'listrefs'): Promise<{ ok: boolean; error?: string }>
  chat(input: { roomId: number; roomEpoch: number; text: string }): Promise<{ ok: boolean; error?: string }>
  openMessageLink(input: string): Promise<{ ok: boolean; error?: string }>
  openAccountSettings(): Promise<void>
  onState(listener: (state: Snapshot) => void): () => void
}
