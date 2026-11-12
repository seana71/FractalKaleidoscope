'use strict';

// Image coordinates have their origin at the top left. Readback starts at the bottom left.
function sampleFrame(rgba, width, height) {
  const w = Math.min(64,width), h = Math.min(40,height);
  const rgb = new Uint8Array(w*h*3);
  for (let y=0; y<h; y++) {
    const srcY = height-1-Math.floor((y+0.5)*height/h);
    for (let x=0; x<w; x++) {
      const srcX = Math.floor((x+0.5)*width/w);
      const src = 4*(srcY*width+srcX), dst = 3*(y*w+x);
      rgb[dst] = rgba[src];
      rgb[dst+1] = rgba[src+1];
      rgb[dst+2] = rgba[src+2];
    }
  }
  return {rgb,w,h};
}

function spatialMetrics({rgb,w,h}) {
  const bins = new Uint32Array(32), luma = new Uint8Array(w*h);
  let neighborSum = 0;
  for (let i=0; i<luma.length; i++) {
    const k = 3*i;
    const level = (54*rgb[k]+183*rgb[k+1]+19*rgb[k+2]) >> 11;
    bins[level]++;
    luma[i] = level;
    if (i%w) neighborSum += Math.abs(level-luma[i-1]);
    if (i>=w) neighborSum += Math.abs(level-luma[i-w]);
  }
  let entropy = 0, expectedDistance = 0, cumulative = 0;
  for (const count of bins) {
    const p = count/luma.length;
    if (p) entropy -= p*Math.log2(p);
    cumulative += p;
    // E|A-B| for two independent draws from the same discrete distribution.
    expectedDistance += 2*cumulative*(1-cumulative);
  }
  const pairs = (w-1)*h+(h-1)*w;
  const structure = expectedDistance>0 && pairs ? Math.max(0,1-neighborSum/pairs/expectedDistance) : 0;
  return {complexity:entropy/5,structure};
}

function classify(recent, iteration) {
  if (recent.length < 8 || recent[0][1] === undefined) return {kind:'warming up',period:null};
  const mean = lag => recent.reduce((total,row) => total+row[lag],0)/recent.length;
  const available = Object.keys(recent[0]).map(Number);
  for (const lag of available) {
    if (lag>1 && iteration>=2*lag+7 &&
        recent.every(row => row[lag]<=0.5) && mean(lag)<0.4*mean(1)) {
      return {kind:'likely periodic orbit',period:lag};
    }
  }
  if (available.every(lag => mean(lag) <= 0.15)) return {kind:'likely fixed point',period:1};
  return {kind:mean(1)<2?'slowly evolving':'evolving',period:null};
}

function createAnalysis() {
  const history = [], recent = [];
  return function measure(sample, iteration) {
    const lags = {};
    for (let lag=1; lag<=history.length; lag++) {
      const old = history[history.length-lag], rgb = sample.rgb;
      let sum = 0;
      for (let i=0; i<rgb.length; i++) sum += Math.abs(rgb[i]-old[i]);
      lags[lag] = 100*sum/(255*rgb.length);
    }
    history.push(sample.rgb);
    if (history.length>32) history.shift();
    recent.push(lags);
    if (recent.length>8) recent.shift();
    return {iteration,lags,...classify(recent,iteration),...spatialMetrics(sample)};
  };
}
