// Stateless, publicly reusable MCP bridge. The user stores the openGym
// pairing token in Muse's secure credential store, not on this server.
// Muse config URL: https://connector.example/mcp?instance=https%3A%2F%2Fgym.example%2Fopengym
// Muse credential: Authorization: Bearer <openGym paired-account token>
import http from 'node:http';
import {createHash} from 'node:crypto';
import {tools,parseInstance,tokenFromHeader,selectTool,fetchOpenGymState} from './lib.mjs';

const response=(id,result)=>({jsonrpc:'2.0',id,result});
const failure=(id,code,message)=>({jsonrpc:'2.0',id,error:{code,message}});
const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
const counts=new Map();
function permitted(key,limit,windowMs) {
  const now=Date.now(),entry=counts.get(key);
  if(counts.size>4000){for(const [k,v] of counts){if(v.until<now)counts.delete(k);}}
  if(counts.size>5000)counts.clear();
  if(!entry||entry.until<now){counts.set(key,{until:now+windowMs,n:1});return true;}
  entry.n++;return entry.n<=limit;
}
function isValidOrigin(origin,allowed) {
  if(!origin)return true; // Non-browser MCP clients normally omit Origin.
  return Boolean(allowed)&&origin===allowed;
}
export function createServer({readState=fetchOpenGymState,allowedOrigin=process.env.PUBLIC_ORIGIN||''}={}) {
  return http.createServer(async(req,res)=>{
    let address;
    try{address=new URL(req.url,'http://placeholder.invalid');}
    catch{return send(res,400,{error:'Invalid request URL'});}
    if(address.pathname!=='/mcp')return send(res,404,{error:'Not found'});
    if(!isValidOrigin(req.headers.origin,allowedOrigin))return send(res,403,{error:'Origin not allowed'});
    if(req.method!=='POST'){
      res.setHeader('Allow','POST');
      return send(res,405,{error:'Only MCP POST JSON responses are supported; SSE not enabled'});
    }
    const instance=address.searchParams.get('instance');
    if(!instance||address.searchParams.size!==1)return send(res,400,{error:'Provide one instance parameter containing the public openGym HTTPS URL'});
    try{parseInstance(instance);}catch(e){return send(res,400,{error:e.message});}
    const token=tokenFromHeader(req.headers.authorization);
    if(!token){res.setHeader('WWW-Authenticate','Bearer');return send(res,401,{error:'Supply your own openGym paired-account token as a Bearer credential'});}
    // Cheap abuse controls, by token hash + remote socket peer. No token content retained.
    const peer=req.socket.remoteAddress||'unknown';
    const hash=createHash('sha256').update(token).digest('hex').slice(0,24);
    if(!permitted('ip:'+peer,300,60000)||!permitted('cred:'+hash,60,60000))return send(res,429,{error:'Too many requests'});
    if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))return send(res,415,{error:'Content-Type must be application/json'});
    const accept=String(req.headers.accept||'');
    if(accept&&!accept.includes('*/*')&&!(accept.includes('application/json')&&accept.includes('text/event-stream')))return send(res,406,{error:'MCP clients must accept JSON and event-stream'});
    let chunks=[],bytes=0;
    try{
      for await(const part of req){
        bytes+=part.length;
        if(bytes>65536)return send(res,413,{error:'Request too large'});
        chunks.push(part);
      }
      const message=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!message||Array.isArray(message)||typeof message!=='object'||message.jsonrpc!=='2.0'||typeof message.method!=='string')return send(res,400,failure(null,-32600,'Invalid JSON-RPC request'));
      const {id,method,params={}}=message;
      if(id===undefined){res.writeHead(202,{'Cache-Control':'no-store'});res.end();return;}
      if(method==='initialize'){
        const requested=params&&params.protocolVersion;
        return send(res,200,response(id,{protocolVersion:['2025-03-26','2025-11-25'].includes(requested)?requested:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'opengym-muse-connector',version:'0.2.0'}}));
      }
      if(method==='ping')return send(res,200,response(id,{}));
      if(method==='tools/list')return send(res,200,response(id,{tools}));
      if(method==='tools/call'){
        if(!params||typeof params.name!=='string'||!tools.some(t=>t.name===params.name))return send(res,200,failure(id,-32602,'Unknown tool'));
        try{
          const data=await readState(instance,token);
          const output=selectTool(data,params.name,params.arguments||{});
          return send(res,200,response(id,{content:[{type:'text',text:JSON.stringify(output)}],isError:false}));
        }catch(e){
          // No raw upstream bodies, Authorization values, or URLs in errors.
          const safe=e.message.startsWith('Invalid ')||e.message==='Unexpected tool argument'?e.message:'Could not read this openGym account; verify HTTPS reachability and the pairing token';
          return send(res,200,response(id,{content:[{type:'text',text:safe}],isError:true}));
        }
      }
      return send(res,200,failure(id,-32601,'Method not found'));
    }catch{
      return send(res,400,failure(null,-32700,'Invalid JSON'));
    }
  });
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  const host=process.env.LISTEN_HOST||'127.0.0.1';
  const port=Number(process.env.PORT||8765);
  if(host!=='127.0.0.1'&&host!=='::1'&&process.env.ALLOW_REMOTE_LISTEN!=='yes'){
    console.error('Remote bind denied. Put the connector behind a trusted HTTPS proxy.');
    process.exit(1);
  }
  createServer().listen(port,host,()=>console.log('openGym Muse MCP listening on '+host+':'+port));
}
