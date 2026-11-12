'use strict';
(()=>{
const $=id=>document.getElementById(id),canvas=$('view');const gl=canvas.getContext('webgl',{alpha:false,antialias:true,preserveDrawingBuffer:true});if(!gl){$('diagnosis').textContent='WebGL is unavailable. Enable WebGL in your browser.';return;}
let quat=[0,0,0,1],target=[0,0,0],distance=8,spin=null,drag=null,paused=false,scores={},recording=null,videoBlob=null,contactReady=false,metricsBlob=null,recorder=null,stream=null,latestVideoName='recursive-feedback.webm';

let renderer;
try { renderer = createFeedbackRenderer(gl); }
catch (error) { $('diagnosis').textContent = 'WebGL initialization failed: '+error.message; throw error; }
const sim = createSimulation(renderer);
let experiment = false, liveObject;
const liveSize = [canvas.width,canvas.height];
function displayAllLags() {
  if (!$('lagDetails').open) return;
  $('allLags').textContent = Array.from({length:32},(_,i) => {
    const value = scores[i+1];
    return String(i+1).padStart(2)+'  '+(value===undefined?'—':value.toFixed(3)+'%').padEnd(8);
  }).join(' ');
}
$('lagDetails').ontoggle = displayAllLags;
function liveCamera() {
  return {position: rotated(quat,[0,0,distance]).map((v,i)=>v+target[i]),
    orientation: [...quat], fovDegrees: 180/3.1};
}
function clear() {
  if (experiment || recording) return;
  displayMetrics(sim.reset({camera: liveCamera(), object: $('object').value}));
}
function home() {
  if (experiment || recording) return;
  quat=qnorm(qm(qaxis([1,0,0],-.15),qaxis([0,1,0],.23)));
  target=[0,0,0]; distance=8; spin=null; clear();
}
function setExperiment(active) {
  experiment = active;
  for (const id of ['home','stop','clear','pause','object','record','freeze','count']) $(id).disabled = active;
  $('oneStep').disabled = $('manySteps').disabled = $('saveConfig').disabled = !active;
  $('experiment').textContent = active ? 'Return to live view' : 'Start experiment';
  $('mode').textContent = active ? 'FIXED CAMERA' : 'ARCBALL · READY';
}
function displayMetrics(row) {
  scores = row.lags;
  displayAllLags();
  for (const lag of [1,2,4,8,16]) {
    $('lag'+lag).textContent = scores[lag] === undefined ? '—' : scores[lag].toFixed(2)+'%';
  }
  $('diagnosis').textContent = row.kind+(row.period>1?' · period '+row.period:'')+' · iteration '+row.iteration;
}
function showIteration() {
  displayMetrics(sim.latest);
  renderer.present();
  $('fps').textContent = 'Iteration '+sim.iteration;
}
function startExperiment(input = {}) {
  if (recording) throw Error('Finish recording before starting an experiment');
  sim.reset(input);
  const config = sim.config;
  if (!experiment) liveObject = $('object').value;
  $('object').value = config.object;
  canvas.width = config.width;
  canvas.height = config.height;
  canvas.style.aspectRatio = config.width+' / '+config.height;
  spin = drag = null;
  setExperiment(true);
  showIteration();
  return config;
}
function stepExperiment(count) {
  if (!experiment) throw Error('Start an experiment first');
  if (!Number.isSafeInteger(count) || count < 0) throw RangeError('Expected a nonnegative iteration count');
  const rows = [];
  for (let i=0; i<count; i++) { rows.push(sim.step()); }
  showIteration();
  return structuredClone(rows);
}
function endExperiment() {
  if (!experiment) return;
  setExperiment(false);
  [canvas.width,canvas.height] = liveSize;
  canvas.style.aspectRatio = '';
  $('object').value = liveObject;
  clear();
  renderer.present();
}
home();
$('experiment').onclick = () => experiment ? endExperiment() : startExperiment({camera:liveCamera(),object:$('object').value});
$('saveConfig').onclick = () => save(new Blob([JSON.stringify(sim.config,null,2)],{type:'application/json'}),'config.json');
$('oneStep').onclick = () => stepExperiment(1);
$('manySteps').onclick = () => stepExperiment(32);
function download(url,name) {
  const link=document.createElement('a');
  link.href=url;
  link.download=name;
  link.click();
}
function save(blob,name) {
  if (!blob) return;
  const url=URL.createObjectURL(blob);
  download(url,name);
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function state(){if(experiment)return {mode:'experiment',...sim.config,feedbackFrame:sim.iteration,spinning:false};return{quaternion:[...quat],target:[...target],distance,centralObject:$('object').value,feedbackFrame:sim.iteration,spinning:!!spin,spin:spin?{axis:[...spin.axis],anglePerRenderedFrame:spin.angle}:null}}
function startRecord(){if(experiment||recording||stream)return;if(!canvas.captureStream||typeof MediaRecorder==='undefined'){$('status').textContent='Browser cannot record video. Try Chrome or Edge.';return;}let mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'].find(x=>MediaRecorder.isTypeSupported(x));try{stream=canvas.captureStream(0);let track=stream.getVideoTracks()[0];recorder=new MediaRecorder(stream,mime?{mimeType:mime,videoBitsPerSecond:5000000}:{videoBitsPerSecond:5000000});let chunks=[];videoBlob=null;metricsBlob=null;contactReady=false;$('downloadVideo').disabled=true;$('downloadSheet').disabled=true;$('downloadData').disabled=true;$('contact').classList.remove('ready');$('contact').getContext('2d').clearRect(0,0,800,480);recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.onstop=()=>{videoBlob=new Blob(chunks,{type:recorder.mimeType||mime||'video/webm'});latestVideoName=videoBlob.type.includes('mp4')?'recursive-feedback.mp4':'recursive-feedback.webm';$('downloadVideo').disabled=!videoBlob.size;$('status').textContent=(videoBlob.size?'Complete · video, contact sheet, and metrics ready':'Complete · contact sheet and metrics ready');stream?.getTracks().forEach(t=>t.stop());stream=null;$('record').disabled=experiment};recorder.onerror=()=>{$('status').textContent='Video encoding error. Contact sheet and metrics may be available.'};let count=+$('count').value;$('experiment').disabled=true;recording={total:count,index:0,encoderFrameRequests:0,track,lastSlot:-1,samples:[],initialState:state(),frozen:$('freeze').checked,oldSpin:spin?{axis:[...spin.axis],angle:spin.angle}:null};if(recording.frozen){spin=null;drag=null}paused=false;$('pause').textContent='Ⅱ Pause';$('record').disabled=true;$('count').disabled=true;$('flash').classList.add('on');$('progress').style.width='0%';$('status').textContent='Recording 0 / '+count;recorder.start();}catch(e){recording=null;$('experiment').disabled=false;$('record').disabled=false;$('count').disabled=false;$('flash').classList.remove('on');$('status').textContent='Recording error: '+e.message;stream?.getTracks().forEach(t=>t.stop());stream=null}}
function captureStep(){let r=recording;if(!r)return;r.index++;r.samples.push({frame:r.index,feedbackFrame:sim.iteration,sampleIndex:r.index,feedbackIteration:sim.iteration,camera:state(),recurrence:{...scores}});const slot=Math.round((r.index-1)*15/(r.total-1));if(slot!==r.lastSlot){const x=(slot%4)*200,y=Math.floor(slot/4)*120,ctx=$('contact').getContext('2d');ctx.drawImage(canvas,x,y,200,120);ctx.fillStyle='#0c1424c9';ctx.fillRect(x,y,78,19);ctx.fillStyle='white';ctx.font='12px monospace';ctx.fillText('Frame '+r.index,x+5,y+13);r.lastSlot=slot}try{r.track.requestFrame();r.encoderFrameRequests++}catch(e){}$('progress').style.width=(100*r.index/r.total)+'%';$('status').textContent='Recording '+r.index+' / '+r.total;if(r.index>=r.total)finishRecord(false)}
function finishRecord(cancel){let r=recording;if(!r)return;recording=null;$('experiment').disabled=false;$('count').disabled=false;$('flash').classList.remove('on');$('contact').classList.add('ready');contactReady=true;$('downloadSheet').disabled=false;metricsBlob=new Blob([JSON.stringify({format:'recursive-feedback-v2',simulationSamples:r.samples.length,encoderFrameRequests:r.encoderFrameRequests,encodedFrameCount:null,capture:r.initialState,cameraFrozen:r.frozen,canceled:cancel,samples:r.samples},null,2)],{type:'application/json'});$('downloadData').disabled=false;if(r.frozen&&r.oldSpin)spin=r.oldSpin;if(recorder?.state!=='inactive')recorder.stop();if(cancel)$('status').textContent='Recording canceled after '+r.index+' frames (partial files available)';else $('status').textContent='Encoding video…'}
let last=0, fpsElapsed=0, fpsFrames=0;
function tick(ts) {
  const dt = last ? Math.min(.05,(ts-last)/1000) : .016;
  last = ts;
  if (!experiment) {
    if (!drag && spin && !recording?.frozen) {
      const step = Math.min(3,dt*60);
      quat = qnorm(qm(quat,qaxis(spin.axis,spin.angle*step)));
    }
    if (!paused) displayMetrics(sim.step(liveCamera(),$('object').value));
    renderer.present();
    if (recording) captureStep();
    fpsElapsed += dt;
    fpsFrames++;
    if (fpsElapsed>1.4) {
      $('fps').textContent = Math.round(fpsFrames/fpsElapsed)+' FPS · '+(distance<2.5?'INSIDE':'OUTSIDE')+' · D '+distance.toFixed(2);
      fpsElapsed = fpsFrames = 0;
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
function point(x,y){let r=canvas.getBoundingClientRect(),s=Math.min(r.width,r.height)*.44,a=(x-r.left-r.width/2)/s,b=(r.top+r.height/2-y)/s,m=Math.hypot(a,b);return m<=1?norm([a,b,Math.sqrt(1-m*m)]):norm([a,b,0])}
function corner(x,y){let r=canvas.getBoundingClientRect(),s=Math.min(r.width,r.height)*.44;return Math.hypot((x-r.left-r.width/2)/s,(y-r.top-r.height/2)/s)>1}
function angle(x,y){let r=canvas.getBoundingClientRect();return Math.atan2(r.top+r.height/2-y,x-r.left-r.width/2)}
function dolly(y){distance=Math.max(.1,Math.min(90,distance*Math.exp(y)));spin=null}
canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('wheel',e=>{e.preventDefault();if(!experiment&&!recording)dolly(e.deltaY*.0012*(e.shiftKey?2:1))},{passive:false});canvas.addEventListener('pointerdown',e=>{if(experiment||recording||e.button>2)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);let mode=e.button===2||(e.ctrlKey&&e.shiftKey)?'dolly':e.button===1||e.ctrlKey?'pan':corner(e.clientX,e.clientY)?'roll':'rotate';drag={mode,x:e.clientX,y:e.clientY,p:point(e.clientX,e.clientY),a:angle(e.clientX,e.clientY),samples:[],t:performance.now()};spin=null;$('mode').textContent=mode.toUpperCase()});
canvas.addEventListener('pointermove',e=>{if(!drag)return;e.preventDefault();let g=drag,dx=e.clientX-g.x,dy=e.clientY-g.y,now=performance.now(),ms=Math.max(8,now-g.t);if(g.mode==='pan'){let r=canvas.getBoundingClientRect(),s=2*distance*Math.tan(Math.PI/6.2)/r.height,right=rotated(quat,[1,0,0]),up=rotated(quat,[0,1,0]);target=target.map((x,i)=>x-right[i]*dx*s+up[i]*dy*s)}else if(g.mode==='dolly')dolly(dy/canvas.getBoundingClientRect().height*2.6);else{let dq;if(g.mode==='roll'){let a=angle(e.clientX,e.clientY),v=a-g.a;while(v>Math.PI)v-=2*Math.PI;while(v< -Math.PI)v+=2*Math.PI;dq=qaxis([0,0,-1],v);g.a=a}else{let p=point(e.clientX,e.clientY);dq=qbetween(p,g.p);g.p=p}quat=qnorm(qm(quat,dq));let a=2*Math.acos(Math.max(-1,Math.min(1,dq[3]))),s=Math.sin(a/2);if(a>.0003&&a<1&&s>.00001){g.samples.push({axis:dq.slice(0,3).map(x=>x/s),angle:a*Math.min(3,16.67/ms),t:now});if(g.samples.length>5)g.samples.shift()}}g.x=e.clientX;g.y=e.clientY;g.t=now});
function release(){if(!drag)return;let g=drag;drag=null;if((g.mode==='roll'||g.mode==='rotate')&&g.samples.length){let recent=g.samples.filter(s=>performance.now()-s.t<110);if(recent.length){let v=[0,0,0];for(let s of recent)for(let i=0;i<3;i++)v[i]+=s.axis[i]*s.angle/recent.length;let a=Math.hypot(...v);if(a>.002)spin={axis:norm(v),angle:Math.min(a,.15)}}}$('mode').textContent=spin?'INERTIAL SPIN':'ARCBALL · READY'}canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',()=>{drag=null;spin=null});
$('home').onclick=()=>{if(!recording)home()};$('stop').onclick=()=>{if(!recording){spin=null;$('mode').textContent='STATIONARY'}};$('clear').onclick=()=>{if(!recording)clear()};$('pause').onclick=()=>{if(recording)return;paused=!paused;$('pause').textContent=paused?'▶ Resume':'Ⅱ Pause'};$('object').onchange=()=>{if(!recording)clear()};$('record').onclick=startRecord;
$('snapshot').onclick = () => {
  if (experiment) download(renderer.png(),'iteration-'+sim.iteration+'.png');
  else canvas.toBlob(b=>save(b,'recursive-feedback.png'),'image/png');
};
$('downloadVideo').onclick=()=>save(videoBlob,latestVideoName);$('downloadSheet').onclick=()=>$('contact').toBlob(b=>save(b,'recursive-feedback-contact-sheet.png'),'image/png');$('downloadData').onclick=()=>save(metricsBlob,'recursive-feedback-metrics.json');$('copyState').onclick=()=>{const txt=JSON.stringify(state(),null,2);if(navigator.clipboard?.writeText)navigator.clipboard.writeText(txt).then(()=>$('status').textContent='Camera state copied').catch(()=>$('status').textContent=txt);else $('status').textContent=txt};
document.addEventListener('keydown',e=>{if(e.code==='Space'&&!e.repeat){if(e.target instanceof HTMLElement&&['SELECT','INPUT','TEXTAREA','BUTTON'].includes(e.target.tagName))return;e.preventDefault();startRecord()}else if(e.key==='Escape'&&recording){e.preventDefault();finishRecord(true)}});
window.rfLab={getState:state,record:startRecord,stopSpin:()=>(spin=null),getMetrics:()=>({...scores}),home,clear,
  experiment:{start:startExperiment,step:stepExperiment,end:endExperiment,png:renderer.png,measurement:()=>structuredClone(sim.latest)}};
})();
