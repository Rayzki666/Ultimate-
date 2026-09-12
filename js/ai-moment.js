import { MomentGate, endpointURL } from './ai-contract.mjs';
export class AiMoment {
  constructor({fetcher=(...args)=>fetch(...args),clock=()=>performance.now()}={}) {
    this.fetcher=fetcher;this.clock=clock;this.gate=new MomentGate();this.enabled=false;this.endpoint='';this.token='';
    this.status='off';this.serial=0;this.inFlight=null;this.lastAttempt=-Infinity;this.count=0;this.errors=0;
  }
  async connect(endpoint,token) {
    this.disable();this.endpoint='';this.token='';
    const origin=endpointURL(endpoint);
    if(typeof token!=='string'||token.length<32||token.length>256||/[\r\n]/.test(token))throw Error('Enter the service access code (at least 32 characters).');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
    try{
      const r=await this.fetcher(origin+'/health',{headers:{Authorization:'Bearer '+token},signal:controller.signal,cache:'no-store',credentials:'omit'});
      if(!r.ok)throw Error('Service connection failed. Check the address and access code.');
      const data=await r.json();if(data.status!=='ready'||data.protocol!==1)throw Error('This service is not ready for live guidance.');
      this.endpoint=origin;this.token=token;this.status='connected';
    }finally{clearTimeout(timer);}
  }
  enable(){if(!this.endpoint||!this.token)throw Error('Connect your AI service in Settings first.');this.invalidate();this.enabled=true;this.status='waiting';this.lastAttempt=-Infinity;this.count=0;this.errors=0;}
  invalidate(){++this.serial;this.gate.invalidate();this.inFlight?.controller.abort();}
  disable(){this.enabled=false;this.invalidate();this.status=this.endpoint?'connected':'off';}
  disconnect(){this.disable();this.endpoint='';this.token='';this.status='off';}
  observe(scene,now){if(this.gate.request&&!this.gate.observe(scene,now)){++this.serial;this.inFlight?.controller.abort();}}
  async analyze(scene,image,context) {
    const now=this.clock();
    if(!this.enabled||this.inFlight||now-this.lastAttempt<5000||this.gate.result)return;
    if(this.count>=60){this.disable();this.status='limit';return;}
    const id=String(++this.serial),controller=new AbortController();
    this.lastAttempt=now;this.count++;this.gate.begin(id,now,scene);
    const request=this.inFlight={id,controller};this.status='analyzing';
    const timer=setTimeout(()=>controller.abort(),7000);
    try{
      const response=await this.fetcher(this.endpoint+'/analyze',{method:'POST',credentials:'omit',cache:'no-store',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+this.token},
        signal:controller.signal,body:JSON.stringify({id,image,...context})});
      if(!response.ok)throw Error(response.status===429?'AI service limit reached':'AI analysis unavailable');
      const data=await response.json();
      if(!this.enabled||id!==String(this.serial))return;
      if(data.id!==id||!this.gate.accept(id,data.result,scene,this.clock()))throw Error('AI response expired');
      this.status=this.gate.result.decision;this.errors=0;
    }catch(error){
      if(id!==String(this.serial)||!this.enabled)return;
      this.gate.invalidate();this.status='error';this.errors++;this.lastAttempt=this.clock()+10000;
      if(this.errors>=3){this.disable();this.status='paused';}
    }finally{clearTimeout(timer);if(this.inFlight===request)this.inFlight=null;}
  }
}
