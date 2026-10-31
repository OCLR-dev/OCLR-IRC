import { tr, uiLocale } from './i18n'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@heroui/react'
import type { JournalEntry, JournalState } from '../../shared/types'
import { WorkspaceCheckbox, WorkspaceSelect } from './controls'

export function JournalView() {
  const [state, setState] = useState<JournalState | null>(null)
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [room, setRoom] = useState('account')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'disable' | 'clear' | null>(null)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const api = window.oclr?.journal
  useEffect(() => api?.onInvalidate(() => { generation.current++; setEntries([]); setConfirm(null); setRoom('account') }), [api])
  useEffect(() => { let active = true; void api?.status().then(value => { if (active) setState(value) }); return () => { active = false } }, [api])
  const selected = room === 'account' ? undefined : room
  async function run(action: () => Promise<{ ok: boolean; entries?: JournalEntry[]; error?: string }>) {
    const expected = generation.current
    setBusy(true); setError(''); setConfirm(null)
    try {
      const result = await action()
      if (!result.ok) setError(result.error || '操作未完成。')
      if (result.entries && expected === generation.current) setEntries(result.entries)
      if (api) setState(await api.status())
    } catch { setError('桌面服務無法回應。') }
    finally { setBusy(false) }
  }
  const rooms = [...new Set(entries.map(entry => entry.room))]
  return <section className="journal-view enter">
    <h1>{tr("本機日誌")}</h1>
    <div className="journal-toolbar">
      <WorkspaceCheckbox selected={state?.enabled ?? true} disabled={!api || busy || !state} onChange={enabled => { if (!enabled) setConfirm('disable'); else if (api) void run(() => api.setEnabled(true)) }}>{tr("保存加密 IRC 日誌 · 7 天")}</WorkspaceCheckbox>
      <span role="status">{state && ({ saving: tr("正在保存"), memory_only: tr("僅記憶體"), failed: tr("保存失敗") })[state.status]}</span>
      <Button variant="secondary" size="sm" isDisabled={!state?.account || busy} onPress={() => api && void run(() => api.read())}>{tr("讀取歷史")}</Button>
    </div>
    <div className="journal-toolbar">
      <WorkspaceSelect label={tr("日誌範圍")} value={room} onChange={setRoom} options={[{ value: 'account', label: tr("本帳號所有對話") }, ...rooms.map(value => ({ value, label: value }))]} />
      <Button variant="secondary" size="sm" isDisabled={!state?.account || busy || state.status !== 'saving'} onPress={() => api && void run(() => api.export(selected))}>{tr("匯出所選範圍")}</Button>
      <Button variant="danger" size="sm" isDisabled={!state?.account || busy} onPress={() => setConfirm('clear')}>{tr("清除所選範圍")}</Button>
    </div>
    {confirm && <div className="journal-confirm"><strong>{confirm === 'disable' ? tr("關閉保存並刪除所有帳號日誌？") : tr("刪除 {{v0}} 的日誌？", { v0: selected ?? tr("本帳號所有對話") })}</strong><Button variant="danger" size="sm" isDisabled={busy} onPress={() => api && void run(async () => { const result = await (confirm === 'disable' ? api.setEnabled(false) : api.clear(selected)); if (result.ok) setEntries([]); return result })}>{tr("確認刪除")}</Button><Button variant="ghost" size="sm" onPress={() => setConfirm(null)}>{tr("取消")}</Button></div>}
    {error && <p className="error-message" role="alert">{tr(error)}</p>}
    <h2>{state?.account ?? tr("尚未登入")}{tr("· 最近 1,000 則")}</h2>
    <ol className="journal-entries">{entries.filter(entry => !selected || entry.room === selected).map((entry, index) => <li key={`${entry.time}-${index}`}><time>{new Date(entry.time).toLocaleString(uiLocale())}</time><span>{entry.room}</span><p>{entry.text}</p></li>)}</ol>
  </section>
}
