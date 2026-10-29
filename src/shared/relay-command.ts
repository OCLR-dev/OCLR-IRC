/** Website relay commands are bounded MP commands, never raw IRC or credentials. */
export function relayCommand(value: unknown): string {
  if (typeof value !== 'string' || value.length > 300 || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value)) throw new Error('無效的網站指令。')
  const text = value.trim()
  if (/^!mp (?:map [1-9]\d{0,9}(?: [0-3])?|set [0-3] [0-3](?: (?:[1-9]|1[0-6]))?|(?:invite|addref) [A-Za-z0-9_\[\]-]{1,50}|(?:timer|start) [1-9]\d{0,3}|abort|aborttimer|mods (?:None|(?:NF|EZ|HD|HR|DT|HT|NC|FL|FI|SD|PF|SO|MR|[1-9]K|Freemod)(?: (?:NF|EZ|HD|HR|DT|HT|NC|FL|FI|SD|PF|SO|MR|[1-9]K|Freemod))*))$/.test(text)) return text
  throw new Error('此網站指令不在允許清單。')
}

/** A wire write is not acceptance. Only a subsequent scoped BanchoBot reply can confirm. */
export function relayReply(command: string, text: string): 'confirmed' | 'failed' | null {
  if (/^(?:You (?:are not|must be)|Invalid |Failed to |User not found|No user found|Beatmap not found|The beatmap could not be found)/i.test(text)) return 'failed'
  const map = /^!mp map (\d+)/.exec(command)
  if (map && /^Beatmap changed to:/i.test(text)) return new RegExp(`https://osu\\.ppy\\.sh/(?:b/|beatmaps/)${map[1]}(?:[^0-9]|$)`).test(text) ? 'confirmed' : null
  if (command === '!mp abort' && /^Aborted the match\.?$/i.test(text)) return 'confirmed'
  if (command === '!mp aborttimer' && /^(?:Countdown aborted|Aborted the match start timer)\.?$/i.test(text)) return 'confirmed'
  // Other response wordings are deliberately left unconfirmed until an exact
  // correlated response is supported; receipt messages still reach the website.
  return null
}
