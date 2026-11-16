import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { IrcSession } from '../src/main/irc.ts'
import { Lines } from '../src/main/protocol.ts'
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(fn:()=>boolean){for(let i=0;i<600;i++){if(fn())return;await pause(10)}throw new Error('Plan timeout')}
async function fixture(mode='success') {
  let name='Initial',team='HeadToHead'
  const sent:string[]=[],sockets=new Set<net.Socket>()
  const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));const lines=new Lines();socket.on('data',chunk=>{for(const line of lines.feed(chunk)){
    sent.push(line)
    if(line.startsWith('USER '))socket.write(':server 001 Example :welcome\n')
    if(line.startsWith('JOIN '))socket.write(':server 366 Example #mp_9 :End\n')
    if(line.includes(':!mp name ')){if(mode!=='wrong-name')name=line.split(':!mp name ')[1];if(mode==='disconnect'){socket.destroy();continue}}
    if(line.includes(':!mp set ')&&mode!=='wrong-mode')team='TeamVs'
    if(line.endsWith(':!mp settings')&&!(mode==='timeout'&&name!=='Initial'))socket.write([
      `Room name: ${name}, History: https://osu.ppy.sh/mp/9`, `Team mode: ${team}, Win condition: ScoreV2`, 'Players: 1', `Slot 1 Ready https://osu.ppy.sh/u/101 Synthetic [Host / Team Red]`
    ].map(body=>`:BanchoBot PRIVMSG #mp_9 :${body}\n`).join(''))
    if(line.endsWith(':!mp listrefs'))socket.write(':BanchoBot PRIVMSG #mp_9 :Match referees: Example\n')
  }})})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const session=new IrcSession(()=>net.createConnection({host:'127.0.0.1',port:(server.address() as net.AddressInfo).port}),{floodMs:10,queryMs:300,retryBaseMs:20})
  session.login({username:'Example',password:'SYNTHETIC_ONLY'});await until(()=>session.state.connection==='online');session.join('9');await until(()=>Boolean(session.state.room?.joined));await pause(20)
  const target=()=>({roomId:9,roomEpoch:session.state.room!.epoch})
  session.query({...target(),kind:'settings'});await until(()=>session.state.room?.syncState==='partial');await pause(20);session.query({...target(),kind:'listrefs'});await until(()=>session.state.room?.referee==='listed');await pause(20)
  const start=(plan:unknown)=>{const preview=session.previewRoomPlan({...target(),plan});session.executeRoomPlan({...target(),token:preview.token,reviewed:true});return preview}
  return {session,target,sent,start,async close(){session.logout();for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()))}}
}
const initialization={kind:'room',name:'SYNTHETIC new',teamMode:'2',scoreMode:'3'}
test('mapless room initialization applies name then rules with independent fresh observations',async()=>{
  const f=await fixture();try{
    const preview=f.start(initialization)
    assert.throws(()=>f.session.executeRoomPlan({...f.target(),token:preview.token,reviewed:true}))
    await until(()=>f.session.state.roomPlan?.state==='observed')
    assert.deepEqual(f.sent.filter(line=>/:!mp (name|set) /.test(line)),['PRIVMSG #mp_9 :!mp name SYNTHETIC new','PRIVMSG #mp_9 :!mp set 2 3'])
    assert.deepEqual(f.session.state.roomPlan!.steps.map(s=>s.state),['observed','observed'])
  }finally{await f.close()}
})
test('wrong effects, missing replies and disconnect stop unsent initialization without replay',async()=>{
  for(const mode of ['wrong-name','wrong-mode','timeout','disconnect']){const f=await fixture(mode);try{
    f.start(initialization);await until(()=>f.session.state.roomPlan?.state==='unknown')
    assert.equal(f.sent.filter(line=>line.includes(':!mp name ')).length,1)
    assert.equal(f.sent.filter(line=>line.includes(':!mp set ')).length,mode==='wrong-mode'?1:0)
    if(mode==='wrong-mode')assert.equal(f.session.state.roomPlan!.steps[0].state,'observed')
    await pause(100);assert.equal(f.sent.filter(line=>line.includes(':!mp name ')).length,1)
  }finally{await f.close()}}
})
test('cancel and human review stop queued plan steps without pretending to undo sent changes',async()=>{
  const f=await fixture('timeout');try{
    f.start(initialization);f.session.reviewOperation({id:f.session.state.roomPlan!.id,reviewed:true})
    assert.equal(f.session.state.roomPlan!.state,'unknown');assert.equal(f.session.state.roomPlan!.steps[1].state,'cancelled')
    await pause(100);assert.equal(f.sent.some(line=>line.includes(':!mp set ')),false)
  }finally{await f.close()}
})

test('removed manual lineup plans cannot preview or dispatch', async () => {
  const f = await fixture()
  try {
    const plan = {kind:'lineup', players:[{osuId:101, slot:4, team:'blue'}]}
    assert.throws(() => f.session.previewRoomPlan({...f.target(), plan}), /不支援此逐步計畫/)
    assert.equal(f.session.state.roomPlan, null)
    assert.equal(f.sent.some(line => /:!mp (move|team) /.test(line)), false)
  } finally { await f.close() }
})
