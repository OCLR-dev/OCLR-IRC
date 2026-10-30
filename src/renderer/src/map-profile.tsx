import { useEffect, useState } from 'react'
import { Button, TextField, Input, Label } from '@heroui/react'
import { WorkspaceCheckbox, WorkspaceSelect } from './controls'
import { MP_MODS } from '../../shared/mp-command'
import type { MapPlanPreview } from '../../shared/map-profile'
import type { Snapshot } from '../../shared/types'
const labels = { queued: '待送出', sending: '正在送出', awaiting: '等待讀回', observed: '已核對設定', unknown: '結果不明', failed: '未送出', cancelled: '已取消' }
export function MapProfileControls({ state }: { state: Snapshot }) {
  const [entryId, setEntryId] = useState(''), [label, setLabel] = useState('')
  const pool = state.manualPool, entry = pool?.entries.find(item => item.id === entryId)
  const [map, setMap] = useState(''), [mods, setMods] = useState<string[]>([]), [freemod, setFreemod] = useState(false)
  const [preview, setPreview] = useState<MapPlanPreview | null>(null), [reviewed, setReviewed] = useState(false), [individual, setIndividual] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const plan = state.mapPlan?.roomId === state.room?.id ? state.mapPlan : null
  const active = plan && ['queued', 'sending', 'awaiting'].includes(plan.state)
  useEffect(() => {
    if (!entryId) return
    setLabel(entry?.label ?? ''); setMap(entry?.profile?.beatmapId ?? ''); setMods(entry?.profile?.roomMods ?? []); setFreemod(entry?.profile?.freemod ?? false)
  }, [entryId, pool?.revision])
  useEffect(() => { setPreview(null); setReviewed(false); setIndividual(false) }, [map, JSON.stringify(mods), freemod, entryId, pool?.revision, state.room?.id, state.room?.epoch, state.connection])
  useEffect(() => { if (!preview) return; const timer = setTimeout(() => setPreview(null), Math.max(0, Date.parse(preview.expiresAt) - Date.now())); return () => clearTimeout(timer) }, [preview])
  async function prepare() {
    if (!window.oclr || !state.room) return
    setBusy(true); setError(''); setReviewed(false); setIndividual(false)
    try {
      const result = entryId && pool ? await window.oclr.previewPoolEntry({roomId:state.room.id,roomEpoch:state.room.epoch,revision:pool.revision,entryId}) : await window.oclr.previewProfile({ roomId: state.room.id, roomEpoch: state.room.epoch, profile: { beatmapId: map, roomMods: mods, freemod, individualModsPolicy: freemod ? 'manual' : 'disabled', ruleset: 'current', revision: crypto.randomUUID() } })
      setPreview(result.preview ?? null); if (!result.ok) setError(result.error ?? '無法預覽。')
    } catch { setError('桌面服務無法回應。') } finally { setBusy(false) }
  }
  async function save(remove = false) {
    if (!window.oclr || !pool) return
    setBusy(true); setError(''); setPreview(null)
    const id = entryId || crypto.randomUUID()
    const entries = pool.entries.filter(item => item.id !== id).map(({id,label,profile}) => ({id,label,profile}))
    if (!remove) entries.push({id,label,profile:{beatmapId:map,roomMods:mods,freemod,individualModsPolicy:freemod?'manual':'disabled',ruleset:'current',revision:crypto.randomUUID()}})
    try { const result = await window.oclr.replaceManualPool({revision:pool.revision,entries}); if (!result.ok) setError(result.error ?? '無法保存槽位。'); else setEntryId(remove ? '' : id) } catch {setError('桌面服務無法回應。')} finally {setBusy(false)}
  }
  const entryMatches = !entryId || Boolean(entry?.profile && entry.label === label && entry.profile.beatmapId === map && JSON.stringify(entry.profile.roomMods) === JSON.stringify(mods) && entry.profile.freemod === freemod)
  async function execute() {
    if (!window.oclr || !state.room || !preview) return
    const token = preview.token; setPreview(null); setBusy(true)
    try { const result = await window.oclr.executeProfile({ roomId: state.room.id, roomEpoch: state.room.epoch, token, reviewed, individualReviewed: individual }); if (!result.ok) setError(result.error ?? '無法開始計畫。') }
    catch { setError('結果不明，請核對房間。') } finally { setBusy(false) }
  }
  async function cancel() {
    if (!window.oclr || !plan) return
    try { const result = await window.oclr.cancelProfile({ id: plan.id }); if (!result.ok) setError(result.error ?? '停止失敗。') } catch { setError('桌面服務無法回應。') }
  }
  return <details className="map-profile profile-controls"><summary>連續換圖與 Mods</summary>
    <WorkspaceSelect label="手動圖池槽位" value={entryId ? `pool:${entryId}` : 'manual'} disabled={busy || Boolean(active) || Boolean(preview)} onChange={id => { setEntryId(id === 'manual' ? '' : id.slice(5)); if (id === 'manual') setLabel('') }} options={[{value:'manual',label:'手動設定'}, ...(pool?.entries ?? []).map(item => ({value:`pool:${item.id}`,label:`${item.label}${item.error ? ' · 設定無效' : ''}`}))]} />
    <TextField name="poolLabel" value={label} onChange={setLabel} isDisabled={busy || Boolean(active) || Boolean(preview)}><Label>圖池槽位名稱</Label><Input /></TextField>
    <TextField name="profileMap" value={map} onChange={setMap} isDisabled={busy || Boolean(active) || Boolean(preview)}><Label>Beatmap ID</Label><Input inputMode="numeric" /></TextField>
    <div className="mp-mods">{MP_MODS.filter(mod => mod !== 'Freemod').map(mod => <WorkspaceCheckbox key={mod} selected={mods.includes(mod)} disabled={busy || Boolean(active) || Boolean(preview)} onChange={selected => setMods(selected ? [...mods, mod] : mods.filter(m => m !== mod))}>{mod}</WorkspaceCheckbox>)}</div>
    <WorkspaceCheckbox selected={freemod} disabled={busy || Boolean(active) || Boolean(preview)} onChange={setFreemod}>Freemod</WorkspaceCheckbox>
    <div className="pool-actions"><Button size="sm" variant="secondary" isDisabled={busy || Boolean(active) || Boolean(preview) || !label.trim()} onPress={() => void save()}>保存圖池槽位</Button>{entryId && <Button size="sm" variant="ghost" isDisabled={busy || Boolean(active) || Boolean(preview)} onPress={() => void save(true)}>移除槽位</Button>}</div>
    {entry?.error && <p role="alert">{entry.error}</p>}
    {preview ? <div className="mp-confirm profile-confirm"><strong>{preview.channel}</strong>{preview.commands.map(command => <code key={command}>{command}</code>)}<WorkspaceCheckbox selected={reviewed} onChange={setReviewed}>我已核對房間、選圖與完整 Mods</WorkspaceCheckbox>{preview.freemod && <WorkspaceCheckbox selected={individual} onChange={setIndividual}>我已確認本次 Freemod 個人 Mods 規則</WorkspaceCheckbox>}<Button size="sm" variant="danger" isDisabled={!reviewed || preview.freemod && !individual || busy} onPress={() => void execute()}>開始套用</Button><Button size="sm" variant="ghost" onPress={() => setPreview(null)}>取消預覽</Button></div> : <Button size="sm" variant="secondary" isDisabled={busy || Boolean(active) || !state.room?.joined || !entryMatches} onPress={() => void prepare()}>預覽選圖計畫</Button>}
    {plan && <div className="profile-progress" role="status">{plan.steps.map((step, i) => <p key={i}>{i + 1}. {step.command} · {labels[step.state]}</p>)}{active && <Button size="sm" variant="danger" onPress={() => void cancel()}>停止後續步驟</Button>}</div>}
    {error && <p role="alert">{error}</p>}
  </details>
}
