'use strict';
const sub=(a,b)=>a.map((x,i)=>x-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>{let l=Math.hypot(...a)||1;return a.map(x=>x/l)};
function perspective(fov,asp,n,f){let m=new Float32Array(16),s=1/Math.tan(fov/2);m[0]=s/asp;m[5]=s;m[10]=(f+n)/(n-f);m[11]=-1;m[14]=2*n*f/(n-f);return m}
function lookAt(eye,target,up){let z=norm(sub(eye,target)),x=norm(cross(up,z)),y=cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-x.reduce((s,v,i)=>s+v*eye[i],0),-y.reduce((s,v,i)=>s+v*eye[i],0),-z.reduce((s,v,i)=>s+v*eye[i],0),1])}
function qm([ax,ay,az,aw], [bx,by,bz,bw]) {
  return [
    aw*bx + ax*bw + ay*bz - az*by,
    aw*by - ax*bz + ay*bw + az*bx,
    aw*bz + ax*by - ay*bx + az*bw,
    aw*bw - ax*bx - ay*by - az*bz
  ];
}
function qnorm(q){let l=Math.hypot(...q)||1;return q.map(x=>x/l)}
function qaxis(a,angle){a=norm(a);let s=Math.sin(angle/2);return[a[0]*s,a[1]*s,a[2]*s,Math.cos(angle/2)]}
function rotated(q,v){return qm(qm(q,[...v,0]),[-q[0],-q[1],-q[2],q[3]]).slice(0,3)}
function qbetween(a,b){let w=1+a.reduce((s,x,i)=>s+x*b[i],0);return w<.00001?qaxis([0,1,0],Math.PI):qnorm([...cross(a,b),w])}

