import { useEffect, useState } from 'react'
import { Button, Input, Label, TextField } from '@heroui/react'
import { MP_MODS } from '../../shared/mp-command'
import type { MpIntent, MpPreview } from '../../shared/mp-command'
import type { Snapshot } from '../../shared/types'

export function MpControls({ state }: { state: Snapshot }) {
  const [kind, setKind] = useState<MpIntent['kind']>('map')
  const [beatmapId, setBeatmapId] = useState('')
  const [mods, setMods] = useState<string[]>([])
  const [preview, setPreview] = useState<MpPreview | null>(null)
  const [reviewed, setReviewed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const room = state.room!
  const fingerprint = JSON.stringify(room)
  useEffect(() => { setPreview(null); setReviewed(false) }, [fingerprint, state.connection])
  useEffect(() => {
    if (!preview) return
    const timer = setTimeout(() => { setPreview(null); setReviewed(false); setMessage('預覽已過期，請重新讀取設定及預覽。') }, Math.max(0, Date.parse(preview.expiresAt) - Date.now()))
    return () => clearTimeout(timer)
  }, [preview])
  const available = state.connection === 'online' && room.joined && room.binding === 'verified' && room.referee === 'listed' && (room.syncState === 'complete' || ((kind === 'map' || (kind === 'mods' && room.beatmap !== null)) && room.syncState === 'partial')) && !state.pending
  async function prepare() {
    if (!window.oclr) return
    setBusy(true); setMessage(''); setReviewed(false); setPreview(null)
    const intent: MpIntent = kind === 'map' ? { kind, beatmapId } : kind === 'mods' ? { kind, mods } : { kind }
    try {
      const result = await window.oclr.previewMp({ roomId: room.id, roomEpoch: room.epoch, intent })
      if (result.ok && result.preview) setPreview(result.preview)
      else setMessage(result.error || '無法預覽操作。')
    } catch { setMessage('桌面服務無法回應。') }
    finally { setBusy(false) }
  }
  async function execute() {
    if (!window.oclr || !preview || !reviewed) return
    const token = preview.token
    setPreview(null); setReviewed(false); setBusy(true)
    try {
      const result = await window.oclr.executeMp({ roomId: room.id, roomEpoch: room.epoch, token, reviewed: true })
      setMessage(result.ok ? '已嘗試送出，尚未確認結果。請核對 BanchoBot 回覆並重讀設定與裁判名單。' : result.error || '操作未完成，請核對房間後重新預覽。')
    } catch { setMessage('結果不明，請核對 BanchoBot 回覆；不會自動重送。') }
    finally { setBusy(false) }
  }
  return <details className="mp-controls"><summary>房內快捷操作</summary>
    <p className="slots-caption">手動操作 {room.channel}；不會自動核對 OCLR 場次規則。</p>
    {!available && <p className="slots-caption">請先讀取完整設定與裁判名單。過期後需重新查詢。</p>}
    <fieldset disabled={busy || Boolean(preview)}>
      <label className="mp-label">操作<select aria-label="房內操作" value={kind} onChange={event => { setKind(event.target.value as MpIntent['kind']); setMessage('') }}><option value="map">換圖</option><option value="mods">設定 Mods</option><option value="start">立即開始比賽</option><option value="abort">中止比賽</option></select></label>
      {kind === 'map' && <TextField name="beatmapId" value={beatmapId} onChange={setBeatmapId}><Label>Beatmap ID</Label><Input placeholder="例如 123456" inputMode="numeric" /></TextField>}
      {kind === 'mods' && <><p className="slots-caption">將取代目前 Mods；全部取消即 None。Freemod 個人 Mods 需人工核對。</p><div className="mp-mods">{MP_MODS.map(mod => <label key={mod}><input type="checkbox" checked={mods.includes(mod)} onChange={event => setMods(event.target.checked ? [...mods, mod] : mods.filter(item => item !== mod))} />{mod}</label>)}</div></>}
      {kind === 'start' && <p className="mp-impact">立即開始，沒有倒數。請核對出賽玩家、隊伍、地圖、個人 Mods 與直播準備。</p>}
      {kind === 'abort' && <p className="mp-impact">中止正在進行的比賽；這不會取消開始倒數或關閉房間。</p>}
    </fieldset>
    {preview ? <div className="mp-confirm"><strong>{preview.channel}</strong><code>{preview.command}</code><label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />我已核對目標房間、比賽狀態及操作影響{kind === 'start' && '，確認玩家、地圖、Mods 與直播已準備完成'}。</label><Button size="sm" variant="danger" isDisabled={busy || !reviewed || !available} onPress={() => void execute()}>確認送出</Button><Button size="sm" variant="ghost" onPress={() => { setPreview(null); setReviewed(false) }}>取消</Button></div> : <Button size="sm" variant="secondary" isDisabled={busy || !available} onPress={() => void prepare()}>預覽指令</Button>}
    {message && <p className="mp-result" role="status">{message}</p>}
  </details>
}
