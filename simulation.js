'use strict';

function experimentConfig(input, limit) {
  const defaults = {
    version: 1, width: 640, height: 400, object: 'banana',
    camera: {position: [0,0,8], orientation: [0,0,0,1], fovDegrees: 180/3.1},
    initial: {type: 'solid', rgb: [5,8,14]}
  };
  const cfg = structuredClone({...defaults, ...input, camera: {...defaults.camera, ...input?.camera}});
  if (cfg.version !== 1) throw Error('Unsupported experiment version');
  for (const n of [cfg.width, cfg.height]) {
    if (!Number.isSafeInteger(n) || n < 1 || n > limit) throw RangeError('Invalid feedback dimensions');
  }
  if (!['banana','torus','sphere','cube','none'].includes(cfg.object)) throw Error('Unknown object');
  function vector(v, length) {
    return Array.isArray(v) && v.length === length && v.every(Number.isFinite);
  }
  const {position, orientation, fovDegrees} = cfg.camera;
  if (!vector(position, 3) || !vector(orientation, 4) || !Math.hypot(...orientation)) throw Error('Invalid camera pose');
  if (!(Number.isFinite(fovDegrees) && fovDegrees > 0 && fovDegrees < 180)) throw Error('Invalid vertical field of view');
  if (Math.abs(Math.hypot(...orientation)-1) > 1e-14) cfg.camera.orientation = qnorm(orientation);
  const seed = cfg.initial;
  if (seed.type === 'solid') {
    if (!vector(seed.rgb,3) || !seed.rgb.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) throw Error('Expected three RGB bytes');
  } else if (seed.type === 'noise') {
    if (!Number.isInteger(seed.seed) || seed.seed < 0 || seed.seed > 0xffffffff) throw Error('Expected uint32 noise seed');
  } else if (seed.type === 'rgb') {
    if (typeof seed.base64 !== 'string' || atob(seed.base64).length !== cfg.width*cfg.height*3) throw Error('Invalid top-down RGB data');
  } else throw Error('Unknown initial texture type');
  return cfg;
}

function seedPixels({width, height, initial}) {
  const pixels = new Uint8Array(width*height*4);
  let random = initial.seed;
  const raw = initial.type === 'rgb' ? atob(initial.base64) : null;
  for (let y=0; y<height; y++) {
    for (let x=0; x<width; x++) {
      const dst = 4*((height-1-y)*width+x);
      for (let c=0; c<3; c++) {
        if (raw !== null) pixels[dst+c] = raw.charCodeAt(3*(y*width+x)+c);
        else if (initial.type === 'solid') pixels[dst+c] = initial.rgb[c];
        else {
          random = (Math.imul(1664525,random) + 1013904223) >>> 0;
          pixels[dst+c] = random >>> 24;
        }
      }
      pixels[dst+3] = 255;
    }
  }
  return pixels;
}

function createSimulation(renderer) {
  let config, iteration = 0, analyze, latest;
  function measure() {
    const grid = sampleFrame(renderer.readPixels(), config.width, config.height);
    latest = analyze(grid,iteration);
    return latest;
  }
  function reset(input) {
    const next = experimentConfig(input, renderer.limit);
    renderer.reset(next.width, next.height, seedPixels(next));
    config = next;
    iteration = 0;
    analyze = createAnalysis();
    return measure();
  }
  function step(camera = config.camera, object = config.object) {
    renderer.advance(camera, object);
    iteration++;
    return measure();
  }
  return {reset, step, get latest() {return latest;}, get iteration() {return iteration;}, get config() {return structuredClone(config);}};
}
