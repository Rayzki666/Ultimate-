// Conservative instantaneous checks. Detail is a heuristic, not an autofocus measurement.
export function eyeState(categories) {
  const values = ['eyeBlinkLeft', 'eyeBlinkRight'].map(name => categories?.find(c => c.categoryName === name)?.score);
  if (values.some(v => !Number.isFinite(v) || v < 0 || v > 1)) return 'unknown';
  if (values.some(v => v > .55)) return 'closed';
  return values.every(v => v < .3) ? 'open' : 'unknown';
}
export function laplacian(data, w, h) {
  if (w < 8 || h < 8 || data.length !== w*h*4) return null;
  const gray = new Float32Array(w*h);
  for (let i=0;i<gray.length;i++) gray[i]=.2126*data[i*4]+.7152*data[i*4+1]+.0722*data[i*4+2];
  let sum=0,sq=0,n=0;
  for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++) {
    const i=y*w+x, v=gray[i-1]+gray[i+1]+gray[i-w]+gray[i+w]-4*gray[i];
    sum+=v;sq+=v*v;n++;
  }
  return sq/n-(sum/n)**2;
}
export class FacePulse {
  constructor() { this.worker=null;this.state='off';this.result=null;this.busy=false;this.serial=0;this.last=-Infinity; }
  start() {
    if (this.worker) return;
    this.state='loading';
    const worker=this.worker=new Worker(new URL('./face-worker.mjs', import.meta.url), {type:'module'});
    worker.onmessage=({data})=>{
      if(this.worker!==worker)return;
      if(data.type==='ready'){this.state='ready';return;}
      if(data.type==='error'){this.fail();return;}
      this.busy=false;this.result={...data,at:performance.now()};
    };
    worker.onerror=()=>this.fail();
    this.timer=setTimeout(()=>{if(this.state==='loading')this.fail();},35000);
    worker.postMessage({type:'init'});
  }
  fail(){this.stop();this.state='failed';}
  stop(){++this.serial;clearTimeout(this.timer);this.worker?.terminate();this.worker=null;this.state='off';this.result=null;this.busy=false;}
  async sample(video, now) {
    if(this.state!=='ready'||this.busy||now-this.last<250)return;
    this.busy=true;this.last=now;
    const serial=this.serial,worker=this.worker;
    try{
      const bitmap=await createImageBitmap(video);
      if(serial!==this.serial||worker!==this.worker){bitmap.close();return;}
      worker.postMessage({type:'frame',bitmap,at:now},[bitmap]);
    }catch{if(serial===this.serial)this.fail();}
  }
  read(now, subjects, crop, mirror, video) {
    if(this.state!=='ready')return {state:'unknown',text:this.state==='failed'?'Face checks unavailable':'Starting face checks'};
    const r=this.result;
    if(!r||now-r.at>650||now-r.sampleAt>850)return {state:'unknown',text:'Waiting for a fresh face check'};
    if(!subjects.length || r.faces.length!==subjects.length)return {state:'unknown',text:'Keep each face visible'};
    if(!this.canvas){this.canvas=document.createElement('canvas');this.canvas.width=64;this.canvas.height=64;this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});}
    const used=new Set();
    for(const subject of subjects){
      const hx=mirror?1-subject.head.x:subject.head.x;
      const x=(crop.sx+hx*crop.sw)/video.videoWidth,y=(crop.sy+subject.head.y*crop.sh)/video.videoHeight;
      const face=r.faces.map((f,i)=>({...f,i,d:Math.hypot(f.x-x,f.y-y)})).sort((a,b)=>a.d-b.d)[0];
      if(!face||face.d>.1||used.has(face.i)||face.width*video.videoWidth<48||face.height*video.videoHeight<48)
        return {state:'unknown',text:'Move close enough to see the face clearly'};
      used.add(face.i);
      if(face.eyes==='closed')return {state:'warn',text:'Wait for open eyes'};
      if(face.eyes!=='open')return {state:'unknown',text:'Eyes are not clear enough to check'};
      const sx=face.x0*video.videoWidth,sy=face.y0*video.videoHeight,sw=face.width*video.videoWidth,sh=face.height*video.videoHeight;
      if(sx<0||sy<0||sx+sw>video.videoWidth||sy+sh>video.videoHeight)return {state:'unknown',text:'Keep the face inside the frame'};
      try{
        this.ctx.drawImage(video,sx,sy,sw,sh,0,0,64,64);
        const score=laplacian(this.ctx.getImageData(0,0,64,64).data,64,64);
        if(!Number.isFinite(score)||score<18)return {state:'unknown',text:'Face detail is unclear — hold steady'};
      }catch{return {state:'unknown',text:'Face detail could not be checked'};}
    }
    return {state:'good',text:'Eyes open; face detail detected'};
  }
}
