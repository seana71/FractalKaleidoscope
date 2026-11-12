'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {parseArgs} = require('node:util');
const {spawnSync} = require('node:child_process');
const {launch, openViewer, framePNG} = require('./browser.cjs');

const writeJSON = (dir,name,value) => fs.writeFileSync(path.join(dir,name),JSON.stringify(value,null,2)+'\n');
const frameName = i => 'frame-'+String(i).padStart(8,'0')+'.png';

function newDirectory(dir) {
  fs.mkdirSync(path.dirname(dir),{recursive:true});
  fs.mkdirSync(dir); // Refuse to mix new and stale results.
}

function rank(rows) {
  const tail = rows.slice(-8);
  const average = fn => tail.reduce((sum,row) => sum+fn(row),0)/tail.length;
  const complexity = average(row=>row.complexity), structure = average(row=>row.structure);
  let recurrence = 0, bestLag = null;
  if (tail.length===8 && tail[0].lags[1] !== undefined) {
    const change = average(row=>row.lags[1]);
    for (const lag of Object.keys(tail[0].lags).map(Number)) {
      if (lag<2 || tail[0].iteration<2*lag || change===0) continue;
      const value = Math.max(0,1-average(row=>row.lags[lag])/change)*Math.min(1,change/2);
      if (value>recurrence) {recurrence=value; bestLag=lag;}
    }
  }
  return {score:(recurrence+complexity+structure)/3,recurrence,bestLag,complexity,structure};
}

function encode(dir,iterations,fps) {
  const result = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg',[
    '-hide_banner','-loglevel','error','-nostdin','-framerate',String(fps),
    '-start_number','0','-i',path.join(dir,'frame-%08d.png'),
    '-frames:v',String(iterations+1),'-c:v','ffv1','-pix_fmt','bgr0',
    '-progress','pipe:1',path.join(dir,'sequence.mkv')
  ],{encoding:'utf8',windowsHide:true});
  if (result.error) throw result.error;
  if (result.status) throw Error(result.stderr.trim());
  const encodedFrameCount = Number([...result.stdout.matchAll(/^frame=(\d+)\s*$/gm)].at(-1)?.[1]);
  if (encodedFrameCount !== iterations+1) throw Error('Unexpected FFmpeg output frame count');
  return {file:'sequence.mkv',codec:'FFV1',fps,encodedFrameCount,firstIteration:0,lastIteration:iterations};
}

async function run(page,dir,config,settings,environment) {
  const canonical = await page.evaluate(cfg=>rfLab.experiment.start(cfg),config);
  newDirectory(dir);
  writeJSON(dir,'config.json',canonical);
  const {iterations, selected, video, fps} = settings;
  const rows = [await page.evaluate(()=>rfLab.experiment.measurement())];
  let current = 0;
  const snapshots = new Set(selected);
  const checkpoints = new Set([...selected,iterations]);
  for (const target of checkpoints) {
    while (current<target) {
      const count = Math.min(32,target-current);
      rows.push(...await page.evaluate(n=>rfLab.experiment.step(n),count));
      current += count;
    }
    if (snapshots.has(target)) {
      fs.writeFileSync(path.join(dir,frameName(current)),await framePNG(page));
    }
  }
  const summary = {...rank(rows),kind:rows.at(-1).kind,period:rows.at(-1).period};
  const report = {version:1,iterations,selected,environment,grid:[Math.min(64,canonical.width),Math.min(40,canonical.height)],
    differenceUnit:'mean absolute RGB difference, percent of 255',summary,rows,video:null};
  writeJSON(dir,'measurements.json',report);
  if (video) {
    report.video = encode(dir,iterations,fps);
    writeJSON(dir,'measurements.json',report);
  }
  return summary;
}

function numbers(value,name) {
  const items = value.split(',');
  if (items.some(s=>!s.trim() || !Number.isFinite(Number(s)))) throw Error('Invalid '+name);
  return items.map(Number);
}

