import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { contextSchema } from '../src/shared/oclr-context.ts'
import { checkContext, contextEntry } from '../src/main/context-gate.ts'
import type { ContextLocalEvidence } from '../src/main/context-gate.ts'
import { ContextReader } from '../src/main/context-reader.ts'
import { OclrError } from '../src/main/oclr-http.ts'
const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/oclr-context.json',import.meta.url),'utf8'))
const context=()=>contextSchema.parse(fixture()).data
function local():ContextLocalEvidence {
  const c=context(),lineup=c.teams.flatMap((s,index)=>s.team!.roster.map((p,i)=>({osuId:p.osuId,teamId:s.team!.id,slot:index*2+i+1})))
  return {sessionActive:true,ircOnline:true,fresh:true,subjectId:c.viewer.osuId,ircUsername:c.viewer.username,connectionGeneration:1,noLocalLobbyReference:true,recoveryReviewed:true,entryId:c.pool!.entries[0].id,lineup,teamColours:[],lineupChanged:false,policyReviewed:false,individualModsReviewed:false,confirmationFingerprint:null,roomAgeMs:0,permissionAgeMs:0,
    room:{id:9,epoch:1,channel:'#mp_9',kind:'match',joined:true,binding:'verified',referee:'listed',name:'Synthetic',mode:'TeamVs · ScoreV2',players:4,members:[],syncState:'complete',observedAt:new Date().toISOString(),slotsVerified:true,phase:'idle',beatmap:{id:c.pool!.entries[0].beatmapId,title:'Synthetic'},mods:['NF','HD'],slots:lineup.map(p=>({slot:p.slot,osuId:p.osuId,username:'Synthetic',status:'Ready',team:p.slot<=2?'red':'blue',host:false}))}}
}
test('candidate context validates complete draft and rejects mixed identities, permissions and links',()=>{
  context()
  for(const mutate of [(v:any)=>v.data.viewer.osuId=1,(v:any)=>v.data.teams[1].team.roster[0].osuId=v.data.teams[0].team.roster[0].osuId,(v:any)=>delete v.data.requiredLocalChecks.start_game,(v:any)=>v.data.links.reviewUrl='https://example.com',(v:any)=>v.data.officials.streaming.confirmedFor.scheduledAt='2026-10-29T12:00:00Z',(v:any)=>v.data.freshUntil='2026-10-27T04:01:00Z',(v:any)=>v.data.lobby.teamColourAssignments[1].colour='red']){const value=fixture();mutate(value);assert.equal(contextSchema.safeParse(value).success,false)}
})
test('create never requires nonexistent room; omitted/unknown checks cannot bypass the fixed minimum',()=>{
  const c=context(),evidence={...local(),room:null,roomAgeMs:null,permissionAgeMs:null}
  assert.equal(checkContext(c,'create_lobby',evidence).allowed,true)
  c.requiredLocalChecks.create_lobby=[]
  assert.equal(checkContext(c,'create_lobby',{...evidence,ircUsername:'Other_Referee'}).allowed,false)
  c.requiredLocalChecks.create_lobby=['future_check']
  assert.ok(checkContext(c,'create_lobby',evidence).reasons.includes('LOCAL_CHECK:future_check'))
  assert.equal(checkContext(context(),'create_lobby',{...evidence,recoveryReviewed:false}).allowed,false)
  assert.equal(checkContext(context(),'create_lobby',{...evidence,ircOnline:false}).allowed,false)
})
test('context identity matching is automatic and uses the same osu! name equivalence',()=>{
  const c=context(),evidence={...local(),room:null,roomAgeMs:null,permissionAgeMs:null}
  for(const name of [c.viewer.username.toLowerCase().replaceAll(' ','_'),c.viewer.username.toUpperCase().replaceAll('_',' ')]){
    assert.equal(checkContext(c,'create_lobby',{...evidence,ircUsername:name}).allowed,true)
  }
  for(const changed of [{...evidence,ircUsername:'Other_Referee'},{...evidence,subjectId:c.viewer.osuId+1},{...evidence,ircOnline:false},{...evidence,sessionActive:false}]){
    assert.equal(checkContext(c,'create_lobby',changed).allowed,false)
  }
})
test('Start requires verified map/mods, eligible exact lineup, colours, fresh room and explicit policies',()=>{
  const c=context(),evidence=local();assert.equal(checkContext(c,'start_game',evidence).allowed,true)
  for(const mutate of [(e:ContextLocalEvidence)=>e.room!.mods=[],(e:ContextLocalEvidence)=>e.room!.slots[0].team='blue',(e:ContextLocalEvidence)=>e.lineup.pop(),(e:ContextLocalEvidence)=>e.roomAgeMs=10000,(e:ContextLocalEvidence)=>e.permissionAgeMs=60000,(e:ContextLocalEvidence)=>e.room!.phase='unknown',(e:ContextLocalEvidence)=>e.room!.slots[0].status='Not Ready',(e:ContextLocalEvidence)=>e.fresh=false]){const e=local();mutate(e);assert.equal(checkContext(c,'start_game',e).allowed,false)}
  c.rules!.startPolicy=null;assert.equal(checkContext(c,'start_game',evidence).allowed,false)
  c.rules!.startPolicy={streamingRequirement:'required'};c.officials.streaming.state='needs_confirmation';assert.equal(checkContext(c,'start_game',evidence).allowed,false)
})
test('H2H 1v1 does not require colours; unknown entry policies block only the selected entry',()=>{
  const c=context(),e=local();c.rules!.teamMode='head_to_head';c.rules!.playersPerTeam=1;c.rules!.roomSize=2;c.lobby.teamColourAssignments=null
  c.requiredLocalChecks.start_game=c.requiredLocalChecks.start_game.filter(s=>s!=='team_colours_verified');e.lineup=[e.lineup[0],e.lineup[2]];e.room!.slots=e.room!.slots.filter(s=>e.lineup.some(p=>p.osuId===s.osuId))
  assert.equal(checkContext(c,'start_game',e).allowed,true)
  const bad=structuredClone(c.pool!.entries[0]);bad.id='00000000-0000-4000-8000-000000000399';bad.slot='FM1';bad.position=2;bad.commandProfile!.freeMod=true;bad.commandProfile!.individualModsCheck='unknown';c.pool!.entries.push(bad)
  assert.equal(contextEntry(c,bad.id),null);assert.equal(checkContext(c,'start_game',e).allowed,true)
  e.entryId=bad.id;assert.equal(checkContext(c,'start_game',e).allowed,false)
})
test('policy revisions and local room/lineup changes invalidate fingerprints; unknown issues never grant permission',()=>{
  const c=context(),e=local(),before=checkContext(c,'start_game',e).fingerprint
  c.contextRevision='ctx_'+'b'.repeat(64);assert.notEqual(checkContext(c,'start_game',e).fingerprint,before)
  c.issues.push({code:'FUTURE_RULE',severity:'warning',path:'/rules',affectedIntents:['start_game'],message:'Unknown policy'})
  assert.equal(checkContext(c,'start_game',e).allowed,false)
  const changed=local();changed.room!.epoch++
  assert.notEqual(checkContext(context(),'start_game',changed).fingerprint,before)
  e.lineupChanged=true;c.rules!.substitutionPolicy=null;assert.equal(checkContext(c,'place_players',e).allowed,false)
})
test('reader coalesces critical preflight reads, rejects late scopes, enforces freshness and purges private data',async()=>{
  let now=1000,calls=0,release:((v:any)=>void)|undefined
  const c=context(),reader=new ContextReader(async()=>{calls++;return new Promise(resolve=>{release=resolve})},()=>now)
  const scope={subjectId:c.viewer.osuId,fixtureId:c.fixture.id,generation:1}
  reader.select(scope);const a=reader.refresh(),b=reader.refresh();assert.equal(a,b)
  await Promise.resolve();release!({value:fixture(),startedAt:1000,receivedAt:1000});await a;assert.equal(calls,1);assert.equal(reader.state.fresh,true)
  const critical=reader.preflight('start_game');await Promise.resolve();assert.equal(calls,2);reader.select({...scope,generation:2});release!({value:fixture(),startedAt:1000,receivedAt:1000});await assert.rejects(critical);assert.equal(reader.state.context,null)
  const next=reader.refresh();await Promise.resolve();release!({value:fixture(),startedAt:1000,receivedAt:1000});await next;now=31000;assert.equal(reader.state.fresh,false);now=301000;assert.equal(reader.state.context,null)
})
test('429 survives scope changes, revoked reads clear data, and wrong viewers never become current',async()=>{
  let now=1000,mode='429',calls=0
  const c=context(),reader=new ContextReader(async()=>{calls++;if(mode==='429')throw new OclrError('RATE_LIMITED',429,5000);if(mode==='403')throw new OclrError('REFEREE_ACCESS_REVOKED',403);const value=fixture();if(mode==='wrong')value.data.fixture.id='00000000-0000-4000-8000-000000000199';return {value,startedAt:now,receivedAt:now}},()=>now)
  const scope={subjectId:c.viewer.osuId,fixtureId:c.fixture.id,generation:1};reader.select(scope)
  await assert.rejects(reader.refresh());reader.select(null);reader.select(scope);await assert.rejects(reader.refresh());assert.equal(calls,1)
  now=6000;mode='ok';await reader.refresh();assert.equal(reader.state.fresh,true)
  mode='403';await assert.rejects(reader.refresh());assert.equal(reader.state.context,null)
  mode='wrong';await assert.rejects(reader.refresh());assert.equal(reader.state.context,null)
})

