'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {PNG} = require('pngjs');

// Independent oracle. Only the exported JSON and the decoded top-down PNGs enter here.
function checkFrames(dir) {
  const report = JSON.parse(fs.readFileSync(path.join(dir,'measurements.json'),'utf8'));
  const config = JSON.parse(fs.readFileSync(path.join(dir,'config.json'),'utf8'));
  const history = [];
  let comparisons = 0, maxError = 0;
  assert.equal(report.rows.length,report.iterations+1);
  for (let i=0; i<=report.iterations; i++) {
    const filename = 'frame-'+String(i).padStart(8,'0')+'.png';
    const img = PNG.sync.read(fs.readFileSync(path.join(dir,filename)));
    assert.equal(img.width,config.width);
    assert.equal(img.height,config.height);
    const w=Math.min(64,img.width), h=Math.min(40,img.height);
    const samples = [];
    for (let y=0; y<h; y++) for (let x=0; x<w; x++) {
      const px=Math.floor((2*x+1)*img.width/(2*w)), py=Math.floor((2*y+1)*img.height/(2*h));
      const offset=4*(py*img.width+px);
      samples.push(...img.data.subarray(offset,offset+3));
    }
    const row=report.rows[i];
    assert.equal(row.iteration,i);
    assert.equal(Object.keys(row.lags).length,history.length);
    history.forEach((previous,index)=>{
      const lag=history.length-index;
      const difference=samples.reduce((sum,v,k)=>sum+Math.abs(v-previous[k]),0);
      const expected=difference/samples.length*100/255;
      const error=Math.abs(expected-row.lags[lag]);
      assert.ok(error<1e-12,'Iteration '+i+', lag '+lag+' differs by '+error);
      maxError=Math.max(maxError,error);
      comparisons++;
    });
    history.push(samples);
    if (history.length>32) history.shift();
  }
  return {frames:report.rows.length,comparisons,maxError};
}

module.exports = {checkFrames};
if (require.main===module) console.log(checkFrames(process.argv[2]));
