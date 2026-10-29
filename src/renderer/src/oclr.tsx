import { useEffect, useState } from 'react'
import { Button, Spinner } from '@heroui/react'
import { emptyOclrState } from '../../shared/oclr-state'
import type { OclrCommand, OclrSnapshot } from '../../shared/oclr-contracts'

const phases = ['賽前準備', 'BP 圖池', '賽後核對']
const commandNames: Record<string, string> = { make: '建立房間', set: '房間規則', addref: '加入直播裁判', invite: '邀請選手', timer: '一般計時', map: '切換地圖', mods: '套用 Mods', start: '開賽倒數', abort: '中止比賽' }
const statusNames = { pending: '待開始', playing: '進行中', completed: '已完成', tied: '平手', aborted: '已中止' }

export function OclrView() {
  const [state, setState] = useState<OclrSnapshot>(emptyOclrState)
  const [phase, setPhase] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const api = window.oclr?.website
    if (!api) return
    let arrived = false
    const off = api.onState(value => { arrived = true; setState(value) })
    void api.snapshot().then(value => { if (!arrived) setState(value) }).catch(() => setError('無法讀取 OCLR 連線狀態。'))
    return off
  }, [])
  useEffect(() => { setCopied(null) }, [state.previewId, state.panelState, state.status])
  useEffect(() => { setPhase(0); setError(null) }, [state.selectedFixtureId])
  async function perform(action: () => Promise<{ ok: boolean; error?: string }>, copying?: string) {
    if (busy) return
    setBusy(true); setError(null)
    try { const result = await action(); if (!result.ok) setError(result.error || 'OCLR 操作未完成。'); else if (copying) setCopied(copying) }
    catch { setError('桌面服務無法回應。') }
    finally { setBusy(false) }
  }
  const api = window.oclr?.website
  const authorized = Boolean(state.subject)
  const panel = state.panel
  const workspace = panel?.workspace
  const settings = workspace?.session?.settings ?? workspace?.defaultSettings
  const fresh = state.panelState === 'fresh' && state.status === 'connected'
  function commands(kinds: string[]) {
    return <div className="oclr-commands">{state.commands.filter(c => kinds.includes(c.kind)).map(command => <CommandRow key={command.id} command={command} copied={copied === command.id} disabled={busy || !fresh} onCopy={() => api && void perform(() => api.copyCommand({ previewId: state.previewId, commandId: command.id }), command.id)} />)}</div>
  }
  return <div className="oclr-view enter">
    <div className="room-heading"><div><div className="section-kicker">OCLR WORKSPACE</div><h1>{authorized ? '我的執裁場次' : '連接 OCLR'}</h1></div><span className="read-only-label">{authorized ? '場次面板 · IRC 投影' : '獨立於 IRC 連線'}</span></div>
    {(error || state.error) && <div className="error-message" role="alert">{error || state.error}</div>}
    {state.retryAt && <p className="oclr-hint" role="status">請於 {new Date(state.retryAt).toLocaleTimeString()} 後重試。</p>}
    {state.remoteRevocation === 'unconfirmed' && <p className="oclr-hint" role="status">本機登入資料已清除，遠端撤銷尚未確認；可到 OCLR 網站管理桌面連線。</p>}
    {authorized && <section className="oclr-session" aria-label="網站 IRC 投影"><div><strong>網站 IRC 投影</strong><p className="oclr-hint">先在房間記錄選取本場 IRC 房間，再選擇下方 OCLR 場次。啟用後，網站送出的房內指令將使用本機 IRC 連線；密碼不會上傳。</p><span role="status">{state.relay.status === 'connected' ? `已投影 #mp_${state.relay.roomId}` : state.relay.status === 'connecting' ? '正在連接…' : state.relay.error || '尚未啟用'}</span></div><Button isDisabled={busy || !state.selectedFixtureId || state.relay.status === 'connecting'} onPress={() => api && void perform(() => state.relay.status === 'connected' ? api.stopRelay() : api.startRelay())}>{state.relay.status === 'connected' ? '停止投影' : '將目前房間投影到網站'}</Button></section>}
    {!authorized ? <section className="oclr-login">
      <p>在系統瀏覽器登入 osu! 並授權 OCLR，讀取本人獲派場次、正式隊伍及保存的裁判面板。</p>
      <p className="oclr-hint">OCLR 登入不會登入或中斷 IRC。授權僅保留於本次應用程式，重新啟動後需再次登入。</p>
      {state.status === 'authorizing' ? <div className="oclr-authorization" role="status"><div className="oclr-hint">請在瀏覽器確認相同比對碼</div><strong className="oclr-verification">{state.authorization?.verificationCode ?? '準備授權…'}</strong><span className="oclr-hint">{state.authorization ? `有效至 ${new Date(state.authorization.expiresAt).toLocaleTimeString()}` : '正在建立安全回呼'}</span><Button variant="ghost" isDisabled={busy} onPress={() => api && void perform(() => api.cancelLogin())}>取消 OCLR 授權</Button></div> : <Button className="primary-button" isDisabled={!api || busy} onPress={() => api && void perform(() => api.login())}>透過瀏覽器登入 OCLR <span aria-hidden="true">↗</span></Button>}
      <p className="oclr-hint">網站需先開放桌面授權服務。若尚未開放，仍可使用「房間記錄」的 IRC 功能。</p>
    </section> : <>
      <div className="oclr-session"><span><span className="tiny-dot active" /> {state.subject!.username} <small>osu! #{state.subject!.osuId}</small></span><div><Button size="sm" variant="ghost" isDisabled={busy || state.fixturesLoading} onPress={() => api && void perform(() => api.refreshFixtures())}>重新整理場次</Button><Button size="sm" variant="ghost" isDisabled={busy} onPress={() => api && void perform(() => api.logout())}>登出 OCLR</Button></div></div>
      <div className="oclr-grid">
        <aside className="oclr-fixtures" aria-label="本人場次"><span className="small-label">指派場次</span><select className="oclr-fixture-picker" aria-label="切換執裁場次" value={state.selectedFixtureId ?? ''} disabled={busy || state.fixturesLoading || !state.fixtures.length} onChange={event => { if (event.target.value && api) void perform(() => api.selectFixture(event.target.value)) }}><option value="">選擇執裁場次</option>{state.fixtures.map(f => <option key={f.fixtureId} value={f.fixtureId}>{f.edition.name} · {f.round.name} · {f.label}</option>)}</select>{state.fixturesLoading && <p className="oclr-hint" role="status"><Spinner size="sm" /> 讀取中…</p>}{!state.fixturesLoading && state.fixtures.length === 0 && <p className="oclr-hint">目前沒有可讀的指派場次。</p>}
          {state.fixtures.map(fixture => <button key={fixture.fixtureId} className={`oclr-fixture ${state.selectedFixtureId === fixture.fixtureId ? 'selected' : ''}`} aria-current={state.selectedFixtureId === fixture.fixtureId ? 'true' : undefined} onClick={() => api && void perform(() => api.selectFixture(fixture.fixtureId))} disabled={busy}><small>{fixture.edition.name} · {fixture.round.name}</small><strong>{fixture.label}</strong><span>{fixture.scheduledAt ? new Date(fixture.scheduledAt).toLocaleString() : '時間待定'}</span><span>{fixture.status === 'cancelled' ? '已取消' : fixture.operational ? '可運作場次' : '僅供查閱'}</span></button>)}
          {state.hasMore && <Button size="sm" variant="ghost" isDisabled={busy || state.fixturesLoading} onPress={() => api && void perform(() => api.loadMoreFixtures())}>載入更多場次</Button>}
        </aside>
        <section className="oclr-panel" aria-label="OCLR 裁判面板">
          {!state.selectedFixtureId ? <div className="empty-state"><h2>選擇執裁場次</h2><p>讀取同一場次的保存設定、圖池與執裁紀錄。</p></div> : <>
            <div className="oclr-panel-heading"><div><h2>{workspace?.fixture.label ?? '讀取裁判面板'}</h2><span className="oclr-hint">{({ empty: '尚未讀取', loading: '讀取中', fresh: '資料已更新', stale: '資料已過期，請重新整理', unavailable: '面板目前不可用' })[state.panelState]}{panel && ` · ${new Date(panel.capturedAt).toLocaleTimeString()}`}{state.status === 'refreshing' && ' · 更新授權中'}</span></div><Button size="sm" variant="ghost" isDisabled={busy || state.panelState === 'loading'} onPress={() => api && void perform(() => api.refreshPanel())}>更新面板</Button></div>
            {workspace && <>
              <div className="oclr-phases" role="tablist" aria-label="執裁階段">{phases.map((name, i) => <button key={name} role="tab" id={`oclr-tab-${i}`} aria-controls="oclr-phase-content" aria-selected={phase === i} tabIndex={phase === i ? 0 : -1} onClick={() => setPhase(i)} onKeyDown={event => { const next = event.key === 'ArrowRight' ? (i + 1) % 3 : event.key === 'ArrowLeft' ? (i + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null; if (next !== null) { event.preventDefault(); setPhase(next); document.getElementById(`oclr-tab-${next}`)?.focus() } }}>{name}</button>)}</div>
              <p className="oclr-hint">此處只讀取與複製；不送 IRC、不保存 Ban／Pick，也不提交正式賽果。</p>
              {workspace.readiness.length > 0 && <details className="oclr-issues"><summary>待核對項目（{workspace.readiness.length}）</summary><ul>{workspace.readiness.map((issue, i) => <li key={i}>{issue}</li>)}</ul></details>}
              <div id="oclr-phase-content" role="tabpanel" aria-labelledby={`oclr-tab-${phase}`} className="oclr-phase-content enter" key={phase}>
                {phase === 0 && <>
                  <dl className="oclr-settings"><div><dt>房間名稱</dt><dd>{settings?.roomName || '尚未設定'}</dd></div><div><dt>遊戲規則</dt><dd>{workspace.rules ? `${workspace.rules.mode} · ${workspace.rules.teamType} · ${workspace.rules.scoringType} · ${workspace.rules.playersPerTeam} 人／隊` : '尚未設定'}</dd></div><div><dt>房間人數</dt><dd>{settings?.roomSize ?? '尚未設定'}</dd></div><div><dt>房間設定中的直播員</dt><dd>{settings?.streamerUsername || '尚未設定'}</dd></div></dl>
                  <div className="oclr-rosters">{workspace.teams.map(team => <section key={team.id}><h3>{team.name}</h3><ul>{team.members.map(member => <li key={member.osuId}>{member.username} <small>#{member.osuId}{member.osuId === team.captainId ? ' · Captain' : ''}</small></li>)}</ul>{!team.members.length && <p className="oclr-hint">沒有可讀的正式名單。</p>}</section>)}</div>
                  <h3>賽前指令</h3><p className="oclr-hint">addref 需要 Bancho 房間建立者權限；網站角色不代表 IRC 權限。</p>{commands(['make', 'set', 'addref', 'invite'])}
                </>}
                {phase === 1 && <>
                  <div className="oclr-order"><span>先 Ban：{workspace.teams.find(t => t.id === workspace.session?.firstBanTeamId)?.name ?? '未設定'}</span><span>先 Pick：{workspace.teams.find(t => t.id === workspace.session?.firstPickTeamId)?.name ?? '未設定'}</span></div>
                  <p className="oclr-hint">點選地圖只更新命令預覽，不記錄 Ban／Pick。</p>
                  <div className="oclr-maps">{workspace.maps.map(map => <button key={map.id} className={`oclr-map ${state.selectedMapId === map.id ? 'selected' : ''}`} aria-label={`預覽 ${map.category}${map.position}`} aria-pressed={state.selectedMapId === map.id} disabled={!fresh || busy} onClick={() => api && void perform(() => api.selectMap(map.id))}><strong>{map.category}{map.position}</strong><span>{map.metadata ? `${map.metadata.artist} — ${map.metadata.title}` : `Beatmap ${map.beatmapId}`}<small>{map.metadata?.difficulty ?? '尚無地圖詳情'} · #{map.beatmapId}</small></span><span>{map.metadata ? `${map.metadata.stars.toFixed(2)}★` : '—'}</span></button>)}</div>
                  {!workspace.maps.length && <p className="oclr-hint">尚無保存圖池。</p>}
                  <h3>選圖與控制指令</h3>{commands(['map', 'mods', 'timer', 'start', 'abort'])}
                </>}
                {phase === 2 && <>
                  <h3>裁判暫記比分</h3><div className="oclr-score">{workspace.teams.map(team => <span key={team.id}>{team.name} <strong>{workspace.projection.score[team.id] ?? 0}</strong></span>)}</div>
                  <p className="oclr-hint">來自保存執裁事件，與正式 MP 審核結果分開。相同地圖的重賽仍是不同 attempt。</p>
                  <ol className="oclr-ledger">{workspace.projection.activeSelections.map(selection => <li key={selection.id}><strong>{selection.kind === 'ban' ? 'Ban' : selection.kind === 'tb' ? 'TB' : 'Pick'} · {selection.category} · #{selection.beatmapId}</strong><span>{workspace.teams.find(t => t.id === selection.teamId)?.name ?? '中立'}</span><ul>{selection.attempts.map(attempt => <li key={attempt.id}>第 {attempt.number} 次 · {statusNames[attempt.status]}{attempt.winnerTeamId && ` · ${workspace.teams.find(t => t.id === attempt.winnerTeamId)?.name ?? '未知隊伍'} 勝`}</li>)}</ul></li>)}</ol>
                  {!workspace.projection.activeSelections.length && <p className="oclr-hint">尚無保存的 Ban／Pick 紀錄。</p>}
                  <Button className="primary-button" isDisabled={busy} onPress={() => api && void perform(() => api.openReview(state.selectedFixtureId!))}>前往網站 MP 審核 ↗</Button><p className="oclr-hint">來源關聯、正式提交與核准仍在網站完成。</p>
                </>}
              </div>
            </>}
          </>}
        </section>
      </div>
    </>}
  </div>
}

function CommandRow({ command, disabled, copied, onCopy }: { command: OclrCommand; disabled: boolean; copied: boolean; onCopy: () => void }) {
  return <div className="oclr-command"><div><span>{command.playerName ? `${commandNames[command.kind]} · ${command.playerName}` : commandNames[command.kind] ?? command.kind}</span><code>{command.text ?? command.reason ?? '尚不可用'}</code></div><Button size="sm" variant="ghost" isDisabled={disabled || !command.text} aria-label={`複製 ${command.id}`} onPress={onCopy}>{copied ? '已複製' : '複製'}</Button></div>
}
