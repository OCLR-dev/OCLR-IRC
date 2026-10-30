import { useEffect, useState } from 'react'
import { Button, Input, Label, TextField } from '@heroui/react'
import { WorkspaceCheckbox, WorkspaceSelect } from './controls'
import type { RoomPlanInput, RoomPlanPreview } from '../../shared/room-plan'
import type { Room, Snapshot } from '../../shared/types'
export function PlanControl({ room, plan }: { room: Room; plan: RoomPlanInput }) {
  const [preview,setPreview] = useState<RoomPlanPreview|null>(null), [names,setNames] = useState<string[]>([]), [reviewed,setReviewed] = useState(false), [policy,setPolicy] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState('')
  function clear() { setPreview(null); setNames([]); setReviewed(false); setPolicy(false) }
  useEffect(clear,[room.id,room.epoch,room.joined,JSON.stringify(plan)])
  useEffect(()=>{if (!preview) return; const timer=setTimeout(clear,Math.max(0,Date.parse(preview.expiresAt)-Date.now()));return ()=>clearTimeout(timer)},[preview])
  async function prepare() {
    if (!window.oclr) return
    clear();setError('');setBusy(true)
    try {const result=await window.oclr.previewRoomPlan({roomId:room.id,roomEpoch:room.epoch,plan});setPreview(result.preview??null);if(!result.ok)setError(result.error??'無法預覽。')}catch{setError('桌面服務無法回應。')}finally{setBusy(false)}
  }
  async function execute() {
    if(!window.oclr||!preview)return
    const input={roomId:room.id,roomEpoch:room.epoch,token:preview.token,reviewed,names,policyReviewed:policy};clear();setBusy(true)
    try{const result=await window.oclr.executeRoomPlan(input);if(!result.ok)setError(result.error??'計畫未開始。')}catch{setError('結果不明，請核對房間。')}finally{setBusy(false)}
  }
  return <div className="room-plan-control">{preview?<div className="mp-confirm room-plan-confirm"><strong>{preview.channel}</strong>{preview.commands.map((command,i)=><code key={i}>{i+1}. {command}</code>)}
    {preview.names.map((name,i)=><TextField key={i} value={names[i]??''} onChange={value=>setNames(items=>{const next=[...items];next[i]=value;return next})}><Label>核對玩家：{name}</Label><Input autoComplete="off" /></TextField>)}
    {preview.kind==='lineup'&&<WorkspaceCheckbox selected={policy} onChange={setPolicy}>本次出賽名單與換人時機已獲核准</WorkspaceCheckbox>}
    <WorkspaceCheckbox selected={reviewed} onChange={setReviewed}>我已核對房間與全部步驟</WorkspaceCheckbox>
    <Button size="sm" variant="danger" isDisabled={busy||!reviewed||preview.kind==='lineup'&&(!policy||preview.names.some((name,i)=>name!==names[i]))} onPress={()=>void execute()}>執行逐步計畫</Button><Button size="sm" variant="ghost" onPress={clear}>取消計畫預覽</Button>
  </div>:<Button size="sm" variant="secondary" isDisabled={busy||!room.joined} onPress={()=>void prepare()}>{plan.kind==='room'?'預覽房名與規則計畫':'預覽陣容計畫'}</Button>}{error&&<p role="alert">{error}</p>}</div>
}
export function RoomPlanControls({state}:{state:Snapshot}) {
  const [name,setName]=useState(''),[team,setTeam]=useState('2'),[score,setScore]=useState('3')
  if(!state.room)return null
  return <details className="map-profile room-initialization"><summary>連續設定房名與規則</summary><TextField name="planRoomName" value={name} onChange={setName}><Label>房間名稱</Label><Input/></TextField><WorkspaceSelect label="計畫隊伍模式" value={team} onChange={setTeam} options={['HeadToHead','TagCoop','TeamVs','TagTeamVs'].map((label,i)=>({value:String(i),label}))}/><WorkspaceSelect label="計畫計分模式" value={score} onChange={setScore} options={['Score','Accuracy','Combo','ScoreV2'].map((label,i)=>({value:String(i),label}))}/><PlanControl room={state.room} plan={{kind:'room',name,teamMode:team,scoreMode:score}}/></details>
}
export function RoomPlanProgress({state}:{state:Snapshot}) {
  const [error,setError]=useState(''),plan=state.roomPlan?.roomId===state.room?.id?state.roomPlan:null
  if(!plan)return null
  const labels={queued:'待送出',sending:'正在送出',awaiting:'等待讀回',observed:'已核對設定',unknown:'結果不明',failed:'未送出',cancelled:'已取消'}
  async function cancel(){try{const result=await window.oclr?.cancelRoomPlan({id:plan!.id});if(!result?.ok)setError(result?.error??'停止失敗。')}catch{setError('桌面服務無法回應。')}}
  return <div className="profile-progress room-plan-progress" role="status">{plan.steps.map((step,i)=><p key={i}>{i+1}. {step.command} · {labels[step.state]}</p>)}{['queued','sending','awaiting'].includes(plan.state)&&<Button size="sm" variant="danger" onPress={()=>void cancel()}>停止剩餘計畫</Button>}{error&&<p role="alert">{error}</p>}</div>
}
