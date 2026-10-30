import test from 'node:test'
import assert from 'node:assert/strict'
import { ManualPool } from '../src/main/manual-pool.ts'
const profile={beatmapId:'123',roomMods:['NF'],freemod:false,individualModsPolicy:'disabled',ruleset:'current',revision:'v1'}
test('invalid entries are isolated and never change a valid profile or imply default FM rules',()=>{
  const pool=new ManualPool()
  pool.replace({revision:pool.state.revision,entries:[{id:'nm1',label:'NM1',profile},{id:'fm1',label:'FM1',profile:{...profile,freemod:true}},{id:'dt1',label:'DT1',profile:{...profile,roomMods:['DT','HT']}}]})
  const state=pool.state
  assert.deepEqual(pool.profile({revision:state.revision,entryId:'nm1'}),profile)
  assert.throws(()=>pool.profile({revision:state.revision,entryId:'fm1'}))
  assert.throws(()=>pool.profile({revision:state.revision,entryId:'dt1'}))
  assert.equal(state.entries[1].profile,null);assert.ok(state.entries[1].error)
  state.entries[0].profile!.roomMods.push('HT')
  assert.deepEqual(pool.profile({revision:state.revision,entryId:'nm1'}).roomMods,['NF'])
})
test('pool writes are bounded, atomic and versioned; clearing invalidates old selection',()=>{
  const pool=new ManualPool(),revision=pool.state.revision
  pool.replace({revision,entries:[{id:'nm1',label:'NM1',profile}]})
  assert.throws(()=>pool.replace({revision,entries:[]}))
  for(const entries of [[{id:'a',label:'A',profile},{id:'a',label:'B',profile}],[{id:'a',label:'A',profile},{id:'b',label:'a',profile}],[{id:'a',label:'X\nY',profile}],Array(201).fill({id:'a',label:'A',profile})])assert.throws(()=>pool.replace({revision:pool.state.revision,entries}))
  assert.equal(pool.state.entries.length,1)
  const old=pool.state.revision;pool.clear();assert.equal(pool.state.entries.length,0);assert.throws(()=>pool.profile({revision:old,entryId:'nm1'}))
})
