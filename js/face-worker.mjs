import { eyeState } from './instant.js';
let model;
self.onmessage=async({data})=>{
  if(data.type==='init'){
    try{
      const {FilesetResolver,FaceLandmarker}=await import('../vendor/mediapipe/vision_bundle.mjs');
      const files=await FilesetResolver.forVisionTasks(new URL('../vendor/mediapipe/wasm',import.meta.url).href);
      const response=await fetch('https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',{signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw Error('Model unavailable');
      model=await FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetBuffer:new Uint8Array(await response.arrayBuffer()),delegate:'CPU'},runningMode:'VIDEO',numFaces:2,outputFaceBlendshapes:true,minFaceDetectionConfidence:.6,minFacePresenceConfidence:.6,minTrackingConfidence:.6});
      postMessage({type:'ready'});
    }catch{postMessage({type:'error'});}
  }else if(data.type==='frame'){
    try{
      const result=model.detectForVideo(data.bitmap,data.at);
      const faces=(result.faceLandmarks||[]).map((points,i)=>{
        const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
        const x0=Math.min(...xs),y0=Math.min(...ys),width=Math.max(...xs)-x0,height=Math.max(...ys)-y0;
        const left=points[33],right=points[263];
        return {x:(left.x+right.x)/2,y:(left.y+right.y)/2,x0,y0,width,height,eyes:eyeState(result.faceBlendshapes?.[i]?.categories)};
      });
      postMessage({type:'result',faces,sampleAt:data.at});
    }catch{postMessage({type:'error'});}finally{data.bitmap.close();}
  }
};