'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {run} = require('./lab.cjs');
const {checkFrames} = require('./check-frames.cjs');
const {PNG} = require('pngjs');
const {launch,openViewer,framePNG} = require('./browser.cjs');

async function sequence() {
  const browser = await launch();
  try {
    const page = await openViewer(browser);
    const cfg = {width:97, height:61, initial:{type:'noise',seed:19}, camera:{position:[1,0,6]}};
    await page.evaluate(cfg => rfLab.experiment.start(cfg),cfg);
    const frames = [];
    for (let i=0; i<=8; i++) {
      if (i) await page.evaluate(() => rfLab.experiment.step(1));
      frames.push(PNG.sync.read(await framePNG(page)).data);
    }
    assert.notDeepEqual(frames[1],frames[8]);
    assert.equal(await page.evaluate(() => document.querySelector('#view').getContext('webgl').getError()),0);
    return frames;
  } finally { await browser.close(); }
}

async function analysisAndControls() {
  const browser = await launch();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'feedback-test-'));
  try {
    const page = await openViewer(browser);
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    const config = {width:97,height:61,camera:{position:[0.8,0.1,1.6], fovDegrees:73},
      object:'torus',initial:{type:'noise',seed:0}};
    const selected = Array.from({length:41},(_,i)=>i);
    const dir = path.join(temp,'run');
    await run(page,dir,config,{iterations:40,selected,video:false},{browser:browser.version()});
    console.log('Independent PNG analysis',checkFrames(dir));

    const canonical = JSON.parse(fs.readFileSync(path.join(dir,'config.json'),'utf8'));
    const poses = await page.evaluate(cfg=>{
      const e = rfLab.experiment;
      e.start(cfg);
      const before = rfLab.getState();
      const rows = e.step(40);
      return {before,after:rfLab.getState(),iterations:rows.map(row=>row.iteration)};
    },canonical);
    assert.deepEqual(poses.iterations,selected.slice(1));
    assert.deepEqual(poses.before.camera,poses.after.camera);
    assert.deepEqual(PNG.sync.read(await framePNG(page)).data,
      PNG.sync.read(fs.readFileSync(path.join(dir,'frame-00000040.png'))).data);

    const canvas = page.locator('#view');
    const box = await canvas.boundingBox();
    const x = box.x+box.width/2, y = box.y+box.height/2;
    await page.mouse.move(x,y);
    await page.mouse.down();
    await page.mouse.move(x+52,y-20,{steps:4});
    await page.mouse.up();
    await page.mouse.wheel(0,-180);
    await page.keyboard.press('Space');
    // Give inertial input and the display scheduler opportunities to interfere.
    await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
    assert.deepEqual(await page.evaluate(()=>rfLab.getState()),poses.after);
    assert.deepEqual(await page.evaluate(()=>rfLab.experiment.step(0)),[]);
    await assert.rejects(page.evaluate(()=>rfLab.experiment.step(-1)));

    // The square back wall fills the frame. With 180 degrees of roll it flips each image.
    const halfTurn = require('../examples/half-turn.json');
    const quarterTurn = structuredClone(halfTurn);
    quarterTurn.camera.orientation = [0,0,Math.SQRT1_2,Math.SQRT1_2];
    for (const [cfg,period] of [[halfTurn,2],[quarterTurn,4]]) {
      const halfPeriod = period/2;
      await page.evaluate(({cfg,start})=>{
        rfLab.experiment.start(cfg);
        rfLab.experiment.step(start);
      },{cfg,start:160-period});
      const first = PNG.sync.read(await framePNG(page)).data;
      await page.evaluate(n=>rfLab.experiment.step(n),halfPeriod);
      const middle = PNG.sync.read(await framePNG(page)).data;
      const rows = await page.evaluate(n=>rfLab.experiment.step(n),halfPeriod);
      const last = PNG.sync.read(await framePNG(page)).data;
      assert.equal(rows.at(-1).iteration,160);
      assert.equal(rows.at(-1).period,period);
      assert.equal(rows.at(-1).lags[period],0);
      assert.ok(rows.at(-1).lags[halfPeriod]>10);
      assert.deepEqual(last,first,`Full RGBA mismatch at lag ${period}`);
      assert.notDeepEqual(last,middle,`Unexpected full RGBA match at lag ${halfPeriod}`);
    }

    const rgbConfig = {width:2,height:2,initial:{type:'rgb',base64:Buffer.from([
      255,0,0, 0,255,0, 0,0,255, 255,255,255
    ]).toString('base64')}};
    await page.evaluate(cfg=>rfLab.experiment.start(cfg),rgbConfig);
    assert.deepEqual([...PNG.sync.read(await framePNG(page)).data],
      [255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]);

    const diagnoses = await page.evaluate(()=>{
      return ['constant','three','thirtyTwo','drift'].map(kind=>{
        const analyze = createAnalysis();
        let row;
        for (let i=0; i<80; i++) {
          const level = {constant:31,three:80*(i%3),thirtyTwo:(13*(i%32))%256,drift:i}[kind];
          row = analyze({rgb:Uint8Array.of(level,level,level),w:1,h:1},i);
        }
        return [row.kind,row.period];
      });
    });
    assert.deepEqual(diagnoses,[['likely fixed point',1],['likely periodic orbit',3],
      ['likely periodic orbit',32],['slowly evolving',null]]);

    await page.click('#experiment');
    const live = await page.evaluate(()=>rfLab.getState());
    await canvas.hover();
    const liveBox = await canvas.boundingBox();
    const centerX = liveBox.x+liveBox.width/2, centerY = liveBox.y+liveBox.height/2;
    await page.mouse.move(centerX,centerY);
    await page.mouse.down();
    await page.mouse.move(centerX+55,centerY+30,{steps:5});
    await page.mouse.up();
    const spinStart = await page.evaluate(()=>rfLab.getState());
    assert.ok(spinStart.spinning,'Arcball release should start inertia');
    await page.waitForFunction(start=>rfLab.getState().feedbackFrame>=start+24,spinStart.feedbackFrame);
    const spinLater = await page.evaluate(()=>rfLab.getState());
    assert.deepEqual(spinLater.spin,spinStart.spin,'Inertial angular speed and axis must stay constant');
    assert.notDeepEqual(spinLater.quaternion,spinStart.quaternion);
    await page.click('#stop');
    assert.equal(await page.evaluate(()=>rfLab.getState().spinning),false);
    await canvas.hover();
    await page.mouse.wheel(0,-150);
    await page.waitForFunction(d=>rfLab.getState().distance<d,live.distance);
    assert.notDeepEqual((await page.evaluate(()=>rfLab.getState())).quaternion,live.quaternion);
    await page.selectOption('#count','32');
    await canvas.focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(()=>!document.getElementById('downloadVideo').disabled);
    const download = page.waitForEvent('download');
    await page.click('#downloadData');
    const metrics = JSON.parse(fs.readFileSync(await (await download).path(),'utf8'));
    assert.equal(metrics.samples.length,32);
    assert.equal(metrics.encoderFrameRequests,32);
    assert.equal(metrics.encodedFrameCount,null);
    assert.equal(metrics.samples.at(-1).feedbackIteration-metrics.samples[0].feedbackIteration,31);
    assert.deepEqual(errors,[]);
    console.log('Passed camera isolation, batch replay, seed orientation, diagnoses, undamped arcball rotation, Stop spin, dolly and Space recording.');
  } finally {
    await browser.close();
    fs.rmSync(temp,{recursive:true,force:true});
  }
}

(async () => {
  assert.deepEqual(await sequence(), await sequence());
  console.log('Two independent browser processes matched every RGBA byte at iterations 0 through 8.');
  await analysisAndControls();
})().catch(error => {console.error(error); process.exitCode=1;});
