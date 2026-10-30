import { WorkspaceSelect, WorkspaceCheckbox } from './controls'
import { useEffect, useState } from 'react'
import { Button, Input, Label, TextField } from '@heroui/react'
import { MP_MODS } from '../../shared/mp-command'
import type { MpIntent, MpPreview } from '../../shared/mp-command'
import type { Snapshot } from '../../shared/types'
export function MpControls({ state }: { state: Snapshot }) {
  const [kind, setKind] = useState<MpIntent['kind']>('map')
  const [seconds, setSeconds] = useState('30')
  const [delayed, setDelayed] = useState(false)
  const [beatmapId, setBeatmapId] = useState('')
  const [mods, setMods] = useState<string[]>([])
  const [preview, setPreview] = useState<MpPreview | null>(null)
  const [reviewed, setReviewed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const room = state.room!
  const { timer: _timer, startCountdown, ...stableRoom } = room
  const fingerprint = JSON.stringify({ ...stableRoom, startCountdown: startCountdown?.status ?? null })
  useEffect(() => { setPreview(null); setReviewed(false) }, [fingerprint, state.connection])
  useEffect(() => {
    if (!preview) return
    const timer = setTimeout(() => { setPreview(null); setReviewed(false); setMessage('預覽已過期，請重新讀取設定及預覽。') }, Math.max(0, Date.parse(preview.expiresAt) - Date.now()))
    return () => clearTimeout(timer)
  }, [preview])
  const available = state.connection === 'online' && room.joined && room.binding === 'verified' && room.referee === 'listed' && (room.syncState === 'complete' || ((kind === 'timer' || kind === 'aborttimer' || kind === 'map' || (kind === 'mods' && room.beatmap !== null)) && room.syncState === 'partial')) && !state.pending
  async function prepare() {
    if (!window.oclr) return
    setBusy(true); setMessage(''); setReviewed(false); setPreview(null)
    const intent: MpIntent = kind === 'map' ? { kind, beatmapId } : kind === 'mods' ? { kind, mods } : kind === 'timer' ? { kind, seconds } : kind === 'start' && delayed ? { kind, seconds } : { kind }
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
      setMessage(result.ok ? '已送出，執行結果待核對' : result.error || '操作未完成，請核對房間後重新預覽。')
    } catch { setMessage('結果不明，請核對 BanchoBot 回覆；不會自動重送。') }
    finally { setBusy(false) }
  }
  return <details className="mp-controls"><summary>房內快捷操作</summary>
    {!available && <p className="slots-caption">設定或裁判名單待更新</p>}
    <fieldset disabled={busy || Boolean(preview)}>
      <WorkspaceSelect label="房內操作" value={kind} disabled={busy || Boolean(preview)} onChange={value => { setKind(value as MpIntent['kind']); setMessage('') }} options={[{ value: 'map', label: '換圖' }, { value: 'mods', label: '設定 Mods' }, { value: 'start', label: '開始比賽' }, { value: 'timer', label: '一般計時' }, { value: 'aborttimer', label: '取消倒數' }, { value: 'abort', label: '中止比賽' }]} />
      {kind === 'map' && <TextField name="beatmapId" value={beatmapId} onChange={setBeatmapId}><Label>Beatmap ID</Label><Input placeholder="例如 123456" inputMode="numeric" /></TextField>}
      {kind === 'start' && <WorkspaceCheckbox selected={delayed} disabled={busy || Boolean(preview)} onChange={setDelayed}>延遲開賽</WorkspaceCheckbox>}
      {(kind === 'timer' || kind === 'start' && delayed) && <TextField name="seconds" value={seconds} onChange={setSeconds}><Label>秒數（1–600）</Label><Input inputMode="numeric" /></TextField>}
      {kind === 'mods' && <><div className="mp-mods">{MP_MODS.map(mod => <WorkspaceCheckbox key={mod} selected={mods.includes(mod)} disabled={busy || Boolean(preview)} onChange={selected => setMods(selected ? [...mods, mod] : mods.filter(item => item !== mod))}>{mod}</WorkspaceCheckbox>)}</div></>}
    </fieldset>
    {preview ? <div className="mp-confirm"><strong>{preview.channel}</strong><code>{preview.command}</code><WorkspaceCheckbox selected={reviewed} onChange={setReviewed}>我已核對目標房間、比賽狀態及操作影響{kind === 'start' && '，確認玩家、地圖、Mods 與直播已準備完成'}。</WorkspaceCheckbox><Button size="sm" variant="danger" isDisabled={busy || !reviewed || !available} onPress={() => void execute()}>確認送出</Button><Button size="sm" variant="ghost" onPress={() => { setPreview(null); setReviewed(false) }}>取消</Button></div> : <Button size="sm" variant="secondary" isDisabled={busy || !available} onPress={() => void prepare()}>預覽指令</Button>}
    {message && <p className="mp-result" role="status">{message}</p>}
  </details>
}
