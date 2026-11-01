import { Icon } from './icons'
import { useTranslation } from 'react-i18next'
import { SettingsView } from './settings'
import { changeLocale, tr, uiLocale } from './i18n'
import { DEFAULT_PREFERENCES, resolveLocale, type AppSettings } from '../../shared/preferences'
import { OperationsView } from './operations'
import { JournalView } from './journal'
import { WorkspaceSelect, WorkspaceCheckbox, RefreshButton } from './controls'
import { MatchStatus } from './match-status'
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, FieldError, Input, Label, Spinner, TextField, Modal, Tabs } from '@heroui/react'
import type { DesktopAPI, Snapshot } from '../../shared/types'
import './styles.css'
import { Composer, MessageList } from './conversation'
import { CreateRoom } from './create-room'
import { OclrView } from './oclr'
import { MpControls } from './mp-controls'
import { PlayerSlots } from './player-slots'
import { FixtureSource, FixturePool, FixtureRoster, useFixtureSource } from './fixture-tools'
declare global { interface Window { oclr?: DesktopAPI } }
const initial: Snapshot = { creation: { status: 'unreviewed', requestId: '', roomId: null, message: null }, retryAttempt: 0, retryAt: null, connection: 'offline', username: '', room: null, pending: null, error: null, messages: [], rooms: [], leavingChannels: [], messageStartIndex: 1 }
const statusText = { offline: '未連線', connecting: '正在連線', online: '已連線', error: '連線失敗', reconnecting: '正在重連', suspended: '休眠暫停' }

