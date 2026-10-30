export interface OperationRecord {
  id: string
  source: 'manual' | 'oclr'
  kind: string
  roomId: number | null
  roomEpoch: number
  state: 'awaiting' | 'observed' | 'unknown'
  createdAt: number
  reviewed: boolean
}
