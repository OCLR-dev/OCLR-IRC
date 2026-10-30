import type { Room } from '../../shared/types'
/** Settings reports occupied slots, not the configured room capacity. */
export function PlayerSlots({ room }: { room: Room }) {
  const current = (room.syncState === 'complete' || room.syncState === 'partial') && room.slotsVerified === true && room.binding === 'verified' && room.joined
  const ready = room.slots.filter(slot => /^ready$/i.test(slot.status)).length
  const state = { unknown: '尚未同步', loading: '同步中', partial: '資料不完整', complete: '設定快照', stale: '資料已過期' }[room.syncState]
  return <section className="player-slots" aria-label="玩家槽位">
    <header><h2>玩家槽位</h2><span>{current ? `準備 ${ready} / ${room.slots.length}` : '準備 — / —'}</span></header>
    <p className="slots-caption">{state}</p>
    <ol className="player-slot-list">
      {Array.from({ length: 16 }, (_, index) => {
        const slot = room.slots.find(player => player.slot === index + 1)
        return <li key={index} className={`player-slot ${slot ? 'occupied' : 'vacant'} ${current ? '' : 'unverified'}`} data-team={slot?.team || undefined}>
          <span className="slot-number">{String(index + 1).padStart(2, '0')}</span>
          {slot ? <div className="slot-player"><strong>{slot.username}</strong><span className="slot-status">{slot.team === 'red' ? '紅隊 · ' : slot.team === 'blue' ? '藍隊 · ' : ''}{slot.host ? '房主 · ' : ''}{slot.status}{!current && ' · 待核對'}</span></div> : <span>{current ? '空位' : '未知'}</span>}
        </li>
      })}
    </ol>
  </section>
}
