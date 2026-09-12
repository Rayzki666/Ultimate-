import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVerdict, endpointURL, sceneChanged, MomentGate, MAX_AGE_MS } from '../js/ai-contract.mjs';
import { AiMoment } from '../js/ai-moment.js';
import { eyeState, laplacian } from '../js/instant.js';

const scene={context:'camera:golden',people:[[.3,.2,.1,.8,.25,.4]],signature:Array(192).fill(100)};
const good={decision:'shoot',confidence:.9,reason:'The subject light and background work together.',action:'',actor:'none',checks:{light:'good',composition:'good',background:'good',pose:'good'}};
const update=(gate,now,extra={})=>gate.update({scene,now,basicReady:true,instant:'good',...extra});
function accepted(){const g=new MomentGate();g.begin('1',0,scene);assert.equal(g.accept('1',good,scene,100),true);return g;}
test('unknown checks and low confidence cannot become shoot; malformed output rejected',()=>{
  assert.equal(parseVerdict({...good,confidence:.7}).decision,'uncertain');
  assert.equal(parseVerdict({...good,checks:{...good.checks,background:'unknown'}}).decision,'uncertain');
  for(const v of [null,{}, {...good,confidence:NaN},{...good,checks:{}},{...good,reason:'x'.repeat(221)},{...good,decision:'adjust',action:'',actor:'none'}])assert.throws(()=>parseVerdict(v));
});
test('service address rejects credentials, paths and insecure remote hosts',()=>{
  assert.equal(endpointURL('https://camera.example/'),'https://camera.example');
  assert.equal(endpointURL('http://127.0.0.1:8000'),'http://127.0.0.1:8000');
  for(const url of ['http://camera.example','https://user:pass@camera.example','https://camera.example/path','https://camera.example/?secret=1','javascript:alert(1)'])assert.throws(()=>endpointURL(url));
});
test('AI signal requires recent semantic approval AND continuous good local checks',()=>{
  const g=accepted();
  assert.equal(update(g,100).ready,false);
  assert.equal(update(g,350).ready,false);
  assert.equal(update(g,600).ready,true);
  assert.equal(update(g,650,{instant:'warn'}).ready,false);
  assert.equal(update(g,700).ready,false);
  assert.equal(update(g,950).ready,false);
  assert.equal(update(g,1200).ready,true);
  assert.equal(update(g,1250,{basicReady:false}).ready,false);
});
test('face unknown, frame gaps and time reversal clear the local hold',()=>{
  const g=accepted();update(g,100);update(g,350);
  assert.equal(update(g,900).ready,false);
  assert.equal(update(g,1150,{instant:'unknown'}).ready,false);
  update(g,1200);update(g,1450);
  assert.equal(update(g,1100).ready,false);
});
test('results expire from capture time, including responses that arrive too late',()=>{
  const g=accepted();assert.equal(update(g,MAX_AGE_MS+1).ready,false);assert.equal(g.result,null);
  g.begin('2',0,scene);assert.equal(g.accept('2',good,scene,MAX_AGE_MS+1),false);
});
test('movement, style/camera/crop changes, visibility and background differences invalidate results',()=>{
  const variants=[
    {...scene,context:'camera:travel'}, {...scene,people:[]},
    {...scene,people:[[.4,...scene.people[0].slice(1)]]},
    {...scene,signature:scene.signature.map(()=>130)},null
  ];
  for(const changed of variants){const g=accepted();assert.equal(sceneChanged(scene,changed),true);update(g,200,{scene:changed});assert.equal(g.result,null);}
  assert.equal(sceneChanged(scene,structuredClone(scene)),false);
});
test('wrong request ID and invalidated requests cannot resurrect recommendations',()=>{
  const g=new MomentGate();g.begin('2',0,scene);
  assert.equal(g.accept('1',good,scene,100),false);g.invalidate();
  assert.equal(g.accept('2',good,scene,100),false);
});
test('client defaults off, sends one in-flight preview, and discards a late reply after stop',async()=>{
  let time=0,calls=0,finish,signal;
  const a=new AiMoment({clock:()=>time,fetcher:async(url,options)=>{calls++;signal=options.signal;return new Promise(r=>finish=r);}});
  await a.analyze(scene,'image',{});assert.equal(calls,0);
  a.endpoint='https://camera.example';a.token='a'.repeat(32);a.enable();
  const pending=a.analyze(scene,'image',{});time=6000;await a.analyze(scene,'image',{});assert.equal(calls,1);
  a.disable();assert.equal(signal.aborted,true);
  finish({ok:true,json:async()=>({id:'2',result:good})});await pending;
  assert.equal(a.gate.result,null);assert.equal(a.enabled,false);
});
test('client cancels a request when scene changes and does not queue a replacement',async()=>{
  let calls=0,finish;
  const a=new AiMoment({clock:()=>0,fetcher:async()=>{calls++;return new Promise(r=>finish=r);}});
  a.endpoint='https://camera.example';a.token='a'.repeat(32);a.enable();
  const p=a.analyze(scene,'image',{});
  a.observe({...scene,context:'other-camera'},100);
  await a.analyze(scene,'image',{});assert.equal(calls,1);
  finish({ok:true,json:async()=>({id:'2',result:good})});await p;
  assert.equal(a.gate.result,null);
});
test('client validates echoed ID, backs off, and pauses after three failures',async()=>{
  let time=0,calls=0;
  const a=new AiMoment({clock:()=>time,fetcher:async()=>{calls++;return {ok:true,json:async()=>({id:'wrong',result:good})};}});
  a.endpoint='https://camera.example';a.token='a'.repeat(32);a.enable();
  for(let i=0;i<3;i++){time=i*20000;await a.analyze(scene,'image',{});assert.equal(a.gate.result,null);}
  assert.equal(calls,3);assert.equal(a.enabled,false);assert.equal(a.status,'paused');
});
test('60-frame session cap prevents another upload',async()=>{
  let calls=0;const a=new AiMoment({fetcher:async()=>{calls++;}});
  a.endpoint='https://camera.example';a.token='a'.repeat(32);a.enable();a.count=60;
  await a.analyze(scene,'image',{});assert.equal(calls,0);assert.equal(a.status,'limit');
});
test('eye checks fail closed for absent, ambiguous or invalid measurements',()=>{
  const cats=(a,b)=>[{categoryName:'eyeBlinkLeft',score:a},{categoryName:'eyeBlinkRight',score:b}];
  assert.equal(eyeState(cats(.1,.1)),'open');
  assert.equal(eyeState(cats(.9,.1)),'closed');
  assert.equal(eyeState(cats(.4,.1)),'unknown');
  assert.equal(eyeState(cats(NaN,.1)),'unknown');
  assert.equal(eyeState([]),'unknown');
});
test('detail heuristic distinguishes a flat face region from visible edges',()=>{
  const flat=new Uint8ClampedArray(64*64*4).fill(128);
  assert.equal(laplacian(flat,64,64),0);
  const textured=flat.slice();
  for(let y=0;y<64;y++)for(let x=0;x<64;x++)for(let k=0;k<3;k++)textured[(y*64+x)*4+k]=((x+y)%2)*255;
  assert.ok(laplacian(textured,64,64)>18);
  assert.equal(laplacian([],0,0),null);
});
