export const MAX_CHAT_LINES = 10
export const MAX_CHAT_DRAFT = 6000
export const IRC_MESSAGE_BYTES = 510
const encoder = new TextEncoder()
export const chatBytes = (text: string, target: string) => encoder.encode(`PRIVMSG ${target} :${text.trim()}`).length
export const isChatCommand = (text: string) => /^!\S/.test(text)
/** Each line is a PRIVMSG body; line breaks can never become IRC protocol frames. */
export function chatLines(value: unknown, target: string): string[] {
  if (typeof value !== 'string' || value.length > MAX_CHAT_DRAFT) throw new Error('草稿過長，請分批傳送。')
  const text = value.replace(/\r\n?/g, '\n')
  if (/[\x00-\x09\x0b-\x1f\x7f\u2028\u2029]/u.test(text)) throw new Error('訊息不能包含控制字元。')
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  if (!lines.length) throw new Error('請輸入訊息。')
  if (lines.length > MAX_CHAT_LINES) throw new Error('每次最多傳送 10 行訊息。')
  if (lines.some(line => chatBytes(line, target) > IRC_MESSAGE_BYTES)) throw new Error('單行訊息過長，請縮短後再送出。')
  return lines
}