function createFeedbackRenderer(gl) {
const vs=`attribute vec3 p,n;attribute vec2 t;uniform mat4 P,V;varying vec2 uv;varying vec3 N;void main(){uv=t;N=n;gl_Position=P*V*vec4(p,1.);}`;
const fs=`precision highp float;varying vec2 uv;varying vec3 N;uniform sampler2D prev;uniform float kind;void main(){if(kind<.5){vec3 c=texture2D(prev,clamp(uv,vec2(.0001),vec2(.9999))).rgb;c=c*vec3(.996,.995,.996)+vec3(.0006,.0007,.0011);gl_FragColor=vec4(c,1.);}else{float light=.38+.62*max(0.,dot(normalize(N),normalize(vec3(-.4,.8,1.))));float spec=.16*pow(max(0.,dot(reflect(normalize(vec3(.4,-.8,-1.)),normalize(N)),normalize(vec3(.2,.3,1.)))),26.);vec3 col;if(kind<1.5){float f=smoothstep(.02,.17,uv.x)*smoothstep(.98,.83,uv.x);col=mix(vec3(.38,.24,.05),vec3(.97,.80,.13),f);col+=vec3(.06,.035,0.)*pow(.5+.5*sin(uv.y*40.+uv.x*14.),12.);}else if(kind<2.5){col=.48+.46*cos(6.28318*(vec3(0.,.33,.67)+uv.x+uv.y*.2));}else if(kind<3.5){col=.48+.46*cos(6.28318*(vec3(.1,.45,.8)+uv.x*.65+uv.y*.2));}else{col=vec3(.3,.7,.95)*(.85+.15*cos(uv.x*15.));}gl_FragColor=vec4(col*light+spec,1.);}}`;
const sv=`attribute vec2 p;varying vec2 uv;void main(){uv=(p+1.)*.5;gl_Position=vec4(p,0.,1.);}`;
const sf=`precision mediump float;varying vec2 uv;uniform sampler2D tex;void main(){gl_FragColor=texture2D(tex,uv);}`;
function shader(t,s){const x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);if(!gl.getShaderParameter(x,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(x));return x}
function program(a,b){const x=gl.createProgram();gl.attachShader(x,shader(gl.VERTEX_SHADER,a));gl.attachShader(x,shader(gl.FRAGMENT_SHADER,b));gl.linkProgram(x);if(!gl.getProgramParameter(x,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(x));return x}
const pg = program(vs, fs);
const screen = program(sv, sf);
const a={p:gl.getAttribLocation(pg,'p'),n:gl.getAttribLocation(pg,'n'),t:gl.getAttribLocation(pg,'t')},u={P:gl.getUniformLocation(pg,'P'),V:gl.getUniformLocation(pg,'V'),prev:gl.getUniformLocation(pg,'prev'),kind:gl.getUniformLocation(pg,'kind')},sp=gl.getAttribLocation(screen,'p'),st=gl.getUniformLocation(screen,'tex');
function buffer(data){let b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);return b}
function mesh(data){return{b:buffer(data),n:data.length/8}}
function put(d,p,n,t){d.push(...p,...n,...t)}
function quad(d,a,b,c,e,n){for(let [p,t] of [[a,[0,0]],[b,[1,0]],[c,[1,1]],[a,[0,0]],[c,[1,1]],[e,[0,1]]])put(d,p,n,t)}
const S=2.5,faces=[
[[-S,-S,-S],[S,-S,-S],[S,S,-S],[-S,S,-S],[0,0,1]],
[[S,-S,S],[-S,-S,S],[-S,S,S],[S,S,S],[0,0,-1]],
[[-S,-S,S],[-S,-S,-S],[-S,S,-S],[-S,S,S],[1,0,0]],
[[S,-S,-S],[S,-S,S],[S,S,S],[S,S,-S],[-1,0,0]],
[[-S,S,-S],[S,S,-S],[S,S,S],[-S,S,S],[0,-1,0]],
[[-S,-S,S],[S,-S,S],[S,-S,-S],[-S,-S,-S],[0,1,0]]];
const room=faces.map(f=>{let d=[];quad(d,...f);return mesh(d)});
function surface(nu,nv,fn){let d=[];for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){let a=fn(i/nu,j/nv),b=fn((i+1)/nu,j/nv),c=fn((i+1)/nu,(j+1)/nv),e=fn(i/nu,(j+1)/nv),n=norm(cross(sub(b,a),sub(e,a)));for(let [p,t] of [[a,[i/nu,j/nv]],[b,[(i+1)/nu,j/nv]],[c,[(i+1)/nu,(j+1)/nv]],[a,[i/nu,j/nv]],[c,[(i+1)/nu,(j+1)/nv]],[e,[i/nu,(j+1)/nv]]])put(d,p,n,t)}return mesh(d)}
const objects={banana:surface(64,20,(u,v)=>{let a=(u-.5)*2.3,r=.31*Math.pow(Math.max(.000001,Math.sin(Math.PI*u)),.65)+.018,t=2*Math.PI*v;return[1.1*Math.sin(a)+r*Math.sin(a)*Math.cos(t),.86*Math.cos(a)-.43+r*Math.cos(a)*Math.cos(t),r*.85*Math.sin(t)]}),torus:surface(96,24,(u,v)=>{let a=u*2*Math.PI,b=v*2*Math.PI,r=.28,R=.85;return[(R+r*Math.cos(b))*Math.cos(a),(R+r*Math.cos(b))*Math.sin(a),r*Math.sin(b)]}),sphere:surface(48,24,(u,v)=>{let a=u*2*Math.PI,b=v*Math.PI;return[Math.sin(b)*Math.cos(a),Math.cos(b),Math.sin(b)*Math.sin(a)]}),cube:(()=>{let d=[],s=.86;for(let f of [[[-s,-s,s],[s,-s,s],[s,s,s],[-s,s,s],[0,0,1]],[[s,-s,-s],[-s,-s,-s],[-s,s,-s],[s,s,-s],[0,0,-1]],[[-s,-s,-s],[-s,-s,s],[-s,s,s],[-s,s,-s],[-1,0,0]],[[s,-s,s],[s,-s,-s],[s,s,-s],[s,s,s],[1,0,0]],[[-s,s,s],[s,s,s],[s,s,-s],[-s,s,-s],[0,1,0]],[[-s,-s,-s],[s,-s,-s],[s,-s,s],[-s,-s,s],[0,-1,0]]])quad(d,...f);return mesh(d)})()};

