import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Description, FieldError, Input, Label, Spinner, TextField } from '@heroui/react'
import type { DesktopAPI, Snapshot } from '../../shared/types'
import './styles.css'
import { Composer, MessageList } from './conversation'

declare global { interface Window { oclr?: DesktopAPI } }
const initial: Snapshot = { retryAttempt: 0, retryAt: null, connection: 'offline', username: '', room: null, pending: null, error: null, messages: [], rooms: [], leavingChannels: [], messageStartIndex: 1 }
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
  const [page, setPage] = useState<'account' | 'room'>('account')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [conversationKind, setConversationKind] = useState<'match' | 'channel' | 'private'>('match')
  const [room, setRoom] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [remember, setRemember] = useState(false)
  const [saved, setSaved] = useState({ available: false, saved: false })
  const [busy, setBusy] = useState(false)
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
  useEffect(() => { if (online) { setPage('room'); setFormError(null) } }, [online])

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
    try { const result = await (conversationKind === 'match' ? window.oclr.join(room) : window.oclr.openConversation({ kind: conversationKind, name: room })); if (!result.ok) setFormError(result.error || '未能加入房間。') }
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
  async function logout() { setPassword(''); setRemember(false); setFormError(null); setPage('account'); await window.oclr?.logout(); if (window.oclr) setSaved(await window.oclr.credentialStatus()) }
  const error = formError || state.error || state.credentialError

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-symbol">O</span><div><strong>OCLR</strong><span>ref tools</span></div></div>
      <div className="workspace-label">裁判工作台 <span>01</span></div>
      <nav aria-label="主要導覽">
        <button className={page === 'account' ? 'nav-item selected' : 'nav-item'} onClick={() => setPage('account')}><Icon name="connect" />帳號連線<span className={`tiny-dot ${online ? 'active' : ''}`} /></button>
        <button className={page === 'room' ? 'nav-item selected' : 'nav-item'} disabled={!online && !state.rooms.length} onClick={() => setPage('room')}><Icon name="room" />房間記錄</button>
      </nav>
      <div className="sidebar-note"><span className="small-label">初版預覽</span><p>登入 IRC、連接比賽房間，<br />讀取設定與裁判資訊。</p></div>
      <div className="sidebar-footer"><span className={`status-dot ${online ? 'online' : connecting ? 'connecting' : ''}`} /><div><strong>{online ? state.username : 'osu! IRC'}</strong><span>{statusText[state.connection]}</span></div>{state.username && <Button isIconOnly variant="ghost" aria-label="登出 IRC" onPress={() => void logout()}><Icon name="logout" /></Button>}</div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div><span>工作台</span><span className="breadcrumb-slash">/</span><strong>{page === 'account' ? '帳號連線' : '房間記錄'}</strong></div><span className="version">v0.4.1 <span>PREVIEW</span></span></header>
      {state.connection !== 'online' && state.username && <div className="reconnect-notice" role="status">{statusText[state.connection]}{state.retryAttempt > 0 && ` · 第 ${state.retryAttempt}/5 次重試`}{state.retryAt && ` · ${new Date(state.retryAt).toLocaleTimeString()} 重試`}。操作不會自動重送。{state.connection === 'error' && <Button size="sm" variant="ghost" onPress={() => { void window.oclr?.retry().then(result => { if (!result.ok) setFormError(result.error || '重試失敗') }).catch(() => setFormError('桌面服務無法回應。')) }}>重新連線</Button>}<Button size="sm" variant="ghost" onPress={() => void logout()}>停止並登出</Button></div>}
      <main>
        {page === 'account' ? <div className="account-view enter">
          <section className="login-section">
            <div className="section-kicker">ACCOUNT CONNECTION</div>
            <h1>{online ? 'IRC 已連線' : '連接 osu! IRC'}</h1>
            <p className="intro">使用你的 osu! 帳號，進入裁判工作台。</p>
            {online ? <div className="connected-panel"><span className="account-avatar">{state.username.slice(0, 1)}</span><h2>{state.username}</h2><p>連線已建立，可以開始讀取比賽房間。</p><Button className="primary-button" onPress={() => setPage('room')}>前往房間記錄 <Icon name="arrow" /></Button><Button variant="ghost" onPress={() => void logout()}>登出</Button></div> : <form onSubmit={login} className="login-form">
              <TextField name="username" value={username} onChange={setUsername} isRequired isDisabled={connecting || busy} className="field">
                <Label>osu! 使用者名稱</Label><Input placeholder="你的 osu! 名稱" autoComplete="username" maxLength={32} /><FieldError />
              </TextField>
              <TextField name="password" value={password} onChange={setPassword} isRequired isDisabled={connecting || busy} className="field">
                <Label>IRC 專用密碼</Label><div className="password-wrap"><Input type={showPassword ? 'text' : 'password'} placeholder="輸入 IRC 專用密碼" autoComplete="off" maxLength={128} /><button type="button" className="password-eye" aria-label={showPassword ? '隱藏密碼' : '顯示密碼'} aria-pressed={showPassword} disabled={connecting} onClick={() => setShowPassword(!showPassword)}><Icon name="eye" /></button></div>
                <Description>使用 IRC 專用密碼，非網站登入密碼。</Description><FieldError />
              </TextField>
              <label className="remember-option"><input type="checkbox" checked={remember} disabled={!saved.available || connecting || busy} onChange={event => setRemember(event.target.checked)} />使用系統安全儲存記住 IRC 登入</label><p className="privacy-caption">不勾選登入會移除舊保存資料；聊天記錄不會因此保存。</p>
              {!saved.available && <p className="privacy-caption">目前系統尚無可驗證的安全儲存，僅使用記憶體。</p>}
              {saved.saved && <div className="saved-actions"><Button variant="ghost" isDisabled={connecting || busy || !saved.available} onPress={() => { setBusy(true); void window.oclr?.loginSaved().then(r => { if (!r.ok) setFormError(r.error || '登入失敗') }).catch(() => setFormError('桌面服務無法回應。')).finally(() => setBusy(false)) }}>使用已保存的帳號</Button><Button variant="ghost" isDisabled={busy} onPress={() => { setBusy(true); void window.oclr?.forgetCredentials().then(async r => { if (!r.ok) setFormError(r.error || '刪除失敗'); else setSaved(await window.oclr!.credentialStatus()) }).catch(() => setFormError('桌面服務無法回應。')).finally(() => setBusy(false)) }}>忘記已保存登入</Button></div>}
              {error && <div className="error-message" role="alert">{error}</div>}
              {!desktop && <div className="error-message" role="status">這是介面預覽。請在桌面應用程式中登入。</div>}
              <Button type="submit" className="primary-button login-button" isDisabled={!desktop || connecting || busy || !username.trim() || !password}>{connecting ? <><Spinner size="sm" />正在登入…</> : <>登入 IRC <Icon name="arrow" /></>}</Button>
              {connecting && <Button variant="ghost" className="cancel-button" onPress={() => void logout()}>取消連線</Button>}
              <p className="privacy-caption"><Icon name="key" />密碼保留於本次連線記憶體供重連使用，登出即清除；勾選保存者可用「忘記」刪除本機憑證。</p>
            </form>}
          </section>
          <aside className="connection-info"><span className="small-label">連線資訊</span><dl><div><dt>服務</dt><dd>osu! Bancho</dd></div><div><dt>伺服器</dt><dd className="mono">irc.ppy.sh</dd></div><div><dt>連接埠</dt><dd className="mono">6667</dd></div></dl><div className="info-divider" /><h3>取得 IRC 專用密碼</h3><p>前往 osu! 帳號設定，查看或重設你的 IRC 密碼。</p><Button variant="ghost" className="text-button" isDisabled={!desktop} onPress={() => void window.oclr?.openAccountSettings()}>開啟帳號設定 <span aria-hidden="true">↗</span></Button><p className="transport-note">osu! IRC 目前使用未加密連線。</p></aside>
        </div> : <div className="room-view enter">
          <div className="room-heading"><div><div className="section-kicker">{state.room?.kind === 'private' ? 'DIRECT MESSAGE' : state.room?.kind === 'channel' ? 'IRC CHANNEL' : 'MATCH ROOM'}</div><h1>{state.room?.name || (state.room?.kind !== 'match' && state.room?.channel) || '房間記錄'}</h1></div><span className="read-only-label">聊天與唯讀查詢</span></div>
          <form className="join-form" onSubmit={join}><select aria-label="對話類型" value={conversationKind} onChange={e => setConversationKind(e.target.value as typeof conversationKind)}><option value="match">比賽房間</option><option value="channel">IRC 頻道</option><option value="private">私訊</option></select><TextField aria-label={conversationKind === 'match' ? 'MP 編號或比賽連結' : conversationKind === 'channel' ? 'IRC 頻道名稱' : '私訊對象名稱'} value={room} onChange={setRoom} className="room-input"><Input placeholder={conversationKind === 'match' ? '貼上 osu! MP 連結或輸入房間編號' : conversationKind === 'channel' ? '#osu 或其他頻道' : 'osu! 使用者名稱'} /></TextField><Button type="submit" className="primary-button" isDisabled={!online || !room.trim() || busy}>{conversationKind === 'private' ? '開啟私訊' : '加入房間'}<Icon name="arrow" /></Button></form>
          {state.leavingChannels.length > 0 && <p className="leaving-notice" role="status">離開確認中：{state.leavingChannels.join("、")}</p>}
          {state.rooms.length > 0 && <div className="room-tabs" aria-label="已開啟的房間">
            {state.rooms.map(tab => <div className={`room-tab ${state.room?.id === tab.id ? 'selected' : ''}`} key={tab.epoch}>
              <button type="button" aria-label={`切換至 ${tab.channel}`} aria-current={state.room?.id === tab.id ? 'page' : undefined} title={tab.error || (tab.pending ? '正在等待回覆' : tab.channel)} onClick={() => void tabAction('selectRoom', tab.id, tab.epoch)}>
                <span className={`tiny-dot ${tab.joined ? 'active' : ''}`} />{tab.channel}
                {tab.mentions > 0 ? <span className="mention-badge">@{tab.mentions}</span> : tab.unread > 0 ? <span className="unread-badge">{tab.unread}</span> : null}
                {tab.pending && <span aria-label="等待回覆">…</span>}{tab.error && <span aria-label="房間不可用或查詢失敗">!</span>}
              </button>
              <button type="button" className="leave-tab" aria-label={`離開 ${tab.channel}`} title="離開頻道並清除此分頁；不關閉比賽房間" onClick={() => void tabAction('leaveRoom', tab.id, tab.epoch)}>×</button>
            </div>)}
          </div>}
          {error && (!connecting || formError || state.credentialError) && <div className="error-message room-error" role="alert">{error}</div>}
          <div className="room-grid"><section className="conversation" aria-label="房間訊息">
            <div className="conversation-header"><span className="channel-name">{state.room?.channel || '# 尚未加入房間'}</span><div className="query-actions"><Button size="sm" variant="ghost" isDisabled={!online || !state.room?.joined || state.room.kind !== 'match' || Boolean(state.pending)} onPress={() => void query('settings')}>讀取設定</Button><Button size="sm" variant="ghost" isDisabled={!online || !state.room?.joined || state.room.kind !== 'match' || Boolean(state.pending)} onPress={() => void query('listrefs')}>裁判名單</Button></div></div>
            <MessageList key={`messages-${state.room?.epoch ?? 0}`} state={state} onError={setFormError} />
            <Composer key={`composer-${state.room?.epoch ?? 0}-${state.connection}`} state={state} onError={setFormError} />
            <div className="conversation-footer"><span className={state.pending ? 'pending-state' : ''}>{state.pending ? '正在等待伺服器回覆…' : '一般聊天 · 比賽變更尚未開放'}</span><span>本次連線記錄 · 最多 1,000 則</span></div>
          </section><aside className="room-inspector"><span className="small-label">{state.room?.kind === 'match' ? '房間資訊' : '對話資訊'}</span>{state.room && state.room.kind !== 'match' ? <dl><div><dt>對話類型</dt><dd>{state.room.kind === 'private' ? '私訊' : 'IRC 頻道'}</dd></div><div><dt>對象</dt><dd>{state.room.channel}</dd></div>{state.room.kind === 'channel' && <div><dt>觀測頻道成員</dt><dd>{state.room.members.length}</dd></div>}</dl> : <dl>{state.room?.kind === 'match' && <div><dt>狀態快照</dt><dd>{({ unknown: '尚未同步', loading: '同步中', partial: '部分資料', complete: '完整觀測', stale: '已過期，請重查' })[state.room.syncState]}</dd></div>}<div><dt>MP 編號</dt><dd className="mono">{state.room?.kind === 'match' ? state.room.id : '—'}</dd></div><div><dt>房間核對</dt><dd className={state.room?.binding === 'verified' ? 'accent-text' : ''}>{state.room?.binding === 'verified' ? 'History 連結相符' : state.room?.binding === 'mismatch' ? '連結不符' : '尚未核對'}</dd></div><div><dt>裁判身分</dt><dd className={state.room?.referee === 'listed' ? 'accent-text' : ''}>{state.room?.referee === 'listed' ? '已列於裁判名單' : '尚未核對'}</dd></div><div><dt>比賽模式</dt><dd>{state.room?.mode || '—'}</dd></div><div><dt>房內玩家</dt><dd>{state.room?.players ?? '—'}</dd></div></dl>}{state.room?.kind === 'match' && <><dl><div><dt>觀測時間</dt><dd>{state.room.observedAt ? new Date(state.room.observedAt).toLocaleTimeString() : '—'}</dd></div><div><dt>目前地圖</dt><dd>{state.room.beatmap ? `${state.room.beatmap.id} · ${state.room.beatmap.title}` : '未知'}</dd></div><div><dt>Mods</dt><dd>{state.room.mods === null ? '未知' : state.room.mods.join(', ') || 'None'}</dd></div><div><dt>比賽階段</dt><dd>{({ unknown: '未知', idle: '未進行', playing: '進行中' })[state.room.phase]}</dd></div></dl><ul className="slot-list">{state.room.slots.map(slot => <li key={slot.slot}>{slot.slot}. {slot.username} · {slot.status} {slot.team || ''}{slot.host ? ' · Host' : ''}</li>)}</ul></>}<p className="inspector-note">{state.room?.kind === 'private' ? '私訊分頁不代表對方在線；BanchoBot 私訊僅供讀取。' : '加入頻道不代表擁有裁判權限；成員名單僅供名稱補完。'}</p></aside></div>
        </div>}
      </main>
      <footer className="app-footer"><span><span className={`tiny-dot ${online ? 'active' : ''}`} />{statusText[state.connection]}</span><span>本次記錄僅保留於記憶體 · OCLR 帳號連結尚未開放</span></footer>
    </div>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
