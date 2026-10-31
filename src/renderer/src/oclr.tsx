import { tr, uiLocale } from './i18n'
import { WorkspaceSelect } from './controls'
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
    <div className="room-heading"><div><div className="section-kicker">OCLR WORKSPACE</div><h1>{authorized ? tr("我的執裁場次") : tr("連接 OCLR")}</h1></div></div>
    {(error || state.error) && <div className="error-message" role="alert">{tr(error || state.error)}</div>}
    {state.retryAt && <p className="oclr-hint" role="status">{tr("請於")}{new Date(state.retryAt).toLocaleTimeString(uiLocale())}{tr("後重試。")}</p>}
    {state.remoteRevocation === 'unconfirmed' && <p className="oclr-hint" role="status">{tr("本機登入資料已清除，遠端撤銷尚未確認；可到 OCLR 網站管理桌面連線。")}</p>}
    {authorized && <section className="oclr-session account-pairing" aria-label={tr("帳號配對")}><div><strong>{tr("帳號配對")}</strong><span>IRC：{state.pairing.ircUsername ?? tr("未連線")} · OCLR：{state.subject!.username}</span><span role="status">{state.pairing.status === 'mismatch' ? tr("暱稱不符") : state.pairing.status === 'unknown' ? tr("尚未配對") : tr("帳號名稱相符・已自動核對")}</span></div></section>}
    {authorized && <section className="oclr-session website-projection" aria-label={tr("網站 IRC 投影")}><div><strong>{tr("網站 IRC 投影")}</strong><span role="status">{state.relay.status === 'connected' ? state.relay.roomId ? tr("已投影 #mp_{{v0}}", { v0: state.relay.roomId }) : tr("等待網站開房指令") : state.relay.status === 'connecting' ? tr("正在連接…") : tr(state.relay.error) || tr("尚未啟用")}</span></div><Button isDisabled={busy || !state.selectedFixtureId || state.relay.status === 'connecting' || state.relay.status !== 'connected' && state.pairing.status !== 'nickname_matched'} onPress={() => api && void perform(() => state.relay.status === 'connected' ? api.stopRelay() : api.startRelay())}>{state.relay.status === 'connected' ? tr("停止投影") : tr("連接網站 IRC")}</Button></section>}
    {!authorized ? <section className="oclr-login">
      {state.status === 'authorizing' ? <div className="oclr-authorization" role="status"><div className="oclr-hint">{tr("請在瀏覽器確認相同比對碼")}</div><strong className="oclr-verification">{state.authorization?.verificationCode ?? tr("準備授權…")}</strong><span className="oclr-hint">{state.authorization ? tr("有效至 {{v0}}", { v0: new Date(state.authorization.expiresAt).toLocaleTimeString(uiLocale()) }) : tr("正在建立安全回呼")}</span><Button variant="ghost" isDisabled={busy} onPress={() => api && void perform(() => api.cancelLogin())}>{tr("取消 OCLR 授權")}</Button></div> : <Button className="primary-button" isDisabled={!api || busy} onPress={() => api && void perform(() => api.login())}>{tr("透過瀏覽器登入 OCLR")}<span aria-hidden="true">↗</span></Button>}
    </section> : <>
      <div className="oclr-session"><span><span className="tiny-dot active" /> {state.subject!.username} <small>osu! #{state.subject!.osuId}</small></span><div><Button size="sm" variant="ghost" isDisabled={busy || state.fixturesLoading} onPress={() => api && void perform(() => api.refreshFixtures())}>{tr("重新整理場次")}</Button><Button size="sm" variant="ghost" isDisabled={busy} onPress={() => api && void perform(() => api.logout())}>{tr("登出 OCLR")}</Button></div></div>
      <div className="oclr-grid">
        <aside className="oclr-fixtures" aria-label={tr("本人場次")}><span className="small-label">{tr("指派場次")}</span><WorkspaceSelect className="oclr-fixture-picker" label={tr("切換執裁場次")} value={state.selectedFixtureId ?? ''} disabled={busy || state.fixturesLoading || !state.fixtures.length} onChange={value => { if (api) void perform(() => api.selectFixture(value)) }} options={state.fixtures.map(f => ({ value: f.fixtureId, label: `${f.edition.name} · ${f.round.name} · ${f.label}` }))} />{state.fixturesLoading && <p className="oclr-hint" role="status"><Spinner size="sm" />{tr("讀取中…")}</p>}{!state.fixturesLoading && state.fixtures.length === 0 && <p className="oclr-hint">{tr("目前沒有可讀的指派場次。")}</p>}
          {state.fixtures.map(fixture => <button key={fixture.fixtureId} className={`oclr-fixture ${state.selectedFixtureId === fixture.fixtureId ? 'selected' : ''}`} aria-current={state.selectedFixtureId === fixture.fixtureId ? 'true' : undefined} onClick={() => api && void perform(() => api.selectFixture(fixture.fixtureId))} disabled={busy}><small>{fixture.edition.name} · {fixture.round.name}</small><strong>{fixture.label}</strong><span>{fixture.scheduledAt ? new Date(fixture.scheduledAt).toLocaleString(uiLocale()) : tr("時間待定")}</span><span>{fixture.status === 'cancelled' ? tr("已取消") : fixture.operational ? tr("可運作場次") : tr("僅供查閱")}</span></button>)}
          {state.hasMore && <Button size="sm" variant="ghost" isDisabled={busy || state.fixturesLoading} onPress={() => api && void perform(() => api.loadMoreFixtures())}>{tr("載入更多場次")}</Button>}
        </aside>
        <section className="oclr-panel" aria-label={tr("OCLR 裁判面板")}>
          {!state.selectedFixtureId ? <div className="empty-state"><h2>{tr("選擇執裁場次")}</h2></div> : <>
            <div className="oclr-panel-heading"><div><h2>{workspace?.fixture.label ?? tr("讀取裁判面板")}</h2><span className="oclr-hint">{({ empty: tr("尚未讀取"), loading: tr("讀取中"), fresh: tr("資料已更新"), stale: tr("資料已過期，請重新整理"), unavailable: tr("面板目前不可用") })[state.panelState]}{panel && ` · ${new Date(panel.capturedAt).toLocaleTimeString(uiLocale())}`}{state.status === 'refreshing' && tr(" · 更新授權中")}</span></div><Button size="sm" variant="ghost" isDisabled={busy || state.panelState === 'loading'} onPress={() => api && void perform(() => api.refreshPanel())}>{tr("更新面板")}</Button></div>
            {workspace && <>
              <div className="oclr-phases" role="tablist" aria-label={tr("執裁階段")}>{phases.map((name, i) => <button key={name} role="tab" id={`oclr-tab-${i}`} aria-controls="oclr-phase-content" aria-selected={phase === i} tabIndex={phase === i ? 0 : -1} onClick={() => setPhase(i)} onKeyDown={event => { const next = event.key === 'ArrowRight' ? (i + 1) % 3 : event.key === 'ArrowLeft' ? (i + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null; if (next !== null) { event.preventDefault(); setPhase(next); document.getElementById(`oclr-tab-${next}`)?.focus() } }}>{tr(name)}</button>)}</div>
              {workspace.readiness.length > 0 && <details className="oclr-issues"><summary>{tr("待核對項目（{{v0}}）", { v0: workspace.readiness.length })}</summary><ul>{workspace.readiness.map((issue, i) => <li key={i}>{tr(issue)}</li>)}</ul></details>}
              <div id="oclr-phase-content" role="tabpanel" aria-labelledby={`oclr-tab-${phase}`} className="oclr-phase-content enter" key={phase}>
                {phase === 0 && <>
                  <dl className="oclr-settings"><div><dt>{tr("房間名稱")}</dt><dd>{settings?.roomName || tr("尚未設定")}</dd></div><div><dt>{tr("遊戲規則")}</dt><dd>{workspace.rules ? tr("{{v0}} · {{v1}} · {{v2}} · {{v3}} 人／隊", { v0: workspace.rules.mode, v1: workspace.rules.teamType, v2: workspace.rules.scoringType, v3: workspace.rules.playersPerTeam }) : tr("尚未設定")}</dd></div><div><dt>{tr("房間人數")}</dt><dd>{settings?.roomSize ?? tr("尚未設定")}</dd></div><div><dt>{tr("房間設定中的直播員")}</dt><dd>{settings?.streamerUsername || tr("尚未設定")}</dd></div></dl>
                  <div className="oclr-rosters">{workspace.teams.map(team => <section key={team.id}><h3>{team.name}</h3><ul>{team.members.map(member => <li key={member.osuId}>{member.username} <small>#{member.osuId}{member.osuId === team.captainId ? ' · Captain' : ''}</small></li>)}</ul>{!team.members.length && <p className="oclr-hint">{tr("沒有可讀的正式名單。")}</p>}</section>)}</div>
                  <h3>{tr("賽前指令")}</h3>{commands(['make', 'set', 'addref', 'invite'])}
                </>}
                {phase === 1 && <>
                  <div className="oclr-order"><span>{tr("先 Ban：")}{workspace.teams.find(t => t.id === workspace.session?.firstBanTeamId)?.name ?? tr("未設定")}</span><span>{tr("先 Pick：")}{workspace.teams.find(t => t.id === workspace.session?.firstPickTeamId)?.name ?? tr("未設定")}</span></div>
                  <div className="oclr-maps">{workspace.maps.map(map => <button key={map.id} className={`oclr-map ${state.selectedMapId === map.id ? 'selected' : ''}`} aria-label={tr("預覽 {{v0}}{{v1}}", { v0: map.category, v1: map.position })} aria-pressed={state.selectedMapId === map.id} disabled={!fresh || busy} onClick={() => api && void perform(() => api.selectMap(map.id))}><strong>{map.category}{map.position}</strong><span>{map.metadata ? `${map.metadata.artist} — ${map.metadata.title}` : `Beatmap ${map.beatmapId}`}<small>{map.metadata?.difficulty ?? tr("尚無地圖詳情")} · #{map.beatmapId}</small></span><span>{map.metadata ? `${map.metadata.stars.toFixed(2)}★` : '—'}</span></button>)}</div>
                  {!workspace.maps.length && <p className="oclr-hint">{tr("尚無保存圖池。")}</p>}
                  <h3>{tr("選圖與控制指令")}</h3>{commands(['map', 'mods', 'timer', 'start', 'abort'])}
                </>}
                {phase === 2 && <>
                  <h3>{tr("裁判暫記比分")}</h3><div className="oclr-score">{workspace.teams.map(team => <span key={team.id}>{team.name} <strong>{workspace.projection.score[team.id] ?? 0}</strong></span>)}</div>
                  <ol className="oclr-ledger">{workspace.projection.activeSelections.map(selection => <li key={selection.id}><strong>{selection.kind === 'ban' ? 'Ban' : selection.kind === 'tb' ? 'TB' : 'Pick'} · {selection.category} · #{selection.beatmapId}</strong><span>{workspace.teams.find(t => t.id === selection.teamId)?.name ?? tr("中立")}</span><ul>{selection.attempts.map(attempt => <li key={attempt.id}>{tr("第")}{attempt.number}{tr("次 ·")}{tr(statusNames[attempt.status])}{attempt.winnerTeamId && tr(" · {{v0}} 勝", { v0: workspace.teams.find(t => t.id === attempt.winnerTeamId)?.name ?? tr("未知隊伍") })}</li>)}</ul></li>)}</ol>
                  {!workspace.projection.activeSelections.length && <p className="oclr-hint">{tr("尚無保存的 Ban／Pick 紀錄。")}</p>}
                  <Button className="primary-button" isDisabled={busy} onPress={() => api && void perform(() => api.openReview(state.selectedFixtureId!))}>{tr("前往網站 MP 審核 ↗")}</Button>
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
  return <div className="oclr-command"><div><span>{command.playerName ? `${tr(commandNames[command.kind])} · ${command.playerName}` : tr(commandNames[command.kind] ?? command.kind)}</span><code>{command.text ?? tr(command.reason || "尚不可用")}</code></div><Button size="sm" variant="ghost" isDisabled={disabled || !command.text} aria-label={tr("複製 {{v0}}", { v0: command.id })} onPress={onCopy}>{copied ? tr("已複製") : tr("複製")}</Button></div>
}