const screenBuffer=buffer([-1,-1,1,-1,-1,1,1,1]);
function drawMesh(m){gl.bindBuffer(gl.ARRAY_BUFFER,m.b);gl.enableVertexAttribArray(a.p);gl.vertexAttribPointer(a.p,3,gl.FLOAT,false,32,0);gl.enableVertexAttribArray(a.n);gl.vertexAttribPointer(a.n,3,gl.FLOAT,false,32,12);gl.enableVertexAttribArray(a.t);gl.vertexAttribPointer(a.t,2,gl.FLOAT,false,32,24);gl.drawArrays(gl.TRIANGLES,0,m.n)}
function drawScene(dst,src,camera,object){gl.bindFramebuffer(gl.FRAMEBUFFER,dst);gl.viewport(0,0,W,H);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);gl.frontFace(gl.CCW);gl.clearColor(.01,.016,.03,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);const {position:eye,orientation:quat,fovDegrees}=camera;const target=sub(eye,rotated(quat,[0,0,1]));gl.useProgram(pg);gl.uniformMatrix4fv(u.P,false,perspective(fovDegrees*Math.PI/180,W/H,.025,100));gl.uniformMatrix4fv(u.V,false,lookAt(eye,target,rotated(quat,[0,1,0])));gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,src);gl.uniform1i(u.prev,0);gl.uniform1f(u.kind,0);for(let m of room)drawMesh(m);let k=object;if(objects[k]){gl.disable(gl.CULL_FACE);gl.uniform1f(u.kind,k==='banana'?1:k==='torus'?2:k==='sphere'?3:4);drawMesh(objects[k])}}
function blit(src,dst,w,h){gl.bindFramebuffer(gl.FRAMEBUFFER,dst);gl.viewport(0,0,w,h);gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.useProgram(screen);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,src);gl.uniform1i(st,0);gl.bindBuffer(gl.ARRAY_BUFFER,screenBuffer);gl.disableVertexAttribArray(a.n);gl.disableVertexAttribArray(a.t);gl.enableVertexAttribArray(sp);gl.vertexAttribPointer(sp,2,gl.FLOAT,false,0,0);gl.drawArrays(gl.TRIANGLE_STRIP,0,4)}
let W = 0, H = 0, targets = [], front = 0, readback;
const limit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));

function dispose(target) {
  gl.deleteRenderbuffer(target.depth);
  gl.deleteFramebuffer(target.framebuffer);
  gl.deleteTexture(target.texture);
}

function allocate(width, height) {
  const texture = gl.createTexture(), framebuffer = gl.createFramebuffer(), depth = gl.createRenderbuffer();
  const target = {texture, framebuffer, depth};
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    dispose(target);
    throw Error('Could not allocate a complete feedback framebuffer');
  }
  return target;
}

function reset(width, height, pixels) {
  if (W !== width || H !== height) {
    const next = [];
    try {
      for (let i = 0; i < 2; i++) next.push(allocate(width, height));
    } catch (error) {
      next.forEach(dispose);
      throw error;
    }
    targets.forEach(dispose);
    targets = next;
    W = width;
    H = height;
  }
  for (const {texture} of targets) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  }
  front = 0;
}

function advance(camera, object) {
  if (gl.isContextLost()) throw Error('WebGL context lost. Reload to restart the experiment.');
  drawScene(targets[1-front].framebuffer, targets[front].texture, camera, object);
  front = 1-front;
}

function readPixels() {
  if (readback?.length !== W*H*4) readback = new Uint8Array(W*H*4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, targets[front].framebuffer);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, readback);
  return readback;
}

function png() {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(W,H);
  const rgba = readPixels();
  for (let y = 0; y < H; y++) {
    const src = (H-1-y)*W*4;
    image.data.set(rgba.subarray(src, src+W*4), y*W*4);
  }
  ctx.putImageData(image,0,0);
  return canvas.toDataURL('image/png');
}

return {reset, advance, readPixels, png, limit,
  present() { blit(targets[front].texture, null, gl.drawingBufferWidth, gl.drawingBufferHeight); }
};
}
