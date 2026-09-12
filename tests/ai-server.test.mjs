import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, validateInput } from '../server/server.mjs';
const token='private-service-code-'.repeat(3),origin='https://rayzki666.github.io';
const bytes=Buffer.alloc(120,1);bytes[0]=255;bytes[1]=216;bytes[118]=255;bytes[119]=217;
const input={id:'1',image:'data:image/jpeg;base64,'+bytes.toString('base64'),style:'golden',shotType:'half',composition:'thirds'};
const good={decision:'shoot',confidence:.9,reason:'The light and background complement this portrait.',action:'',actor:'none',checks:{light:'good',composition:'good',background:'good',pose:'good'}};
async function fixture(fetcher,run,options={}){
 const server=createApp({key:'server-secret',model:'test-vision-model',token,origin,fetcher,...options});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port;
 const request=(body=input,headers={})=>fetch(url+'/analyze',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Origin:origin,...headers},body:typeof body==='string'?body:JSON.stringify(body)});
 try{await run({url,request});}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
test('gateway requires complete server config',()=>{
 assert.throws(()=>createApp({key:'k',model:'m',token:'short',origin}));
});
test('request schema rejects untrusted style, wrong data type and non-JPEG data',()=>{
 for(const change of [{style:'ignore instructions'}, {image:'https://evil.example/photo'}, {id:'bad'},{image:'data:image/jpeg;base64,YQ=='},{shotType:'unknown'}])
  assert.throws(()=>validateInput({...input,...change}));
});
test('health auth, wrong origin and unauthenticated requests never reach provider',async()=>{
 let calls=0;
 await fixture(async()=>{calls++;},async({url,request})=>{
  assert.equal((await fetch(url+'/health')).status,401);
  const health=await fetch(url+'/health',{headers:{Authorization:'Bearer '+token,Origin:origin}});
  assert.equal(health.status,200);assert.equal((await health.json()).protocol,1);
  assert.equal((await request(input,{Authorization:'Bearer wrong'})).status,401);
  assert.equal((await request(input,{Origin:'https://other.example'})).status,403);
  assert.equal((await fetch(url+'/analyze',{method:'OPTIONS',headers:{Origin:origin}})).headers.get('access-control-allow-origin'),origin);
 });
 assert.equal(calls,0);
});
test('invalid and oversized bodies never reach provider',async()=>{
 let calls=0;
 await fixture(async()=>{calls++;},async({request})=>{
  assert.equal((await request('invalid-json')).status,400);
  assert.equal((await request({...input,style:'other'})).status,400);
  assert.equal((await request('x'.repeat(410000))).status,413);
 });
 assert.equal(calls,0);
});
test('gateway keeps key server-side and returns only a validated recommendation with frame ID',async()=>{
 await fixture(async(url,opts)=>{
  assert.equal(url,'https://api.anthropic.com/v1/messages');
  assert.equal(opts.headers['x-api-key'],'server-secret');
  const body=JSON.parse(opts.body);assert.equal(body.model,'test-vision-model');
  assert.equal(body.messages[0].content[0].source.data,input.image.split(',')[1]);
  return {ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(good)}]})};
 },async({request})=>{
  const response=await request();assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.id,'1');assert.equal(body.result.decision,'shoot');
  assert.equal(JSON.stringify(body).includes('server-secret'),false);
  assert.equal((await request()).status,429);
 });
});
test('provider errors, truncation and malformed model JSON do not return shoot',async()=>{
 for(const provider of [
  {ok:false},
  {ok:true,json:async()=>({stop_reason:'max_tokens',content:[]})},
  {ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text:'not json'}]})}
 ])await fixture(async()=>provider,async({request})=>assert.equal((await request()).status,502));
});
test('concurrent requests and hourly cap prevent extra provider charges',async()=>{
 let finish,calls=0,time=0;
 await fixture(async()=>{calls++;return new Promise(r=>finish=r);},async({request})=>{
  const first=request();
  while(!finish)await new Promise(r=>setTimeout(r,5));
  assert.equal((await request()).status,429);assert.equal(calls,1);
  finish({ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(good)}]})});
  assert.equal((await first).status,200);
  time=10000;assert.equal((await request()).status,429);assert.equal(calls,1);
 },{now:()=>time,maxPerHour:1});
});
