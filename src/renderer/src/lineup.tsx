import { PlanControl } from './room-plan'
import { useEffect, useState } from 'react'
import { Button, Input, Label, TextField } from '@heroui/react'
import { WorkspaceCheckbox, WorkspaceSelect } from './controls'
import { compareLineup, manualRoster, lineupMode } from '../../shared/lineup'
import type { ManualRosterEntry, LineupSelection } from '../../shared/lineup'
import type { Room } from '../../shared/types'
const labels = { unknown: '玩家觀測待更新', empty: '尚未選擇出賽玩家', duplicate: '重複 UID', unlisted: '不在手動名單', missing: '尚未到場', bench: '未選出賽但在房內', team: '隊伍不符', slot: '槽位不符', conflict: '預定槽位重複', policy: '隊伍或槽位尚未指定' }
export function ManualLineup({ room }: { room: Room }) {
  const [roster, setRoster] = useState<ManualRosterEntry[]>([]), [selection, setSelection] = useState<LineupSelection[]>([])
  const [uid, setUid] = useState(''), [name, setName] = useState(''), [error, setError] = useState(''), [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  function add() { try { if (!/^[1-9]\d*$/.test(uid)) throw new Error('請輸入有效 UID。'); setRoster(manualRoster([...roster, { osuId: Number(uid), name }])); setUid(''); setName(''); setError('') } catch (e) { setError((e as Error).message) } }
  const individual = lineupMode(room) === 'individual'
  const effectiveSelection = individual ? selection.map(player => ({ ...player, team: null })) : selection
  const differences = compareLineup(roster, effectiveSelection, room, now)
  return <details className="manual-lineup map-profile"><summary>手動陣容核對</summary>
    <TextField name="lineupUid" value={uid} onChange={setUid}><Label>osu! UID</Label><Input inputMode="numeric" /></TextField>
    <TextField name="lineupName" value={name} onChange={setName}><Label>玩家名稱</Label><Input /></TextField>
    <Button size="sm" variant="secondary" onPress={add}>加入手動名單</Button>
    {error && <p role="alert">{error}</p>}
    {roster.map(player => { const selected = selection.find(item => item.osuId === player.osuId)
      const update = (patch: Partial<LineupSelection>) => setSelection(items => items.map(item => item.osuId === player.osuId ? { ...item, ...patch } : item))
      return <div className="lineup-entry" key={player.osuId}><strong>{player.name} · #{player.osuId}</strong>
        <WorkspaceCheckbox selected={Boolean(selected)} onChange={checked => setSelection(items => checked ? [...items, { osuId: player.osuId, team: null, slot: null }] : items.filter(item => item.osuId !== player.osuId))}>本次出賽</WorkspaceCheckbox>
        {selected && <>{!individual && <WorkspaceSelect label={`${player.name} 隊伍`} value={selected.team ?? ''} onChange={team => update({ team: team as 'red' | 'blue' })} options={[{ value: 'red', label: '紅隊' }, { value: 'blue', label: '藍隊' }]} />}<WorkspaceSelect label={`${player.name} 槽位`} value={selected.slot ? String(selected.slot) : ''} onChange={slot => update({ slot: Number(slot) })} options={Array.from({ length: 16 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} /></>}
        <Button size="sm" variant="ghost" onPress={() => { setRoster(items => items.filter(item => item.osuId !== player.osuId)); setSelection(items => items.filter(item => item.osuId !== player.osuId)) }}>移除</Button>
      </div>
    })}
    <PlanControl room={room} plan={{kind: 'lineup', players: effectiveSelection}} />
    <div className="lineup-differences" role="status">{differences.length ? differences.map((issue, index) => <p key={index}>{issue.osuId ? `${roster.find(p => p.osuId === issue.osuId)?.name ?? `#${issue.osuId}`} · ` : ''}{labels[issue.kind]}</p>) : <p>符合手動陣容</p>}</div>
  </details>
}
