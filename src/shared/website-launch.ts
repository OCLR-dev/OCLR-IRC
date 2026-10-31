import { uuid } from './oclr-contracts.ts'

export interface WebsiteLaunchState {
  requestId: string
  fixtureId: string
  status: 'pending' | 'authorizing' | 'loading' | 'ready' | 'error'
}
/** External URLs only request navigation. No credentials, origin override or commands. */
export function parseWebsiteLaunch(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 100) return null
  const match = /^oclr-irc:\/\/connect\?fixture=([a-f0-9-]{36})$/.exec(value)
  return match && match[0] === value && uuid.safeParse(match[1]).success ? match[1] : null
}
