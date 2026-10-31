import { tr, uiLocale } from './i18n'
import { useState } from 'react'
import { Button } from '@heroui/react'
import type { Snapshot } from '../../shared/types'
import { WorkspaceCheckbox } from './controls'
const names: Record<string, string> = { roomplan: '房名與規則計畫', lineupplan: '陣容計畫', move: '移動槽位', team: '更換隊伍', kick: '移出玩家', rename: '更改房名', configure: '模式與容量', host: '指定房主', clearhost: '清除房主', password: '房間密碼', lock: '鎖定槽位', unlock: '解鎖槽位', close: '關閉房間', mapprofile: '連續選圖', make: '建立房間', map: '換圖', mods: '設定 Mods', start: '開始比賽', abort: '中止比賽', timer: '一般計時', aborttimer: '取消倒數', set: '房間設定', invite: '邀請玩家', addref: '裁判設定' }
export function OperationsView({ state }: { state: Snapshot }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [reviewed, setReviewed] = useState(false)
  const [error, setError] = useState('')
  async function review() {
    if (!selected || !reviewed || !window.oclr) return
    const id = selected; setSelected(null); setReviewed(false)
    try { const result = await window.oclr.reviewOperation({ id, reviewed: true }); if (!result.ok) setError(result.error || '核對失敗。') }
    catch { setError('桌面服務無法回應。') }
  }
  return <section className="journal-view enter"><h1>{tr("操作記錄")}</h1>
    {state.operations?.failed && <p className="error-message">{tr("操作恢復記錄不可用，目前禁止變更。")}</p>}
    {error && <p className="error-message" role="alert">{tr(error)}</p>}
    <ol className="journal-entries">{[...(state.operations?.records ?? [])].reverse().map(record => <li key={record.id}>
      <time>{new Date(record.createdAt).toLocaleString(uiLocale())}</time><strong>{tr(names[record.kind] ?? record.kind)} · {record.roomId ? `#mp_${record.roomId}` : tr("新房間")} · {record.source === 'oclr' ? tr("網站") : tr("手動")}</strong>
      <p>{record.state === 'awaiting' ? tr("等待伺服器回覆") : record.state === 'observed' ? tr("已觀測到對應回覆") : record.reviewed ? tr("結果不明 · 已人工核對") : tr("結果不明 · 待人工核對")}</p>
      {record.state !== 'observed' && !record.reviewed && (selected === record.id ? <div className="journal-confirm"><WorkspaceCheckbox selected={reviewed} onChange={setReviewed}>{tr("我已核對房間與 BanchoBot 回覆，停止等待此操作；不會重送")}</WorkspaceCheckbox><Button size="sm" isDisabled={!reviewed} onPress={() => void review()}>{tr("完成核對")}</Button><Button size="sm" variant="ghost" onPress={() => setSelected(null)}>{tr("取消")}</Button></div> : <Button size="sm" variant="secondary" onPress={() => { setSelected(record.id); setReviewed(false); setError('') }}>{tr("人工核對")}</Button>)}
    </li>)}</ol>
  </section>
}
