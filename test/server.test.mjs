import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../src/server.mjs';
import {parseInstance,isPublicIPv4,resolvePublicIPv4,tokenFromHeader,selectTool} from '../src/lib.mjs';

const base='https://fitness.example.org/opengym';
const url='http://127.0.0.1:';
const token1='my-opengym-account-one-123456';
const token2='my-opengym-account-two-123456';
const stateFor=token=>({
  workouts:[{id:'1',d:'2026-10-24',name:token===token1?'Lower A':'Upper B',
    entries:[{id:'squat',sets:[{w:65,r:8,done:true},{w:70,r:9,done:false},{w:70,r:6,done:true}]}]}],
  routines:[{id:'r1',name:token===token1?'Glutes':'Upper',ex:[{id:'squat',sets:3,reps:8}]}],
  week:{'1':['r1']},
  bodyweight:[{d:'2026-10-24',w:99}],
  secret_notes:'never return this'
});
const rpc=(method,params={},id=1)=>({jsonrpc:'2.0',id,method,params});
test('URL allowlist rejects private endpoints, credentials, ports and bad paths',()=>{
  assert.equal(parseInstance(base),base);
  assert.equal(parseInstance('https://fitness.example.org/'), 'https://fitness.example.org');
  for(const bad of [
    'http://fitness.example.org','https://127.0.0.1',
    'https://[::1]/','https://localhost','https://api.local',
    'https://router.home.arpa','https://example.org:8080',
    'https://user:password@example.org','https://example.org/?token=123',
    'https://example.org/%2e%2e/secret','https://example.org/#hi',
    'https://example.org:8443'
  ]) assert.throws(()=>parseInstance(bad),undefined,bad);
});
test('all resolved addresses must be public and pinned',async()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','172.18.0.1','192.168.1.5','169.254.169.254','100.99.12.4','203.0.113.10','192.0.2.5','198.51.100.2','0.0.0.0','224.0.0.1']){
    assert.equal(isPublicIPv4(ip),false,ip);
  }
  assert.equal(isPublicIPv4('8.8.8.8'),true);
  await assert.rejects(resolvePublicIPv4('gym.example.org',async()=>[{address:'8.8.8.8'},{address:'127.0.0.1'}]));
  assert.equal(await resolvePublicIPv4('gym.example.org',async()=>[{address:'8.8.8.8'}]),'8.8.8.8');
});
test('bearer format and data projection protect secrets',()=>{
  assert.equal(tokenFromHeader('Basic hello'),null);
  assert.equal(tokenFromHeader('Bearer hello'),null);
  assert.equal(tokenFromHeader('Bearer '+token1),token1);
  const recent=selectTool(stateFor(token1),'recent_workouts',{limit:1});
  const text=JSON.stringify(recent);
  assert.match(text,/squat/);
  assert.doesNotMatch(text,/never return this|bodyweight|secret_notes/);
  assert.equal(recent.workouts[0].exercises[0].completed_sets.length,2);
  assert.equal(selectTool(stateFor(token1),'training_plan').routines[0].name,'Glutes');
  assert.throws(()=>selectTool(stateFor(token1),'recent_workouts',{limit:-1}));
});
test('MCP HTTP is stateless, per-account, read-only and rejects invalid requests',async t=>{
  const seen=[];
  const server=createServer({readState:async(instance,token)=>{
    seen.push({instance,token});
    return stateFor(token);
  }});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const endpoint=url+server.address().port+'/mcp?instance='+encodeURIComponent(base);
  const send=(auth,body,extra={})=>fetch(endpoint,{
    method:'POST',headers:{Authorization:auth,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...extra},
    body:JSON.stringify(body)
  });
  let r=await send('',rpc('tools/list'));
  assert.equal(r.status,401);
  assert.ok(!(await r.text()).includes(token1));
  r=await send('Bearer '+token1,rpc('initialize',{protocolVersion:'2025-11-25'}));
  assert.equal((await r.json()).result.protocolVersion,'2025-11-25');
  r=await send('Bearer '+token1,rpc('tools/list'));
  assert.deepEqual((await r.json()).result.tools.map(x=>x.name),['workout_summary','recent_workouts','training_plan']);
  r=await send('Bearer '+token1,rpc('tools/call',{name:'training_plan'}));
  assert.match((await r.text()),/Glutes/);
  r=await send('Bearer '+token2,rpc('tools/call',{name:'training_plan'}));
  const data=await r.text();
  assert.match(data,/Upper/); assert.doesNotMatch(data,/Glutes/);
  assert.deepEqual(seen,[{instance:base,token:token1},{instance:base,token:token2}]);
  r=await send('Bearer '+token1,rpc('tools/call',{name:'write_workout'}));
  assert.equal((await r.json()).error.code,-32602);
  r=await send('Bearer '+token1,rpc('tools/call',{name:'recent_workouts',arguments:{limit:0}}));
  assert.equal((await r.json()).result.isError,true);
  assert.equal(seen.length,3);
  r=await send('Bearer '+token1,rpc('ping'),{Origin:'https://untrusted.site'});
  assert.equal(r.status,403);
  r=await fetch(endpoint,{method:'GET',headers:{Authorization:'Bearer '+token1}});
  assert.equal(r.status,405);
  r=await send('Bearer '+token1,rpc('notifications/initialized',{},undefined));
  // Explicit notifications have no ID and must receive 202.
  r=await send('Bearer '+token1,{jsonrpc:'2.0',method:'notifications/initialized'});
  assert.equal(r.status,202);
});
