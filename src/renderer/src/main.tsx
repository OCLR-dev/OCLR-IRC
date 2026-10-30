import { OperationsView } from './operations'
import { JournalView } from './journal'
import { WorkspaceSelect, WorkspaceCheckbox } from './controls'
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
declare global { interface Window { oclr?: DesktopAPI } }
const initial: Snapshot = { creation: { status: 'unreviewed', requestId: '', roomId: null, message: null }, retryAttempt: 0, retryAt: null, connection: 'offline', username: '', room: null, pending: null, error: null, messages: [], rooms: [], leavingChannels: [], messageStartIndex: 1 }
const statusText = { offline: '未連線', connecting: '正在連線', online: '已連線', error: '連線失敗', reconnecting: '正在重連', suspended: '休眠暫停' }
function Icon({ name }: { name: 'connect' | 'room' | 'arrow' | 'logout' | 'key' | 'eye' }) {
  const paths = {
    connect: <><path d="M8 7V3m8 4V3M6 7h12v4a6 6 0 0 1-12 0V7Zm6 10v4" /></>,
    room: <><path d="M4 5h16v12H9l-5 4V5Z" /><path d="M8 9h8M8 13h5" /></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    logout: <><path d="M9 4H4v16h5m5-13 5 5-5 5m-5-5h14" /></>,
    key: <><circle cx="8" cy="8" r="4" /><path d="m11 11 9 9m-3-3 3-3m-6 0 3-3" /></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>
  }
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
function App() {
  const [state, setState] = useState(initial)
  const [page, setPage] = useState<'account' | 'room' | 'oclr' | 'journal' | 'operations'>('account')
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
  useEffect(() => { if (online) { setPage(current => current === 'account' ? 'room' : current); setFormError(null) } }, [online])
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
  async function runInBackground() {
    try { const result = await window.oclr?.runInBackground(); if (result && !result.ok) setFormError(result.error || '無法轉入背景。') }
    catch { setFormError('桌面服務無法回應。') }
  }
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-symbol">O</span><div><strong>OCLR</strong><span>IRC</span></div></div>
      <div className="workspace-label">裁判工作台 <span>01</span></div>
      <nav aria-label="主要導覽">
        <button className={page === 'account' ? 'nav-item selected' : 'nav-item'} onClick={() => setPage('account')}><Icon name="connect" /><span className="nav-label">帳號連線</span><span className={`tiny-dot ${online ? 'active' : ''}`} /></button>
        <button className={page === 'room' ? 'nav-item selected' : 'nav-item'} disabled={!online && !state.rooms.length} onClick={() => setPage('room')}><Icon name="room" /><span className="nav-label">房間記錄</span></button>
        <button className={page === 'oclr' ? 'nav-item selected' : 'nav-item'} onClick={() => setPage('oclr')}><Icon name="connect" /><span className="nav-label">OCLR 場次</span></button>
        <button className={page === 'journal' ? 'nav-item selected' : 'nav-item'} onClick={() => setPage('journal')}><Icon name="room" /><span className="nav-label">本機日誌</span></button>
        <button className={page === 'operations' ? 'nav-item selected' : 'nav-item'} onClick={() => setPage('operations')}><Icon name="room" /><span className="nav-label">操作記錄</span></button>
      </nav>
      <div className="sidebar-note"><span className="small-label">背景執行</span><Button variant="ghost" size="sm" isDisabled={!desktop} onPress={() => void runInBackground()}>轉入背景</Button><Button variant="ghost" size="sm" isDisabled={!desktop} onPress={() => { void window.oclr?.quit().catch(() => setFormError('無法退出程式。')) }}>退出程式</Button></div>
      <div className="sidebar-footer"><span className={`status-dot ${online ? 'online' : connecting ? 'connecting' : ''}`} /><div><strong>{online ? state.username : 'osu! IRC'}</strong><span>{statusText[state.connection]}</span></div>{state.username && <Button isIconOnly variant="ghost" aria-label="登出 IRC" onPress={() => void logout()}><Icon name="logout" /></Button>}</div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div><span>工作台</span><span className="breadcrumb-slash">/</span><strong>{page === 'operations' ? '操作記錄' : page === 'journal' ? '本機日誌' : page === 'account' ? '帳號連線' : page === 'oclr' ? 'OCLR 場次' : '房間記錄'}</strong></div><span className="version">v0.7.0 <span>PREVIEW</span></span></header>
      {state.connection !== 'online' && state.username && <div className="reconnect-notice" role="status">{statusText[state.connection]}{state.retryAttempt > 0 && ` · 第 ${state.retryAttempt}/5 次重試`}{state.retryAt && ` · ${new Date(state.retryAt).toLocaleTimeString()} 重試`}{state.connection === 'error' && <Button size="sm" variant="ghost" onPress={() => { void window.oclr?.retry().then(result => { if (!result.ok) setFormError(result.error || '重試失敗') }).catch(() => setFormError('桌面服務無法回應。')) }}>重新連線</Button>}<Button size="sm" variant="ghost" onPress={() => void logout()}>停止並登出</Button></div>}
      <main>
        {page === 'operations' ? <OperationsView key={state.username} state={state} /> : page === 'journal' ? <JournalView key={state.username} /> : page === 'oclr' ? <OclrView /> : page === 'account' ? <div className="account-view enter">
          <section className="login-section">
            <div className="section-kicker">ACCOUNT CONNECTION</div>
            <h1>{online ? 'IRC 已連線' : '連接 osu! IRC'}</h1>
            {online ? <div className="connected-panel"><span className="account-avatar">{state.username.slice(0, 1)}</span><h2>{state.username}</h2><Button className="primary-button" onPress={() => setPage('room')}>前往房間記錄 <Icon name="arrow" /></Button><Button variant="ghost" onPress={() => void logout()}>登出</Button></div> : <form onSubmit={login} className="login-form">
              <TextField name="username" value={username} onChange={setUsername} isRequired isDisabled={connecting || busy} className="field">
                <Label>osu! 使用者名稱</Label><Input placeholder="你的 osu! 名稱" autoComplete="username" maxLength={32} /><FieldError />
              </TextField>
              <TextField name="password" value={password} onChange={setPassword} isRequired isDisabled={connecting || busy} className="field">
                <Label>IRC 專用密碼</Label><div className="password-wrap"><Input type={showPassword ? 'text' : 'password'} placeholder="輸入 IRC 專用密碼" autoComplete="off" maxLength={128} /><button type="button" className="password-eye" aria-label={showPassword ? '隱藏密碼' : '顯示密碼'} aria-pressed={showPassword} disabled={connecting} onClick={() => setShowPassword(!showPassword)}><Icon name="eye" /></button></div>
                <FieldError />
              </TextField>
              <WorkspaceCheckbox selected={remember} disabled={!saved.available || connecting || busy} onChange={setRemember}>使用系統安全儲存記住 IRC 登入</WorkspaceCheckbox>
              {saved.saved && <div className="saved-actions"><Button className="saved-login-button" isDisabled={connecting || busy || !saved.available} onPress={() => { setBusy(true); void window.oclr?.loginSaved().then(r => { if (!r.ok) setFormError(r.error || '登入失敗') }).catch(() => setFormError('桌面服務無法回應。')).finally(() => setBusy(false)) }}>使用已保存的帳號</Button><Button variant="secondary" className="forget-login-button" isDisabled={busy} onPress={() => { setBusy(true); void window.oclr?.forgetCredentials().then(async r => { if (!r.ok) setFormError(r.error || '刪除失敗'); else setSaved(await window.oclr!.credentialStatus()) }).catch(() => setFormError('桌面服務無法回應。')).finally(() => setBusy(false)) }}>忘記已保存登入</Button></div>}
              {error && <div className="error-message" role="alert">{error}</div>}
              {!desktop && <div className="error-message" role="status">這是介面預覽。請在桌面應用程式中登入。</div>}
              <Button type="submit" className="primary-button login-button" isDisabled={!desktop || connecting || busy || !username.trim() || !password}>{connecting ? <><Spinner size="sm" />正在登入…</> : <>登入 IRC <Icon name="arrow" /></>}</Button>
              {connecting && <Button variant="ghost" className="cancel-button" onPress={() => void logout()}>取消連線</Button>}
            </form>}
          </section>
          <aside className="connection-info"><span className="small-label">連線資訊</span><dl><div><dt>服務</dt><dd>osu! Bancho</dd></div><div><dt>伺服器</dt><dd className="mono">irc.ppy.sh</dd></div><div><dt>連接埠</dt><dd className="mono">6667</dd></div></dl><div className="info-divider" /><h3>取得 IRC 專用密碼</h3><Button variant="ghost" className="text-button" isDisabled={!desktop} onPress={() => void window.oclr?.openAccountSettings()}>開啟帳號設定 <span aria-hidden="true">↗</span></Button></aside>
        </div> : <div className={`room-view enter ${toolsOpen && state.room ? 'tools-visible' : ''}`} style={{ '--tool-width': `${toolWidth}px` } as React.CSSProperties}><div className="room-main">
          <div className="room-heading"><h1>房間記錄</h1><div className="room-actions">
            <Button size="sm" variant="secondary" className="join-room-button" isDisabled={!online || busy} onPress={() => setJoinOpen(true)}>加入</Button>
            <Button size="sm" variant="secondary" className="new-room-button" isDisabled={!online || (state.rooms.length >= 8 && state.creation.status !== 'awaiting')} onPress={() => setCreateOpen(true)}>{state.creation.status === 'awaiting' ? '正在建立…' : '＋ 新建'}</Button>
            {!toolsOpen && <Button size="sm" variant="ghost" onPress={() => setToolsOpen(true)}>展開工具</Button>}
          </div></div>
          <Modal isOpen={joinOpen} onOpenChange={setJoinOpen}><Modal.Backdrop><Modal.Container size="sm"><Modal.Dialog aria-label="加入房間"><Modal.Header><Modal.Heading>加入房間</Modal.Heading><Modal.CloseTrigger /></Modal.Header><Modal.Body>
          <form className="join-form" onSubmit={join}><WorkspaceSelect label="對話類型" value={conversationKind} onChange={value => setConversationKind(value as typeof conversationKind)} options={[{ value: 'match', label: '比賽房間' }, { value: 'channel', label: 'IRC 頻道' }, { value: 'private', label: '私訊' }]} /><TextField aria-label={conversationKind === 'match' ? 'MP 編號或比賽連結' : conversationKind === 'channel' ? 'IRC 頻道名稱' : '私訊對象名稱'} value={room} onChange={setRoom} className="room-input"><Input autoFocus placeholder={conversationKind === 'match' ? '貼上 osu! MP 連結或輸入房間編號' : conversationKind === 'channel' ? '#osu 或其他頻道' : 'osu! 使用者名稱'} /></TextField><Button type="submit" className="primary-button" isDisabled={!online || !room.trim() || busy}>{conversationKind === 'private' ? '開啟私訊' : '加入房間'}<Icon name="arrow" /></Button></form>
          {formError && <p role="alert" className="error-message">{formError}</p>}
          </Modal.Body></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
          <Modal isOpen={createOpen} onOpenChange={setCreateOpen}><Modal.Backdrop><Modal.Container size="sm"><Modal.Dialog aria-label="新建比賽房間"><Modal.Body><CreateRoom state={state} onClose={() => setCreateOpen(false)} /></Modal.Body></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
          {!createOpen && state.creation.message && <p className={`creation-notice ${['unknown', 'blocked'].includes(state.creation.status) ? 'creation-warning' : ''}`} role="status">{state.creation.message}</p>}
          {state.leavingChannels.length > 0 && <p className="leaving-notice" role="status">離開確認中：{state.leavingChannels.join("、")}</p>}
          {state.rooms.length > 0 && <div className="room-tabs" aria-label="已開啟的房間">
            {state.rooms.map(tab => <div className={`room-tab ${state.room?.id === tab.id ? 'selected' : ''}`} key={tab.epoch}>
              <button type="button" aria-label={`切換至 ${tab.channel}`} aria-current={state.room?.id === tab.id ? 'page' : undefined} title={tab.error || (tab.pending ? '正在等待回覆' : tab.channel)} onClick={() => void tabAction('selectRoom', tab.id, tab.epoch)}>
                <span className={`tiny-dot ${tab.joined ? 'active' : ''}`} />{tab.channel}
                {tab.mentions > 0 ? <span className="mention-badge">@{tab.mentions}</span> : tab.unread > 0 ? <span className="unread-badge">{tab.unread}</span> : null}
                {tab.pending && <span aria-label="等待回覆">…</span>}{tab.error && <span aria-label="房間不可用或查詢失敗">!</span>}
              </button>
              <button type="button" className="leave-tab" aria-label={`離開 ${tab.channel}`}  onClick={() => void tabAction('leaveRoom', tab.id, tab.epoch)}>×</button>
            </div>)}
          </div>}
          {error && (!connecting || formError || state.credentialError) && <div className="error-message room-error" role="alert">{error}</div>}
          <div className={`room-grid ${state.room ? '' : 'room-grid-empty'}`}><section className="conversation" aria-label="房間訊息">
            <div className="conversation-header"><div className="conversation-title"><h2>{state.room?.name || state.room?.channel || '尚未加入房間'}</h2><span className="channel-name">{state.room?.channel}</span></div><div className="query-actions"><Button size="sm" variant="ghost" isDisabled={!online || !state.room?.joined || state.room.kind !== 'match' || Boolean(state.pending)} onPress={() => void query('settings')}>讀取設定</Button><Button size="sm" variant="ghost" isDisabled={!online || !state.room?.joined || state.room.kind !== 'match' || Boolean(state.pending)} onPress={() => void query('listrefs')}>裁判名單</Button></div></div>
            {state.room?.kind === 'match' && <MatchStatus room={state.room} />}
            <MessageList key={`messages-${state.room?.epoch ?? 0}`} state={state} onError={setFormError} />
            <Composer key={`composer-${state.room?.epoch ?? 0}-${state.connection}`} state={state} onError={setFormError} />
            {state.pending && <div className="conversation-footer"><span className="pending-state">正在等待伺服器回覆…</span></div>}
          </section></div></div>{state.room && <aside className="room-inspector" hidden={!toolsOpen} aria-label="房內工具">
          <div className="tool-resizer" role="separator" aria-label="調整工具欄寬度" aria-orientation="vertical" aria-valuemin={280} aria-valuemax={420} aria-valuenow={toolWidth} tabIndex={0}
            onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setToolWidth(width => Math.max(280, Math.min(420, width + (event.key === 'ArrowLeft' ? 16 : -16)))) } }}
            onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId) }}
            onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setToolWidth(Math.max(280, Math.min(420, event.currentTarget.parentElement!.getBoundingClientRect().right - event.clientX))) }} />
          <div className="tools-heading"><strong>房內工具</strong><Button size="sm" variant="ghost" onPress={() => setToolsOpen(false)}>收合</Button><span className="channel-name">{state.room.channel}</span></div><div className="tools-scroll">{state.room?.kind === 'match' && <Tabs aria-label="房內工具分類" selectedKey={toolTab} onSelectionChange={setToolTab}><Tabs.ListContainer><Tabs.List aria-label="房內工具分類"><Tabs.Tab id="actions">操作<Tabs.Indicator /></Tabs.Tab><Tabs.Tab id="players">玩家<Tabs.Indicator /></Tabs.Tab></Tabs.List></Tabs.ListContainer><Tabs.Panel id="actions" shouldForceMount><MpControls key={`mp-${state.room.epoch}`} state={state} onReveal={players => { setToolsOpen(true); setToolTab(players ? 'players' : 'actions') }} /></Tabs.Panel><Tabs.Panel id="players" shouldForceMount><PlayerSlots room={state.room} /></Tabs.Panel></Tabs>}<span className="small-label">{state.room?.kind === 'match' ? '房間資訊' : '對話資訊'}</span>{state.room && state.room.kind !== 'match' ? <dl><div><dt>對話類型</dt><dd>{state.room.kind === 'private' ? '私訊' : 'IRC 頻道'}</dd></div><div><dt>對象</dt><dd>{state.room.channel}</dd></div>{state.room.kind === 'channel' && <div><dt>觀測頻道成員</dt><dd>{state.room.members.length}</dd></div>}</dl> : <dl>{state.room?.kind === 'match' && <div><dt>狀態快照</dt><dd>{({ unknown: '尚未同步', loading: '同步中', partial: '部分資料', complete: '完整觀測', stale: '已過期，請重查' })[state.room.syncState]}</dd></div>}<div><dt>MP 編號</dt><dd className="mono">{state.room?.kind === 'match' ? state.room.id : '—'}</dd></div><div><dt>房間核對</dt><dd className={state.room?.binding === 'verified' ? 'accent-text' : ''}>{state.room?.binding === 'verified' ? 'History 連結相符' : state.room?.binding === 'mismatch' ? '連結不符' : '尚未核對'}</dd></div><div><dt>裁判身分</dt><dd className={state.room?.referee === 'listed' ? 'accent-text' : ''}>{state.room?.referee === 'listed' ? '已列於裁判名單' : '尚未核對'}</dd></div><div><dt>比賽模式</dt><dd>{state.room?.mode || '—'}</dd></div><div><dt>房內玩家</dt><dd>{state.room?.players ?? '—'}</dd></div></dl>}{state.room?.kind === 'match' && <><dl><div><dt>觀測時間</dt><dd>{state.room.observedAt ? new Date(state.room.observedAt).toLocaleTimeString() : '—'}</dd></div><div><dt>目前地圖</dt><dd>{state.room.beatmap ? `${state.room.beatmap.id} · ${state.room.beatmap.title}` : '未知'}</dd></div><div><dt>Mods</dt><dd>{state.room.mods === null ? '未知' : state.room.mods.join(', ') || 'None'}</dd></div><div><dt>比賽階段</dt><dd>{({ unknown: '未知', idle: '未進行', playing: '進行中' })[state.room.phase]}</dd></div></dl></>}</div></aside>}
        </div>}
      </main>
      <footer className="app-footer"><span><span className={`tiny-dot ${online ? 'active' : ''}`} />IRC {statusText[state.connection]}</span></footer>
    </div>
  </div>
}
createRoot(document.getElementById('root')!).render(<App />)
