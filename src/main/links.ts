import { find } from 'linkifyjs'
import type { Message } from '../shared/types.ts'
import { webURL } from './protocol.ts'

export function messageLink(input: unknown, messages: Message[]): string {
  const url = webURL(input)
  const known = messages.some(message => find(message.text, 'url').some(link => {
    try { return webURL(link.href) === url } catch { return false }
  }))
  if (!known) throw new Error('連結已不在本次房間記錄中。')
  return url
}
