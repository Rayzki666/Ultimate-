// Instant on-device face-region checks. Detail and change detection are conservative heuristics.
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
function eyeBandSignature(data,w,h) {
  const out=[];
  // Pose gives an approximate face crop with the eye midpoint near the middle.
  for(let by=0;by<4;by++)for(let bx=0;bx<8;bx++){
    let sum=0,n=0;
    const y0=Math.round(h*(.25+by*.0875)),y1=Math.round(h*(.25+(by+1)*.0875));
    const x0=Math.round(w*bx/8),x1=Math.round(w*(bx+1)/8);
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
      const i=(y*w+x)*4;sum+=(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2])/255;n++;
    }
    out.push(sum/(n||1));
  }
  return out;
}
export class FacePulse {
  constructor(){this.state='ready';this.canvas=document.createElement('canvas');this.canvas.width=64;this.canvas.height=64;this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});this.result=null;}
  start(){this.state='ready';}
  stop(){this.result=null;}
  sample(){}
  read(now,subjects,crop,mirror,video) {
    if(!subjects.length)return {state:'unknown',text:'Keep each face visible',signature:[]};
    const signatures=[];
    for(const subject of subjects){
      let box=subject.face;
      if(!box)return {state:'unknown',text:'Keep each face visible',signature:[]};
      if(mirror)box={...box,x0:1-box.x1,x1:1-box.x0};
      const x0=Math.max(0,box.x0),x1=Math.min(1,box.x1),y0=Math.max(0,box.y0),y1=Math.min(1,box.y1);
      const sx=crop.sx+x0*crop.sw,sy=crop.sy+y0*crop.sh,sw=(x1-x0)*crop.sw,sh=(y1-y0)*crop.sh;
      if(sw<48||sh<48)return {state:'unknown',text:'Move close enough to see the face clearly',signature:[]};
      try{
        this.ctx.drawImage(video,sx,sy,sw,sh,0,0,64,64);
        const data=this.ctx.getImageData(0,0,64,64).data;
        const score=laplacian(data,64,64);
        if(!Number.isFinite(score)||score<18)return {state:'unknown',text:'Face detail is unclear — hold steady',signature:[]};
        signatures.push(...eyeBandSignature(data,64,64));
      }catch{return {state:'unknown',text:'Face detail could not be checked',signature:[]};}
    }
    this.result={at:now,signature:signatures};
    return {state:'good',text:'Face detail detected',signature:signatures};
  }
}