function orbit(base,yaw,elevation,roll,distance) {
  const y = yaw*Math.PI/180, p = -elevation*Math.PI/180;
  const sy=Math.sin(y/2), cy=Math.cos(y/2), sp=Math.sin(p/2), cp=Math.cos(p/2);
  // Compose yaw about world Y, pitch about local X, then roll about local Z.
  const [qx,qy,qz,qw] = [cy*sp,sy*cp,-sy*sp,cy*cp];
  const sr = Math.sin(roll*Math.PI/360), cr = Math.cos(roll*Math.PI/360);
  const orientation = [qx*cr+qy*sr,qy*cr-qx*sr,qz*cr+qw*sr,qw*cr-qz*sr];
  return {...base,camera:{...base.camera,orientation,
    position:[distance*Math.sin(y)*Math.cos(p),-distance*Math.sin(p),distance*Math.cos(y)*Math.cos(p)]}};
}

async function main() {
  const {values:o,positionals} = parseArgs({allowPositionals:true,options:{
    config:{type:'string'},out:{type:'string'},iterations:{type:'string',default:'64'},frames:{type:'string'},
    yaw:{type:'string',default:'0,30,60'},elevation:{type:'string',default:'0,20'},distance:{type:'string',default:'3,6'},roll:{type:'string',default:'0'},
    fps:{type:'string',default:'30'},video:{type:'boolean'},chromium:{type:'string'},hardware:{type:'boolean'}
  }});
  const [command] = positionals;
  if (positionals.length!==1 || !['run','sweep'].includes(command) || !o.out) {
    throw Error('Usage: node tools/lab.cjs run|sweep --out NEW_DIRECTORY [--config FILE] [--iterations N] [--frames 0,8,32|all] [--video] [--fps N] [--chromium PATH] [--hardware] [--yaw LIST --elevation LIST --roll LIST --distance LIST]');
  }
  const base = o.config ? JSON.parse(fs.readFileSync(o.config,'utf8').replace(/^\uFEFF/,'')) : {};
  const iterations=Number(o.iterations), fps=Number(o.fps);
  if (!Number.isSafeInteger(iterations) || iterations<0) throw Error('Invalid iteration count');
  if (!Number.isFinite(fps) || fps<=0) throw Error('Invalid playback rate');
  const wanted = !o.frames || o.frames==='all' ? [0,iterations] : numbers(o.frames,'frames');
  if (!wanted.every(i=>Number.isInteger(i) && i>=0 && i<=iterations)) throw Error('Selected frame out of range');
  const selected = o.video || o.frames==='all' ? Array.from({length:iterations+1},(_,i)=>i) : [...new Set(wanted)].sort((a,b)=>a-b);
  const settings = {iterations,fps,selected,video:o.video};
  const browser = await launch(o);
  try {
    const page = await openViewer(browser);
    const renderer = await page.evaluate(()=>{
      const gl=document.getElementById('view').getContext('webgl');
      const ext=gl.getExtension('WEBGL_debug_renderer_info');
      return gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER);
    });
    const environment = {browser:browser.version(),renderer,playwright:require('playwright-core/package.json').version};
    if (command==='run') {
      console.log(await run(page,o.out,base,settings,environment));
      return;
    }
    const yaws=numbers(o.yaw,'yaw'), elevations=numbers(o.elevation,'elevation'), distances=numbers(o.distance,'distance');
    const rolls = numbers(o.roll,'roll');
    if (distances.some(d=>d<0)) throw Error('Distances must be nonnegative');
    newDirectory(o.out);
    const results = [];
    for (const yaw of yaws) for (const elevation of elevations) for (const roll of rolls) for (const distance of distances) {
      const directory = 'run-'+String(results.length+1).padStart(4,'0');
      const summary = await run(page,path.join(o.out,directory),orbit(base,yaw,elevation,roll,distance),settings,environment);
      results.push({directory,yaw,elevation,roll,distance,...summary});
    }
    results.sort((a,b)=>b.score-a.score);
    writeJSON(o.out,'ranking.json',{iterations,yaws,elevations,rolls,distances,results});
    console.table(results);
  } finally {await browser.close();}
}

module.exports = {frameName,run,rank};
if (require.main===module) main().catch(error=>{console.error(error.message);process.exitCode=1;});
