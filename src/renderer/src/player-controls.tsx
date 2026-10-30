import { useEffect, useState } from 'react'
import { Button, Input, Label, TextField } from '@heroui/react'
import { WorkspaceCheckbox, WorkspaceSelect } from './controls'
import type { LobbyPreview, PlayerIntent } from '../../shared/lobby-command'
import type { Snapshot } from '../../shared/types'
export function PlayerControls({ state }: { state: Snapshot }) {
  const [kind, setKind] = useState<PlayerIntent['kind']>('invite'), [uid, setUid] = useState(''), [name, setName] = useState(''), [slot, setSlot] = useState(''), [team, setTeam] = useState('')
  const [preview, setPreview] = useState<LobbyPreview | null>(null), [confirmName, setConfirmName] = useState(''), [reviewed, setReviewed] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  function clear() { setPreview(null); setConfirmName(''); setReviewed(false) }
  useEffect(clear, [kind, uid, name, slot, team, state.room?.id, state.room?.epoch, state.connection])
  useEffect(() => { if (!preview) return; const timer = setTimeout(clear, Math.max(0, Date.parse(preview.expiresAt) - Date.now())); return () => clearTimeout(timer) }, [preview])
  async function prepare() {
    if (!window.oclr || !state.room) return
    clear(); setBusy(true); setMessage('')
    const intent: PlayerIntent = kind === 'invite' ? {kind,osuId:uid,name} : kind === 'move' ? {kind,osuId:uid,slot} : kind === 'team' ? {kind,osuId:uid,team:team as 'red'|'blue'} : {kind,osuId:uid}
    try { const result = await window.oclr.previewLobby({roomId:state.room.id,roomEpoch:state.room.epoch,intent}); setPreview(result.preview ?? null); if (!result.ok) setMessage(result.error ?? '無法預覽。') } catch { setMessage('桌面服務無法回應。') } finally { setBusy(false) }
  }
  async function execute() {
    if (!window.oclr || !state.room || !preview) return
    const input = {roomId:state.room.id,roomEpoch:state.room.epoch,token:preview.token,reviewed,playerName:confirmName}; clear(); setBusy(true)
    try { const result = await window.oclr.executeLobby(input); setMessage(result.ok ? '已送出，等待核對。' : result.error ?? '無法送出。') } catch { setMessage('結果不明，請核對房間。') } finally { setBusy(false) }
  }
  const disabled = busy || Boolean(preview)
  return <details className="map-profile player-controls"><summary>手動玩家操作</summary>
    <WorkspaceSelect label="玩家操作" value={kind} onChange={value => {setKind(value as PlayerIntent['kind']);setUid('')}} disabled={disabled} options={[{value:'invite',label:'邀請玩家'},{value:'move',label:'移動槽位'},{value:'team',label:'更換隊伍'},{value:'kick',label:'移出房間'}]} />
    {kind === 'invite' ? <><TextField name="inviteUid" value={uid} onChange={setUid} isDisabled={disabled}><Label>osu! UID</Label><Input inputMode="numeric" /></TextField><TextField name="inviteName" value={name} onChange={setName} isDisabled={disabled}><Label>玩家名稱</Label><Input /></TextField></> : <WorkspaceSelect label="目前玩家" value={uid} onChange={setUid} disabled={disabled} options={(state.room?.slots ?? []).map(player=>({value:String(player.osuId),label:`${player.username} · #${player.osuId}`}))} />}
    {kind === 'move' && <WorkspaceSelect label="目標槽位" value={slot} onChange={setSlot} disabled={disabled} options={Array.from({length:16},(_,i)=>({value:String(i+1),label:String(i+1)}))} />}
    {kind === 'team' && <WorkspaceSelect label="目標隊伍" value={team} onChange={setTeam} disabled={disabled} options={[{value:'red',label:'紅隊'},{value:'blue',label:'藍隊'}]} />}
    {preview ? <div className="mp-confirm"><strong>{preview.channel} · {preview.playerName}</strong><code>{preview.command}</code><TextField name="confirmPlayer" value={confirmName} onChange={setConfirmName}><Label>輸入玩家名稱以核對 UID</Label><Input autoComplete="off" /></TextField><WorkspaceCheckbox selected={reviewed} onChange={setReviewed}>我已核對房間、玩家身份與變更</WorkspaceCheckbox><Button size="sm" variant="danger" isDisabled={busy || !reviewed || confirmName !== preview.playerName} onPress={() => void execute()}>確認玩家操作</Button><Button size="sm" variant="ghost" onPress={clear}>取消預覽</Button></div> : <Button size="sm" variant="secondary" isDisabled={busy || !state.room?.joined} onPress={() => void prepare()}>預覽玩家操作</Button>}
    {message && <p role="status">{message}</p>}
  </details>
}
