import { OCLR_ORIGIN } from '../shared/oclr-contracts.ts'

/** Set by the operator in Main, never accepted from renderer IPC or server data. */
export function oclrOrigin(input?: string): string {
  if (!input) return OCLR_ORIGIN
  const url = new URL(input)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw new Error('Invalid OCLR server origin')
  return url.origin
}
