import { tr } from './i18n'
import { ManualLineup } from './lineup'
import type { Room } from '../../shared/types'
/** Settings reports occupied slots, not the configured room capacity. */
export function PlayerSlots({ room }: { room: Room }) {
  const current = (room.syncState === 'complete' || room.syncState === 'partial') && room.slotsVerified === true && room.binding === 'verified' && room.joined
  const ready = room.slots.filter(slot => /^ready$/i.test(slot.status)).length
  const state = { unknown: tr("尚未同步"), loading: tr("同步中"), partial: tr("資料不完整"), complete: tr("設定快照"), stale: tr("資料已過期") }[room.syncState]
  return <section className="player-slots" aria-label={tr("玩家槽位")}>
    <header><h2>{tr("玩家槽位")}</h2><span>{current ? tr("準備 {{v0}} / {{v1}}", { v0: ready, v1: room.slots.length }) : tr("準備 — / —")}</span></header>
    <p className="slots-caption">{state}</p>
    <ManualLineup key={`${room.id}:${room.epoch}:${room.joined}`} room={room} />
    <ol className="player-slot-list">
      {Array.from({ length: 16 }, (_, index) => {
        const slot = room.slots.find(player => player.slot === index + 1)
        return <li key={index} className={`player-slot ${slot ? 'occupied' : 'vacant'} ${current ? '' : 'unverified'}`} data-team={slot?.team || undefined}>
          <span className="slot-number">{String(index + 1).padStart(2, '0')}</span>
          {slot ? <div className="slot-player"><strong>{slot.username}</strong><span className="slot-status">{slot.team === 'red' ? tr("紅隊 · ") : slot.team === 'blue' ? tr("藍隊 · ") : ''}{slot.host ? tr("房主 · ") : ''}{slot.status}{!current && tr(" · 待核對")}</span></div> : <span>{current ? tr("空位") : tr("未知")}</span>}
        </li>
      })}
    </ol>
  </section>
}
