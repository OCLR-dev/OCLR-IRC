export interface Countdown {
  status: 'active' | 'finished' | 'cancelled' | 'unknown'
  observedAt: string
  deadline: string | null
}
export interface CountdownEvent { kind: 'timer' | 'start'; value: Countdown }

/** Bancho text only; callers must establish the source, room and connection first. */
export function countdownEvent(body: string, now = Date.now()): CountdownEvent | null {
  const observedAt = new Date(now).toISOString()
  const ended: Record<string, [CountdownEvent['kind'], Countdown['status']]> = {
    'Countdown finished': ['timer', 'finished'],
    'Countdown aborted': ['timer', 'cancelled'],
    'Aborted the match start timer': ['start', 'cancelled']
  }
  if (ended[body]) { const [kind, status] = ended[body]; return { kind, value: { status, observedAt, deadline: null } } }
  const match = /^(Countdown ends in|Match starts in|Queued the match to start in) (\d{1,4}) (minute|second)s?(?: and (\d{1,2}) seconds?)?$/.exec(body)
  if (!match || (match[4] && (match[3] !== 'minute' || Number(match[4]) > 59))) return null
  const seconds = Number(match[2]) * (match[3] === 'minute' ? 60 : 1) + Number(match[4] || 0)
  if (seconds < 1 || seconds > 3600) return null
  return { kind: match[1] === 'Countdown ends in' ? 'timer' : 'start', value: { status: 'active', observedAt, deadline: new Date(now + seconds * 1000).toISOString() } }
}

export function countdownLabel(value: Countdown, now: number): string {
  if (value.status !== 'active') return { finished: '已結束', cancelled: '已取消', unknown: '待核對' }[value.status]
  const seconds = value.deadline ? Math.max(0, Math.ceil((Date.parse(value.deadline) - now) / 1000)) : 0
  return seconds > 0 ? `約 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '等待伺服器確認'
}
