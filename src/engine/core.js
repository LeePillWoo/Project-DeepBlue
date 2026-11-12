// Project Deep Blue — core: namespace, math, geometry helpers, GLSL chunks, input.
(function () {
  'use strict';
  const DB = (window.DB = window.DB || {});
  const T = THREE;

  // ------------------------------------------------------------------ math
  const M = (DB.M = {
    clamp: (x, a, b) => (x < a ? a : x > b ? b : x),
    sat: (x) => (x < 0 ? 0 : x > 1 ? 1 : x),
    lerp: (a, b, t) => a + (b - a) * t,
    smooth: (a, b, x) => { const t = M.sat((x - a) / (b - a)); return t * t * (3 - 2 * t); },
    damp: (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt)),
    wrapPi: (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; },
    dampAngle: (a, b, k, dt) => a + M.wrapPi(b - a) * (1 - Math.exp(-k * dt)),
    remap: (x, a, b, c, d) => c + (d - c) * M.sat((x - a) / (b - a)),
    rng: (seed) => () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  });
  function hash2(ix, iy) {
    let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  M.hash2 = hash2;
  M.noise2 = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  M.fbm2 = (x, y, oct = 5) => {
    let a = 0.5, s = 0;
    for (let i = 0; i < oct; i++) { s += a * M.noise2(x, y); x = x * 2.03 + 17.31; y = y * 2.03 + 9.17; a *= 0.5; }
    return s;
  };

  // tiny event bus (gameplay → ui/audio)
  const handlers = {};
  DB.on = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); };
  DB.emit = (ev, data) => { const h = handlers[ev]; if (h) for (const fn of h) fn(data); };

  // ------------------------------------------------------------------ quality
  const qs = new URLSearchParams(location.search);
  DB.params = qs;
  const presets = {
    low: { scale: 0.7, msaa: 0, cloudSteps: 12, skyScale: 0.4, shadow: 1024, oceanSeg: 256, rays: 10 },
    medium: { scale: 0.85, msaa: 2, cloudSteps: 18, skyScale: 0.5, shadow: 2048, oceanSeg: 320, rays: 14 },
    high: { scale: 1.0, msaa: 4, cloudSteps: 36, skyScale: 0.5, shadow: 2048, oceanSeg: 384, rays: 18 },
    ultra: { scale: 1.0, msaa: 4, cloudSteps: 56, skyScale: 0.75, shadow: 4096, oceanSeg: 512, rays: 26 },
  };
  DB.Q = Object.assign({ name: 'high' }, presets[qs.get('q')] || presets.high);
  if (presets[qs.get('q')]) DB.Q.name = qs.get('q');

  // Yield to the browser between heavy init steps so the loading UI repaints.
  DB.yieldNow = () =>
    'scheduler' in window && 'yield' in window.scheduler ? window.scheduler.yield() : new Promise((r) => setTimeout(r, 0));

  // ------------------------------------------------------------------ geometry helpers
  const G = (DB.G = {});
  const _m4 = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler(), _v = new T.Vector3(), _s = new T.Vector3();

  // transform a geometry in place: xf(geo, [x,y,z], [rx,ry,rz], scale|[sx,sy,sz])
  G.xf = (geo, p, r, s) => {
    _e.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0);
    _q.setFromEuler(_e);
    if (s === undefined) _s.set(1, 1, 1); else if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
    _m4.compose(_v.set(p ? p[0] : 0, p ? p[1] : 0, p ? p[2] : 0), _q, _s);
    geo.applyMatrix4(_m4);
    return geo;
  };
  // give a geometry a uniform vertex color (linear rgb from hex)
  G.tint = (geo, hex) => {
    const c = new T.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new T.BufferAttribute(a, 3));
    return geo;
  };
  // merge geometries (position/normal/uv/color) into one non-indexed geometry
  G.merge = (geos) => {
    const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
    let n = 0;
    for (const g of parts) n += g.attributes.position.count;
    const hasColor = parts.some((g) => g.attributes.color);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    const col = hasColor ? new Float32Array(n * 3).fill(1) : null;
    let o = 0;
    for (const g of parts) {
      const c = g.attributes.position.count;
      pos.set(g.attributes.position.array.subarray(0, c * 3), o * 3);
      if (!g.attributes.normal) g.computeVertexNormals();
      nor.set(g.attributes.normal.array.subarray(0, c * 3), o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, c * 2), o * 2);
      if (col && g.attributes.color) col.set(g.attributes.color.array.subarray(0, c * 3), o * 3);
      o += c;
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.BufferAttribute(nor, 3));
    out.setAttribute('uv', new T.BufferAttribute(uv, 2));
    if (col) out.setAttribute('color', new T.BufferAttribute(col, 3));
    return out;
  };
  // box with rounded edges
  G.rbox = (w, h, d, r, seg = 4) => {
    r = Math.min(r, w / 2, h / 2, d / 2);
    const g = new T.BoxGeometry(w, h, d, seg * 2, seg * 2, seg * 2);
    const p = g.attributes.position, nrm = g.attributes.normal;
    const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const cx = M.clamp(x, -hx, hx), cy = M.clamp(y, -hy, hy), cz = M.clamp(z, -hz, hz);
      _v.set(x - cx, y - cy, z - cz);
      if (_v.lengthSq() < 1e-12) { _v.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i)); } else _v.normalize();
      p.setXYZ(i, cx + _v.x * r, cy + _v.y * r, cz + _v.z * r);
      nrm.setXYZ(i, _v.x, _v.y, _v.z);
    }
    return g;
  };
  G.box = (w, h, d) => new T.BoxGeometry(w, h, d);
  G.cyl = (r1, r2, h, seg = 20, open = false) => new T.CylinderGeometry(r1, r2, h, seg, 1, open);
  G.sph = (r, ws = 20, hs = 14) => new T.SphereGeometry(r, ws, hs);
  G.cap = (r, len, seg = 12) => new T.CapsuleGeometry(r, len, 5, seg);
  G.torus = (R, r, a = 10, b = 24, arc = Math.PI * 2) => new T.TorusGeometry(R, r, a, b, arc);
  G.tube = (pts, r, seg = 8, closed = false, tSeg) => {
    const curve = new T.CatmullRomCurve3(pts.map((p) => (p.isVector3 ? p : new T.Vector3(p[0], p[1], p[2]))), closed, 'centripetal');
    return new T.TubeGeometry(curve, tSeg || Math.max(8, pts.length * 6), r, seg, closed);
  };
  // sweep a closed 2D section [(side, up), ...] along a path (Vector3[]), keeping "up" = +Y
  G.sweep = (path, section, closedPath = false) => {
    const n = path.length, m = section.length;
    const pos = new Float32Array(n * m * 3), uv = new Float32Array(n * m * 2), idx = [];
    const t = new T.Vector3(), side = new T.Vector3(), up = new T.Vector3(0, 1, 0);
    let len = 0;
    for (let i = 0; i < n; i++) {
      const a = path[closedPath ? (i - 1 + n) % n : Math.max(i - 1, 0)], b = path[closedPath ? (i + 1) % n : Math.min(i + 1, n - 1)];
      t.subVectors(b, a).normalize();
      side.crossVectors(t, up).normalize();
      if (i > 0) len += path[i].distanceTo(path[i - 1]);
      for (let j = 0; j < m; j++) {
        const k = (i * m + j) * 3;
        pos[k] = path[i].x + side.x * section[j][0];
        pos[k + 1] = path[i].y + section[j][1];
        pos[k + 2] = path[i].z + side.z * section[j][0];
        uv[(i * m + j) * 2] = len;
        uv[(i * m + j) * 2 + 1] = j / m;
      }
    }
    const rings = closedPath ? n : n - 1;
    for (let i = 0; i < rings; i++) {
      const i2 = (i + 1) % n;
      for (let j = 0; j < m; j++) {
        const j2 = (j + 1) % m;
        const a = i * m + j, b = i * m + j2, c = i2 * m + j, d = i2 * m + j2;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  // rounded-rectangle section for sweeps
  G.rrect = (w, h, r, seg = 3) => {
    const pts = [], hw = w / 2, hh = h / 2;
    const corners = [[hw - r, hh - r, 0], [-hw + r, hh - r, 1], [-hw + r, -hh + r, 2], [hw - r, -hh + r, 3]];
    for (const [cx, cy, q] of corners) for (let i = 0; i <= seg; i++) {
      const a = (q + i / seg) * Math.PI / 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts;
  };

  // ------------------------------------------------------------------ textures
  DB.canvasTex = (w, h, draw, opts = {}) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    draw(ctx, w, h);
    const t = new T.CanvasTexture(c);
    if (opts.srgb !== false) t.colorSpace = T.SRGBColorSpace;
    if (opts.repeat !== false) t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = opts.aniso || 8;
    return t;
  };

  // fullscreen pass helper
  const fsScene = new T.Scene(), fsCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fsMesh = new T.Mesh(new T.PlaneGeometry(2, 2), null);
  fsMesh.frustumCulled = false;
  fsScene.add(fsMesh);
  DB.FS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  DB.renderFS = (renderer, material, target, face) => {
    fsMesh.material = material;
    renderer.setRenderTarget(target || null, face || 0);
    renderer.render(fsScene, fsCam);
  };
  DB.fsMat = (frag, uniforms, extra) =>
    new T.ShaderMaterial(Object.assign({ vertexShader: DB.FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false }, extra || {}));
  // render a fragment shader once into a tiling mipmapped texture
  DB.bake = (renderer, frag, size, uniforms, opts = {}) => {
    const rt = new T.WebGLRenderTarget(size, size, {
      wrapS: T.RepeatWrapping, wrapT: T.RepeatWrapping, minFilter: T.LinearMipmapLinearFilter, magFilter: T.LinearFilter,
      generateMipmaps: true, type: opts.type || T.UnsignedByteType, depthBuffer: false,
    });
    rt.texture.anisotropy = opts.aniso || 8;
    const mat = DB.fsMat(frag, uniforms || {});
    DB.renderFS(renderer, mat, rt);
    renderer.setRenderTarget(null);
    mat.dispose();
    return rt.texture;
  };

  // 256² noise: R = white noise, G = R shifted by (37,17) so one bilinear fetch gives 3D value noise (iq's trick)
  DB.makeNoiseTex = () => {
    const N = 256, d = new Uint8Array(N * N * 4), r = M.rng(1337);
    for (let i = 0; i < N * N; i++) { d[i * 4] = r() * 256; d[i * 4 + 2] = r() * 256; d[i * 4 + 3] = r() * 256; }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const sx = (x - 37 + N) % N, sy = (y - 17 + N) % N;
      d[(y * N + x) * 4 + 1] = d[(sy * N + sx) * 4];
    }
    const t = new T.DataTexture(d, N, N, T.RGBAFormat);
    t.wrapS = t.wrapT = T.RepeatWrapping; t.minFilter = t.magFilter = T.LinearFilter; t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };

  // ------------------------------------------------------------------ GLSL chunks
  DB.GLSL = {};
  DB.GLSL.common = /* glsl */ `
#define PI 3.14159265359
#define sat(x) clamp(x, 0.0, 1.0)
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*vnoise(p); p = p*2.02 + vec2(17.3, 9.1); a *= 0.5; } return s; }
float fbm3(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<3;i++){ s += a*vnoise(p); p = p*2.02 + vec2(17.3, 9.1); a *= 0.5; } return s; }
`;
  // 3D value noise through the 256² lookup texture (uniform sampler2D uNoise)
  DB.GLSL.noise3 = /* glsl */ `
float tnoise(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
  vec2 uv = (i.xy + vec2(37.0, 17.0) * i.z) + f.xy;
  vec2 rg = textureLod(uNoise, (uv + 0.5) / 256.0, 0.0).yx; return mix(rg.x, rg.y, f.z); }
`;

  // ------------------------------------------------------------------ input
  const Input = (DB.Input = {
    keys: new Set(), hit: new Set(), mdx: 0, mdy: 0, buttons: 0, bDown: 0, bUp: 0, locked: false, canvas: null, onLock: null,
    free: false, everLocked: false, cx: 0,      // free = no pointer lock available here: play with the visible cursor (cx = cursor x, -1..1)
    init(canvas) {
      this.canvas = canvas;
      addEventListener('keydown', (e) => {
        if (!e.repeat) { this.keys.add(e.code); this.hit.add(e.code); }
        if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) || (e.code === 'KeyF' && !e.ctrlKey)) e.preventDefault();
        if (this.free && e.code === 'Escape' && !e.repeat) {      // without pointer lock, Esc is ours to handle: pause / resume
          this.locked = !this.locked; if (!this.locked) { this.buttons = 0; this.keys.clear(); }
          if (this.onLock) this.onLock(this.locked);
        }
      });
      addEventListener('keyup', (e) => this.keys.delete(e.code));
      addEventListener('blur', () => { this.keys.clear(); this.buttons = 0; });
      document.addEventListener('mousemove', (e) => { this.cx = (e.clientX / innerWidth) * 2 - 1; if (this.locked) { this.mdx += e.movementX; this.mdy += e.movementY; } });
      document.addEventListener('mousedown', (e) => { if (!this.locked) return; this.buttons |= 1 << e.button; this.bDown |= 1 << e.button; });
      document.addEventListener('mouseup', (e) => { if (this.buttons & (1 << e.button)) this.bUp |= 1 << e.button; this.buttons &= ~(1 << e.button); });
      document.addEventListener('contextmenu', (e) => e.preventDefault());
      document.addEventListener('pointerlockchange', () => {
        this.locked = document.pointerLockElement === canvas;
        if (this.locked) { this.everLocked = true; this.free = false; }
        if (!this.locked) { this.buttons = 0; this.keys.clear(); }
        if (this.onLock) this.onLock(this.locked);
      });
    },
    lock() {
      const c = this.canvas;
      if (!c || document.pointerLockElement === c) return;
      if (this.free) { if (!this.locked) { this.locked = true; if (this.onLock) this.onLock(true); } return; }
      // a viewer that refuses pointer lock outright (some embedded / app views) gets cursor play instead; a refusal after it has
      // worked once is just Chrome's cool-down after Esc, so that one is ignored
      const fail = () => { if (!this.everLocked) this.goFree(); };
      try {
        const p = c.requestPointerLock({ unadjustedMovement: true });
        if (p && p.catch) p.catch(() => { try { const p2 = c.requestPointerLock(); if (p2 && p2.catch) p2.catch(fail); } catch (e) { fail(); } });
      } catch (e) { try { const p3 = c.requestPointerLock(); if (p3 && p3.catch) p3.catch(fail); } catch (e2) { fail(); } }
    },
    goFree() { this.free = true; this.locked = true; if (this.onLock) this.onLock(true); DB.emit('freeMouse'); },
    unlock() { if (document.pointerLockElement) document.exitPointerLock(); },
    down(code) { return this.keys.has(code); },
    pressed(code) { return this.hit.has(code); },
    mouse(b = 0) { return !!(this.buttons & (1 << b)); },
    mouseDown(b = 0) { return !!(this.bDown & (1 << b)); },
    mouseUp(b = 0) { return !!(this.bUp & (1 << b)); },
    endFrame() { this.hit.clear(); this.mdx = this.mdy = 0; this.bDown = this.bUp = 0; },
  });
})();
