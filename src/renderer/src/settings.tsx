import { useEffect, useState } from 'react'
import { Button, Input, Label, Tabs, TextField } from '@heroui/react'
import { WorkspaceCheckbox, WorkspaceSelect } from './controls'
import { tr } from './i18n'
import { BrandIcon } from './brand'
import { CHAT_FONT_FAMILIES, CHAT_FONT_SIZES, CHAT_SEND_SHORTCUTS, CHAT_TIMESTAMPS, modifiedEnterLabel, type AppPreferences, type AppSettings, type LanguagePreference } from '../../shared/preferences'
import { networkProxyInput, PROXY_MODES, type NetworkProxy } from '../../shared/network-proxy'
import type { AppUpdateState } from '../../shared/app-updates'

function UpdateSettings() {
  const [state, setState] = useState<AppUpdateState | null>(null)
  const [error, setError] = useState(false)
  const updates = window.oclr?.updates
  useEffect(() => {
    if (!updates) return
    let active = true, received = false
    const unsubscribe = updates.onState(value => { received = true; setState(value) })
    void updates.snapshot().then(value => { if (active && !received) setState(value) }, () => { if (active) setError(true) })
    return () => { active = false; unsubscribe() }
  }, [updates])
  async function run(action: 'check' | 'download' | 'install' | 'openReleases') {
    setError(false)
    try { await updates?.[action]() } catch { setError(true) }
  }
  const status = state?.status
  const version = state?.version ?? ''
  const descriptions = {
    idle: '', checking: tr('正在檢查更新…'), current: tr('目前已是最新版本。'),
    available: tr('已有新版本 {{v0}}。', { v0: version }), downloading: tr('正在下載更新（{{v0}}%）…', { v0: state?.progress ?? 0 }),
    ready: tr('版本 {{v0}} 已下載。', { v0: version }), installing: tr('正在重新啟動並安裝…'), error: ''
  }
  const busy = status === 'checking' || status === 'downloading' || status === 'installing'
  return <section className="settings-section" aria-labelledby="app-updates-title">
    <h2 id="app-updates-title">{tr('應用程式更新')}</h2>
    <div className="about-links">
      {status === 'ready' ? <Button variant="primary" onPress={() => void run('install')}>{tr('重新啟動並安裝')}</Button>
        : state?.mode === 'windows' && status === 'available' ? <Button variant="primary" onPress={() => void run('download')}>{tr('下載更新')}</Button>
        : <Button variant="secondary" isDisabled={!state || busy} onPress={() => void run('check')}>{tr('檢查更新')}</Button>}
      <Button variant="ghost" isDisabled={!updates} onPress={() => void run('openReleases')}>{tr('GitHub 下載頁')} ↗</Button>
    </div>
    {status && descriptions[status] && <p role="status">{descriptions[status]}</p>}
    {(status === 'error' || error) && <div role="alert" className="error-message">{tr('更新未完成，請重試或前往 GitHub 下載。')}</div>}
  </section>
}

function NetworkSettings({ proxy, disabled, save }: { proxy: NetworkProxy; disabled: boolean; save: (proxy: NetworkProxy) => Promise<boolean> }) {
  const [mode, setMode] = useState(proxy.mode)
  const [host, setHost] = useState(proxy.mode === 'direct' ? '' : proxy.host)
  const [port, setPort] = useState(proxy.mode === 'direct' ? '' : String(proxy.port))
  const [feedback, setFeedback] = useState<'saved' | 'invalid' | null>(null)
  const labels = { direct: tr('直連'), socks5: 'SOCKS5', http: 'HTTP CONNECT' }

  async function submit() {
    let value: NetworkProxy
    try { value = networkProxyInput(mode === 'direct' ? { mode } : { mode, host, port: /^\d+$/.test(port.trim()) ? Number(port) : NaN }) }
    catch { setFeedback('invalid'); return }
    setFeedback(null)
    if (await save(value)) {
      if (value.mode !== 'direct') { setHost(value.host); setPort(String(value.port)) }
      setFeedback('saved')
    }
  }

  return <section className="settings-section" aria-labelledby="network-proxy-title">
    <h2 id="network-proxy-title">{tr('網路代理')}</h2>
    <form className="network-proxy-form" onSubmit={event => { event.preventDefault(); void submit() }}>
      <WorkspaceSelect label={tr('連線方式')} value={mode} disabled={disabled} onChange={selected => {
        const next = PROXY_MODES.find(option => option === selected)
        if (next) { setMode(next); setFeedback(null) }
      }} options={PROXY_MODES.map(value => ({ value, label: labels[value] }))} />
      {mode !== 'direct' && <div className="network-proxy-fields">
        <TextField name="proxyHost" className="field" value={host} isDisabled={disabled} onChange={value => { setHost(value); setFeedback(null) }}>
          <Label>{tr('代理主機')}</Label><Input placeholder="127.0.0.1" autoComplete="off" spellCheck={false} maxLength={253} />
        </TextField>
        <TextField name="proxyPort" className="field" value={port} isDisabled={disabled} onChange={value => { setPort(value); setFeedback(null) }}>
          <Label>{tr('連接埠')}</Label><Input inputMode="numeric" autoComplete="off" maxLength={5} />
        </TextField>
      </div>}
      <div><Button type="submit" variant="primary" isDisabled={disabled}>{tr('儲存代理設定')}</Button></div>
      {feedback === 'invalid' && <div className="error-message" role="alert">{tr('請輸入有效的代理主機和連接埠（1–65535）。')}</div>}
      {feedback === 'saved' && <div role="status">{tr('代理設定已儲存。')}</div>}
    </form>
    <p>{tr('套用於新的 IRC 連線、OCLR API 和 osu! 資料請求。')}</p>
  </section>
}

