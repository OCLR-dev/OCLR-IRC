import { randomUUID } from 'node:crypto'
import { ContextReader } from './context-reader.ts'
import { checkContext } from './context-gate.ts'
import type { ContextLocalEvidence } from './context-gate.ts'
import type { Snapshot, RoomTarget } from '../shared/types.ts'
interface CreationPort {
  readonly state:Snapshot; readonly sessionGeneration:number
  createWebsiteRoom(input:{name:string;requestId:string;reviewed:boolean},onDispatch?:()=>void):void
  relayRefresh(target:RoomTarget):void
  on(event:'state',listener:()=>void):unknown
  off(event:'state',listener:()=>void):unknown
}
export interface FixtureCreationPreview { token:string; fixtureId:string; fixtureLabel:string; ircUsername:string; name:string; command:string }
interface Source { fixtureId:string; subjectId:number; status:'awaiting'|'created'|'unknown'|'failed'; roomId:number|null }
/** Candidate coordinator: instantiate only with authorized context and a journal privacy hook. No IPC registration. */
export class FixtureCreation {
  private reader:ContextReader
  private irc:CreationPort
  private evidence:()=>ContextLocalEvidence
  private privateRoom:(roomId:number)=>void
  private now:()=>number
  private closed=false
  private prepareGeneration=0
  private preview:{value:FixtureCreationPreview;scope:string;fingerprint:string;requestId:string;deadline:number}|null=null
  private source:Source|null=null
  private sourceScope=''
  private pending:{requestId:string;generation:number;seenAwaiting:boolean}|null=null
  private refreshed=false
  constructor(reader:ContextReader,irc:CreationPort,evidence:()=>ContextLocalEvidence,privateRoom:(roomId:number)=>void,now=()=>performance.now()){
    this.reader=reader;this.irc=irc;this.evidence=evidence;this.privateRoom=privateRoom;this.now=now;irc.on('state',this.observe)
  }
  private scope(){return JSON.stringify([this.reader.selection,this.irc.sessionGeneration,this.irc.state.username])}
  private local():ContextLocalEvidence {
    const irc=this.irc.state,provided=this.evidence()
    return {...provided,fresh:this.reader.state.fresh,ircOnline:irc.connection==='online',ircUsername:irc.username,connectionGeneration:this.irc.sessionGeneration,noLocalLobbyReference:provided.noLocalLobbyReference&&irc.creation.status==='unreviewed'&&irc.creation.roomId===null&&!this.source}
  }
  get state(){if(this.sourceScope&&this.sourceScope!==this.scope()){this.source=null;this.preview=null}return this.source?{...this.source}:null}
  async prepare():Promise<FixtureCreationPreview>{
    if(this.closed)throw new Error('控制器已關閉。')
    this.preview=null;const generation=++this.prepareGeneration,scope=this.scope()
    if(this.state||this.pending)throw new Error('已有開房結果待核對。')
    const context=await this.reader.preflight('create_lobby')
    if(this.closed||generation!==this.prepareGeneration||scope!==this.scope())throw new Error('場次或帳號已變更。')
    const gate=checkContext(context,'create_lobby',this.local())
    if(!gate.allowed)throw new Error(gate.reasons.join('；'))
    const value={token:randomUUID(),fixtureId:context.fixture.id,fixtureLabel:context.fixture.label,ircUsername:this.irc.state.username,name:context.lobby.roomName!,command:`!mp make ${context.lobby.roomName}`}
    this.preview={value,scope,fingerprint:gate.fingerprint,requestId:this.irc.state.creation.requestId,deadline:this.now()+10000}
    return {...value}
  }
  async execute(input:unknown){
    const preview=this.preview;this.preview=null
    if(this.closed||!preview||!input||typeof input!=='object'||(input as {token?:unknown}).token!==preview.value.token||(input as {reviewed?:unknown}).reviewed!==true||this.now()>=preview.deadline||preview.scope!==this.scope())throw new Error('開房確認已失效。')
    const generation=++this.prepareGeneration
    const context=await this.reader.preflight('create_lobby')
    const gate=checkContext(context,'create_lobby',this.local())
    if(this.closed||generation!==this.prepareGeneration||!gate.allowed||gate.fingerprint!==preview.fingerprint||preview.scope!==this.scope()||this.now()>=preview.deadline||this.irc.state.creation.requestId!==preview.requestId)throw new Error('場次、權限或開房狀態已變更，請重新核對。')
    this.source={fixtureId:context.fixture.id,subjectId:context.viewer.osuId,status:'awaiting',roomId:null};this.sourceScope=preview.scope;this.refreshed=false
    let dispatched=false
    try{this.irc.createWebsiteRoom({name:preview.value.name,requestId:preview.requestId,reviewed:true},()=>{
      dispatched=true;this.pending={requestId:preview.requestId,generation:this.irc.sessionGeneration,seenAwaiting:true}
    })}catch(error){if(this.source)this.source.status=dispatched?'unknown':'failed';this.pending=null;throw error}
    this.observe()
  }
  private observe=()=>{
    const state=this.irc.state,pending=this.pending
    // Context privacy is cleared immediately on scope change, but minimal pending
    // metadata can still exclude a late-created room from IRC-only journaling.
    void this.state
    if(pending){
      if(this.irc.sessionGeneration!==pending.generation||state.connection!=='online'){if(this.source)this.source.status='unknown';this.pending=null;return}
      if(state.creation.status==='awaiting'&&state.creation.requestId===pending.requestId)pending.seenAwaiting=true
      else if(pending.seenAwaiting&&['created','blocked'].includes(state.creation.status)&&state.creation.roomId!==null){
        this.pending=null
        try{this.privateRoom(state.creation.roomId)}catch{if(this.source)this.source.status='unknown';return}
        if(this.source){this.source.roomId=state.creation.roomId;this.source.status=state.creation.status==='created'?'created':'unknown'}
      }else if(state.creation.status==='unknown'||state.creation.status==='blocked'){if(this.source)this.source.status='unknown';this.pending=null}
    }
    if(this.source?.status==='created'&&!this.refreshed&&state.room?.id===this.source.roomId&&state.room.joined){
      this.refreshed=true
      try{this.irc.relayRefresh({roomId:state.room.id,roomEpoch:state.room.epoch})}catch{this.source.status='unknown'}
    }
  }
  cancelPreview(){this.preview=null;this.prepareGeneration++}
  dispose(){this.closed=true;this.irc.off('state',this.observe);this.preview=null;this.source=null;this.pending=null;this.prepareGeneration++}
}
