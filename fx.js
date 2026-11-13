// fx.js: what the moves look like.
// It only draws things. It reads the battle state and the events sent by game.js,
// and turns them into shader effects, particles and glow. Nothing in here changes
// how the game plays.
(function () {
  'use strict';

  // ---------------------------------------------------------------
  // GLSL helpers: 3D simplex noise (by Ashima Arts / Stefan Gustavson) and fbm
  // ---------------------------------------------------------------
  const NOISE = `
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }
  float fbm(vec3 p){ float f=0.0, a=0.5; for(int i=0;i<3;i++){ f+=a*snoise(p); p*=2.03; a*=0.5; } return f; }
  `;
  const UV_VERT = `
  varying vec2 vUv; varying vec3 vPos;
  void main(){ vUv=uv; vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
  const FRESNEL_VERT = `
  varying vec3 vN; varying vec3 vV; varying vec3 vPos;
  void main(){ vPos=position; vec4 mv=modelViewMatrix*vec4(position,1.0);
    vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`;

  const TAU = Math.PI * 2;
  const V3 = (x, y, h) => new THREE.Vector3(x, h, y);   // game coords (x, y, height) to 3D world coords
  const col = (c) => new THREE.Color(c);

  function shaderMat(frag, uniforms, opts) {
    opts = opts || {};
    return new THREE.ShaderMaterial({
      uniforms: Object.assign({ uTime: { value: 0 }, uI: { value: 0 } }, uniforms),
      vertexShader: opts.vert || UV_VERT,
      fragmentShader: NOISE + frag,
      transparent: true,
      depthWrite: false,
      side: opts.side == null ? THREE.DoubleSide : opts.side,
      blending: opts.normal ? THREE.NormalBlending : THREE.AdditiveBlending
    });
  }

  // ---------------------------------------------------------------
  // Materials
  // ---------------------------------------------------------------
  // Fire on a cylinder or cone (uv.x goes around, uv.y goes up). The noise wraps, so no seam.
  function fireMat(core, mid, edge, opts) {
    return shaderMat(`
      uniform float uTime, uI, uSpeed, uDark; uniform vec3 uCore, uMid, uEdge;
      varying vec2 vUv;
      void main(){
        float a = vUv.x * 6.2831853;
        vec3 p = vec3(cos(a) * 1.6, sin(a) * 1.6, vUv.y * 3.0 - uTime * uSpeed);
        float n = fbm(p) * 0.85 + 0.5 * fbm(p * 2.3 + vec3(3.1, 1.7, -uTime * 0.8));
        float shape = (1.0 - vUv.y) * 1.25 + n * 0.85 - 0.45;
        float flame = smoothstep(0.0, 0.42, shape);
        float hot = smoothstep(0.45, 0.95, shape);
        vec3 c = mix(uEdge, uMid, flame); c = mix(c, uCore, hot);
        float alpha = flame * uI * smoothstep(0.0, 0.08, vUv.y);
        gl_FragColor = vec4(c * (0.75 + 0.45 * hot * (1.0 - uDark)), alpha);
      }`, {
      uCore: { value: col(core) }, uMid: { value: col(mid) }, uEdge: { value: col(edge) },
      uSpeed: { value: (opts && opts.speed) || 2.4 }, uDark: { value: (opts && opts.dark) ? 1 : 0 }
    }, { normal: !!(opts && opts.dark) });
  }
  // Spiral streaks for the tornado funnel.
  function windMat(base, hi, opts) {
    return shaderMat(`
      uniform float uTime, uI, uTwist, uSpeed; uniform vec3 uBase, uHi;
      varying vec2 vUv;
      void main(){
        float s = vUv.x + vUv.y * uTwist - uTime * uSpeed;
        float a = s * 6.2831853;
        vec3 p = vec3(cos(a) * 1.4, sin(a) * 1.4, vUv.y * 5.0 - uTime * 1.5);
        float n = fbm(p);
        float bands = smoothstep(0.05, 0.55, n + 0.25 * sin(a * 3.0));
        float edge = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.72, vUv.y);
        vec3 c = mix(uBase, uHi, bands);
        gl_FragColor = vec4(c, (0.22 + 0.78 * bands) * edge * uI);
      }`, { uBase: { value: col(base) }, uHi: { value: col(hi) }, uTwist: { value: (opts && opts.twist) || 1.6 },
            uSpeed: { value: (opts && opts.speed) || 1.4 } }, { normal: !!(opts && opts.normal) });
  }
  // Polar effects on a flat disc: whirlpool, ice sheet, ground glow.
  function whirlpoolMat() {
    return shaderMat(`
      uniform float uTime, uI; varying vec2 vUv;
      void main(){
        vec2 p = vUv * 2.0 - 1.0; float r = length(p); if (r > 1.0) discard;
        float ang = atan(p.y, p.x);
        float swirl = ang + log(r + 0.03) * 2.4 + uTime * 3.2;
        vec3 q = vec3(cos(swirl) * 2.0, sin(swirl) * 2.0, r * 3.0 - uTime * 0.6);
        float n = fbm(q);
        float arms = 0.5 + 0.5 * sin(swirl * 3.0 + n * 2.5);
        float foam = smoothstep(0.72, 0.98, arms + n * 0.35) * smoothstep(0.15, 0.45, r);
        vec3 deep = vec3(0.01, 0.08, 0.18), mid = vec3(0.05, 0.38, 0.62), hi = vec3(0.85, 0.97, 1.0);
        vec3 c = mix(deep, mid, smoothstep(0.05, 0.9, r) * (0.6 + 0.4 * arms));
        c = mix(c, hi, foam);
        float rim = smoothstep(0.82, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
        c += vec3(0.6, 0.9, 1.0) * rim * 0.8;
        float alpha = (0.55 + 0.35 * arms) * smoothstep(1.0, 0.92, r) * uI;
        gl_FragColor = vec4(c, alpha);
      }`, {}, { normal: true });
  }
  function iceSheetMat() {
    return shaderMat(`
      uniform float uTime, uI, uSpread; uniform vec2 uOrigin; varying vec2 vUv;
      void main(){
        vec2 p = vUv * 2.0 - 1.0; float r = length(p); if (r > 1.0) discard;
        float reach = length(p - uOrigin);
        float mask = 1.0 - smoothstep(uSpread - 0.18, uSpread, reach);
        float n = fbm(vec3(p * 5.0, 0.0));
        float ridge = 1.0 - abs(snoise(vec3(p * 9.0, 1.7)));
        float cracks = smoothstep(0.9, 0.99, ridge);
        float glint = pow(max(0.0, snoise(vec3(p * 22.0, uTime * 0.6))), 8.0) * 3.0;
        vec3 c = mix(vec3(0.55, 0.78, 0.95), vec3(0.9, 0.98, 1.0), 0.5 + 0.5 * n);
        c += vec3(1.0) * (cracks * 0.4 + glint * 0.5);
        float edgeGlow = smoothstep(uSpread - 0.25, uSpread, reach) * mask;
        c += vec3(0.6, 0.9, 1.0) * edgeGlow;
        gl_FragColor = vec4(min(c, vec3(1.0)), (0.16 + cracks * 0.22 + edgeGlow * 0.3) * mask * uI);
      }`, { uSpread: { value: 0 }, uOrigin: { value: new THREE.Vector2() } }, { normal: true });
  }
  // A soft ring on a disc: shockwaves, reticles, timing rings, telegraph markers.
  function ringMat(color, opts) {
    return shaderMat(`
      uniform float uTime, uI, uR, uW, uSeg, uFill; uniform vec3 uColor; varying vec2 vUv;
      void main(){
        vec2 p = vUv * 2.0 - 1.0; float r = length(p); if (r > 1.0) discard;
        float ring = smoothstep(uR - uW, uR, r) * (1.0 - smoothstep(uR, uR + uW, r));
        float seg = 1.0;
        if (uSeg > 0.5) { float a = atan(p.y, p.x) + uTime * 1.5; seg = step(0.35, fract(a / 6.2831853 * uSeg)); }
        float fill = uFill * (1.0 - smoothstep(0.0, uR, r)) * 0.35;
        gl_FragColor = vec4(uColor, (ring * seg + fill) * uI);
      }`, { uColor: { value: col(color) }, uR: { value: 0.8 }, uW: { value: 0.06 }, uSeg: { value: (opts && opts.seg) || 0 },
            uFill: { value: (opts && opts.fill) || 0 } }, { normal: !!(opts && opts.normal) });
  }
  // Energy shell with a bright edge and a tinted inside (dark domes, shells, ice crystals).
  function fresnelMat(inner, rim, opts) {
    opts = opts || {};
    return shaderMat(`
      uniform float uTime, uI, uInnerA, uPow, uHex; uniform vec3 uInner, uRim;
      varying vec3 vN; varying vec3 vV; varying vec3 vPos;
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPow);
        float n = fbm(vPos * 0.06 + vec3(0.0, -uTime * 0.5, uTime * 0.2));
        float hex = 0.0;
        if (uHex > 0.5) {
          vec2 q = vec2(atan(vPos.z, vPos.x) * 3.0, vPos.y * 0.35);
          vec2 hq = vec2(q.x + q.y * 0.5, q.y * 0.866);
          vec2 gq = abs(fract(hq) - 0.5);
          hex = smoothstep(0.42, 0.5, max(gq.x, gq.y));
        }
        vec3 c = mix(uInner, uRim, clamp(f + hex * 0.8, 0.0, 1.0));
        float a = (uInnerA * (0.7 + 0.6 * n) + f + hex * 0.6) * uI;
        gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
      }`, { uInner: { value: col(inner) }, uRim: { value: col(rim) }, uInnerA: { value: opts.innerA == null ? 0.2 : opts.innerA },
            uPow: { value: opts.pow || 2.2 }, uHex: { value: opts.hex ? 1 : 0 } },
      { vert: FRESNEL_VERT, normal: opts.normal, side: opts.side == null ? THREE.FrontSide : opts.side });
  }
  // Energy flowing along a tube (tendrils, lightning glow, beams).
  function flowMat(color, opts) {
    return shaderMat(`
      uniform float uTime, uI; uniform vec3 uColor; varying vec2 vUv;
      void main(){
        float n = snoise(vec3(vUv.x * 8.0 - uTime * 6.0, vUv.y * 2.0, uTime));
        float a = (0.55 + 0.45 * n) * uI * smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
        gl_FragColor = vec4(uColor * (1.2 + 0.8 * n), a);
      }`, { uColor: { value: col(color) } }, { normal: !!(opts && opts.normal) });
  }
  // Ribbon of wind along a path (Dragoon's gale trail).
  function ribbonMat(color) {
    return shaderMat(`
      uniform float uTime, uI; uniform vec3 uColor; varying vec2 vUv;
      void main(){
        float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
        float n = fbm(vec3(vUv.x * 7.0 - uTime * 5.0, vUv.y * 3.0, uTime * 0.7));
        float streak = smoothstep(-0.1, 0.5, n);
        gl_FragColor = vec4(uColor, pow(across, 1.4) * streak * uI * smoothstep(0.0, 0.15, vUv.x));
      }`, { uColor: { value: col(color) } }, { normal: false });
  }

  // ---------------------------------------------------------------
  // Particles. One pool glows (fire, sparks, energy) and one doesn't (smoke, snow,
  // spray, debris). Both reuse a fixed set of slots.
  // ---------------------------------------------------------------
  const P_VERT = `
    attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
    varying float vA; varying vec3 vC; uniform float uScale;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize * uScale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; vA = aAlpha; vC = aColor; }`;
  const P_FRAG = `
    varying float vA; varying vec3 vC; uniform float uSoft;
    void main(){ vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0; if (r > 1.0) discard;
      gl_FragColor = vec4(vC, vA * pow(1.0 - r, uSoft)); }`;
  class Pool {
    constructor(cap, additive, soft) {
      this.cap = cap; this.head = 0;
      const F = (n) => new Float32Array(cap * n);
      this.p = F(3); this.v = F(3); this.c0 = F(3); this.c1 = F(3);
      this.life = F(1); this.age = F(1); this.s0 = F(1); this.s1 = F(1); this.a0 = F(1);
      this.drag = F(1); this.grav = F(1);
      this.cOut = F(3); this.sOut = F(1); this.aOut = F(1);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
      g.setAttribute('aColor', new THREE.BufferAttribute(this.cOut, 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(this.sOut, 1));
      g.setAttribute('aAlpha', new THREE.BufferAttribute(this.aOut, 1));
      this.mat = new THREE.ShaderMaterial({
        uniforms: { uScale: { value: 400 }, uSoft: { value: soft || 1.4 } },
        vertexShader: P_VERT, fragmentShader: P_FRAG, transparent: true, depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
      });
      this.points = new THREE.Points(g, this.mat);
      this.points.frustumCulled = false;
      this.points.renderOrder = additive ? 20 : 19;
      this.geo = g;
    }
    // o: {x,y,h, vx,vy,vh, life, size, size1, color, color1, alpha, drag, grav, boost}
    emit(o) {
      const i = this.head; this.head = (this.head + 1) % this.cap;
      const i3 = i * 3;
      this.p[i3] = o.x; this.p[i3 + 1] = o.h || 0; this.p[i3 + 2] = o.y;
      this.v[i3] = o.vx || 0; this.v[i3 + 1] = o.vh || 0; this.v[i3 + 2] = o.vy || 0;
      const c0 = o.color instanceof THREE.Color ? o.color : col(o.color || 0xffffff);
      const c1 = o.color1 ? (o.color1 instanceof THREE.Color ? o.color1 : col(o.color1)) : c0;
      const b = o.boost || 1;
      this.c0[i3] = c0.r * b; this.c0[i3 + 1] = c0.g * b; this.c0[i3 + 2] = c0.b * b;
      this.c1[i3] = c1.r * b; this.c1[i3 + 1] = c1.g * b; this.c1[i3 + 2] = c1.b * b;
      this.life[i] = o.life || 0.6; this.age[i] = 0;
      this.s0[i] = o.size || 8; this.s1[i] = o.size1 == null ? this.s0[i] : o.size1;
      this.a0[i] = o.alpha == null ? 1 : o.alpha;
      this.drag[i] = o.drag || 0; this.grav[i] = o.grav || 0;
    }
    update(dt) {
      for (let i = 0; i < this.cap; i++) {
        const L = this.life[i];
        if (this.age[i] >= L) { this.aOut[i] = 0; this.sOut[i] = 0; continue; }
        this.age[i] += dt;
        const t = Math.min(1, this.age[i] / L);
        const i3 = i * 3, k = Math.max(0, 1 - this.drag[i] * dt);
        this.v[i3] *= k; this.v[i3 + 1] = this.v[i3 + 1] * k + this.grav[i] * dt; this.v[i3 + 2] *= k;
        this.p[i3] += this.v[i3] * dt; this.p[i3 + 1] += this.v[i3 + 1] * dt; this.p[i3 + 2] += this.v[i3 + 2] * dt;
        if (this.p[i3 + 1] < 0.5 && this.grav[i] < 0) { this.p[i3 + 1] = 0.5; this.v[i3 + 1] *= -0.3; }
        this.sOut[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
        this.aOut[i] = this.a0[i] * Math.min(1, t / 0.08) * (1 - t);
        this.cOut[i3] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
        this.cOut[i3 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
        this.cOut[i3 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
      }
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aColor.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
    }
    clear() { this.age.fill(0); this.life.fill(0); }
  }

  // Lightning: a jagged line turned into a tube, white in the middle with a colored glow.
  function boltPoints(a, b, jitter, segs) {
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = a.clone().lerp(b, t);
      if (i > 0 && i < segs) {
        const j = jitter * Math.sin(t * Math.PI);
        p.x += (Math.random() - 0.5) * j; p.y += (Math.random() - 0.5) * j * 0.5; p.z += (Math.random() - 0.5) * j;
      }
      pts.push(p);
    }
    return pts;
  }
  class Bolt {
    constructor(parent, color, coreR, glowR) {
      this.core = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.glow = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.core.renderOrder = this.glow.renderOrder = 22;
      parent.add(this.glow); parent.add(this.core);
      this.coreR = coreR || 0.9; this.glowR = glowR || 2.6; this.a = 0;
    }
    strike(a, b, jitter, segs) {
      const pts = boltPoints(a, b, jitter, segs || 12);
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
      this.core.geometry.dispose(); this.glow.geometry.dispose();
      this.core.geometry = new THREE.TubeGeometry(curve, pts.length * 2, this.coreR, 4, false);
      this.glow.geometry = new THREE.TubeGeometry(curve, pts.length * 2, this.glowR, 5, false);
      this.a = 1;
    }
    fade(dt, rate) {
      this.a = Math.max(0, this.a - dt * (rate || 5));
      this.core.material.opacity = this.a;
      this.glow.material.opacity = this.a * 0.55;
      this.core.visible = this.glow.visible = this.a > 0.01;
    }
    dispose() { this.core.geometry.dispose(); this.glow.geometry.dispose(); this.core.material.dispose(); this.glow.material.dispose(); }
  }

  // ---------------------------------------------------------------
  // FX core
  // ---------------------------------------------------------------
  const FX = { ready: false };
  let R, S, C, lights = {}, bloomComposer = null, finalComposer = null, bloom = null, mixPass = null, bloomLevel = 0;
  const BLOOM_LAYER = 1;
  // Only the effects glow. They're on layer 0 (normal render) and also on layer 1 (glow).
  function markBloom(obj) { obj.traverse((n) => { if (!n.userData.noBloom) n.layers.enable(BLOOM_LAYER); }); return obj; }
  FX.markBloom = markBloom;
  let add, smoke, root, kits = [], shake = 0, flashLight, flashI = 0;
  let generic = null;
  let dimTarget = 0, dim = 0;
  // For weaker phones: if the game slows down while the glow is on, turn the glow off.
  let slowT = 0, lowPower = false, dtAvg = 1 / 60;
  const tmpV = new THREE.Vector3();

  FX.init = function (renderer, scene, camera, lightRefs) {
    R = renderer; S = scene; C = camera; lights = lightRefs || {};
    S.background = new THREE.Color(0x0b0e13);     // same color with or without the glow
    root = new THREE.Group(); S.add(root);
    add = new Pool(2200, true, 1.3);
    smoke = new Pool(1400, false, 1.1);
    S.add(add.points); S.add(smoke.points);
    markBloom(add.points);                           // sparks and fire glow, smoke and snow don't
    flashLight = new THREE.PointLight(0xffaa55, 0, 220, 2);
    S.add(flashLight);
    if (THREE.EffectComposer && THREE.RenderPass && THREE.UnrealBloomPass && THREE.ShaderPass) {
      try {
        // Selective glow: draw only the layer-1 objects into a separate buffer, blur it,
        // and add it on top of the normal image.
        const size = R.getSize(new THREE.Vector2());
        bloomComposer = new THREE.EffectComposer(R);
        bloomComposer.renderToScreen = false;
        bloomComposer.addPass(new THREE.RenderPass(S, C));
        bloom = new THREE.UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.4, 0.3);
        bloomComposer.addPass(bloom);
        finalComposer = new THREE.EffectComposer(R);
        finalComposer.addPass(new THREE.RenderPass(S, C));
        mixPass = new THREE.ShaderPass(new THREE.ShaderMaterial({
          uniforms: { baseTexture: { value: null }, bloomTexture: { value: bloomComposer.renderTarget2.texture }, uBloom: { value: 1 } },
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: 'uniform sampler2D baseTexture; uniform sampler2D bloomTexture; uniform float uBloom; varying vec2 vUv;' +
            'void main(){ gl_FragColor = texture2D(baseTexture, vUv) + uBloom * vec4(texture2D(bloomTexture, vUv).rgb, 0.0); }'
        }), 'baseTexture');
        mixPass.needsSwap = true;
        finalComposer.addPass(mixPass);
      } catch (e) { bloomComposer = finalComposer = bloom = mixPass = null; }
    }
    FX.resize();
    FX.ready = true;
  };
  FX.resize = function () {
    if (!R) return;
    const size = R.getSize(new THREE.Vector2());
    const pr = R.getPixelRatio();
    const scale = size.y * pr / (2 * Math.tan((C.fov * Math.PI / 180) / 2));
    if (add) { add.mat.uniforms.uScale.value = scale; smoke.mat.uniforms.uScale.value = scale; }
    if (finalComposer) {
      bloomComposer.setPixelRatio(pr); bloomComposer.setSize(size.x / 2, size.y / 2);
      finalComposer.setPixelRatio(pr); finalComposer.setSize(size.x, size.y);
      mixPass.uniforms.bloomTexture.value = bloomComposer.renderTarget2.texture;
    }
  };
  FX.render = function () {
    if (finalComposer && bloomLevel > 0.01 && !lowPower) {
      // 1) Glow buffer: just the effects, on black.
      // This pass has no lights or beys, so it must not update the shadow map,
      // otherwise old bey shadows get left on the floor.
      const bg = S.background;
      S.background = null;
      C.layers.set(BLOOM_LAYER);
      const au = R.shadowMap.autoUpdate;
      R.shadowMap.autoUpdate = false;
      bloomComposer.render();
      R.shadowMap.autoUpdate = au;
      C.layers.set(0);
      S.background = bg;
      // 2) The normal scene (shadows get updated here), with the glow on top.
      R.shadowMap.needsUpdate = true;
      mixPass.uniforms.uBloom.value = bloomLevel;
      finalComposer.render();
    } else {
      R.render(S, C);
    }
  };
  FX.shake = function (amount) { shake = Math.max(shake, amount); };
  function flash(x, y, h, color, power) {
    flashLight.position.copy(V3(x, y, h));
    flashLight.color.set(color);
    flashI = Math.max(flashI, Math.min(0.9, power * 0.25));
  }

  // Disposable helper meshes
  function disc(radius, mat, h) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
    m.rotation.x = -Math.PI / 2; m.position.y = h == null ? 0.6 : h;
    m.renderOrder = 15;
    return m;
  }
  function disposeTree(o) {
    o.traverse((n) => { if (n.geometry) n.geometry.dispose(); if (n.material) n.material.dispose(); });
  }

  // ---------------------------------------------------------------
  // Generic hits (every bey): sparks, shockwaves, wall dust.
  // ---------------------------------------------------------------
  function makeGeneric() {
    const g = new THREE.Group(); root.add(g);
    const waves = [];
    for (let i = 0; i < 6; i++) {
      const m = disc(1, ringMat(0xffffff), 1.2); m.visible = false; g.add(m);
      waves.push({ m, t: 1, dur: 0.35, size: 40 });
    }
    let wi = 0;
    function wave(x, y, size, color, dur, h) {
      const w = waves[wi]; wi = (wi + 1) % waves.length;
      w.m.position.set(x, h || 1.2, y); w.t = 0; w.dur = dur || 0.35; w.size = size;
      w.m.material.uniforms.uColor.value.set(color);
      w.m.visible = true;
    }
    function sparks(x, y, h, n, colors, speed, life, size) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, s = speed * (0.4 + Math.random() * 0.8);
        add.emit({ x, y, h: h + Math.random() * 4, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vh: 40 + Math.random() * 120,
          life: life * (0.6 + Math.random() * 0.6), size: size, size1: size * 0.3,
          color: colors[i % colors.length], color1: 0xff7a1a, drag: 3, grav: -260, boost: 1.0 });
      }
    }
    return {
      wave, sparks,
      update(dt) {
        for (const w of waves) {
          if (!w.m.visible) continue;
          w.t += dt / w.dur;
          if (w.t >= 1) { w.m.visible = false; continue; }
          const s = w.size * (0.3 + 0.7 * w.t);
          w.m.scale.set(s, s, 1);
          w.m.material.uniforms.uR.value = 0.82; w.m.material.uniforms.uW.value = 0.12 * (1 - w.t) + 0.03;
          w.m.material.uniforms.uI.value = (1 - w.t) * 0.9;
        }
      },
      onEvent(e) {
        if (e.type === 'impact') {
          const p = Math.min(1, e.power / 0.1);
          const n = Math.round(5 + p * 20 + (e.base ? 10 : 0));
          sparks(e.x, e.y, 10, n, [0xffe9b8, e.colorA, e.colorB, 0xffc860], 140 + p * 200, 0.4, 4 + p * 2);
          wave(e.x, e.y, 26 + p * 44, 0xffd890, 0.3);
          if (p > 0.45 || e.base) { FX.shake(2 + p * 5); flash(e.x, e.y, 20, 0xfff0d0, 1.2 + p * 2); }
        } else if (e.type === 'wall') {
          sparks(e.x, e.y, 6, 10, [0xcfd8ff, 0xffffff], 120, 0.35, 4);
          for (let i = 0; i < 6; i++) smoke.emit({ x: e.x, y: e.y, h: 4, vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.5) * 50, vh: 20 + Math.random() * 20,
            life: 0.7, size: 14, size1: 30, color: 0x8a8f99, alpha: 0.35, drag: 2 });
        }
      },
      dispose() { disposeTree(g); root.remove(g); }
    };
  }

  // ---------------------------------------------------------------
  // One kit per bey. Each returns { update(dt, t), onEvent(e), dispose() }.
  // ---------------------------------------------------------------
  function emitFire(x, y, h, n, spread, dark) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, r = Math.random() * spread;
      if (dark) {
        smoke.emit({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, h: h + Math.random() * 6, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30,
          vh: 50 + Math.random() * 60, life: 0.6 + Math.random() * 0.4, size: 16, size1: 34, color: 0x1a0a14, color1: 0x050307, alpha: 0.75, drag: 1.5 });
        if (Math.random() < 0.5) add.emit({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, h: h + Math.random() * 8, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40,
          vh: 60 + Math.random() * 80, life: 0.5, size: 6, size1: 2, color: 0xff3020, color1: 0x5a0000, drag: 1, boost: 1.1 });
      } else {
        add.emit({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, h: h + Math.random() * 6, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30,
          vh: 60 + Math.random() * 70, life: 0.45 + Math.random() * 0.3, size: 18, size1: 5, color: 0xffc46a, color1: 0xd8260a, drag: 1.2, boost: 0.9 });
      }
    }
  }

  // Dragoon: Gale Trail and Sky Tornado
  function kitDragoon(f) {
    const g = new THREE.Group(); root.add(g);
    // The tornado: two layers, dusty on the outside with bright streaks inside.
    const prof = [];
    for (let i = 0; i <= 18; i++) { const t = i / 18; prof.push(new THREE.Vector2(9 + 62 * Math.pow(t, 1.5), t * 220)); }
    const funnelGeo = new THREE.LatheGeometry(prof, 48);
    const outerMat = windMat(0x5d6676, 0xc9d2de, { normal: true, twist: 1.8, speed: 1.2 });
    const innerMat = windMat(0x2a4f7a, 0x9fd4ff, { twist: 2.6, speed: 2.1 });
    const outer = new THREE.Mesh(funnelGeo, outerMat);
    const inner = new THREE.Mesh(funnelGeo, innerMat); inner.scale.set(0.72, 0.95, 0.72);
    outer.renderOrder = 16; inner.renderOrder = 17;
    const funnel = new THREE.Group(); funnel.add(outer); funnel.add(inner); funnel.visible = false; g.add(funnel);
    outer.userData.noBloom = true;
    const dust = disc(1, ringMat(0xc9ced8, { normal: true }), 0.8); dust.visible = false; g.add(dust);
    // Gale trails
    const ribbons = [];
    function ribbonFor(tr) {
      const max = 40;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(max * 2 * 3), uv = new Float32Array(max * 2 * 2), idx = [];
      for (let i = 0; i < max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const m = new THREE.Mesh(geo, ribbonMat(0xdcefff)); m.renderOrder = 16; m.frustumCulled = false;
      g.add(markBloom(m));
      return { tr, m, max };
    }
    return {
      update(dt, t) {
        // Gale trail ribbons follow the trail points in the battle state.
        for (const tr of BATTLE.trails) if (tr.owner === f && !ribbons.find((r) => r.tr === tr)) ribbons.push(ribbonFor(tr));
        for (let k = ribbons.length - 1; k >= 0; k--) {
          const r = ribbons[k];
          if (!BATTLE.trails.includes(r.tr)) { g.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); ribbons.splice(k, 1); continue; }
          const pts = r.tr.pts, n = Math.min(pts.length, r.max);
          const pos = r.m.geometry.attributes.position.array, uv = r.m.geometry.attributes.uv.array;
          for (let i = 0; i < r.max; i++) {
            const p = pts[Math.min(i, n - 1)], q = pts[Math.min(i + 1, n - 1)], pp = pts[Math.min(Math.max(i - 1, 0), n - 1)];
            let dx = q.x - pp.x, dy = q.y - pp.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
            const w = 16 * (0.4 + 0.6 * Math.sin(Math.min(1, i / Math.max(1, n - 1)) * Math.PI));
            pos[i * 6] = p.x - dy * w; pos[i * 6 + 1] = 4; pos[i * 6 + 2] = p.y + dx * w;
            pos[i * 6 + 3] = p.x + dy * w; pos[i * 6 + 4] = 4; pos[i * 6 + 5] = p.y - dx * w;
            const u = i / Math.max(1, n - 1);
            uv[i * 4] = u; uv[i * 4 + 1] = 0; uv[i * 4 + 2] = u; uv[i * 4 + 3] = 1;
          }
          r.m.geometry.attributes.position.needsUpdate = true; r.m.geometry.attributes.uv.needsUpdate = true;
          r.m.material.uniforms.uTime.value = t;
          r.m.material.uniforms.uI.value = 1.1 * Math.max(0, 1 - r.tr.age / r.tr.life);
          if (Math.random() < 0.5 && n > 1) {
            const p = pts[Math.floor(Math.random() * n)];
            smoke.emit({ x: p.x, y: p.y, h: 5, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, vh: 25, life: 0.6, size: 10, size1: 24, color: 0xe8f1ff, alpha: 0.3, drag: 2 });
          }
        }
        // Tornado
        const s = f.special && f.special.kind === 'tornado' ? f.special : null;
        if (s) {
          const grow = Math.min(1, s.t / s.wind), shrink = s.t > s.dur ? Math.max(0, 1 - (s.t - s.dur) / 0.35) : 1;
          const k = grow * shrink;
          funnel.visible = dust.visible = true;
          funnel.position.set(s.x, 0, s.y);
          funnel.scale.set(0.35 + 0.65 * k, 0.2 + 0.8 * k, 0.35 + 0.65 * k);
          funnel.rotation.y -= dt * 4;
          outerMat.uniforms.uTime.value = innerMat.uniforms.uTime.value = t;
          outerMat.uniforms.uI.value = 0.5 * k; innerMat.uniforms.uI.value = 0.5 * k;
          dust.position.set(s.x, 0.8, s.y);
          const ds = s.R * 1.1 * (0.5 + 0.5 * k); dust.scale.set(ds, ds, 1);
          dust.material.uniforms.uR.value = 0.7; dust.material.uniforms.uW.value = 0.25;
          dust.material.uniforms.uI.value = 0.22 * k; dust.material.uniforms.uFill.value = 1;
          // debris + dust caught in the vortex
          for (let i = 0; i < 4; i++) {
            const a = Math.random() * TAU, r = s.R * (0.6 + Math.random() * 0.5);
            const tang = 160 + Math.random() * 120;
            smoke.emit({ x: s.x + Math.cos(a) * r, y: s.y + Math.sin(a) * r, h: 2,
              vx: -Math.sin(a) * tang - Math.cos(a) * 60, vy: Math.cos(a) * tang - Math.sin(a) * 60, vh: 90 + Math.random() * 90,
              life: 0.9, size: 9 + Math.random() * 10, size1: 22, color: 0xb8bfcc, color1: 0x7d8594, alpha: 0.45 * k, drag: 0.8 });
          }
          if (Math.random() < 0.6) {
            const a = Math.random() * TAU;
            add.emit({ x: s.x + Math.cos(a) * 30, y: s.y + Math.sin(a) * 30, h: 10 + Math.random() * 60, vx: -Math.sin(a) * 220, vy: Math.cos(a) * 220,
              vh: 120, life: 0.5, size: 5, size1: 2, color: 0xeaf6ff, boost: 1.3, drag: 1 });
          }
        } else { funnel.visible = dust.visible = false; }
      },
      onEvent(e) {
        if (e.type === 'gust') {
          for (let i = 0; i < 16; i++) smoke.emit({ x: e.x, y: e.y, h: 6, vx: e.dx * 200 + (Math.random() - 0.5) * 80, vy: e.dy * 200 + (Math.random() - 0.5) * 80, vh: 30,
            life: 0.6, size: 12, size1: 30, color: 0xf0f6ff, alpha: 0.45, drag: 3 });
        }
        if (e.type === 'fling') {
          FX.shake(6);
          for (let i = 0; i < 30; i++) smoke.emit({ x: e.x, y: e.y, h: 10, vx: e.dx * 260 + (Math.random() - 0.5) * 120, vy: e.dy * 260 + (Math.random() - 0.5) * 120, vh: 40 + Math.random() * 60,
            life: 0.8, size: 14, size1: 34, color: 0xe6ecf5, alpha: 0.5, drag: 2.5 });
        }
      },
      dispose() { for (const r of ribbons) g.remove(r.m); disposeTree(g); root.remove(g); }
    };
  }

  // Dranzer: Flame Arc and Phoenix Dive
  function kitDranzer(f) {
    const g = new THREE.Group(); root.add(g);
    // While it's in the air: a cocoon of flames and wings made of fire particles.
    const cocoonGeo = new THREE.CylinderGeometry(10, 26, 46, 32, 1, true);
    const cocoonMat = fireMat(0xfff4c2, 0xff8a1e, 0xb3120a, { speed: 3.2 });
    const cocoon = new THREE.Mesh(cocoonGeo, cocoonMat); cocoon.visible = false; cocoon.renderOrder = 18; g.add(cocoon);
    // Target on the ground: a segmented outer ring, an inner ring and a soft fill
    const ret = disc(1, ringMat(0xff8a1e, { seg: 8, fill: 1 }), 1.0); ret.visible = false; g.add(ret);
    const retIn = disc(1, ringMat(0xffe0a0), 1.1); retIn.visible = false; g.add(retIn);
    const shadow = disc(1, ringMat(0x000000, { normal: true, fill: 2.5 }), 0.7); shadow.visible = false; g.add(shadow);
    shadow.userData.noBloom = true;
    // Column of light on the target once it locks.
    const pillarMat = fireMat(0xffd27a, 0xff6a1a, 0x8a0f05, { speed: 4 });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(9, 14, 140, 24, 1, true), pillarMat);
    pillar.visible = false; pillar.renderOrder = 18; g.add(pillar);
    // Flame column that erupts on impact.
    const eruptMat = fireMat(0xffe0a0, 0xff6a1a, 0x9a1206, { speed: 5 });
    const erupt = new THREE.Mesh(new THREE.CylinderGeometry(22, 48, 120, 32, 1, true), eruptMat);
    erupt.visible = false; erupt.renderOrder = 18; g.add(erupt);
    let eruptT = 1, eruptX = 0, eruptY = 0;
    // Sparks circling Dranzer when it's stunned after a missed dive.
    let lastPhase = null;
    return {
      update(dt, t) {
        // Flame Arc: fire comes off Dranzer during the dash
        if (f.boostTimer > 0 && f.boostSource === 'base') emitFire(f.x, f.y, 8, 4, 12, false);
        const s = f.special && f.special.kind === 'dive' ? f.special : null;
        if (!s) { cocoon.visible = ret.visible = retIn.visible = shadow.visible = false; lastPhase = null; return; }
        const h = f.height || 0;
        cocoonMat.uniforms.uTime.value = t;
        const airborne = s.phase !== 'land';
        cocoon.visible = airborne;
        cocoon.position.set(f.x, h + 10, f.y);
        const stretch = s.phase === 'dive' ? 2.4 : 1;
        cocoon.scale.set(1.2, 1.2 * stretch, 1.2);
        cocoonMat.uniforms.uI.value = airborne ? 0.5 : 0;
        if (airborne) {
          // Phoenix wings: two flapping fans of flame, swept back.
          const flap = Math.sin(t * 8);
          for (let side = -1; side <= 1; side += 2) {
            for (let i = 0; i < 10; i++) {
              const u = Math.random();                       // 0 at the shoulder, 1 at the wing tip
              const feather = (Math.random() - 0.5) * 10 * u;
              const wx = side * (10 + u * 70);
              const wy = 6 + u * u * 34 + feather;            // swept back, away from the camera
              const wh = h + 16 + u * (18 + 16 * flap);
              const cIn = u < 0.35 ? 0xffd27a : 0xff7a1e, cOut = u < 0.35 ? 0xff5a10 : 0xb3120a;
              add.emit({ x: f.x + wx, y: f.y + wy, h: wh, vx: side * 6, vy: 25, vh: -8, life: 0.24, size: 22 - u * 10, size1: 6,
                color: cIn, color1: cOut, boost: 0.5, drag: 3 });
            }
            // tail flames trailing behind
            if (Math.random() < 0.7) add.emit({ x: f.x + (Math.random() - 0.5) * 8, y: f.y + 14 + Math.random() * 20, h: h + 10, vx: 0, vy: 40, vh: -10,
              life: 0.35, size: 12, size1: 3, color: 0xffa040, color1: 0xc81a05, boost: 0.5, drag: 2 });
          }
          // embers falling from the phoenix
          if (Math.random() < 0.8) add.emit({ x: f.x + (Math.random() - 0.5) * 40, y: f.y + (Math.random() - 0.5) * 40, h: h, vx: 0, vy: 0, vh: -30,
            life: 0.8, size: 4, size1: 1, color: 0xffb347, color1: 0xff2a00, grav: -60, boost: 1.0 });
          if (s.phase === 'dive') {
            // a thick trail of fire as it dives, like a comet
            for (let i = 0; i < 10; i++) {
              const k = Math.random();
              add.emit({ x: f.x + (s.fx - f.x) * k * 0.6 + (Math.random() - 0.5) * 10, y: f.y + (s.fy - f.y) * k * 0.6 + (Math.random() - 0.5) * 10,
                h: h + 10 + (85 - h) * k * 0.6, vx: 0, vy: 0, vh: 20, life: 0.35, size: 20 - k * 10, size1: 4,
                color: 0xffc060, color1: 0xb3120a, boost: 0.6, drag: 2 });
            }
          }
        }
        // Column of light while the target is locked or Dranzer is diving
        const showPillar = s.phase === 'lock' || s.phase === 'dive';
        pillar.visible = showPillar;
        if (showPillar) {
          pillar.position.set(s.tx, 70, s.ty);
          pillarMat.uniforms.uTime.value = t;
          pillarMat.uniforms.uI.value = 0.35 + 0.25 * Math.sin(t * 30);
        }
        // Reticle on the ground
        const showRet = s.phase === 'aim' || s.phase === 'lock' || s.phase === 'dive';
        ret.visible = retIn.visible = shadow.visible = showRet;
        if (showRet) {
          const lock = s.phase !== 'aim';
          const pulse = lock ? 0.75 + 0.25 * Math.sin(t * 40) : 0.85 + 0.15 * Math.sin(t * 8);
          const size = 60 * (lock ? 1 - 0.1 * Math.min(1, s.pt / 0.4) : 1);
          ret.position.set(s.tx, 1.0, s.ty); ret.scale.set(size, size, 1);
          ret.material.uniforms.uColor.value.set(lock ? 0xff2a10 : 0xff8a1e);
          ret.material.uniforms.uR.value = 0.9; ret.material.uniforms.uW.value = 0.05;
          ret.material.uniforms.uTime.value = t; ret.material.uniforms.uI.value = 1.0 * pulse;
          retIn.position.set(s.tx, 1.1, s.ty); retIn.scale.set(size * 0.35, size * 0.35, 1);
          retIn.material.uniforms.uR.value = 0.8; retIn.material.uniforms.uW.value = 0.12; retIn.material.uniforms.uI.value = 0.9 * pulse;
          // the phoenix's shadow growing as it falls
          const k = s.phase === 'dive' ? Math.min(1, s.pt / 0.22) : 0;
          shadow.position.set(s.tx, 0.7, s.ty); const ss = 14 + 22 * k; shadow.scale.set(ss, ss, 1);
          shadow.material.uniforms.uR.value = 0.5; shadow.material.uniforms.uI.value = 0.35 + 0.3 * k;
        }
        lastPhase = s.phase;
      },
      tick(dt, t) {
        if (eruptT < 1) {
          eruptT += dt / 0.6;
          erupt.visible = eruptT < 1;
          const k = Math.min(1, eruptT / 0.25);
          erupt.position.set(eruptX, 60 * k, eruptY);
          erupt.scale.set(1 - 0.3 * eruptT, k, 1 - 0.3 * eruptT);
          eruptMat.uniforms.uTime.value = t;
          eruptMat.uniforms.uI.value = 0.75 * (1 - eruptT);
        }
        if (f.stun > 0) {
          const a = t * 9;
          for (let i = 0; i < 3; i++) {
            const aa = a + i * TAU / 3;
            add.emit({ x: f.x + Math.cos(aa) * 16, y: f.y + Math.sin(aa) * 16, h: 34, life: 0.12, size: 6, size1: 3, color: 0xffe08a, boost: 0.7 });
          }
        }
      },
      onEvent(e) {
        if (e.type === 'special' && e.f === f) {
          for (let i = 0; i < 30; i++) {
            const a = Math.random() * TAU;
            add.emit({ x: f.x, y: f.y, h: 4, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, vh: 160 + Math.random() * 120, life: 0.6, size: 16, size1: 4,
              color: 0xfff1b8, color1: 0xff3a0a, drag: 2, boost: 1.5 });
          }
          generic.wave(f.x, f.y, 90, 0xff8a1e, 0.45);
        }
        if (e.type === 'diveHit') {
          FX.shake(9);
          flash(e.x, e.y, 30, 0xffa040, 3);
          generic.wave(e.x, e.y, 110, 0xff8a30, 0.6);
          generic.wave(e.x, e.y, 60, 0xffd080, 0.35);
          eruptT = 0; eruptX = e.x; eruptY = e.y;
          for (let i = 0; i < 40; i++) {
            const a = Math.random() * TAU, sp = 140 + Math.random() * 260;
            add.emit({ x: e.x, y: e.y, h: 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vh: 80 + Math.random() * 200, life: 0.45 + Math.random() * 0.45,
              size: 13, size1: 3, color: 0xffb050, color1: 0xb3120a, drag: 2.8, grav: -120, boost: 0.6 });
          }
          for (let i = 0; i < 26; i++) {
            const a = Math.random() * TAU;
            add.emit({ x: e.x + Math.cos(a) * 20, y: e.y + Math.sin(a) * 20, h: 6, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40, vh: 110 + Math.random() * 90,
              life: 0.7, size: 22, size1: 8, color: 0xff9a30, color1: 0x6a0a02, drag: 2, boost: 0.45 });
          }
          for (let i = 0; i < 24; i++) {
            const a = Math.random() * TAU, sp = 60 + Math.random() * 90;
            smoke.emit({ x: e.x, y: e.y, h: 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vh: 40 + Math.random() * 50, life: 1.2, size: 26, size1: 60,
              color: 0x3a2a26, color1: 0x1a1414, alpha: 0.5, drag: 1.8 });
          }
        }
        if (e.type === 'diveMiss') {
          FX.shake(4);
          generic.wave(e.x, e.y, 90, 0xff8a1e, 0.4);
          for (let i = 0; i < 20; i++) {
            const a = Math.random() * TAU;
            smoke.emit({ x: e.x, y: e.y, h: 4, vx: Math.cos(a) * 80, vy: Math.sin(a) * 80, vh: 30, life: 0.9, size: 18, size1: 40, color: 0x8b8178, alpha: 0.45, drag: 2 });
          }
        }
      },
      dispose() { disposeTree(g); root.remove(g); }
    };
  }

  // Black Dranzer: Dark Claw and Eclipse Drain
  function kitBlackDranzer(f) {
    const g = new THREE.Group(); root.add(g);
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), fresnelMat(0x12020a, 0xff2a2a, { normal: true, innerA: 0.45, pow: 2.6 }));
    sphere.visible = false; sphere.renderOrder = 14; g.add(sphere);
    const core = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), fresnelMat(0x000000, 0xb3100a, { innerA: 0.0, pow: 1.8 }));
    core.visible = false; core.renderOrder = 18; g.add(core);
    const tendrilMat = flowMat(0xff2414);
    const tendril = new THREE.Mesh(new THREE.BufferGeometry(), tendrilMat); tendril.visible = false; tendril.renderOrder = 21; g.add(tendril);
    let tendrilT = 0;
    return {
      update(dt, t) {
        if (f.boostTimer > 0 && f.boostSource === 'base') emitFire(f.x, f.y, 8, 5, 12, true);
        const s = f.special && f.special.kind === 'eclipse' ? f.special : null;
        if (!s) { sphere.visible = core.visible = tendril.visible = false; dimTarget = Math.max(dimTarget, 0); return; }
        const k = Math.min(1, s.t / 0.3) * Math.min(1, (s.dur - s.t) / 0.3 + 0.01);
        dimTarget = Math.max(dimTarget, 0.45 * k);
        sphere.visible = core.visible = true;
        sphere.position.set(f.x, 6, f.y); const sr = s.R * (0.85 + 0.15 * k); sphere.scale.set(sr, sr * 0.55, sr);
        sphere.material.uniforms.uTime.value = t; sphere.material.uniforms.uI.value = 0.9 * k;
        core.position.set(f.x, 22, f.y); const cr = 20 + Math.sin(t * 12) * 2; core.scale.set(cr, cr, cr);
        core.material.uniforms.uTime.value = t; core.material.uniforms.uI.value = 0.75 * k;
        // black flames rising around Black Dranzer
        emitFire(f.x, f.y, 4, 3, s.R * 0.6, true);
        // drain tendril to the rival
        tendrilT -= dt;
        const o = s.foe;
        if (s.linked) {
          if (tendrilT <= 0) {
            tendrilT = 0.05;
            const a = V3(o.x, o.y, 16), b = V3(f.x, f.y, 22);
            const mid = a.clone().lerp(b, 0.5); mid.y += 28;
            const pts = boltPoints(a, mid, 10, 4).concat(boltPoints(mid, b, 10, 4).slice(1));
            tendril.geometry.dispose();
            tendril.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 2.2, 5, false);
          }
          tendril.visible = true; tendrilMat.uniforms.uTime.value = t; tendrilMat.uniforms.uI.value = 1.4 * k;
          // particles flowing from the rival into Black Dranzer (the drained spin)
          const dx = f.x - o.x, dy = f.y - o.y;
          add.emit({ x: o.x, y: o.y, h: 14, vx: dx * 2.2, vy: dy * 2.2, vh: 20, life: 0.45, size: 7, size1: 3, color: 0xff4a3a, color1: 0x7a0000, boost: 1.1 });
        } else tendril.visible = false;
      },
      onEvent(e) {
        if (e.type === 'clawMiss' && e.x != null) emitFire(e.x, e.y, 6, 10, 10, true);
        if (e.type === 'drain') generic.sparks(e.x, e.y, 14, 12, [0xff3020, 0x2a0000], 120, 0.4, 5);
        if (e.type === 'special' && e.f === f) { generic.wave(f.x, f.y, 180, 0xff2020, 0.5); FX.shake(3); }
      },
      dispose() { tendril.geometry.dispose(); disposeTree(g); root.remove(g); }
    };
  }

  // Driger: Twin Pounce and Thunder Claw
  function kitDriger(f) {
    const g = new THREE.Group(); root.add(g);
    const bolts = [0, 1, 2, 3].map(() => new Bolt(g, 0x3dff5a, 1.0, 3.4));
    const sky = new Bolt(g, 0x7dff8a, 1.6, 5);
    const timing = disc(1, ringMat(0x7dff8a), 1.3); timing.visible = false; g.add(timing);
    const target = disc(1, ringMat(0xeaffc8), 1.2); target.visible = false; g.add(target);
    const slashes = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(26, 31, 24, 1, 0, Math.PI * 0.9), new THREE.MeshBasicMaterial({ color: 0xc8ffb0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.renderOrder = 22; m.visible = false; g.add(m); slashes.push(m);
    }
    let slashT = 1, boltT = 0;
    return {
      update(dt, t) {
        const s = f.special && f.special.kind === 'claw' ? f.special : null;
        const charged = (f.boostTimer > 0 && (f.boostSource === 'base' || f.boostSource === 'claw')) || !!s;
        boltT -= dt;
        if (charged && boltT <= 0) {
          boltT = 0.06;
          for (const b of bolts) {
            const a0 = Math.random() * TAU, a1 = a0 + (Math.random() - 0.5) * 2.6;
            b.strike(V3(f.x + Math.cos(a0) * 16, f.y + Math.sin(a0) * 16, 10 + Math.random() * 24),
                     V3(f.x + Math.cos(a1) * (30 + Math.random() * 26), f.y + Math.sin(a1) * (30 + Math.random() * 26), 1 + Math.random() * 6), 14, 8);
          }
        }
        for (const b of bolts) b.fade(dt, charged ? 8 : 12);
        sky.fade(dt, 3.5);
        if (s && s.count < 3) {
          const beatStart = s.next - s.beat, p = Math.min(1.2, (s.t - beatStart) / s.beat);
          timing.visible = target.visible = true;
          const big = 46 + (1 - Math.min(1, p)) * 120;
          timing.position.set(f.x, 1.3, f.y); timing.scale.set(big, big, 1);
          timing.material.uniforms.uR.value = 0.92; timing.material.uniforms.uW.value = 0.04; timing.material.uniforms.uI.value = 1.4;
          const close = 1 - Math.min(1, Math.abs(s.t - s.next) / 0.11);
          target.position.set(f.x, 1.2, f.y); target.scale.set(46, 46, 1);
          target.material.uniforms.uR.value = 0.92; target.material.uniforms.uW.value = 0.05; target.material.uniforms.uI.value = 0.7 + 1.6 * close;
        } else { timing.visible = target.visible = false; }
        // claw slashes
        if (slashT < 1) {
          slashT += dt / 0.28;
          slashes.forEach((m, i) => { m.visible = slashT < 1; m.material.opacity = Math.max(0, 1 - slashT) * 1.4; m.scale.setScalar(0.8 + slashT * 0.5); });
        }
      },
      onEvent(e) {
        if (e.type === 'special' && e.f === f) {
          sky.strike(V3(f.x + 20, f.y - 30, 260), V3(f.x, f.y, 20), 40, 14);
          flash(f.x, f.y, 40, 0x7dff8a, 3); FX.shake(4);
          generic.wave(f.x, f.y, 140, 0x7dff8a, 0.45);
        }
        if (e.type === 'claw' && e.f === f) {
          const o = foeOfF(f);
          if (e.q === 'miss') { generic.sparks(f.x, f.y, 10, 6, [0x8a948a], 80, 0.3, 4); return; }
          const perfect = e.q === 'perfect';
          // three parallel slashes across the rival, angled along the lunge
          const ang = Math.atan2(o.y - f.y, o.x - f.x);
          slashes.forEach((m, i) => {
            m.position.set(o.x + Math.cos(ang + Math.PI / 2) * (i - 1) * 9, 14 + i * 2, o.y + Math.sin(ang + Math.PI / 2) * (i - 1) * 9);
            m.rotation.set(-Math.PI / 2 + 0.5, 0, -ang + Math.PI * 0.55);
            m.material.color.set(perfect ? 0xfff2a0 : 0x9dff8a);
          });
          slashT = 0;
          generic.wave(f.x, f.y, perfect ? 120 : 70, perfect ? 0xfff2a0 : 0x7dff8a, 0.3);
          if (perfect) { flash(o.x, o.y, 20, 0xeaff9a, 2.5); FX.shake(4); }
        }
      },
      dispose() { bolts.forEach((b) => b.dispose()); sky.dispose(); disposeTree(g); root.remove(g); }
    };
  }

  // Draciel: Iron Shell and Maelstrom
  function kitDraciel(f) {
    const g = new THREE.Group(); root.add(g);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 18, 0, TAU, 0, Math.PI * 0.55), fresnelMat(0x0b3a1a, 0x9dffb0, { innerA: 0.25, pow: 1.6, hex: true }));
    shell.visible = false; shell.renderOrder = 18; g.add(shell);
    const pool = disc(1, whirlpoolMat(), 0.5); pool.visible = false; pool.renderOrder = 12; g.add(pool);
    const wallGeo = new THREE.CylinderGeometry(1, 1, 1, 48, 1, true);
    const wallMat = windMat(0x1a6aa8, 0xd8f4ff, { twist: 0.6, speed: 2.2 });
    const wall = new THREE.Mesh(wallGeo, wallMat); wall.visible = false; wall.renderOrder = 17; g.add(wall);
    return {
      update(dt, t) {
        // The shell is gold while a parry is still possible, then turns green.
        if (f.guardTimer > 0) {
          const parry = f.guardAge <= PARRY_WINDOW;
          shell.visible = true;
          shell.position.set(f.x, 0, f.y);
          const r = 30 + (parry ? 3 * Math.sin(t * 30) : 0); shell.scale.set(r, r * 1.05, r);
          shell.material.uniforms.uRim.value.set(parry ? 0xffe27a : 0x9dffb0);
          shell.material.uniforms.uTime.value = t;
          shell.material.uniforms.uI.value = parry ? 1.5 : 0.95 * Math.min(1, f.guardTimer / 0.2);
        } else shell.visible = false;
        const s = f.special && f.special.kind === 'maelstrom' ? f.special : null;
        if (s) {
          const k = Math.min(1, s.t / s.wind) * Math.min(1, (s.dur - s.t) / 0.35 + 0.01);
          pool.visible = wall.visible = true;
          pool.position.set(f.x, 0.5, f.y); const pr = s.R * 1.05; pool.scale.set(pr, pr, 1);
          pool.material.uniforms.uTime.value = t; pool.material.uniforms.uI.value = k;
          wall.position.set(f.x, 9, f.y); wall.scale.set(s.R * 1.03, 18 * k, s.R * 1.03);
          wallMat.uniforms.uTime.value = t; wallMat.uniforms.uI.value = 0.8 * k;
          for (let i = 0; i < 3; i++) {
            const a = Math.random() * TAU;
            smoke.emit({ x: f.x + Math.cos(a) * s.R, y: f.y + Math.sin(a) * s.R, h: 6, vx: -Math.sin(a) * 120, vy: Math.cos(a) * 120, vh: 70 + Math.random() * 60,
              life: 0.6, size: 8, size1: 16, color: 0xe6f8ff, color1: 0x7ac8ff, alpha: 0.7 * k, grav: -220, drag: 1 });
          }
          const o = s.foe;
          if (o.inMaelstrom && Math.random() < 0.7) smoke.emit({ x: o.x, y: o.y, h: 3, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, vh: 70,
            life: 0.5, size: 7, size1: 14, color: 0xffffff, color1: 0x9ad8ff, alpha: 0.8, grav: -260 });
        } else pool.visible = wall.visible = false;
      },
      onEvent(e) {
        if (e.type === 'parry') {
          FX.shake(6); flash(e.x, e.y, 20, 0xffe27a, 3.5);
          generic.wave(e.x, e.y, 150, 0xffe27a, 0.4);
          generic.sparks(e.x, e.y, 14, 40, [0xffffff, 0xffe27a, 0xffc040], 260, 0.5, 6);
        }
        if (e.type === 'block') { generic.wave(e.x, e.y, 70, 0x9dffb0, 0.3); generic.sparks(e.x, e.y, 12, 12, [0x9dffb0, 0xffffff], 140, 0.35, 4); }
        if (e.type === 'special' && e.f === f) generic.wave(f.x, f.y, 230, 0x7ac8ff, 0.6);
      },
      dispose() { disposeTree(g); root.remove(g); }
    };
  }

  // Wolborg: Frost Howl and White Blizzard
  function kitWolborg(f) {
    const g = new THREE.Group(); root.add(g);
    const sheet = disc(1, iceSheetMat(), 0.45); sheet.visible = false; sheet.renderOrder = 11; g.add(sheet);
    sheet.userData.noBloom = true;
    const crystalMat = fresnelMat(0x9fd8ff, 0xffffff, { innerA: 0.35, pow: 1.8, normal: true });
    const crystal = new THREE.Group();
    const big = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), crystalMat); big.scale.set(26, 34, 26); big.position.y = 22; crystal.add(big);
    for (let i = 0; i < 5; i++) {
      const sh = new THREE.Mesh(new THREE.ConeGeometry(5, 26 + (i % 2) * 10, 5), crystalMat);
      const a = (i / 5) * TAU; sh.position.set(Math.cos(a) * 22, 10, Math.sin(a) * 22);
      sh.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6); crystal.add(sh);
    }
    crystal.visible = false; crystal.children.forEach((c) => { c.renderOrder = 19; }); g.add(crystal);
    // One cone shape for each howl in flight
    const arcs = [];
    function arcFor(w) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 32, 1, -w.half, w.half * 2), new THREE.MeshBasicMaterial({ color: 0xcdeeff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.renderOrder = 21; g.add(markBloom(m));
      return { w, m };
    }
    let freezeTarget = null;
    return {
      update(dt, t) {
        for (const w of BATTLE.waves) if (w.owner === f && !arcs.find((a) => a.w === w)) arcs.push(arcFor(w));
        for (let k = arcs.length - 1; k >= 0; k--) {
          const a = arcs[k];
          if (!BATTLE.waves.includes(a.w)) { g.remove(a.m); a.m.geometry.dispose(); a.m.material.dispose(); arcs.splice(k, 1); continue; }
          const front = a.w.len * Math.min(1, a.w.t / a.w.dur);
          a.m.position.set(a.w.x, 2, a.w.y);
          a.m.rotation.z = -a.w.ang;
          a.m.scale.set(Math.max(1, front), Math.max(1, front), 1);
          a.m.material.opacity = 1.2 * (1 - Math.max(0, a.w.t - a.w.dur) / 0.3);
          if (Math.random() < 0.9) {
            const ang = a.w.ang + (Math.random() - 0.5) * a.w.half * 2;
            smoke.emit({ x: a.w.x + Math.cos(ang) * front, y: a.w.y + Math.sin(ang) * front, h: 4 + Math.random() * 6, vx: Math.cos(ang) * 60, vy: Math.sin(ang) * 60, vh: 10,
              life: 0.5, size: 8, size1: 18, color: 0xffffff, color1: 0xbfe6ff, alpha: 0.6, drag: 2 });
          }
        }
        const o = foeOfF(f);
        if (o.slow > 0 && Math.random() < 0.6) add.emit({ x: o.x + (Math.random() - 0.5) * 20, y: o.y + (Math.random() - 0.5) * 20, h: 8 + Math.random() * 10, vx: 0, vy: 0, vh: 15,
          life: 0.5, size: 5, size1: 2, color: 0xd8f4ff, boost: 1.3 });
        const s = f.special && f.special.kind === 'blizzard' ? f.special : null;
        if (s) {
          const k = Math.min(1, s.t / 0.4) * Math.min(1, (s.dur - s.t) / 0.4 + 0.01);
          sheet.visible = true;
          sheet.scale.set(ARENA.r * 1.02, ARENA.r * 1.02, 1); sheet.position.set(0, 0.45, 0);
          const u = sheet.material.uniforms;
          u.uTime.value = t; u.uI.value = k; u.uSpread.value = Math.min(2.2, s.t * 2.6);
          if (s.t < 0.05) u.uOrigin.value.set(f.x / ARENA.r, -f.y / ARENA.r);
          // snowfall across the whole stadium, blown by the wind
          for (let i = 0; i < 9; i++) {
            const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * ARENA.r * 1.1;
            smoke.emit({ x: Math.cos(a) * r - 60, y: Math.sin(a) * r, h: 120 + Math.random() * 80, vx: 70 + Math.random() * 40, vy: (Math.random() - 0.5) * 20, vh: -110 - Math.random() * 60,
              life: 1.4, size: 4 + Math.random() * 4, color: 0xffffff, alpha: 0.9 * k });
          }
          if (Math.random() < 0.3) smoke.emit({ x: (Math.random() - 0.5) * ARENA.r * 2, y: (Math.random() - 0.5) * ARENA.r * 2, h: 10, vx: 80, vy: 0, vh: 5,
            life: 1.6, size: 60, size1: 110, color: 0xe8f6ff, alpha: 0.12 * k, drag: 0.5 });
        } else sheet.visible = false;
        // Frozen rival: ice crystal around it
        if (o.frozen > 0) {
          crystal.visible = true; crystal.position.set(o.x, 0, o.y);
          crystalMat.uniforms.uTime.value = t; crystalMat.uniforms.uI.value = Math.min(1, o.frozen / 0.15) * 1.2;
          if (Math.random() < 0.4) smoke.emit({ x: o.x + (Math.random() - 0.5) * 40, y: o.y + (Math.random() - 0.5) * 40, h: 4, vx: 0, vy: 0, vh: 12, life: 0.9, size: 14, size1: 30, color: 0xeaf8ff, alpha: 0.3 });
        } else crystal.visible = false;
      },
      onEvent(e) {
        if (e.type === 'freeze') {
          FX.shake(5); flash(e.x, e.y, 20, 0xbfe6ff, 3);
          generic.wave(e.x, e.y, 130, 0xdff6ff, 0.4);
          for (let i = 0; i < 40; i++) {
            const a = Math.random() * TAU, sp = 80 + Math.random() * 180;
            add.emit({ x: e.x, y: e.y, h: 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vh: 60 + Math.random() * 140, life: 0.6, size: 6, size1: 2,
              color: 0xffffff, color1: 0x8fd0ff, drag: 2, grav: -200, boost: 1.4 });
          }
        }
        if (e.type === 'howlHit') generic.sparks(e.x, e.y, 10, 16, [0xffffff, 0xbfe6ff], 120, 0.4, 5);
        if (e.type === 'special' && e.f === f) { generic.wave(f.x, f.y, 260, 0xdff6ff, 0.7); FX.shake(2); }
      },
      dispose() { for (const a of arcs) g.remove(a.m); disposeTree(g); root.remove(g); }
    };
  }

  // Zeus: Mirror Guard and Dark Dimension
  function kitZeus(f) {
    const g = new THREE.Group(); root.add(g);
    const shards = [];
    const shardMat = fresnelMat(0x3a1d6e, 0xe2d4ff, { innerA: 0.35, pow: 1.2 });
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(13, 24), shardMat); m.renderOrder = 19; m.visible = false; g.add(m); shards.push(m);
    }
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), fresnelMat(0x06010f, 0xb06bff, { normal: true, innerA: 0.6, pow: 2.4, side: THREE.BackSide }));
    dome.visible = false; dome.renderOrder = 13; g.add(dome);
    const domeFront = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), fresnelMat(0x000000, 0xc88cff, { innerA: 0.0, pow: 3.0 }));
    domeFront.visible = false; domeFront.renderOrder = 23; g.add(domeFront);
    const winds = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 6, 64, Math.PI * 1.2), new THREE.MeshBasicMaterial({ color: 0xd0b8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.renderOrder = 22; m.visible = false; g.add(m); winds.push(m);
    }
    const markers = [], boltsPool = [];
    for (let i = 0; i < 5; i++) {
      const m = disc(1, ringMat(0xc070ff, { fill: 1.5, seg: 6 }), 1.3); m.visible = false; g.add(m); markers.push(m);
      boltsPool.push(new Bolt(g, 0xa060ff, 1.6, 5));
    }
    let bi = 0;
    return {
      update(dt, t) {
        // Mirror shards circle Zeus while the mirror is up, and glow once a hit is stored.
        const showShards = f.mirror > 0 || f.mirrorStore > 0.005;
        shards.forEach((m, i) => {
          m.visible = showShards;
          if (!showShards) return;
          const a = t * 3 + (i / 6) * TAU, r = f.mirror > 0 ? 36 : 28;
          m.position.set(f.x + Math.cos(a) * r, 16 + Math.sin(t * 4 + i) * 3, f.y + Math.sin(a) * r);
          m.lookAt(f.x, 16, f.y);
        });
        shardMat.uniforms.uTime.value = t;
        shardMat.uniforms.uI.value = f.mirror > 0 ? 1.4 : 0.9;
        if (f.boostTimer > 0 && f.boostSource === 'release') {
          for (let i = 0; i < 3; i++) add.emit({ x: f.x + (Math.random() - 0.5) * 16, y: f.y + (Math.random() - 0.5) * 16, h: 10 + Math.random() * 10, vx: 0, vy: 0, vh: 10,
            life: 0.35, size: 9, size1: 2, color: 0xe2d4ff, color1: 0x7a30ff, boost: 1.0 });
        }
        const s = f.special && f.special.kind === 'dimension' ? f.special : null;
        for (const b of boltsPool) b.fade(dt, 4);
        if (s) {
          const k = Math.min(1, s.t / 0.3) * Math.min(1, (s.dur - s.t) / 0.3 + 0.01);
          dimTarget = Math.max(dimTarget, 0.7 * k);
          dome.visible = domeFront.visible = true;
          const r = 150 * (0.6 + 0.4 * k);
          dome.position.set(f.x, 0, f.y); dome.scale.set(r, r * 0.6, r);
          domeFront.position.copy(dome.position); domeFront.scale.copy(dome.scale);
          dome.material.uniforms.uTime.value = domeFront.material.uniforms.uTime.value = t;
          dome.material.uniforms.uI.value = 0.85 * k; domeFront.material.uniforms.uI.value = 0.7 * k;
          winds.forEach((m, i) => {
            m.visible = true; m.position.set(f.x, 8 + i * 9, f.y);
            const wr = 34 + i * 14; m.scale.set(wr, wr, wr);
            m.rotation.z = t * (4 + i) * (i % 2 ? -1 : 1);
            m.material.opacity = 0.7 * k;
          });
          // warning markers on the ground before each bolt
          markers.forEach((m, i) => {
            const b = s.bolts[i];
            if (!b || b.struck) { m.visible = false; return; }
            m.visible = true;
            const p = Math.min(1, b.t / 0.55);
            m.position.set(b.x, 1.3, b.y); const ms = 30 * (1.5 - 0.5 * p); m.scale.set(ms, ms, 1);
            m.material.uniforms.uR.value = 0.85; m.material.uniforms.uW.value = 0.05;
            m.material.uniforms.uTime.value = t * 2; m.material.uniforms.uI.value = 0.6 + 1.2 * p + 0.4 * Math.sin(t * 30) * p;
          });
          if (Math.random() < 0.5) add.emit({ x: f.x + (Math.random() - 0.5) * 200, y: f.y + (Math.random() - 0.5) * 200, h: 5, vx: 0, vy: 0, vh: 40, life: 1, size: 4, size1: 1, color: 0xb070ff, boost: 1.5 });
        } else {
          dome.visible = domeFront.visible = false;
          winds.forEach((m) => { m.visible = false; });
          markers.forEach((m) => { m.visible = false; });
        }
      },
      onEvent(e) {
        if (e.type === 'bolt') {
          const b = boltsPool[bi]; bi = (bi + 1) % boltsPool.length;
          b.strike(V3(e.x + (Math.random() - 0.5) * 60, e.y - 40, 300), V3(e.x, e.y, 0), 46, 16);
          flash(e.x, e.y, 30, 0xb080ff, e.hit ? 4 : 2.5);
          FX.shake(e.hit ? 6 : 3);
          generic.wave(e.x, e.y, e.hit ? 140 : 90, 0xd8c0ff, 0.4);
          generic.sparks(e.x, e.y, 4, e.hit ? 36 : 18, [0xffffff, 0xc8a0ff, 0x8040ff], 220, 0.45, 5);
        }
        if (e.type === 'absorb') { flash(e.x, e.y, 20, 0xc8a0ff, 2.5); generic.wave(e.x, e.y, 100, 0xe2d4ff, 0.35); }
        if (e.type === 'release') { FX.shake(5); flash(e.x, e.y, 20, 0xc8a0ff, 3); generic.wave(e.x, e.y, 140, 0xb080ff, 0.4); generic.sparks(e.x, e.y, 12, 30, [0xffffff, 0xb080ff], 220, 0.45, 6); }
        if (e.type === 'reflect') { generic.wave(e.x, e.y, 80, 0xc070ff, 0.3); }
        if (e.type === 'special' && e.f === f) { FX.shake(4); flash(f.x, f.y, 60, 0x9050ff, 3); }
      },
      dispose() { boltsPool.forEach((b) => b.dispose()); disposeTree(g); root.remove(g); }
    };
  }

  function foeOfF(f) { return f === BATTLE.a ? BATTLE.b : BATTLE.a; }
  const KITS = { dragoon: kitDragoon, dranzer: kitDranzer, blackdranzer: kitBlackDranzer, driger: kitDriger,
                 draciel: kitDraciel, wolborg: kitWolborg, zeus: kitZeus };

  FX.setupBattle = function (battle) {
    if (!FX.ready) return;
    for (const k of kits) k.dispose();
    kits = [];
    if (generic) generic.dispose();
    generic = makeGeneric();
    add.clear(); smoke.clear();
    shake = 0; flashI = 0; dim = 0; dimTarget = 0;
    for (const f of [battle.a, battle.b]) {
      const make = KITS[f.bey.id];
      if (make) kits.push(make(f));
    }
    markBloom(root);
    // the bit's halo and beam on each bey glow too
    [meshA, meshB].forEach((m) => { const gl = m && m.userData.glow; if (gl) { gl.halo.layers.enable(BLOOM_LAYER); gl.beam.layers.enable(BLOOM_LAYER); } });
  };

  FX.update = function (battle, dt, t) {
    dimTarget = 0;
    for (const e of battle.events) {
      generic.onEvent(e);
      for (const k of kits) k.onEvent(e);
    }
    for (const k of kits) { k.update(dt, t); if (k.tick) k.tick(dt, t); }
    generic.update(dt);
    add.update(dt); smoke.update(dt);
    // The lights dim during Eclipse Drain and Dark Dimension.
    dim += (dimTarget - dim) * Math.min(1, dt * 6);
    if (lights.ambient) lights.ambient.intensity = lights.ambientBase * (1 - dim);
    if (lights.dir) lights.dir.intensity = lights.dirBase * (1 - dim * 0.85);
    // Flash of light on big hits
    flashI = Math.max(0, flashI - dt * 9);
    flashLight.intensity = flashI;
    // Camera shake, on top of the normal camera movement
    if (shake > 0.05) {
      C.position.x += (Math.random() - 0.5) * shake;
      C.position.y += (Math.random() - 0.5) * shake;
      C.position.z += (Math.random() - 0.5) * shake;
      shake *= Math.max(0, 1 - dt * 9);
    }
    // Only run the glow pass when something is glowing, to save battery.
    const anyFx = battle.a.special || battle.b.special || battle.a.glow > 0.02 || battle.b.glow > 0.02 ||
      flashI > 0.05 || battle.a.guardTimer > 0 || battle.b.guardTimer > 0 || battle.a.mirror > 0 || battle.b.mirror > 0 ||
      (battle.a.boostTimer > 0) || (battle.b.boostTimer > 0) || battle.waves.length || battle.trails.length;
    bloomLevel += ((anyFx ? 1 : 0) - bloomLevel) * Math.min(1, dt * (anyFx ? 10 : 3));
    dtAvg += (dt - dtAvg) * 0.1;
    if (!lowPower && bloomLevel > 0.5 && dtAvg > 1 / 30) {
      slowT += dt;
      if (slowT > 2.5) { lowPower = true; console.info('FX: glow turned off to keep the game smooth on this device.'); }
    } else slowT = Math.max(0, slowT - dt);
  };
  FX.isLowPower = function () { return lowPower; };

  window.FX = FX;
})();
