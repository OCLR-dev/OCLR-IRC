import { useState } from 'react'
import { Button, Tabs } from '@heroui/react'
import { WorkspaceCheckbox, WorkspaceSelect } from './controls'
import { tr } from './i18n'
import type { AppPreferences, AppSettings, LanguagePreference } from '../../shared/preferences'

export function SettingsView({ settings, onChange }: { settings: AppSettings; onChange: (settings: AppSettings) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(patch: Partial<AppPreferences>) {
    if (!window.oclr || busy) return
    setBusy(true); setError('')
    try {
      const result = await window.oclr.settings.update({ ...settings.preferences, ...patch })
      if (result.ok && result.settings) onChange(result.settings)
      else setError(result.error || '無法保存設定，請重試。')
    } catch { setError('桌面服務無法回應。') }
    finally { setBusy(false) }
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
        <Tabs.Tab id="about">{tr('關於')}<Tabs.Indicator /></Tabs.Tab>
      </Tabs.List></Tabs.ListContainer>
      <Tabs.Panel id="general">
        <section className="settings-section"><h2>{tr('IRC 登入')}</h2>
          <WorkspaceCheckbox name="restoreIrcLogin" selected={settings.preferences.restoreIrcLogin} disabled={busy || !window.oclr || !settings.secureStorageAvailable && !settings.preferences.restoreIrcLogin} onChange={value => void save({ restoreIrcLogin: value })}>{tr('啟動時恢復上次 IRC 登入')}</WorkspaceCheckbox>
          <p>{tr(settings.secureStorageAvailable ? '使用系統安全儲存保存登入；手動登出後不會自動連線。' : '系統安全儲存不可用，將使用手動登入。')}</p>
        </section>
        <section className="settings-section"><h2>{tr('視窗行為')}</h2>
          <WorkspaceCheckbox name="closeToBackground" selected={settings.preferences.closeToBackground} disabled={busy || !window.oclr} onChange={value => void save({ closeToBackground: value })}>{tr('關閉視窗後在背景執行')}</WorkspaceCheckbox>
          <p>{tr('保留連線，可從系統匣、Dock 或工作列重新開啟。')}</p>
        </section>
        <section className="settings-section"><h2>{tr('語言')}</h2>
          <WorkspaceSelect className="language-select" label={tr('介面語言')} value={settings.preferences.language} disabled={busy || !window.oclr} onChange={value => void save({ language: value as LanguagePreference })} options={[
            { value: 'system', label: tr('跟隨系統') }, { value: 'zh-Hans', label: '简体中文' }, { value: 'zh-Hant', label: '繁體中文' }, { value: 'en', label: 'English' }
          ]} />
        </section>
      </Tabs.Panel>
      <Tabs.Panel id="about">
        <section className="settings-section about-app"><span className="brand-symbol" aria-hidden="true">O</span><div><h2>OCLR IRC</h2><p>{tr('OCLR 賽事裁判用 IRC 客戶端')}</p></div></section>
        <dl className="about-details"><div><dt>{tr('版本')}</dt><dd>{settings.version}</dd></div><div><dt>{tr('作業系統')}</dt><dd>{({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' })[settings.platform as 'darwin' | 'win32' | 'linux'] ?? settings.platform}</dd></div><div><dt>{tr('授權')}</dt><dd>MIT</dd></div></dl>
        <div className="about-links"><Button variant="secondary" onPress={() => void open('repository')}>{tr('專案網站')} ↗</Button><Button variant="ghost" onPress={() => void open('license')}>{tr('開源授權')} ↗</Button><Button variant="ghost" onPress={() => void open('notices')}>{tr('第三方聲明')} ↗</Button></div>
        <p className="about-stack">Electron · React · HeroUI · i18next</p>
      </Tabs.Panel>
    </Tabs>
    {error && <p role="alert" className="error-message">{tr(error)}</p>}
  </section>
}
