import { useEffect, useState } from 'react'
import { Button, TextField, Input, Label } from '@heroui/react'
import { WorkspaceCheckbox, WorkspaceSelect } from './controls'
import type { LobbyIntent, LobbyPreview } from '../../shared/lobby-command'
import type { Snapshot } from '../../shared/types'
const actions = { rename: '更改房名', configure: '模式與容量', lock: '鎖定隊伍與槽位', unlock: '解鎖隊伍與槽位', host: '指定房主', clearhost: '清除房主', password: '房間密碼', close: '關閉比賽房間' }
export function LobbyControls({ state }: { state: Snapshot }) {
  const [kind, setKind] = useState<keyof typeof actions>('rename'), [name, setName] = useState(''), [team, setTeam] = useState('2'), [score, setScore] = useState('3'), [size, setSize] = useState('16'), [host, setHost] = useState(''), [mode, setMode] = useState('set')
  const [preview, setPreview] = useState<LobbyPreview | null>(null), [reviewed, setReviewed] = useState(false), [password, setPassword] = useState(''), [closeRoom, setCloseRoom] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  function clear() { setPreview(null); setReviewed(false); setPassword(''); setCloseRoom('') }
  useEffect(clear, [kind, name, team, score, size, host, mode, state.room?.id, state.room?.epoch, state.connection])
  useEffect(() => { if (!preview) return; const timer = setTimeout(clear, Math.max(0, Date.parse(preview.expiresAt) - Date.now())); return () => clearTimeout(timer) }, [preview])
  async function prepare() {
    if (!window.oclr || !state.room) return
    setBusy(true); setError(''); clear()
    const intent: LobbyIntent = kind === 'rename' ? { kind, name } : kind === 'configure' ? { kind, teamMode: team, scoreMode: score, size } : kind === 'host' ? { kind, osuId: host } : kind === 'password' ? { kind, mode: mode as 'set' | 'clear' } : { kind }
    try { const result = await window.oclr.previewLobby({ roomId: state.room.id, roomEpoch: state.room.epoch, intent }); setPreview(result.preview ?? null); if (!result.ok) setError(result.error ?? '無法預覽。') } catch { setError('桌面服務無法回應。') } finally { setBusy(false) }
  }
  async function execute() {
    if (!window.oclr || !state.room || !preview) return
    const input = { roomId: state.room.id, roomEpoch: state.room.epoch, token: preview.token, reviewed, password, closeRoom }; clear(); setBusy(true)
    try { const result = await window.oclr.executeLobby(input); setError(result.ok ? '已送出，等待核對。' : result.error ?? '無法送出。') } catch { setError('結果不明，請核對房間。') } finally { setBusy(false) }
  }
  const disabled = busy || Boolean(preview)
  return <details className="map-profile lobby-controls"><summary>房間設定</summary>
    <WorkspaceSelect label="房間操作" value={kind} onChange={value => setKind(value as keyof typeof actions)} disabled={disabled} options={Object.entries(actions).map(([value, label]) => ({ value, label }))} />
    {kind === 'rename' && <TextField value={name} onChange={setName} isDisabled={disabled}><Label>房間名稱</Label><Input /></TextField>}
    {kind === 'configure' && <><WorkspaceSelect label="隊伍模式" value={team} onChange={setTeam} disabled={disabled} options={['HeadToHead', 'TagCoop', 'TeamVs', 'TagTeamVs'].map((label, i) => ({ value: String(i), label }))} /><WorkspaceSelect label="計分模式" value={score} onChange={setScore} disabled={disabled} options={['Score', 'Accuracy', 'Combo', 'ScoreV2'].map((label, i) => ({ value: String(i), label }))} /><TextField value={size} onChange={setSize} isDisabled={disabled}><Label>開放槽位</Label><Input inputMode="numeric" /></TextField></>}
    {kind === 'host' && <WorkspaceSelect label="房主" value={host} onChange={setHost} disabled={disabled} options={(state.room?.slots ?? []).map(slot => ({ value: String(slot.osuId), label: slot.username }))} />}
    {kind === 'password' && <WorkspaceSelect label="密碼操作" value={mode} onChange={setMode} disabled={disabled} options={[{ value: 'set', label: '設定密碼' }, { value: 'clear', label: '清除密碼' }]} />}
    {preview ? <div className="mp-confirm"><strong>{preview.channel}</strong><code>{preview.command}</code>
      {preview.passwordMode === 'set' && <TextField value={password} onChange={setPassword}><Label>新房間密碼</Label><Input type="password" autoComplete="off" /></TextField>}
      {preview.kind === 'close' && <TextField value={closeRoom} onChange={setCloseRoom}><Label>輸入頻道名稱以關閉房間</Label><Input autoComplete="off" /></TextField>}
      <WorkspaceCheckbox selected={reviewed} onChange={setReviewed}>我已核對目標房間與變更</WorkspaceCheckbox>
      <Button size="sm" variant="danger" isDisabled={busy || !reviewed || preview.kind === 'close' && closeRoom !== preview.channel || preview.passwordMode === 'set' && !password} onPress={() => void execute()}>確認變更</Button><Button size="sm" variant="ghost" onPress={clear}>取消預覽</Button>
    </div> : <Button size="sm" variant="secondary" isDisabled={busy || !state.room?.joined} onPress={() => void prepare()}>預覽房間設定</Button>}
    {error && <p role="status">{error}</p>}
  </details>
}