export function SettingsView({ settings, onChange }: { settings: AppSettings; onChange: (settings: AppSettings) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const chatFontLabels = { default: tr('預設字型'), serif: tr('襯線字型'), monospace: tr('等寬字型') }
  const timestampLabels = { hidden: tr('隱藏時間戳'), minutes: tr('時分（HH:mm）'), seconds: tr('時分秒（HH:mm:ss）') }
  async function save(patch: Partial<AppPreferences>) {
    if (!window.oclr || busy) return false
    setBusy(true); setError('')
    try {
      const result = await window.oclr.settings.update({ ...settings.preferences, ...patch })
      if (result.ok && result.settings) { onChange(result.settings); return true }
      else setError(result.error || '無法保存設定，請重試。')
    } catch { setError('桌面服務無法回應。') }
    finally { setBusy(false) }
    return false
  }
  async function open(kind: 'repository' | 'license' | 'notices') {
    try { const result = await window.oclr?.settings.openAboutLink(kind); if (!result?.ok) setError(result?.error || '無法開啟此連結。') }
    catch { setError('無法開啟此連結。') }
  }
  return <section className="settings-view enter">
    <h1>{tr('設定')}</h1>
    <Tabs aria-label={tr('設定頁面')} defaultSelectedKey="general">
      <Tabs.ListContainer><Tabs.List aria-label={tr('設定頁面')}>
        <Tabs.Tab id="general">{tr('一般')}<Tabs.Indicator /></Tabs.Tab>
        <Tabs.Tab id="network">{tr('網路')}<Tabs.Indicator /></Tabs.Tab>
        <Tabs.Tab id="about">{tr('關於')}<Tabs.Indicator /></Tabs.Tab>
      </Tabs.List></Tabs.ListContainer>
      <Tabs.Panel id="general">
        <section className="settings-section"><h2>OCLR</h2>
          <WorkspaceCheckbox name="autoRefreshOclr" selected={settings.preferences.autoRefreshOclr} disabled={busy || !window.oclr} onChange={value => void save({ autoRefreshOclr: value })}>{tr('自動更新 OCLR 網站資料')}</WorkspaceCheckbox>
          <p>{tr('在背景更新場次與裁判面板；關閉後可手動重新整理。')}</p>
        </section>
        <section className="settings-section"><h2>{tr('IRC 登入')}</h2>
          <WorkspaceCheckbox name="restoreIrcLogin" selected={settings.preferences.restoreIrcLogin} disabled={busy || !window.oclr || !settings.secureStorageAvailable && !settings.preferences.restoreIrcLogin} onChange={value => void save({ restoreIrcLogin: value })}>{tr('啟動時恢復上次 IRC 登入')}</WorkspaceCheckbox>
          <p>{tr(settings.secureStorageAvailable ? '使用系統安全儲存保存登入；手動登出後不會自動連線。' : '系統安全儲存不可用，將使用手動登入。')}</p>
        </section>
        <section className="settings-section"><h2>{tr('視窗行為')}</h2>
          <WorkspaceCheckbox name="closeToBackground" selected={settings.preferences.closeToBackground} disabled={busy || !window.oclr} onChange={value => void save({ closeToBackground: value })}>{tr('關閉視窗後在背景執行')}</WorkspaceCheckbox>
          <p>{tr('保留連線，可從系統匣、Dock 或工作列重新開啟。')}</p>
        </section>
        <section className="settings-section"><h2>{tr('桌面通知')}</h2>
          <div className="notification-settings">
            <WorkspaceCheckbox name="notifyPlayersReady" selected={settings.preferences.notifyPlayersReady} disabled={busy || !window.oclr} onChange={value => void save({ notifyPlayersReady: value })}>{tr('全員就緒')}</WorkspaceCheckbox>
            <WorkspaceCheckbox name="notifyMatchFinished" selected={settings.preferences.notifyMatchFinished} disabled={busy || !window.oclr} onChange={value => void save({ notifyMatchFinished: value })}>{tr('本局結束')}</WorkspaceCheckbox>
            <WorkspaceCheckbox name="notifyOnlyInBackground" selected={settings.preferences.notifyOnlyInBackground} disabled={busy || !window.oclr} onChange={value => void save({ notifyOnlyInBackground: value })}>{tr('僅在背景時通知')}</WorkspaceCheckbox>
          </div>
        </section>
        <section className="settings-section"><h2>{tr('語言')}</h2>
          <WorkspaceSelect className="language-select" label={tr('介面語言')} value={settings.preferences.language} disabled={busy || !window.oclr} onChange={value => void save({ language: value as LanguagePreference })} options={[
            { value: 'system', label: tr('跟隨系統') }, { value: 'zh-Hans', label: '简体中文' }, { value: 'zh-Hant', label: '繁體中文' }, { value: 'en', label: 'English' }
          ]} />
        </section>
        <section className="settings-section chat-font-settings">
          <div><h2>{tr('聊天字號')}</h2>
            <WorkspaceSelect className="chat-font-size-select" label={tr('聊天字號')} value={String(settings.preferences.chatFontSize)} disabled={busy || !window.oclr} onChange={value => {
              const chatFontSize = CHAT_FONT_SIZES.find(size => size === Number(value))
              if (chatFontSize !== undefined) void save({ chatFontSize })
            }} options={CHAT_FONT_SIZES.map(size => ({ value: String(size), label: `${size} px` }))} />
          </div>
          <div><h2>{tr('聊天字型')}</h2>
            <WorkspaceSelect className="chat-font-family-select" label={tr('聊天字型')} value={settings.preferences.chatFontFamily} disabled={busy || !window.oclr} onChange={value => {
              const chatFontFamily = CHAT_FONT_FAMILIES.find(font => font === value)
              if (chatFontFamily !== undefined) void save({ chatFontFamily })
            }} options={CHAT_FONT_FAMILIES.map(value => ({ value, label: chatFontLabels[value] }))} />
          </div>
          <div><h2>{tr('聊天時間戳')}</h2>
            <WorkspaceSelect className="chat-timestamp-select" label={tr('聊天時間戳')} value={settings.preferences.chatTimestamp} disabled={busy || !window.oclr} onChange={value => {
              const chatTimestamp = CHAT_TIMESTAMPS.find(mode => mode === value)
              if (chatTimestamp !== undefined) void save({ chatTimestamp })
            }} options={CHAT_TIMESTAMPS.map(value => ({ value, label: timestampLabels[value] }))} />
          </div>
        </section>
        <section className="settings-section"><h2>{tr('傳送快捷鍵')}</h2>
          <WorkspaceSelect className="chat-send-shortcut-select" label={tr('傳送快捷鍵')} value={settings.preferences.chatSendShortcut} disabled={busy || !window.oclr} onChange={value => {
            const chatSendShortcut = CHAT_SEND_SHORTCUTS.find(shortcut => shortcut === value)
            if (chatSendShortcut !== undefined) void save({ chatSendShortcut })
          }} options={[
            { value: 'enter', label: 'Enter' },
            { value: 'modifier-enter', label: modifiedEnterLabel(settings.platform) }
          ]} />
        </section>
        <section className="settings-section">
          <WorkspaceCheckbox name="foldBanchoQueries" selected={settings.preferences.foldBanchoQueries} disabled={busy || !window.oclr} onChange={value => void save({ foldBanchoQueries: value })}>{tr('摺疊 BanchoBot 查詢回覆')}</WorkspaceCheckbox>
        </section>
      </Tabs.Panel>
      <Tabs.Panel id="network">
        <NetworkSettings proxy={settings.preferences.networkProxy} disabled={busy || !window.oclr} save={networkProxy => save({ networkProxy })} />
      </Tabs.Panel>
      <Tabs.Panel id="about">
        <section className="settings-section about-app"><BrandIcon /><div><h2>OCLR IRC</h2><p>{tr('OCLR 賽事裁判用 IRC 客戶端')}</p></div></section>
        <dl className="about-details"><div><dt>{tr('版本')}</dt><dd>{settings.version}</dd></div><div><dt>{tr('作業系統')}</dt><dd>{({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' })[settings.platform as 'darwin' | 'win32' | 'linux'] ?? settings.platform}</dd></div><div><dt>{tr('授權')}</dt><dd>MIT</dd></div></dl>
        <div className="about-links"><Button variant="secondary" onPress={() => void open('repository')}>{tr('專案網站')} ↗</Button><Button variant="ghost" onPress={() => void open('license')}>{tr('開源授權')} ↗</Button><Button variant="ghost" onPress={() => void open('notices')}>{tr('第三方聲明')} ↗</Button></div>
        <p className="about-stack">Electron · React · HeroUI · i18next</p>
        <UpdateSettings />
      </Tabs.Panel>
    </Tabs>
    {error && <p role="alert" className="error-message">{tr(error)}</p>}
  </section>
}