function App({ initialSettings }: { initialSettings: AppSettings }) {
  useTranslation()
  const [settings, setSettings] = useState(initialSettings)
  function applySettings(value: AppSettings) { setSettings(value); void changeLocale(value.locale) }
  useEffect(() => window.oclr?.settings.onState(applySettings), [])
  const [state, setState] = useState(initial)
  const website = useFixtureSource()
  const [launch, setLaunch] = useState<import('../../shared/website-launch').WebsiteLaunchState | null>(null)
  useEffect(() => {
    const api = window.oclr?.websiteLaunch
    if (!api) return
    let arrived = false
    const receive = (value: import('../../shared/website-launch').WebsiteLaunchState | null) => { setLaunch(value); if (value) setPage('oclr') }
    const off = api.onState(value => { arrived = true; receive(value) })
    void api.snapshot().then(value => { if (!arrived) receive(value) }).catch(() => {})
    return off
  }, [])
  const [page, setPage] = useState<'account' | 'room' | 'oclr' | 'journal' | 'operations' | 'settings'>('account')
  const [roomRequest, setRoomRequest] = useState<import('../../shared/website-room-join').WebsiteRoomJoinState | null>(null)
  useEffect(() => {
    const api = window.oclr?.websiteRoomJoin
    if (!api) return
    let arrived = false
    const receive = (value: import('../../shared/website-room-join').WebsiteRoomJoinState | null) => {
      setRoomRequest(value)
      if (value) setPage(value.status === 'pending' ? 'account' : 'room')
    }
    const off = api.onState(value => { arrived = true; receive(value) })
    void api.snapshot().then(value => { if (!arrived) receive(value) }).catch(() => {})
    return off
  }, [])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [conversationKind, setConversationKind] = useState<'match' | 'channel' | 'private'>('match')
  const [room, setRoom] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [remember, setRemember] = useState(false)
  const [saved, setSaved] = useState({ available: false, saved: false })
  const [busy, setBusy] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(true)
  const [toolTab, setToolTab] = useState<string | number>('actions')
  const [toolWidth, setToolWidth] = useState(320)
  const desktop = Boolean(window.oclr)
  const online = state.connection === 'online'
  const connecting = (state.connection === 'connecting' || state.connection === 'reconnecting')
  useEffect(() => {
    if (!window.oclr) return
    let eventArrived = false
    const off = window.oclr.onState(next => { eventArrived = true; setState(next) })
    void window.oclr.credentialStatus().then(setSaved).catch(() => {})
    void window.oclr.snapshot().then(next => { if (!eventArrived) setState(next) })
    return off
  }, [])
  useEffect(() => { if (online) { setPage(current => current === 'account' ? roomRequest ? 'room' : launch ? 'oclr' : 'room' : current); setFormError(null) } }, [online])
  async function login(event: React.FormEvent) {
    event.preventDefault()
    if (!window.oclr || busy || connecting) return
    setFormError(null); setBusy(true)
    const submitted = password
    setPassword(''); setShowPassword(false)
    try { const result = await window.oclr.login({ username, password: submitted, remember }); if (!result.ok) setFormError(result.error || '登入未完成。') }
    catch { setFormError('無法連接桌面服務，請重新開啟應用程式。') }
    finally { setBusy(false) }
  }
  async function join(event: React.FormEvent) {
    event.preventDefault()
    if (!window.oclr || busy) return
    setFormError(null); setBusy(true)
    try { const result = await (conversationKind === 'match' ? window.oclr.join(room) : window.oclr.openConversation({ kind: conversationKind, name: room })); if (!result.ok) setFormError(result.error || '未能加入房間。'); else setJoinOpen(false) }
    catch { setFormError('桌面服務無法回應。') }
    finally { setBusy(false) }
  }
  async function query(kind: 'settings' | 'listrefs') {
    if (!window.oclr || !state.room) return
    setFormError(null)
    try { const result = await window.oclr.query({ roomId: state.room!.id, roomEpoch: state.room!.epoch, kind }); if (!result.ok) setFormError(result.error || '查詢未完成。') }
    catch { setFormError('桌面服務無法回應。') }
  }
  async function tabAction(kind: 'selectRoom' | 'leaveRoom', id: number, epoch: number) {
    if (!window.oclr) return
    setFormError(null)
    try { const result = await window.oclr[kind]({ roomId: id, roomEpoch: epoch }); if (!result.ok) setFormError(result.error || '房間操作未完成。') }
    catch { setFormError('桌面服務無法回應。') }
  }
  async function logout() { setPassword(''); setRemember(false); setCreateOpen(false); setJoinOpen(false); setFormError(null); setPage('account'); await window.oclr?.logout(); if (window.oclr) setSaved(await window.oclr.credentialStatus()) }
  const error = formError || state.error || state.credentialError
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-symbol">O</span><div><strong>OCLR</strong><span>IRC</span></div></div>
      <div className="workspace-label">{tr("裁判工作台")}<span>01</span></div>
      <nav aria-label={tr("主要導覽")}>
        <button className={page === 'account' ? 'nav-item selected' : 'nav-item'} title={tr("帳號連線")} aria-current={page === 'account' ? 'page' : undefined} onClick={() => setPage('account')}><Icon name="connect" /><span className="nav-label">{tr("帳號連線")}</span><span className={`tiny-dot ${online ? 'active' : ''}`} /></button>
        <button className={page === 'room' ? 'nav-item selected' : 'nav-item'} title={tr("房間記錄")} aria-current={page === 'room' ? 'page' : undefined} disabled={!online && !state.rooms.length} onClick={() => setPage('room')}><Icon name="room" /><span className="nav-label">{tr("房間記錄")}</span></button>
        <button className={page === 'oclr' ? 'nav-item selected' : 'nav-item'} title={tr("OCLR 場次")} aria-current={page === 'oclr' ? 'page' : undefined} onClick={() => setPage('oclr')}><Icon name="trophy" /><span className="nav-label">{tr("OCLR 場次")}</span></button>
        <button className={page === 'journal' ? 'nav-item selected' : 'nav-item'} title={tr("本機日誌")} aria-current={page === 'journal' ? 'page' : undefined} onClick={() => setPage('journal')}><Icon name="document" /><span className="nav-label">{tr("本機日誌")}</span></button>
        <button className={page === 'operations' ? 'nav-item selected' : 'nav-item'} title={tr("操作記錄")} aria-current={page === 'operations' ? 'page' : undefined} onClick={() => setPage('operations')}><Icon name="history" /><span className="nav-label">{tr("操作記錄")}</span></button>
      </nav>
      <div className="sidebar-settings"><button className={page === 'settings' ? 'nav-item selected' : 'nav-item'} title={tr("設定")} aria-current={page === 'settings' ? 'page' : undefined} onClick={() => setPage('settings')}><Icon name="settings" /><span className="nav-label">{tr("設定")}</span></button></div>
      <div className="sidebar-footer" role="status" aria-label={`${state.username || 'osu! IRC'} · ${tr(statusText[state.connection])}`} title={`${state.username || 'osu! IRC'} · ${tr(statusText[state.connection])}`}><span className={`status-dot ${online ? 'online' : connecting ? 'connecting' : ''}`} aria-hidden="true" /><div><strong>{state.username || 'osu! IRC'}</strong><span>{tr(statusText[state.connection])}</span></div>{state.username && <Button isIconOnly variant="ghost" aria-label={tr("登出 IRC")} onPress={() => void logout()}><Icon name="logout" /></Button>}</div>
    </aside>
    <div className="workspace">
      {state.connection !== 'online' && state.username && <div className="reconnect-notice" role="status">{tr(statusText[state.connection])}{state.retryAttempt > 0 && tr(" · 第 {{v0}}/5 次重試", { v0: state.retryAttempt })}{state.retryAt && tr(" · {{v0}} 重試", { v0: new Date(state.retryAt).toLocaleTimeString(uiLocale()) })}{state.connection === 'error' && <RefreshButton label={tr("重新連線")} onPress={() => { void window.oclr?.retry().then(result => { if (!result.ok) setFormError(result.error || '重試失敗') }).catch(() => setFormError('桌面服務無法回應。')) }} />}<Button size="sm" variant="ghost" onPress={() => void logout()}>{tr("停止並登出")}</Button></div>}
      <main>
        {roomRequest && roomRequest.status !== 'joined' && <section className="oclr-session" aria-label={tr("重新加入房間")}>
          <div><strong>#{`mp_${roomRequest.roomId}`}</strong><span role="status">{roomRequest.status === 'pending' ? tr("請先登入 osu! IRC。") : roomRequest.status === 'error' ? tr("未能加入房間。") : tr("正在加入房間…")}</span></div>
          {roomRequest.status === 'error' && <RefreshButton label={tr("重新加入房間")} onPress={() => void window.oclr?.websiteRoomJoin.retry(roomRequest.requestId).catch(() => setFormError('桌面服務無法回應。'))} />}
          <Button variant="ghost" onPress={() => void window.oclr?.websiteRoomJoin.clear()}>{tr("關閉")}</Button>
        </section>}
        {launch && (page === 'account' || page === 'oclr') && <section className="oclr-session" aria-label={tr("網站連接請求")}>
          <div><strong>{tr("網站連接請求")}</strong><span>{launch.fixtureId}</span><span role="status">{launch.status === 'ready' ? tr("場次已帶入，請啟用網站 IRC。") : launch.status === 'error' ? tr("無法帶入場次，請確認授權與本人指派後重試。") : launch.status === 'authorizing' ? tr("請在瀏覽器完成 OCLR 授權。") : launch.status === 'loading' ? tr("正在讀取場次…") : tr("請登入 IRC，再繼續連接此場次。")}</span></div>
          {!['loading', 'authorizing', 'ready'].includes(launch.status) && <Button onPress={() => { if (!online) setPage('account'); else { setPage('oclr'); void window.oclr?.websiteLaunch.continue(launch.requestId).catch(() => setFormError('桌面服務無法回應。')) } }}>{online ? tr("繼續連接") : tr("帳號連線")}</Button>}
          <Button variant="ghost" onPress={() => void window.oclr?.websiteLaunch.clear()}>{tr("關閉")}</Button>
        </section>}
        {page === 'settings' ? <SettingsView settings={settings} onChange={applySettings} /> : page === 'operations' ? <OperationsView key={state.username} state={state} /> : page === 'journal' ? <JournalView key={state.username} /> : page === 'oclr' ? <OclrView /> : page === 'account' ? <div className="account-view enter">
          <section className="login-section">
            <div className="section-kicker">ACCOUNT CONNECTION</div>
            <h1>{online ? tr("IRC 已連線") : tr("連接 osu! IRC")}</h1>
            {online ? <div className="connected-panel"><span className="account-avatar">{state.username.slice(0, 1)}</span><h2>{state.username}</h2><Button className="primary-button" onPress={() => setPage('room')}>{tr("前往房間記錄")}<Icon name="arrow" /></Button><Button variant="ghost" onPress={() => void logout()}>{tr("登出")}</Button></div> : <form onSubmit={login} className="login-form">
              <TextField name="username" value={username} onChange={setUsername} isRequired isDisabled={connecting || busy} className="field">
                <Label>{tr("osu! 使用者名稱")}</Label><Input placeholder={tr("你的 osu! 名稱")} autoComplete="username" maxLength={32} /><FieldError />
              </TextField>
              <TextField name="password" value={password} onChange={setPassword} isRequired isDisabled={connecting || busy} className="field">
                <Label>{tr("IRC 專用密碼")}</Label><div className="password-wrap"><Input type={showPassword ? 'text' : 'password'} placeholder={tr("輸入 IRC 專用密碼")} autoComplete="off" maxLength={128} /><button type="button" className="password-eye" aria-label={showPassword ? tr("隱藏密碼") : tr("顯示密碼")} aria-pressed={showPassword} disabled={connecting} onClick={() => setShowPassword(!showPassword)}><Icon name="eye" /></button></div>
                <FieldError />
              </TextField>
              <WorkspaceCheckbox selected={remember} disabled={!saved.available || connecting || busy} onChange={setRemember}>{tr("使用系統安全儲存記住 IRC 登入")}</WorkspaceCheckbox>
              {saved.saved && <div className="saved-actions"><Button className="saved-login-button" isDisabled={connecting || busy || !saved.available} onPress={() => { setBusy(true); void window.oclr?.loginSaved().then(r => { if (!r.ok) setFormError(r.error || '登入失敗') }).catch(() => setFormError('桌面服務無法回應。')).finally(() => setBusy(false)) }}>{tr("使用已保存的帳號")}</Button><Button variant="secondary" className="forget-login-button" isDisabled={busy} onPress={() => { setBusy(true); void window.oclr?.forgetCredentials().then(async r => { if (!r.ok) setFormError(r.error || '刪除失敗'); else setSaved(await window.oclr!.credentialStatus()) }).catch(() => setFormError('桌面服務無法回應。')).finally(() => setBusy(false)) }}>{tr("忘記已保存登入")}</Button></div>}
              {error && <div className="error-message" role="alert">{tr(error)}</div>}
              {!desktop && <div className="error-message" role="status">{tr("這是介面預覽。請在桌面應用程式中登入。")}</div>}
              <Button type="submit" className="primary-button login-button" isDisabled={!desktop || connecting || busy || !username.trim() || !password}>{connecting ? <><Spinner size="sm" />{tr("正在登入…")}</> : <>{tr("登入 IRC")}<Icon name="arrow" /></>}</Button>
              {connecting && <Button variant="ghost" className="cancel-button" onPress={() => void logout()}>{tr("取消連線")}</Button>}
            </form>}
          </section>
          <aside className="connection-info"><span className="small-label">{tr("連線資訊")}</span><dl><div><dt>{tr("服務")}</dt><dd>osu! Bancho</dd></div><div><dt>{tr("伺服器")}</dt><dd className="mono">irc.ppy.sh</dd></div><div><dt>{tr("連接埠")}</dt><dd className="mono">6667</dd></div></dl><div className="info-divider" /><h3>{tr("取得 IRC 專用密碼")}</h3><Button variant="ghost" className="text-button" isDisabled={!desktop} onPress={() => void window.oclr?.openAccountSettings()}>{tr("開啟帳號設定")}<span aria-hidden="true">↗</span></Button></aside>
        </div> : <div className={`room-view enter ${toolsOpen && state.room ? 'tools-visible' : ''}`} style={{ '--tool-width': `${toolWidth}px` } as React.CSSProperties}><div className="room-main">
          <div className="room-heading"><h1>{tr("房間記錄")}</h1><div className="room-actions">
            <Button size="sm" variant="secondary" className="join-room-button" isDisabled={!online || busy} onPress={() => setJoinOpen(true)}>{tr("加入")}</Button>
            <Button size="sm" variant="secondary" className="new-room-button" isDisabled={!online || (state.rooms.length >= 8 && state.creation.status !== 'awaiting')} onPress={() => setCreateOpen(true)}>{state.creation.status === 'awaiting' ? tr("正在建立…") : tr("＋ 新建")}</Button>
            {!toolsOpen && state.room && <Button isIconOnly size="sm" variant="ghost" className="tools-toggle" aria-label={tr("展開房內工具")} aria-expanded={false} aria-controls="room-tools" onPress={() => setToolsOpen(true)}><Icon name="menu" /></Button>}
          </div></div>
          <Modal isOpen={joinOpen} onOpenChange={setJoinOpen}><Modal.Backdrop><Modal.Container size="sm"><Modal.Dialog aria-label={tr("加入房間")}><Modal.Header><Modal.Heading>{tr("加入房間")}</Modal.Heading><Modal.CloseTrigger aria-label={tr("關閉")} /></Modal.Header><Modal.Body>
          <form className="join-form" onSubmit={join}><WorkspaceSelect label={tr("對話類型")} value={conversationKind} onChange={value => setConversationKind(value as typeof conversationKind)} options={[{ value: 'match', label: tr("比賽房間") }, { value: 'channel', label: tr("IRC 頻道") }, { value: 'private', label: tr("私訊") }]} /><TextField aria-label={conversationKind === 'match' ? tr("MP 編號或比賽連結") : conversationKind === 'channel' ? tr("IRC 頻道名稱") : tr("私訊對象名稱")} value={room} onChange={setRoom} className="room-input"><Input autoFocus placeholder={conversationKind === 'match' ? tr("貼上 osu! MP 連結或輸入房間編號") : conversationKind === 'channel' ? tr("#osu 或其他頻道") : tr("osu! 使用者名稱")} /></TextField><Button type="submit" className="primary-button" isDisabled={!online || !room.trim() || busy}>{conversationKind === 'private' ? tr("開啟私訊") : tr("加入房間")}<Icon name="arrow" /></Button></form>
          {formError && <p role="alert" className="error-message">{tr(formError)}</p>}
          </Modal.Body></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
          <Modal isOpen={createOpen} onOpenChange={setCreateOpen}><Modal.Backdrop><Modal.Container size="sm"><Modal.Dialog aria-label={tr("新建比賽房間")}><Modal.Body><CreateRoom state={state} onClose={() => setCreateOpen(false)} /></Modal.Body></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
          {!createOpen && state.creation.message && <p className={`creation-notice ${['unknown', 'blocked'].includes(state.creation.status) ? 'creation-warning' : ''}`} role="status">{tr(state.creation.message)}</p>}
          {state.leavingChannels.length > 0 && <p className="leaving-notice" role="status">{tr("離開確認中：")}{state.leavingChannels.join("、")}</p>}
          {state.rooms.length > 0 && <div className="room-tabs" aria-label={tr("已開啟的房間")}>
            {state.rooms.map(tab => <div className={`room-tab ${state.room?.id === tab.id ? 'selected' : ''}`} key={tab.epoch}>
              <button type="button" aria-label={tr("切換至 {{v0}}", { v0: tab.channel })} aria-current={state.room?.id === tab.id ? 'page' : undefined} title={tab.error ? tr(tab.error) : (tab.pending ? tr("正在等待回覆") : tab.channel)} onClick={() => void tabAction('selectRoom', tab.id, tab.epoch)}>
                <span className={`tiny-dot ${tab.joined ? 'active' : ''}`} />{tab.channel}
                {tab.mentions > 0 ? <span className="mention-badge">@{tab.mentions}</span> : tab.unread > 0 ? <span className="unread-badge">{tab.unread}</span> : null}
                {tab.pending && <span aria-label={tr("等待回覆")}>…</span>}{tab.error && <span aria-label={tr("房間不可用或查詢失敗")}>!</span>}
              </button>
              <button type="button" className="leave-tab" aria-label={tr("離開 {{v0}}", { v0: tab.channel })}  onClick={() => void tabAction('leaveRoom', tab.id, tab.epoch)}>×</button>
            </div>)}
          </div>}
          {error && (!connecting || formError || state.credentialError) && <div className="error-message room-error" role="alert">{tr(error)}</div>}
          <div className={`room-grid ${state.room ? '' : 'room-grid-empty'}`}><section className="conversation" aria-label={tr("房間訊息")}>
            <div className="conversation-header"><div className="conversation-title"><h2>{state.room?.name || state.room?.channel || tr("尚未加入房間")}</h2><div className="conversation-meta"><span className="channel-name">{state.room?.channel}</span><span className="query-status" role="status" aria-label={state.pending ? tr("正在等待伺服器回覆…") : undefined}>{state.pending && <><Spinner size="sm" aria-hidden="true" /><span>{tr("正在等待伺服器回覆…")}</span></>}</span></div></div><div className="query-actions"><RefreshButton label={tr("讀取設定")} disabled={!online || !state.room?.joined || state.room.kind !== 'match'} busy={Boolean(state.pending)} onPress={() => void query('settings')} /><RefreshButton label={tr("裁判名單")} disabled={!online || !state.room?.joined || state.room.kind !== 'match'} busy={Boolean(state.pending)} onPress={() => void query('listrefs')} /></div></div>
            {state.room?.kind === 'match' && <MatchStatus room={state.room} />}
            <MessageList key={`messages-${state.room?.epoch ?? 0}`} state={state} onError={setFormError} />
            <Composer key={`composer-${state.room?.epoch ?? 0}-${state.connection}`} state={state} onError={setFormError} />
          </section></div></div>{state.room && <aside id="room-tools" className="room-inspector" hidden={!toolsOpen} aria-label={tr("房內工具")}>
          <div className="tool-resizer" role="separator" aria-label={tr("調整工具欄寬度")} aria-orientation="vertical" aria-valuemin={280} aria-valuemax={420} aria-valuenow={toolWidth} tabIndex={0}
            onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setToolWidth(width => Math.max(280, Math.min(420, width + (event.key === 'ArrowLeft' ? 16 : -16)))) } }}
            onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId) }}
            onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setToolWidth(Math.max(280, Math.min(420, event.currentTarget.parentElement!.getBoundingClientRect().right - event.clientX))) }} />
          <div className="tools-heading"><strong>{tr("房內工具")}</strong><Button isIconOnly size="sm" variant="ghost" className="tools-toggle" aria-label={tr("收合房內工具")} aria-expanded={true} aria-controls="room-tools" onPress={() => setToolsOpen(false)}><Icon name="menu" /></Button><span className="channel-name">{state.room.channel}</span></div><div className="tools-scroll">{state.room.kind === 'match' && <FixtureSource website={website} onConnect={() => setPage('oclr')} />}{state.room?.kind === 'match' && <Tabs aria-label={tr("房內工具分類")} selectedKey={toolTab} onSelectionChange={setToolTab}><Tabs.ListContainer><Tabs.List aria-label={tr("房內工具分類")}><Tabs.Tab id="actions">{tr("操作")}<Tabs.Indicator /></Tabs.Tab><Tabs.Tab id="pool">{tr("圖池")}<Tabs.Indicator /></Tabs.Tab><Tabs.Tab id="players">{tr("玩家")}<Tabs.Indicator /></Tabs.Tab></Tabs.List></Tabs.ListContainer><Tabs.Panel id="actions" shouldForceMount><MpControls key={`mp-${state.room.epoch}`} state={state} onReveal={players => { setToolsOpen(true); setToolTab(players ? 'players' : 'actions') }} /></Tabs.Panel><Tabs.Panel id="pool" shouldForceMount><FixturePool website={website} /></Tabs.Panel><Tabs.Panel id="players" shouldForceMount><FixtureRoster key={`fixture-${state.room.epoch}`} website={website} state={state} onConnect={() => setPage('oclr')} onOperations={() => setPage('operations')} /><PlayerSlots room={state.room} /></Tabs.Panel></Tabs>}<span className="small-label">{state.room?.kind === 'match' ? tr("房間資訊") : tr("對話資訊")}</span>{state.room && state.room.kind !== 'match' ? <dl><div><dt>{tr("對話類型")}</dt><dd>{state.room.kind === 'private' ? tr("私訊") : tr("IRC 頻道")}</dd></div><div><dt>{tr("對象")}</dt><dd>{state.room.channel}</dd></div>{state.room.kind === 'channel' && <div><dt>{tr("觀測頻道成員")}</dt><dd>{state.room.members.length}</dd></div>}</dl> : <dl>{state.room?.kind === 'match' && <div><dt>{tr("狀態快照")}</dt><dd>{({ unknown: tr("尚未同步"), loading: tr("同步中"), partial: tr("部分資料"), complete: tr("完整觀測"), stale: tr("已過期，請重查") })[state.room.syncState]}</dd></div>}<div><dt>{tr("MP 編號")}</dt><dd className="mono">{state.room?.kind === 'match' ? state.room.id : '—'}</dd></div><div><dt>{tr("房間核對")}</dt><dd className={state.room?.binding === 'verified' ? 'accent-text' : ''}>{state.room?.binding === 'verified' ? tr("History 連結相符") : state.room?.binding === 'mismatch' ? tr("連結不符") : tr("尚未核對")}</dd></div><div><dt>{tr("裁判身分")}</dt><dd className={state.room?.referee === 'listed' ? 'accent-text' : ''}>{state.room?.referee === 'listed' ? tr("已列於裁判名單") : tr("尚未核對")}</dd></div><div><dt>{tr("比賽模式")}</dt><dd>{state.room?.mode || '—'}</dd></div><div><dt>{tr("房內玩家")}</dt><dd>{state.room?.players ?? '—'}</dd></div></dl>}{state.room?.kind === 'match' && <><dl><div><dt>{tr("觀測時間")}</dt><dd>{state.room.observedAt ? new Date(state.room.observedAt).toLocaleTimeString(uiLocale()) : '—'}</dd></div><div><dt>{tr("目前地圖")}</dt><dd>{state.room.beatmap ? `${state.room.beatmap.id} · ${state.room.beatmap.title}` : tr("未知")}</dd></div><div><dt>Mods</dt><dd>{state.room.mods === null ? tr("未知") : state.room.mods.join(', ') || 'None'}</dd></div><div><dt>{tr("比賽階段")}</dt><dd>{({ unknown: tr("未知"), idle: tr("未進行"), playing: tr("進行中") })[state.room.phase]}</dd></div></dl></>}</div></aside>}
        </div>}
      </main>
    </div>
  </div>
}
async function bootstrap() {
  let settings: AppSettings = { preferences: { ...DEFAULT_PREFERENCES }, locale: resolveLocale('system', navigator.languages), version: '0.8.2', platform: '' }
  try { if (window.oclr) settings = await window.oclr.settings.snapshot() } catch { /* Preview defaults; never read credentials here. */ }
  await changeLocale(settings.locale)
  createRoot(document.getElementById('root')!).render(<App initialSettings={settings} />)
}
void bootstrap()
