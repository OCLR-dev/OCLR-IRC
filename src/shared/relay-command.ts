import { countdownEvent } from './countdown.ts'
import { validateModCombination } from './mp-command.ts'

/** Website relay commands are bounded MP commands, never raw IRC or credentials. */
export function relayCommand(value: unknown): string {
  if (typeof value !== 'string' || value.length > 300 || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value)) throw new Error('無效的網站指令。')
  const text = value.trim()
  if (/^!mp (?:map [1-9]\d{0,9}(?: [0-3])?|set [0-3] [0-3](?: (?:[1-9]|1[0-6]))?|(?:invite|addref) [A-Za-z0-9_\[\]-]{1,50}|(?:timer|start) [1-9]\d{0,3}|abort|aborttimer|mods (?:None|(?:NF|EZ|HD|HR|DT|HT|NC|FL|FI|SD|PF|SO|MR|[1-9]K|Freemod)(?: (?:NF|EZ|HD|HR|DT|HT|NC|FL|FI|SD|PF|SO|MR|[1-9]K|Freemod))*))$/.test(text)) {
    if (text.startsWith('!mp mods ') && text !== '!mp mods None') validateModCombination(text.slice('!mp mods '.length).split(' '))
    return text
  }
  throw new Error('此網站指令不在允許清單。')
}

/** A wire write is not acceptance. Only a subsequent scoped BanchoBot reply can confirm. */
export function relayReply(command: string, text: string): 'confirmed' | 'failed' | null {
  if (/^(?:You (?:are not|must be)|Invalid |Failed to |User not found|No user found|Beatmap not found|The beatmap could not be found)/i.test(text)) return 'failed'
  if (confirmsMods(command, text)) return 'confirmed'
  const timer = /^!mp timer ([1-9]\d{0,3})$/.exec(command)
  if (timer) {
    const event = countdownEvent(text, 0)
    if (event?.kind === 'timer' && event.value.status === 'active' && Date.parse(event.value.deadline!) === Number(timer[1]) * 1000) return 'confirmed'
  }
  const addref = /^!mp addref ([A-Za-z0-9_\[\]-]{1,50})$/.exec(command)
  const added = /^Added (.+) to the match referees\.?$/.exec(text)
  const nick = (name: string) => name.trim().replace(/ /g, '_').toLowerCase()
  if (addref && added && nick(addref[1]) === nick(added[1])) return 'confirmed'
  const map = /^!mp map (\d+)/.exec(command)
  if (map) {
    const modern = /^Changed beatmap to (https?:\/\/[^\s]+)(?:\s|$)/i.exec(text)
    const legacy = /^Beatmap changed to:\s+(.+)$/i.exec(text)
    // Only the actual first link identifies the map. A later URL in its title
    // must not confirm a different requested ID or a lookalike URL suffix.
    const url = modern?.[1] ?? legacy?.[1].match(/https?:\/\/[^\s()[\]<>]+/i)?.[0]
    const observed = url && /^https:\/\/osu\.ppy\.sh\/(?:b|beatmaps)\/([1-9]\d*)$/.exec(url)
    if (observed?.[1] === map[1]) return 'confirmed'
  }
  if (command === '!mp abort' && /^Aborted the match\.?$/i.test(text)) return 'confirmed'
  if (command === '!mp aborttimer' && /^(?:Countdown aborted|Aborted the match start timer)\.?$/i.test(text)) return 'confirmed'
  // Other response wordings are deliberately left unconfirmed until an exact
  // correlated response is supported; receipt messages still reach the website.
  return null
}

export function confirmsMods(command: string, reply: string): boolean {
  const requested = /^!mp mods (.+)$/.exec(command);
  const observed = /^(?:Enabled (.+)|Disabled all mods), (enabled|disabled) FreeMod\.?$/i.exec(reply);
  if (!requested || !observed) return false;
  const aliases: Record<string, string | undefined> = {NOFAIL: "NF", EASY: "EZ", HIDDEN: "HD", HARDROCK: "HR", DOUBLETIME: "DT", HALFTIME: "HT", NIGHTCORE: "NC", FLASHLIGHT: "FL", FADEIN: "FI", SUDDENDEATH: "SD", PERFECT: "PF", SPUNOUT: "SO", MIRROR: "MR"};
  const normalize = (value: string) => {
    const name = value.replace(/[ -]/g, "").toUpperCase();
    return aliases[name] ?? (/^(?:NF|EZ|HD|HR|DT|HT|NC|FL|FI|SD|PF|SO|MR|[1-9]K)$/.test(name) ? name : null);
  };
  const words = requested[1].split(" ");
  const freemod = words.includes("Freemod");
  if (freemod !== (observed[2].toLowerCase() === "enabled")) return false;
  const desired = words.filter(m => !["None", "Freemod"].includes(m)).map(normalize);
  const actual = observed[1] ? observed[1].split(/,\s*/).map(normalize) : [];
  return !desired.includes(null) && !actual.includes(null) && new Set(actual).size === actual.length && desired.sort().join(",") === actual.sort().join(",");
}
