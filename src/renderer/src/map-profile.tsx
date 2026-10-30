import { useEffect, useState } from 'react'
import { Button, TextField, Input, Label } from '@heroui/react'
import { WorkspaceCheckbox } from './controls'
import { MP_MODS } from '../../shared/mp-command'
import type { MapPlanPreview } from '../../shared/map-profile'
import type { Snapshot } from '../../shared/types'
const labels = { queued: '待送出', sending: '正在送出', awaiting: '等待讀回', observed: '已核對設定', unknown: '結果不明', failed: '未送出', cancelled: '已取消' }
export function MapProfileControls({ state }: { state: Snapshot }) {
  const [map, setMap] = useState(''), [mods, setMods] = useState<string[]>([]), [freemod, setFreemod] = useState(false)
  const [preview, setPreview] = useState<MapPlanPreview | null>(null), [reviewed, setReviewed] = useState(false), [individual, setIndividual] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const plan = state.mapPlan?.roomId === state.room?.id ? state.mapPlan : null
  const active = plan && ['queued', 'sending', 'awaiting'].includes(plan.state)
  useEffect(() => { setPreview(null); setReviewed(false); setIndividual(false) }, [map, JSON.stringify(mods), freemod, state.room?.id, state.room?.epoch, state.connection])
  useEffect(() => { if (!preview) return; const timer = setTimeout(() => setPreview(null), Math.max(0, Date.parse(preview.expiresAt) - Date.now())); return () => clearTimeout(timer) }, [preview])
  async function prepare() {
    if (!window.oclr || !state.room) return
    setBusy(true); setError(''); setReviewed(false); setIndividual(false)
    try {
      const result = await window.oclr.previewProfile({ roomId: state.room.id, roomEpoch: state.room.epoch, profile: { beatmapId: map, roomMods: mods, freemod, individualModsPolicy: freemod ? 'manual' : 'disabled', ruleset: 'current', revision: crypto.randomUUID() } })
      setPreview(result.preview ?? null); if (!result.ok) setError(result.error ?? '無法預覽。')
    } catch { setError('桌面服務無法回應。') } finally { setBusy(false) }
  }
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
  return <details className="map-profile"><summary>連續換圖與 Mods</summary>
    <TextField name="profileMap" value={map} onChange={setMap} isDisabled={busy || Boolean(active) || Boolean(preview)}><Label>Beatmap ID</Label><Input inputMode="numeric" /></TextField>
    <div className="mp-mods">{MP_MODS.filter(mod => mod !== 'Freemod').map(mod => <WorkspaceCheckbox key={mod} selected={mods.includes(mod)} disabled={busy || Boolean(active) || Boolean(preview)} onChange={selected => setMods(selected ? [...mods, mod] : mods.filter(m => m !== mod))}>{mod}</WorkspaceCheckbox>)}</div>
    <WorkspaceCheckbox selected={freemod} disabled={busy || Boolean(active) || Boolean(preview)} onChange={setFreemod}>Freemod</WorkspaceCheckbox>
    {preview ? <div className="mp-confirm profile-confirm"><strong>{preview.channel}</strong>{preview.commands.map(command => <code key={command}>{command}</code>)}<WorkspaceCheckbox selected={reviewed} onChange={setReviewed}>我已核對房間、選圖與完整 Mods</WorkspaceCheckbox>{preview.freemod && <WorkspaceCheckbox selected={individual} onChange={setIndividual}>我已確認本次 Freemod 個人 Mods 規則</WorkspaceCheckbox>}<Button size="sm" variant="danger" isDisabled={!reviewed || preview.freemod && !individual || busy} onPress={() => void execute()}>開始套用</Button><Button size="sm" variant="ghost" onPress={() => setPreview(null)}>取消預覽</Button></div> : <Button size="sm" variant="secondary" isDisabled={busy || Boolean(active) || !state.room?.joined} onPress={() => void prepare()}>預覽選圖計畫</Button>}
    {plan && <div className="profile-progress" role="status">{plan.steps.map((step, i) => <p key={i}>{i + 1}. {step.command} · {labels[step.state]}</p>)}{active && <Button size="sm" variant="danger" onPress={() => void cancel()}>停止後續步驟</Button>}</div>}
    {error && <p role="alert">{error}</p>}
  </details>
}
