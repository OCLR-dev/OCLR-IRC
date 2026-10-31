export interface WebsiteRoomJoinState {
  requestId: string
  roomId: number
  status: 'pending' | 'joining' | 'joined' | 'error'
}

/** Fixed Bancho room navigation only. No hosts, credentials or room commands. */
export function parseWebsiteRoomJoin(value: unknown): number | null {
  if (typeof value !== 'string' || value.length > 64) return null
  const match = /^oclr-irc:\/\/join\?room=([1-9]\d{0,15})$/.exec(value)
  if (!match || match[0] !== value) return null
  const id = Number(match[1])
  return Number.isSafeInteger(id) ? id : null
}
