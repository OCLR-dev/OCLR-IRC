export type UpdateMode = 'manual' | 'sparkle' | 'windows'
export type UpdateStatus = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing' | 'error'
export interface AppUpdateState {
  mode: UpdateMode
  status: UpdateStatus
  version: string | null
  progress: number | null
}