test('manual FM confirmation is bound to the current context and local plan fingerprint',()=>{
  const c=context(),e=local(),profile=c.pool!.entries[0].commandProfile!
  profile.freeMod=true;profile.individualModsCheck='manual';profile.policyText='Synthetic approved individual Mods policy';e.room!.mods!.push('Freemod')
  let result=checkContext(c,'start_game',e);assert.equal(result.allowed,false)
  e.individualModsReviewed=true;e.confirmationFingerprint=result.fingerprint
  assert.equal(checkContext(c,'start_game',e).allowed,true)
  c.contextRevision='ctx_'+'c'.repeat(64)
  assert.equal(checkContext(c,'start_game',e).allowed,false)
})

test('repeated cached server timestamps do not extend context freshness',async()=>{
  let now=1000
  const c=context(),reader=new ContextReader(async()=>({value:fixture(),startedAt:now,receivedAt:now}),()=>now)
  reader.select({subjectId:c.viewer.osuId,fixtureId:c.fixture.id,generation:1});await reader.refresh()
  now=21000;await reader.refresh();now=31000;assert.equal(reader.state.fresh,false)
  await assert.rejects(reader.refresh());assert.equal(reader.state.context,null)
})

test('reader scope rejects path injection before invoking transport',()=>{
  const reader=new ContextReader(async()=>{throw new Error('Must not read')})
  assert.throws(()=>reader.select({subjectId:1,fixtureId:'../admin',generation:1}))
  assert.throws(()=>reader.select({subjectId:NaN,fixtureId:context().fixture.id,generation:1}))
})
