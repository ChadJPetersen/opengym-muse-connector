import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const port=18765;
const token='x'.repeat(35);
const child=spawn(process.execPath,['src/server.mjs'],{env:{
  ...process.env,PORT:String(port),LISTEN_HOST:'127.0.0.1',
  CONNECTOR_BEARER_TOKEN:token,OPENGYM_URL:'http://127.0.0.1:1',
  OPENGYM_BEARER_TOKEN:'fake-token'
},stdio:'pipe'});
try{
  let running=false;
  for(let i=0;i<30;i++){
    try{await fetch('http://127.0.0.1:'+port+'/mcp');running=true;break;}
    catch{await delay(100);}
  }
  assert.ok(running,'server started');
  const send=async(t,body)=>fetch('http://127.0.0.1:'+port+'/mcp',{
    method:'POST',headers:{Authorization:t, 'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
  assert.equal((await send('Bearer wrong',{jsonrpc:'2.0',id:1,method:'tools/list'})).status,401);
  let result=await send('Bearer '+token,{jsonrpc:'2.0',id:1,method:'initialize'});
  assert.equal((await result.json()).result.serverInfo.name,'opengym-muse-bridge');
  result=await send('Bearer '+token,{jsonrpc:'2.0',id:2,method:'tools/list'});
  assert.deepEqual((await result.json()).result.tools.map(x=>x.name),['workout_summary','recent_workouts','training_plan']);
  result=await send('Bearer '+token,{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'unknown'}});
  assert.equal((await result.json()).error.code,-32602);
  result=await send('Bearer '+token,{jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'workout_summary',arguments:{days:30}}});
  assert.equal((await result.json()).result.isError,true);
  console.log('openGym Muse connector basic API tests passed');
}finally{child.kill();}
