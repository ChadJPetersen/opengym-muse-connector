// Stateless, per-user openGym connector. No stored credentials or per-user server config.
import net from 'node:net';
import dns from 'node:dns/promises';
import https from 'node:https';

export const tools = Object.freeze([
  {name:'workout_summary',description:'Read completed workout frequency and dates for the connected openGym account (no profile notes, photos or body measurements).',inputSchema:{type:'object',properties:{days:{type:'integer',minimum:1,maximum:365,default:30}},additionalProperties:false}},
  {name:'recent_workouts',description:'List completed workouts, exercise IDs, repetitions, weights and set duration for this openGym account; excludes notes and body measurements.',inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:30,default:10}},additionalProperties:false}},
  {name:'training_plan',description:'Read saved routine names, prescribed exercises/sets/reps, and weekly routine assignments for this openGym account.',inputSchema:{type:'object',properties:{},additionalProperties:false}}
]);

const forbiddenSuffixes=['.local','.localhost','.internal','.lan','.home.arpa','.test','.invalid','.onion','.example'];
export function parseInstance(raw) {
  if(typeof raw!=='string' || raw.length>512 || raw.length<12)throw new Error('Provide an openGym HTTPS instance URL in the MCP instance query parameter');
  let u;
  try{u=new URL(raw);}catch{throw new Error('Invalid openGym instance URL');}
  if(raw.includes('%'))throw new Error('Percent-encoded instance URLs are not supported');
  if(u.protocol!=='https:' || u.port && u.port!=='443' || u.username || u.password || u.search || u.hash)throw new Error('Use a public HTTPS openGym URL without credentials, port, query or fragment');
  const name=u.hostname.toLowerCase().replace(/\.$/,'');
  if(!name.includes('.') || net.isIP(name) || name==='localhost' || forbiddenSuffixes.some(s=>name.endsWith(s)))throw new Error('Use a public DNS hostname, not a local address');
  if(!/^[a-z0-9.-]+$/.test(name))throw new Error('Invalid hostname');
  if(u.pathname.length>200 || !/^\/[a-zA-Z0-9_~.\/-]*$/.test(u.pathname))throw new Error('Unsupported instance URL path');
  return u.origin+u.pathname.replace(/\/+$/,'');
}
// Only permit globally routable IPv4 to the outbound connector. The socket is
// pinned to this vetted DNS answer; a second DNS lookup cannot bypass checks.
export function isPublicIPv4(value) {
  if(net.isIP(value)!==4)return false;
  const p=value.split('.').map(Number);
  const [a,b,c]=p;
  if(a===0||a===10||a===127||a>=224)return false;
  if(a===100&&b>=64&&b<=127)return false;
  if(a===169&&b===254)return false;
  if(a===172&&b>=16&&b<=31)return false;
  if(a===192&&(b===168||b===0||b===0&&c===2||b===88&&c===99))return false;
  if(a===198&&(b===18||b===19||b===51&&c===100))return false;
  if(a===203&&b===0&&c===113)return false;
  if(a===255)return false;
  return true;
}
export async function resolvePublicIPv4(hostname,resolver=dns.lookup) {
  const results=await resolver(hostname,{all:true,family:4,verbatim:true});
  if(!Array.isArray(results)||!results.length||results.some(x=>!isPublicIPv4(x.address)))throw new Error('openGym hostname does not resolve exclusively to public IPv4 addresses');
  return results[0].address;
}
export function tokenFromHeader(header) {
  if(typeof header!=='string')return null;
  const m=/^Bearer ([A-Za-z0-9._~+\/=:-]{16,4096})$/.exec(header);
  return m?m[1]:null;
}
export async function fetchOpenGymState(instance,token,{resolver=dns.lookup}={}) {
  const base=parseInstance(instance);
  const target=new URL(base+'/api/data');
  const pinnedIp=await resolvePublicIPv4(target.hostname,resolver);
  return new Promise((resolve,reject)=>{
    const req=https.request(target,{
      method:'GET',agent:false,timeout:15000,
      lookup:(_hostname,_options,cb)=>cb(null,pinnedIp,4),
      headers:{Authorization:'Bearer '+token,Accept:'application/json'}
    },res=>{
      if(res.statusCode!==200){res.resume();reject(new Error('openGym request failed (HTTP '+res.statusCode+')'));return;}
      if(!String(res.headers['content-type']||'').toLowerCase().includes('application/json')){res.resume();reject(new Error('openGym did not return JSON'));return;}
      const chunks=[];let bytes=0;
      res.on('data',chunk=>{
        bytes+=chunk.length;
        if(bytes>16*1024*1024){res.destroy(new Error('openGym state is too large'));return;}
        chunks.push(chunk);
      });
      res.on('end',()=>{
        try{
          const obj=JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if(!obj||!obj.state||typeof obj.state!=='object'||Array.isArray(obj.state))throw new Error('No valid saved openGym state');
          resolve(obj.state);
        }catch{reject(new Error('Invalid openGym state response'));}
      });
      res.on('error',reject);
    });
    req.on('timeout',()=>req.destroy(new Error('openGym request timed out')));
    req.on('error',reject);
    req.end();
  });
}
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d);
const asString=v=>typeof v==='string'?v.slice(0,180):'';
const complete=e=>(Array.isArray(e?.sets)?e.sets:[]).filter(s=>s&&s.done===true);
const number=n=>typeof n==='number'&&Number.isFinite(n)?n:null;
const workout=w=>({
  date:w.d,
  routine:asString(w.name)||null,
  exercises:(Array.isArray(w.entries)?w.entries:[]).slice(0,100).map(e=>({
    exercise_id:asString(e?.id),
    completed_sets:complete(e).slice(0,50).map(s=>({reps:number(s.r),weight:number(s.w),duration_seconds:number(s.t)}))
  })).filter(e=>e.exercise_id&&e.completed_sets.length)
});
export function selectTool(state,name,args={},now=new Date()) {
  if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('Invalid tool arguments');
  const spec=tools.find(t=>t.name===name);
  if(!spec)throw new Error('Unknown tool');
  const allowed=Object.keys(spec.inputSchema.properties);
  if(Object.keys(args).some(x=>!allowed.includes(x)))throw new Error('Unexpected tool argument');
  const range=(v,key,min,max,fallback)=> {
    if(v===undefined)return fallback;
    if(!Number.isInteger(v)||v<min||v>max)throw new Error('Invalid '+key);
    return v;
  };
  if(name==='training_plan'){
    if(Object.keys(args).length)throw new Error('Unexpected tool argument');
    const validIds=new Set();
    const routines=(Array.isArray(state.routines)?state.routines:[]).slice(0,100).map(r=>{
      const id=asString(r?.id);
      validIds.add(id);
      return {id,name:asString(r?.name),exercises:(Array.isArray(r?.ex)?r.ex:[]).slice(0,100).map(e=>({
        id:asString(e?.id),sets:number(e?.sets),reps:number(e?.reps)
      }))};
    });
    const week={};
    if(state.week&&typeof state.week==='object'&&!Array.isArray(state.week)){
      for(const day of ['0','1','2','3','4','5','6']){
        const ids=state.week[day];
        if(Array.isArray(ids))week[day]=ids.filter(id=>typeof id==='string'&&validIds.has(id)).slice(0,20);
      }
    }
    return {routines,week};
  }
  const list=(Array.isArray(state.workouts)?state.workouts:[])
    .filter(w=>w&&validDate(w.d))
    .sort((a,b)=>b.d.localeCompare(a.d));
  if(name==='recent_workouts'){
    const limit=range(args.limit,'limit',1,30,10);
    return {workouts:list.slice(0,limit).map(workout)};
  }
  const days=range(args.days,'days',1,365,30);
  const midnight=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
  const from=new Date(midnight-(days-1)*86400000).toISOString().slice(0,10);
  const until=new Date(midnight).toISOString().slice(0,10);
  const window=list.filter(w=>w.d>=from&&w.d<=until);
  return {
    from,through:until,timezone:'UTC',workout_count:window.length,
    completed_set_count:window.reduce((total,w)=>total+(Array.isArray(w.entries)?w.entries:[]).reduce((n,e)=>n+complete(e).length,0),0),
    workout_dates:window.map(w=>w.d),
    routines_trained:[...new Set(window.map(w=>asString(w.name)).filter(Boolean))]
  };
}
