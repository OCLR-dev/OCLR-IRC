import { uuid } from '../shared/oclr-contracts.ts'
import { contextSchema } from '../shared/oclr-context.ts'
import type { ContextSnapshot } from '../shared/oclr-context.ts'
import { OclrError } from './oclr-http.ts'
import type { HttpReply } from './oclr-http.ts'
interface Scope { subjectId:number; fixtureId:string; generation:number }
/** Injected read-only transport. Not registered as an IPC or production endpoint. */
export class ContextReader {
  private scope:Scope|null=null
  private generation=0
  private value:ContextSnapshot|null=null
  private deadline=0
  private purge=0
  private serverAt=0
  private serverAnchor=0
  private blockedUntil=0
  private purgeTimer:ReturnType<typeof setTimeout>|null=null
  private pending:Promise<ContextSnapshot>|null=null
  private controller=new AbortController()
  private read:(id:string,signal:AbortSignal)=>Promise<HttpReply>
  private now:()=>number
  constructor(read:(id:string,signal:AbortSignal)=>Promise<HttpReply>,now=()=>performance.now()){this.read=read;this.now=now}
  select(scope:Scope|null){if(scope&&(!Number.isSafeInteger(scope.subjectId)||scope.subjectId<1||!uuid.safeParse(scope.fixtureId).success||!Number.isSafeInteger(scope.generation)||scope.generation<0))throw new OclrError('INVALID_RESPONSE');if(JSON.stringify(scope)===JSON.stringify(this.scope))return;this.controller.abort();this.controller=new AbortController();this.generation++;if(this.purgeTimer)clearTimeout(this.purgeTimer);this.purgeTimer=null;this.scope=scope?{...scope}:null;this.value=null;this.deadline=this.purge=this.serverAt=this.serverAnchor=0;this.pending=null}
  get selection(){return this.scope?{...this.scope}:null}
  get state(){if(this.value&&this.now()>=this.purge){this.value=null;this.deadline=0}return {context:this.value?structuredClone(this.value):null,fresh:Boolean(this.value&&this.now()<this.deadline),retryAt:this.blockedUntil>this.now()?this.blockedUntil:null}}
  refresh():Promise<ContextSnapshot>{
    if(!this.scope)return Promise.reject(new OclrError('SESSION_EXPIRED'))
    if(this.now()<this.blockedUntil)return Promise.reject(new OclrError('RATE_LIMITED',429,this.blockedUntil-this.now()))
    if(this.pending)return this.pending
    const scope={...this.scope},generation=this.generation,signal=this.controller.signal
    this.deadline=0
    const pending=(async()=>{
      try{
        const reply=await Promise.resolve().then(()=>this.read(scope.fixtureId,signal))
        if(generation!==this.generation)throw new OclrError('CANCELLED')
        if(Buffer.byteLength(JSON.stringify(reply.value),'utf8')>512*1024)throw new OclrError('INVALID_RESPONSE')
        const parsed=contextSchema.safeParse(reply.value)
        if(!parsed.success)throw new OclrError('INVALID_RESPONSE')
        const {data,meta}=parsed.data,rtt=reply.receivedAt-reply.startedAt,server=Date.parse(meta.serverTime),captured=Date.parse(data.capturedAt),fresh=Date.parse(data.freshUntil)
        if(meta.contractVersion!=='1.0.0'||data.viewer.osuId!==scope.subjectId||data.fixture.id!==scope.fixtureId||!Number.isFinite(rtt)||rtt<0||reply.receivedAt>this.now()||captured>server||server+rtt>=fresh||this.value&&captured<Date.parse(this.value.capturedAt))throw new OclrError('INVALID_RESPONSE')
        const serverNow=Math.max(server+rtt,this.serverAt?this.serverAt+reply.receivedAt-this.serverAnchor:0)
        this.serverAt=serverNow;this.serverAnchor=reply.receivedAt
        this.value=data;this.deadline=reply.receivedAt+fresh-serverNow;this.purge=reply.receivedAt+captured+300000-serverNow
        if(this.now()>=this.deadline)throw new OclrError('INVALID_RESPONSE')
        if(this.purgeTimer)clearTimeout(this.purgeTimer)
        this.purgeTimer=setTimeout(()=>{if(generation===this.generation){this.value=null;this.deadline=this.purge=0;this.purgeTimer=null}},Math.max(1,this.purge-this.now()))
        this.purgeTimer.unref()
        return structuredClone(data)
      }catch(error){
        if(generation===this.generation){this.deadline=0;if(error instanceof OclrError&&error.status===429)this.blockedUntil=Math.max(this.blockedUntil,this.now()+error.retryAfterMs)
          if(!(error instanceof OclrError)||error.status===401||error.status===403||error.status===404||error.code==='INVALID_RESPONSE'){this.value=null;this.purge=0}
        }
        throw error
      }finally{if(generation===this.generation)this.pending=null}
    })()
    this.pending=pending;return pending
  }
  async preflight(intent:string){
    if(intent==='create_lobby'||intent==='start_game'||!this.state.fresh)return this.refresh()
    return this.state.context!
  }
}
