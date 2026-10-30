import { RoomPlanControls, RoomPlanProgress } from './room-plan'
import { PlayerControls } from './player-controls'
import { LobbyControls } from './lobby-controls'
import { MapProfileControls } from './map-profile'
import { MP_ACTIONS, searchWorkspaceActions, commandSearchShortcut } from '../../shared/referee-tools'
import { WorkspaceSelect, WorkspaceCheckbox } from './controls'
import { useEffect, useRef, useState } from 'react'
import { Button, Input, Label, TextField } from '@heroui/react'
import { MP_MODS } from '../../shared/mp-command'
import type { WorkspaceAction } from '../../shared/referee-tools'
import type { MpIntent, MpPreview } from '../../shared/mp-command'
import type { Snapshot } from '../../shared/types'
export function MpControls({ state, onReveal }: { state: Snapshot; onReveal?: (players: boolean) => void }) {
  const details = useRef<HTMLDetailsElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
  const [search, setSearch] = useState('')
  useEffect(() => {
    const start = () => { composing.current = true }
    const end = () => { composing.current = false }
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      const editing = Boolean(target?.isContentEditable || target?.closest('input, textarea, select, [contenteditable], [role=combobox]'))
      if (!commandSearchShortcut(event, editing, composing.current)) return
      event.preventDefault()
      if (details.current) details.current.open = true
      onReveal?.(false)
      requestAnimationFrame(() => searchInput.current?.focus())
    }
    window.addEventListener('keydown', keydown)
    window.addEventListener('compositionstart', start)
    window.addEventListener('compositionend', end)
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('compositionstart', start); window.removeEventListener('compositionend', end) }
  }, [onReveal])
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
  function navigate(action: WorkspaceAction) {
    if (composing.current) return
    setSearch(''); setMessage('')
    if (!('target' in action)) {
      setKind(action.value)
      requestAnimationFrame(() => details.current?.querySelector<HTMLElement>('fieldset input:not([type=hidden]), fieldset button[aria-haspopup]')?.focus())
      return
    }
    const target = details.current?.closest('.room-inspector')?.querySelector<HTMLDetailsElement>(action.target)
    if (!target) return
    onReveal?.(action.target === '.manual-lineup')
    target.open = true
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'nearest' })
      target.querySelector<HTMLElement>('input:not([type=checkbox]):not([type=hidden]), button[aria-haspopup]')?.focus({ preventScroll: true })
    })
  }
  return <details ref={details} className="mp-controls" open><summary>房內快捷操作</summary>
    {!available && <p className="slots-caption">設定或裁判名單待更新</p>}
    <TextField aria-label="搜尋房內指令" value={search} onChange={setSearch} isDisabled={busy || Boolean(preview)} className="command-search"><Input ref={searchInput} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !composing.current) { setSearch(''); event.stopPropagation() } }} placeholder="搜尋指令" maxLength={80} /></TextField>
    {search.trim() && <div className="command-results" aria-label="指令搜尋結果">{searchWorkspaceActions(search).map(action => <Button key={action.value} size="sm" variant="secondary" isDisabled={busy || Boolean(preview)} onPress={() => navigate(action)}>{action.label}</Button>)}{!searchWorkspaceActions(search).length && <span role="status">沒有符合的指令</span>}</div>}
    <fieldset disabled={busy || Boolean(preview)}>
      <WorkspaceSelect label="房內操作" value={kind} disabled={busy || Boolean(preview)} onChange={value => { setKind(value as MpIntent['kind']); setMessage('') }} options={MP_ACTIONS} />
      {kind === 'map' && <TextField name="beatmapId" value={beatmapId} onChange={setBeatmapId}><Label>Beatmap ID</Label><Input placeholder="例如 123456" inputMode="numeric" /></TextField>}
      {kind === 'start' && <WorkspaceCheckbox selected={delayed} disabled={busy || Boolean(preview)} onChange={setDelayed}>延遲開賽</WorkspaceCheckbox>}
      {(kind === 'timer' || kind === 'start' && delayed) && <TextField name="seconds" value={seconds} onChange={setSeconds}><Label>秒數（1–600）</Label><Input inputMode="numeric" /></TextField>}
      {kind === 'mods' && <><div className="mp-mods">{MP_MODS.map(mod => <WorkspaceCheckbox key={mod} selected={mods.includes(mod)} disabled={busy || Boolean(preview)} onChange={selected => setMods(selected ? [...mods, mod] : mods.filter(item => item !== mod))}>{mod}</WorkspaceCheckbox>)}</div></>}
    </fieldset>
    {preview ? <div className="mp-confirm"><strong>{preview.channel}</strong><code>{preview.command}</code><WorkspaceCheckbox selected={reviewed} onChange={setReviewed}>我已核對目標房間、比賽狀態及操作影響{kind === 'start' && '，確認玩家、地圖、Mods 與直播已準備完成'}。</WorkspaceCheckbox><Button size="sm" variant="danger" isDisabled={busy || !reviewed || !available} onPress={() => void execute()}>確認送出</Button><Button size="sm" variant="ghost" onPress={() => { setPreview(null); setReviewed(false) }}>取消</Button></div> : <Button size="sm" variant="secondary" isDisabled={busy || !available} onPress={() => void prepare()}>預覽指令</Button>}
    <MapProfileControls state={state} />
    <LobbyControls state={state} />
    <RoomPlanControls state={state} />
    <RoomPlanProgress state={state} />
    <PlayerControls state={state} />
    {message && <p className="mp-result" role="status">{message}</p>}
  </details>
}
