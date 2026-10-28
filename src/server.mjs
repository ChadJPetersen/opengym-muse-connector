// Read-only, single-user Muse / MCP bridge for a paired openGym profile.
// Node.js 20+; no third-party dependencies. Run separately from Home Assistant.
import http from 'node:http';

const host = process.env.LISTEN_HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8765);
const museSecret = process.env.CONNECTOR_BEARER_TOKEN || '';
const openGym = (process.env.OPENGYM_URL || '').replace(/\/$/, '');
const openGymToken = process.env.OPENGYM_BEARER_TOKEN || '';
if (!museSecret || museSecret.length < 24 || !openGym || !openGymToken) {
  console.error('Set CONNECTOR_BEARER_TOKEN (24+ chars), OPENGYM_URL, OPENGYM_BEARER_TOKEN.');
  process.exit(1);
}
if (host !== '127.0.0.1' && host !== '::1' && process.env.ALLOW_REMOTE_LISTEN !== 'yes') {
  console.error('Remote bind denied. Keep localhost + HTTPS proxy, or explicitly opt in.');
  process.exit(1);
}
const tools = [
  {name:'workout_summary',description:'Read completed workout dates, exercise and completed-set counts for the authenticated openGym profile. No notes or bodyweight.',inputSchema:{type:'object',properties:{days:{type:'integer',minimum:1,maximum:365,default:30}},additionalProperties:false}},
  {name:'recent_workouts',description:'List recent workouts and exercise IDs with completed sets; excludes notes and bodyweight.',inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:30,default:10}},additionalProperties:false}},
  {name:'training_plan',description:'Read saved routine names, exercise IDs, sets/reps targets and weekly schedule; no personal notes.',inputSchema:{type:'object',properties:{},additionalProperties:false}}
];
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
const response=(id,result)=>({jsonrpc:'2.0',id,result});
const error=(id,code,message)=>({jsonrpc:'2.0',id,error:{code,message}});
const dateString=w=>typeof w.d==='string'?w.d:null;
async function state(){
  // No arbitrary URLs: this bridge talks only to the configured openGym server.
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  try {
    const r=await fetch(openGym+'/api/data',{headers:{Authorization:'Bearer '+openGymToken,Accept:'application/json'},signal:controller.signal});
    if(!r.ok) throw new Error('openGym returned HTTP '+r.status);
    const payload=await r.json();
    if(!payload || typeof payload.state!=='object' || !payload.state) throw new Error('openGym has no saved state');
    return payload.state;
  }finally{clearTimeout(timeout);}
}
const completed=e=>(Array.isArray(e?.sets)?e.sets:[]).filter(s=>s?.done===true);
const workout=w=>({
  date:dateString(w),routine:typeof w.name==='string'?w.name:null,
  exercises:(Array.isArray(w.entries)?w.entries:[]).map(e=>({
    exercise_id:String(e.id||''),completed_sets:completed(e).map(s=>({
      reps:Number.isFinite(s.r)?s.r:null,weight:Number.isFinite(s.w)?s.w:null,
      duration_seconds:Number.isFinite(s.t)?s.t:null
    }))
  })).filter(e=>e.completed_sets.length>0)
});
function query(s,name,args){
  if(name==='training_plan')return {
    routines:(Array.isArray(s.routines)?s.routines:[]).map(r=>({
      id:String(r.id||''),name:String(r.name||''),
      exercises:(Array.isArray(r.ex)?r.ex:[]).map(e=>({id:String(e.id||''),sets:Number.isFinite(e.sets)?e.sets:null,reps:Number.isFinite(e.reps)?e.reps:null}))
    })),week:s.week&&typeof s.week==='object'?s.week:{}
  };
  let list=(Array.isArray(s.workouts)?s.workouts:[]).filter(w=>dateString(w)).sort((a,b)=>b.d.localeCompare(a.d));
  if(name==='recent_workouts')return {workouts:list.slice(0,Math.max(1,Math.min(30,args.limit??10))).map(workout)};
  if(name==='workout_summary'){
    const days=Math.max(1,Math.min(365,args.days??30));
    const today=new Date().toISOString().slice(0,10);
    const start=new Date(Date.now()-(days-1)*86400000).toISOString().slice(0,10);
    list=list.filter(w=>w.d>=start&&w.d<=today);
    return {from:start,through:today,workout_count:list.length,
      completed_set_count:list.reduce((n,w)=>n+(Array.isArray(w.entries)?w.entries:[]).reduce((m,e)=>m+completed(e).length,0),0),
      workout_dates:list.map(w=>w.d),routines_trained:[...new Set(list.map(w=>w.name).filter(Boolean))]};
  }
  throw new Error('Unknown tool');
}
async function rpc(req){
  const {id,method,params={}}=req||{};
  if(typeof method!=='string')return error(id??null,-32600,'Invalid request');
  if(method==='notifications/initialized')return null;
  if(method==='initialize')return response(id,{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'opengym-muse-bridge',version:'0.1.0'}});
  if(method==='ping')return response(id,{});
  if(method==='tools/list')return response(id,{tools});
  if(method==='tools/call'){
    if(typeof params.name!=='string'||!tools.some(t=>t.name===params.name))return error(id,-32602,'Unknown tool');
    try{const data=await state(); const result=query(data,params.name,params.arguments||{});return response(id,{content:[{type:'text',text:JSON.stringify(result)}],isError:false});}
    catch(e){return response(id,{content:[{type:'text',text:'Unable to read openGym: '+e.message}],isError:true});}
  }
  return error(id,-32601,'Method not found');
}
const server=http.createServer(async(req,res)=>{
  if(req.url!=='/mcp')return json(res,404,{error:'Not found'});
  if(req.headers.authorization!=='Bearer '+museSecret)return json(res,401,{error:'Unauthorized'});
  if(req.method!=='POST')return json(res,405,{error:'POST required'});
  // Small requests only; avoid collecting unbounded sensitive payloads.
  let chunks=[],bytes=0;
  try{
    for await (const c of req){bytes+=c.length;if(bytes>65536){json(res,413,{error:'Too large'});return;}chunks.push(c);}
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(Array.isArray(body))return json(res,400,error(null,-32600,'Batched requests unsupported'));
    const answer=await rpc(body);
    if(answer===null){res.writeHead(202);res.end();return;}
    json(res,200,answer);
  }catch{json(res,400,error(null,-32700,'Invalid JSON'));}
});
server.listen(port,host,()=>console.log('openGym Muse bridge listening on '+host+':'+port));
