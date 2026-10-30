import { remainingMatchSeconds } from '../../shared/match-time'
import { useEffect, useState } from 'react'
import type { Room } from '../../shared/types'

export function MatchStatus({ room }: { room: Room }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (room.phase !== 'playing') return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [room.phase, room.match?.startedAt])
  const elapsed = room.match ? Math.max(0, Math.floor((now - Date.parse(room.match.startedAt)) / 1000)) : null
  const beatmap = room.beatmap ?? room.match?.beatmap
  const mods = room.mods ?? room.match?.mods
  const duration = room.duration?.beatmapId === beatmap?.id ? room.duration?.milliseconds ?? null : null
  const remaining = remainingMatchSeconds(duration, elapsed, mods)
  return <section className="match-status" aria-label="比賽狀態">
    <div><strong>{room.phase === 'playing' ? '進行中 · In progress' : room.phase === 'idle' ? '比賽未進行' : '比賽狀態待核對'}</strong>
      {room.phase === 'playing' && elapsed !== null && <time title="依官方譜面最後物件與 Mods 估算；含載入與網路時間誤差，並非音檔長度或伺服器結束確認">{remaining === null ? `已進行 ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')} · 剩餘未知` : `剩餘約 ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`}</time>}</div>
    <div><span>{beatmap?.title ?? '歌曲尚未確認'}</span><span>{mods == null ? 'Mods 未知' : mods.join(', ') || 'NoMod'}</span></div>
    {room.phase === 'playing' && <small>已收到 Bancho 開賽確認；玩家狀態以最近設定回覆為準。</small>}
  </section>
}
