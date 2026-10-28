#!/usr/bin/env node
// Local-only one-time openGym pairing helper. Displays the result only on
// the local terminal. Never forwards it to GitHub or the Muse MCP bridge.
import readline from 'node:readline/promises';
import {stdin,stdout,stderr,argv,exit} from 'node:process';
const raw=argv[2]||'';
let url;
try{
  url=new URL(raw);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('HTTPS required');
}catch{
  stderr.write('Usage: node scripts/redeem-pairing-code.mjs https://YOUR_OPENGYM_HOST[/path]\n');
  exit(1);
}
const rl=readline.createInterface({input:stdin,output:stdout});
let code;
try{code=(await rl.question('One-time code from openGym Settings > Account: ')).trim();}
finally{rl.close();}
if(!code||code.length>100){stderr.write('Invalid code.\n');exit(1);}
try{
  const base=url.origin+url.pathname.replace(/\/+$/,'');
  const r=await fetch(base+'/api/pair/redeem',{
    method:'POST',redirect:'error',
    headers:{'Content-Type':'application/json',Accept:'application/json'},
    body:JSON.stringify({code}),signal:AbortSignal.timeout(15000)
  });
  if(!r.ok){stderr.write('Pairing failed (HTTP '+r.status+'). Create a fresh code.\n');exit(1);}
  const data=await r.json();
  if(typeof data.token!=='string'||!data.token){stderr.write('No token returned.\n');exit(1);}
  stdout.write('\nOPEN GYM ACCOUNT TOKEN — KEEP SECRET:\n'+data.token+'\n\n');
  stdout.write('Enter this ONLY in Muse secure credentials, not a chat or URL.\n');
}catch(e){stderr.write('Pairing failed: '+e.message+'\n');exit(1);}
