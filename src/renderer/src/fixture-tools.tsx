import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Label, Spinner, TextField } from '@heroui/react'
import { emptyOclrState } from '../../shared/oclr-state'
import { fixtureInviteSource, type FixtureInvitePreview } from '../../shared/fixture-tools'
import type { OclrSnapshot } from '../../shared/oclr-contracts'
import type { Snapshot } from '../../shared/types'
import { WorkspaceCheckbox, WorkspaceSelect } from './controls'
import { tr } from './i18n'
export function useFixtureSource() {
  const [state, setState] = useState<OclrSnapshot>(emptyOclrState)
  useEffect(() => {
    const api = window.oclr?.website
    if (!api) return
    let arrived = false, closed = false
    const off = api.onState(value => {arrived = true; setState(value)})
    void api.snapshot().then(value => {if (!arrived && !closed) setState(value)}).catch(() => {})
    return () => {closed = true; off()}
  }, [])
  return state
}
export function FixtureSource({website, onConnect}: {website: OclrSnapshot; onConnect: () => void}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function update(id?: string) {
    if (!window.oclr || busy) return
    setBusy(true); setError('')
    try {const result = await (id ? window.oclr.website.selectFixture(id) : website.selectedFixtureId ? window.oclr.website.refreshPanel() : window.oclr.website.refreshFixtures()); if (!result.ok) setError(result.error || 'OCLR 操作未完成。')}
    catch {setError('桌面服務無法回應。')} finally {setBusy(false)}
  }
  return <section className="fixture-source" aria-label={tr("場次來源")}>
    {!website.subject ? <Button size="sm" variant="secondary" onPress={onConnect}>{tr("連接 OCLR")}</Button> : <>
      <div className="fixture-source-row"><WorkspaceSelect label={tr("OCLR 場次")} value={website.selectedFixtureId || ''} disabled={busy || website.status !== 'connected'} onChange={id => {if (id) void update(id)}} options={[{value: '', label: tr("選擇場次")}, ...website.fixtures.map(fixture => ({value: fixture.fixtureId, label: fixture.label}))]} /><Button isIconOnly size="sm" variant="ghost" aria-label={tr("同步場次資料")} isDisabled={busy || website.status !== 'connected'} onPress={() => void update()}>{busy || website.panelState === 'loading' ? <Spinner size="sm" /> : <span aria-hidden="true">↻</span>}</Button></div>
      <div className="fixture-source-meta"><span>{website.panel?.workspace.round.name || tr("尚未選擇場次")}</span><span>{website.panelState === 'fresh' ? tr("已同步") : website.panelState === 'loading' ? tr("同步中") : website.panelState === 'stale' ? tr("資料已過期") : ''}</span></div>
      {website.hasMore && <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => void window.oclr?.website.loadMoreFixtures()}>{tr("載入更多場次")}</Button>}
    </>}
    {error && <p role="alert">{tr(error)}</p>}
  </section>
}
export function FixturePool({website}: {website: OclrSnapshot}) {
  const [error, setError] = useState(''), [copied, setCopied] = useState('')
  const workspace = website.panel?.workspace, fresh = website.status === 'connected' && website.panelState === 'fresh'
  useEffect(() => {setError(''); setCopied('')}, [website.selectedFixtureId, website.selectedMapId, website.previewId])
  async function copy(commandId: string) {
    if (!window.oclr) return
    try {const result = await window.oclr.website.copyCommand({previewId: website.previewId, commandId}); if (result.ok) setCopied(commandId); else setError(result.error || 'OCLR 操作未完成。')}
    catch {setError('桌面服務無法回應。')}
  }
  return <section className="fixture-pool" aria-label={tr("本輪圖池")}>
    {!workspace ? <p className="tool-empty">{tr("選擇 OCLR 場次以同步圖池與隊員。")}</p> : <>
      <div className="fixture-section-heading"><strong>{tr("本輪圖池")}</strong><span>{workspace.maps.length}</span></div>
      {!workspace.maps.length && <p className="tool-empty">{tr("本輪尚無圖池。")}</p>}
      <div className="fixture-map-list">{workspace.maps.map(map => <Button key={map.id} variant="ghost" className={`fixture-map ${website.selectedMapId === map.id ? 'selected' : ''}`} aria-pressed={website.selectedMapId === map.id} isDisabled={!fresh} onPress={() => {setError(''); void window.oclr?.website.selectMap(map.id).then(result => {if (!result.ok) setError(result.error || 'OCLR 操作未完成。')}).catch(() => setError('桌面服務無法回應。'))}}><span className="fixture-map-slot">{map.category}{map.position}</span><span className="fixture-map-title"><strong>{map.metadata?.title || String(map.beatmapId)}</strong><span>{map.metadata?.artist || `#${map.beatmapId}`}</span></span></Button>)}</div>
      {website.selectedMapId && <div className="fixture-map-commands">{website.commands.filter(command => command.kind === 'map' || command.kind === 'mods').map(command => <div key={command.id}><code>{command.text || tr(command.reason || '無法預覽。')}</code><Button size="sm" variant="secondary" isDisabled={!fresh || !command.text} onPress={() => void copy(command.id)}>{copied === command.id ? tr("已複製") : command.kind === 'map' ? tr("複製換圖指令") : tr("複製 Mods 指令")}</Button></div>)}</div>}
    </>}
    {error && <p role="alert">{tr(error)}</p>}
  </section>
}
export function FixtureRoster({website, state, onConnect, onOperations}: {website: OclrSnapshot; state: Snapshot; onConnect: () => void; onOperations: () => void}) {
  const [preview, setPreview] = useState<FixtureInvitePreview | null>(null), [confirmName, setConfirmName] = useState(''), [reviewed, setReviewed] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const generation = useRef(0)
  const workspace = website.panel?.workspace
  const sourceKey = useMemo(() => JSON.stringify([website.subject, workspace]), [website.subject, workspace])
  const fresh = website.status === 'connected' && website.panelState === 'fresh'
  const linked = website.relay.status === 'connected' && website.relay.roomId === state.room?.id && state.room?.joined && website.pairing.reviewed
  const unreviewed = state.operations?.records.some(record => record.roomId === state.room?.id && (record.state === 'awaiting' || record.state === 'unknown' && !record.reviewed))
  function clear() {setPreview(null); setConfirmName(''); setReviewed(false)}
  useEffect(() => {generation.current++; clear(); setMessage('')}, [sourceKey, state.room?.id, state.room?.epoch, state.connection])
  useEffect(() => {if (preview && (!fresh || !linked)) clear()}, [fresh, linked, preview])
  useEffect(() => {if (!preview) return; const timer = setTimeout(clear, Math.max(0, Date.parse(preview.expiresAt) - Date.now())); return () => clearTimeout(timer)}, [preview])
  async function prepare(teamId: string, osuId: number) {
    if (!window.oclr || !state.room || busy) return
    const request = ++generation.current
    clear(); setBusy(true); setMessage('')
    try {const result = await window.oclr.website.previewInvite({roomId: state.room.id, roomEpoch: state.room.epoch, previewId: website.previewId, teamId, osuId}); if (request === generation.current) {setPreview(result.preview || null); if (!result.ok) setMessage(result.error || '無法預覽。')}}
    catch {if (request === generation.current) setMessage('桌面服務無法回應。')} finally {setBusy(false)}
  }
  async function execute() {
    if (!window.oclr || !state.room || !preview || busy) return
    const input = {roomId: state.room.id, roomEpoch: state.room.epoch, token: preview.token, playerName: confirmName, reviewed}
    clear(); setBusy(true); setMessage('')
    try {const result = await window.oclr.website.executeInvite(input); setMessage(result.ok ? '已送出，等待核對。' : result.error || '無法送出。')}
    catch {setMessage('結果不明，請核對房間。')} finally {setBusy(false)}
  }
  return <section className="fixture-roster" aria-label={tr("兩隊名單")}>
    <div className="fixture-section-heading"><strong>{tr("兩隊名單")}</strong></div>
    {!workspace ? <p className="tool-empty">{tr("選擇 OCLR 場次以同步圖池與隊員。")}</p> : <>
      {!linked && <Button size="sm" variant="secondary" onPress={onConnect}>{tr("連接此房間以邀請隊員")}</Button>}
      {workspace.teams.map(team => <section key={team.id} className="fixture-team" aria-label={team.name}><h3>{team.name}</h3>{!team.members.length && <p className="tool-empty">{tr("尚無隊員名單。")}</p>}{team.members.map(player => {
        const known = state.room?.slotsVerified && ['complete', 'partial'].includes(state.room.syncState)
        const present = known && state.room?.slots.some(slot => slot.osuId === player.osuId)
        let sourceError = ''
        if (fresh) try {fixtureInviteSource(website, team.id, player.osuId, false)} catch (error) {sourceError = error instanceof Error ? error.message : '無法預覽。'}
        return <div className="fixture-player" key={player.osuId}><div><strong>{player.username}</strong><span>#{player.osuId} · {present ? tr("已在房內") : known ? tr("未到場") : tr("到場狀態未知")}</span>{sourceError && <span className="fixture-source-error">{tr(sourceError)}</span>}</div><Button size="sm" variant="secondary" aria-label={tr("邀請 {{v0}}", {v0: player.username})} isDisabled={!fresh || !linked || busy || Boolean(preview) || Boolean(present) || Boolean(unreviewed) || Boolean(sourceError)} onPress={() => void prepare(team.id, player.osuId)}>{tr("邀請")}</Button></div>
      })}</section>)}
    </>}
    {preview && <div className="mp-confirm fixture-invite-confirm"><strong>{preview.fixtureLabel} · {preview.teamName}</strong><span>{preview.channel} · {preview.playerName} · #{preview.osuId}</span><code>{preview.command}</code><TextField name="fixtureConfirmName" value={confirmName} onChange={setConfirmName}><Label>{tr("輸入玩家名稱以核對 UID")}</Label><Input autoComplete="off" /></TextField><WorkspaceCheckbox selected={reviewed} onChange={setReviewed}>{tr("我已核對房間、玩家身份與變更")}</WorkspaceCheckbox><Button size="sm" className="primary-button" isDisabled={busy || !fresh || !linked || !reviewed || confirmName !== preview.playerName} onPress={() => void execute()}>{tr("確認邀請")}</Button><Button size="sm" variant="ghost" onPress={clear}>{tr("取消預覽")}</Button></div>}
    {unreviewed && <Button size="sm" variant="ghost" onPress={onOperations}>{tr("前往操作記錄核對")}</Button>}
    {message && <p role="status">{tr(message)}</p>}
  </section>
}
