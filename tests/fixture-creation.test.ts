import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { readFileSync } from 'node:fs'
import { IrcSession } from '../src/main/irc.ts'
import { Lines } from '../src/main/protocol.ts'
import { ContextReader } from '../src/main/context-reader.ts'
import { FixtureCreation } from '../src/main/fixture-creation.ts'
import type { ContextLocalEvidence } from '../src/main/context-gate.ts'
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(fn:()=>boolean){for(let i=0;i<400;i++){if(fn())return;await pause(5)}throw new Error('Creation timed out')}
async function fixture(brokenStore=false){
  let peer:net.Socket,reads=0,now=1000,barrier:Promise<void>|null=null,release:(()=>void)|null=null
  const data=JSON.parse(readFileSync(new URL('./fixtures/oclr-context.json',import.meta.url),'utf8')),sent:string[]=[],events:string[]=[],sockets=new Set<net.Socket>()
  const server=net.createServer(socket=>{peer=socket;sockets.add(socket);socket.on('close',()=>sockets.delete(socket));const lines=new Lines();socket.on('data',chunk=>{for(const line of lines.feed(chunk)){
    sent.push(line)
    if(line.startsWith('USER '))socket.write(':server 001 Example_Referee :welcome\n')
    if(line.startsWith('JOIN '))socket.write(':server 366 Example_Referee #mp_9 :End\n')
    if(line.endsWith(':!mp settings'))socket.write(`:BanchoBot PRIVMSG #mp_9 :Room name: ${data.data.lobby.roomName}, History: https://osu.ppy.sh/mp/9\n:BanchoBot PRIVMSG #mp_9 :Team mode: TeamVs, Win condition: ScoreV2\n:BanchoBot PRIVMSG #mp_9 :Players: 0\n`)
    if(line.endsWith(':!mp listrefs'))socket.write(':BanchoBot PRIVMSG #mp_9 :Match referees: Example_Referee\n')
  }})})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const irc=new IrcSession(()=>net.createConnection({host:'127.0.0.1',port:(server.address() as net.AddressInfo).port}),{floodMs:5,creationMs:500,queryMs:300,retryBaseMs:20})
  irc.setCreationStore({latest(){return null},begin(){if(brokenStore)throw new Error('disk full');events.push('persisted')},complete(){events.push('completed')}})
  irc.login({username:'Example_Referee',password:'SYNTHETIC_ONLY'});await until(()=>irc.state.connection==='online')
  const reader=new ContextReader(async()=>{reads++;if(barrier)await barrier;return {value:structuredClone(data),startedAt:now,receivedAt:now}},()=>now)
  const scope={fixtureId:data.data.fixture.id,subjectId:data.data.viewer.osuId,generation:1};reader.select(scope)
  const evidence:ContextLocalEvidence={sessionActive:true,ircOnline:true,fresh:true,subjectId:scope.subjectId,ircUsername:'Example_Referee',connectionGeneration:irc.sessionGeneration,room:null,roomAgeMs:null,permissionAgeMs:null,noLocalLobbyReference:true,recoveryReviewed:true,entryId:null,lineup:[],teamColours:[],lineupChanged:false,policyReviewed:false,individualModsReviewed:false,confirmationFingerprint:null}
  const controller=new FixtureCreation(reader,irc,()=>({...evidence}),id=>events.push(`private:${id}`),()=>now)
  return {irc,reader,controller,data,evidence,sent,events,scope,reads:()=>reads,holdReads:()=>{barrier=new Promise<void>(resolve=>{release=resolve})},resumeReads:()=>{barrier=null;release?.()},setNow:(value:number)=>{now=value},reply:(sender='BanchoBot',name=data.data.lobby.roomName)=>peer.write(`:${sender} PRIVMSG Example_Referee :Created the tournament match https://osu.ppy.sh/mp/9 ${name}\n`),async close(){controller.dispose();reader.select(null);irc.logout();for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()))}}
}
test('fixture creation rereads before a single persisted make and associates only trusted matching completion',async()=>{
  const f=await fixture();try{
    const preview=await f.controller.prepare();assert.equal(f.sent.some(line=>line.includes(':!mp make ')),false)
    const first=f.controller.execute({token:preview.token,reviewed:true})
    await assert.rejects(f.controller.execute({token:preview.token,reviewed:true}));await first
    await until(()=>f.sent.some(line=>line.includes(':!mp make ')))
    assert.equal(f.reads(),2);assert.deepEqual(f.events,['persisted']);assert.equal(f.controller.state!.status,'awaiting')
    assert.equal(f.irc.state.operations?.records.at(-1)?.source,'oclr')
    f.reply('OtherUser');f.reply('BanchoBot','Wrong room');await pause(20);assert.equal(f.controller.state!.status,'awaiting')
    f.reply();await until(()=>f.controller.state?.status==='created');await until(()=>f.sent.some(line=>line.endsWith(':!mp listrefs')))
    assert.equal(f.controller.state!.fixtureId,f.scope.fixtureId);assert.equal(f.controller.state!.roomId,9)
    assert.deepEqual(f.events,['persisted','completed','private:9'])
    assert.equal(f.sent.filter(line=>line.includes(':!mp make ')).length,1)
    assert.equal(f.sent.some(line=>/:!mp (map|mods|start|set) /.test(line)),false)
    await assert.rejects(f.controller.prepare())
  }finally{await f.close()}
})
test('changed context, expired preview, identity mismatch and unavailable persistence send no make',async()=>{
  for(const mode of ['revision','expired','identity','storage','cancel','dispose']){const f=await fixture(mode==='storage');try{
    const preview=await f.controller.prepare()
    if(mode==='revision')f.data.data.contextRevision='ctx_'+'b'.repeat(64)
    if(mode==='expired')f.setNow(11000)
    if(mode==='identity')f.evidence.subjectId++
    if(mode==='cancel')f.controller.cancelPreview()
    if(mode==='dispose')f.controller.dispose()
    await assert.rejects(f.controller.execute({token:preview.token,reviewed:true}))
    assert.equal(f.sent.some(line=>line.includes(':!mp make ')),false)
    if(mode==='storage')assert.equal(f.controller.state?.status,'failed')
  }finally{await f.close()}}
})
test('timeout stays unknown without replay; context change clears source but still quarantines a late-created room',async()=>{
  const f=await fixture();try{
    const preview=await f.controller.prepare();await f.controller.execute({token:preview.token,reviewed:true})
    await until(()=>f.controller.state?.status==='unknown');await assert.rejects(f.controller.prepare());await pause(50)
    assert.equal(f.sent.filter(line=>line.includes(':!mp make ')).length,1)
  }finally{await f.close()}
  const changed=await fixture();try{
    const preview=await changed.controller.prepare();await changed.controller.execute({token:preview.token,reviewed:true})
    changed.reader.select(null);assert.equal(changed.controller.state,null)
    changed.reply();await until(()=>changed.events.includes('private:9'))
    assert.equal(changed.controller.state,null)
  }finally{await changed.close()}
})

test('cancel, disposal and selection changes during dispatch preflight never send a late make',async()=>{
  for(const mode of ['cancel','dispose','scope']){const f=await fixture();try{
    const preview=await f.controller.prepare();f.holdReads()
    const dispatch=f.controller.execute({token:preview.token,reviewed:true});const rejected=assert.rejects(dispatch)
    await until(()=>f.reads()===2)
    if(mode==='cancel')f.controller.cancelPreview()
    if(mode==='dispose')f.controller.dispose()
    if(mode==='scope')f.reader.select(null)
    f.resumeReads();await rejected
    assert.equal(f.sent.some(line=>line.includes(':!mp make ')),false)
  }finally{await f.close()}}
})
