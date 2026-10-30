export type PlayerIntent = { kind: 'invite'; osuId: string; name: string } | { kind: 'move'; osuId: string; slot: string } | { kind: 'team'; osuId: string; team: 'red' | 'blue' } | { kind: 'kick'; osuId: string }
export type LobbyIntent = PlayerIntent | { kind: 'rename'; name: string } | { kind: 'configure'; teamMode: string; scoreMode: string; size: string } | { kind: 'host'; osuId: string } | { kind: 'password'; mode: 'set' | 'clear' } | { kind: 'lock' | 'unlock' | 'clearhost' | 'close' }
export interface LobbyPreview { token: string; channel: string; command: string; kind: LobbyIntent['kind']; passwordMode?: 'set' | 'clear'; expiresAt: string; playerName?: string }
export function lobbyIntent(input: unknown): LobbyIntent {
  if (!input || typeof input !== 'object') throw new Error('無效的房間設定。')
  const value = input as Record<string, unknown>
  if (['invite', 'move', 'team', 'kick'].includes(String(value.kind))) {
    if (typeof value.osuId !== 'string' || !/^[1-9]\d{0,15}$/.test(value.osuId) || !Number.isSafeInteger(Number(value.osuId))) throw new Error('無效的玩家 UID。')
    if (value.kind === 'invite') {
      if (typeof value.name !== 'string' || !value.name.trim() || [...value.name].length > 64 || /[\p{Cc}\p{Cf}]/u.test(value.name)) throw new Error('請輸入待核對的玩家名稱。')
      return { kind: 'invite', osuId: value.osuId, name: value.name.trim() }
    }
    if (value.kind === 'move') {
      if (typeof value.slot !== 'string' || !/^(?:[1-9]|1[0-6])$/.test(value.slot)) throw new Error('請選擇 1–16 的槽位。')
      return { kind: 'move', osuId: value.osuId, slot: value.slot }
    }
    if (value.kind === 'team') {
      if (value.team !== 'red' && value.team !== 'blue') throw new Error('請明確選擇紅隊或藍隊。')
      return { kind: 'team', osuId: value.osuId, team: value.team }
    }
    return { kind: 'kick', osuId: value.osuId }
  }
  if (value.kind === 'rename') {
    if (typeof value.name !== 'string' || !value.name.trim() || [...value.name.trim()].length > 50 || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value.name)) throw new Error('房名需為 1–50 字，不含控制字元。')
    return { kind: 'rename', name: value.name.trim() }
  }
  if (value.kind === 'configure') {
    if (typeof value.teamMode !== 'string' || !/^[0-3]$/.test(value.teamMode) || typeof value.scoreMode !== 'string' || !/^[0-3]$/.test(value.scoreMode) || typeof value.size !== 'string' || !/^(?:[1-9]|1[0-6])$/.test(value.size)) throw new Error('請選擇有效的隊伍模式、計分與 1–16 個槽位。')
    return { kind: 'configure', teamMode: value.teamMode, scoreMode: value.scoreMode, size: value.size }
  }
  if (value.kind === 'host') {
    if (typeof value.osuId !== 'string' || !/^[1-9]\d{0,15}$/.test(value.osuId) || !Number.isSafeInteger(Number(value.osuId))) throw new Error('無效的玩家 UID。')
    return { kind: 'host', osuId: value.osuId }
  }
  if (value.kind === 'password' && (value.mode === 'set' || value.mode === 'clear')) return { kind: 'password', mode: value.mode }
  if (['lock', 'unlock', 'clearhost', 'close'].includes(String(value.kind))) return { kind: value.kind as 'lock' | 'unlock' | 'clearhost' | 'close' }
  throw new Error('不支援此房間設定。')
}
export function lobbyCommand(intent: LobbyIntent, secret?: unknown) {
  if (intent.kind === 'invite' || intent.kind === 'kick') return `!mp ${intent.kind} #${intent.osuId}`
  if (intent.kind === 'move') return `!mp move #${intent.osuId} ${intent.slot}`
  if (intent.kind === 'team') return `!mp team #${intent.osuId} ${intent.team}`
  if (intent.kind === 'rename') return `!mp name ${intent.name}`
  if (intent.kind === 'configure') return `!mp set ${intent.teamMode} ${intent.scoreMode} ${intent.size}`
  if (intent.kind === 'host') return `!mp host #${intent.osuId}`
  if (intent.kind === 'password') {
    if (intent.mode === 'clear') return '!mp password'
    if (secret === undefined) return '!mp password 〔隱藏〕'
    if (typeof secret !== 'string' || !secret || [...secret].length > 64 || /[\s\p{Cc}\p{Cf}]/u.test(secret)) throw new Error('房間密碼需為 1–64 字，不含空白或控制字元。')
    return `!mp password ${secret}`
  }
  return `!mp ${intent.kind}`
}
