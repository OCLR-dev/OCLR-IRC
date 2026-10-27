import { StringDecoder } from 'node:string_decoder'

export class Lines {
  private decoder = new StringDecoder('utf8')
  private pending = ''
  feed(chunk: Buffer): string[] {
    this.pending += this.decoder.write(chunk)
    if (Buffer.byteLength(this.pending) > 131072) throw new Error('receive-limit')
    const lines: string[] = []
    let end: number
    while ((end = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, end).replace(/\r$/, '')
      if (Buffer.byteLength(line) > 16384) throw new Error('line-limit')
      lines.push(line)
      this.pending = this.pending.slice(end + 1)
    }
    if (Buffer.byteLength(this.pending) > 16384) throw new Error('line-limit')
    return lines
  }
}

export function parse(line: string): { prefix: string; command: string; params: string[] } | null {
  let rest = line.trimStart()
  if (rest.startsWith('@')) {
    const space = rest.indexOf(' ')
    if (space < 0) return null
    rest = rest.slice(space + 1).trimStart()
  }
  let prefix = ''
  if (rest.startsWith(':')) {
    const space = rest.indexOf(' ')
    if (space < 0) return null
    prefix = rest.slice(1, space)
    rest = rest.slice(space + 1).trimStart()
  }
  const trailing = rest.indexOf(' :')
  const parts = (trailing < 0 ? rest : rest.slice(0, trailing)).split(/ +/)
  const command = parts.shift()?.toUpperCase()
  if (!command || !/^(?:[A-Z]+|\d{3})$/.test(command)) return null
  if (trailing >= 0) parts.push(rest.slice(trailing + 2))
  return { prefix, command, params: parts }
}

export function normalize(name: string): string { return name.replaceAll(' ', '_').toLowerCase() }
export function credentials(input: unknown): { username: string; password: string } {
  if (!input || typeof input !== 'object') throw new Error('請填寫帳號與 IRC 專用密碼。')
  const { username, password } = input as Record<string, unknown>
  if (typeof username !== 'string' || !/^[A-Za-z0-9_ \[\]-]{2,32}$/.test(username.trim())) throw new Error('請填寫有效的 osu! 使用者名稱。')
  if (typeof password !== 'string' || !password.length || password.length > 128 || /[\r\n\0]/.test(password)) throw new Error('請填寫有效的 IRC 專用密碼。')
  return { username: username.trim().replaceAll(' ', '_'), password }
}
export function roomId(input: unknown): number {
  if (typeof input !== 'string') throw new Error('請輸入 MP 編號或 osu! 比賽連結。')
  const match = /^(?:https:\/\/osu\.ppy\.sh\/(?:mp|community\/matches)\/)?([1-9]\d*)\/?$/.exec(input.trim())
  const id = Number(match?.[1])
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('請輸入有效的 MP 編號或 osu! 比賽連結。')
  return id
}
export function redact(text: string): string {
  if (/(?:^|\s)(?:PASS\s|!mp\s+password(?:\s|$)|(?:access_token|refresh_token|code_verifier|password)\s*[:=])/i.test(text)) return '〔含敏感資訊，已隱藏〕'
  return text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, 3000)
}

// Outgoing chat is deliberately not an arbitrary IRC/command gateway.
export function chatText(input: unknown, channel: string): string {
  if (typeof input !== 'string' || /[\x00-\x1f\x7f]/.test(input)) throw new Error('訊息不能包含換行或控制字元。')
  const text = input.trim()
  if (!text) throw new Error('請輸入訊息。')
  if (/^[!／/]/u.test(text)) throw new Error('此輸入區只支援一般聊天，尚未開放指令。')
  if (Buffer.byteLength(`PRIVMSG ${channel} :${text}`, 'utf8') > 510) throw new Error('訊息過長，請縮短後再送出。')
  return text
}
// Only allow a clicked, currently visible message URL; reject credentials and protocols
// that can execute applications. Renderer cannot use this as a generic shell proxy.
export function webURL(input: unknown): string {
  if (typeof input !== 'string' || input.length > 2048 || /[\x00-\x20\x7f]/.test(input)) throw new Error('無效的網頁連結。')
  let url: URL
  try { url = new URL(input) } catch { throw new Error('無效的網頁連結。') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('僅能開啟不含登入資訊的 HTTP／HTTPS 連結。')
  return url.href
}
