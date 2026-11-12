// Project Deep Blue — particles (spray, mist, bubbles, blood/sand clouds) + screen-space thick lines.
(function () {
  'use strict';
  const DB = window.DB, T = THREE, M = DB.M;
  const N = 6000;

  const VERT = /* glsl */ `
attribute vec4 aData;    // size (m), alpha, kind, seed
attribute vec3 aColor;
uniform float uScale, uTime;
varying vec4 vData; varying vec3 vColor; varying vec3 vWorld;
void main(){
  vec3 p = position;
  if (aData.z > 1.5 && aData.z < 2.5) { p.x += sin(uTime * 6.0 + aData.w * 40.0) * 0.025; p.z += cos(uTime * 5.3 + aData.w * 31.0) * 0.025; }
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(aData.x * uScale / max(-mv.z, 0.05), aData.z > 1.5 && aData.z < 2.5 ? 64.0 : 480.0);
  vData = aData; vColor = aColor; vWorld = p;
  vData.y *= smoothstep(0.12, 0.55, -mv.z);      // nothing balloons into the lens
}`;
  const FRAG = /* glsl */ `
uniform float uUnder;
varying vec4 vData; varying vec3 vColor; varying vec3 vWorld;
${DB.GLSL.common}
${DB.GLSL.water}
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0; float r = length(q);
  if (r > 1.0) discard;
  float kind = vData.z, a; vec3 col = vColor;
  if (kind < 0.5) a = pow(1.0 - r, 1.5);                                                       // mist
  else if (kind < 1.5) { a = smoothstep(1.0, 0.5, r); col *= 0.75 + 0.9 * smoothstep(0.55, 0.0, length(q - vec2(-0.3, -0.3))); }   // droplet
  else if (kind < 2.5) { a = smoothstep(0.5, 0.95, r) * smoothstep(1.0, 0.88, r) * 0.75 + smoothstep(0.4, 0.0, length(q - vec2(-0.35, -0.4))) + 0.07; }   // bubble
  else if (kind < 3.5) a = pow(1.0 - r, 1.15);                                                 // cloud
  else a = smoothstep(1.0, 0.15, r);                                                           // speck
  a *= vData.y;
  if (uUnder > 0.5) {
    float depth = max(-vWorld.y, 0.0);
    if (kind < 2.5 || kind > 3.5) col *= sunAtDepth(depth) * 0.16 + ambAtDepth(depth) * 0.3;   // lit by what reaches this depth
    else col *= (sunAtDepth(depth) * 0.25 + ambAtDepth(depth) * 0.3);
    vec3 toP = vWorld - cameraPosition; float d = length(toP);
    col = waterFog(col, toP / d, d, max(-cameraPosition.y, 0.0));
  }
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

  const FX = (DB.FX = {
    n: 0, time: 0,
    init(scene) {
      this.pos = new Float32Array(N * 3); this.data = new Float32Array(N * 4); this.col = new Float32Array(N * 3);
      this.vel = new Float32Array(N * 3); this.life = new Float32Array(N); this.max = new Float32Array(N);
      this.grow = new Float32Array(N); this.grav = new Float32Array(N); this.drag = new Float32Array(N); this.a0 = new Float32Array(N);
      const g = (this.geo = new T.BufferGeometry());
      g.setAttribute('position', new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage));
      g.setAttribute('aData', new T.BufferAttribute(this.data, 4).setUsage(T.DynamicDrawUsage));
      g.setAttribute('aColor', new T.BufferAttribute(this.col, 3).setUsage(T.DynamicDrawUsage));
      g.setDrawRange(0, 0);
      this.mat = new T.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, toneMapped: false,
        uniforms: Object.assign({ uScale: { value: 600 }, uTime: { value: 0 }, uUnder: { value: 0 } }, DB.Ocean.water),
      });
      this.points = new T.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 20;
      scene.add(this.points);
    },
    clear() { this.n = 0; this.geo.setDrawRange(0, 0); },
    // o: {x,y,z, vx,vy,vz, life, size, grow, alpha, kind, grav, drag, r,g,b}
    emit(o) {
      if (this.n >= N) return;
      const i = this.n++;
      this.pos[i * 3] = o.x; this.pos[i * 3 + 1] = o.y; this.pos[i * 3 + 2] = o.z;
      this.vel[i * 3] = o.vx || 0; this.vel[i * 3 + 1] = o.vy || 0; this.vel[i * 3 + 2] = o.vz || 0;
      this.life[i] = this.max[i] = o.life || 1; this.grow[i] = o.grow || 0; this.grav[i] = o.grav === undefined ? -9.8 : o.grav; this.drag[i] = o.drag || 0;
      this.data[i * 4] = o.size || 0.1; this.a0[i] = o.alpha === undefined ? 1 : o.alpha; this.data[i * 4 + 1] = this.a0[i]; this.data[i * 4 + 2] = o.kind || 0; this.data[i * 4 + 3] = Math.random();
      this.col[i * 3] = o.r === undefined ? 1 : o.r; this.col[i * 3 + 1] = o.g === undefined ? 1 : o.g; this.col[i * 3 + 2] = o.b === undefined ? 1 : o.b;
    },
    // white-water colour under the current sun
    white(k = 1) { const e = DB.Env; return [(e.sunColor.r * 0.26 + e.ambColor.r) * 0.85 * k, (e.sunColor.g * 0.26 + e.ambColor.g) * 0.85 * k, (e.sunColor.b * 0.26 + e.ambColor.b) * 0.85 * k]; },
    // surface splash: s = strength (1 = big fish breach)
    splash(x, y, z, s = 1, dirX = 0, dirZ = 0) {
      const w = this.white();
      const nd = Math.round(80 * s + 14), nm = Math.round(20 * s + 2);
      for (let i = 0; i < nd; i++) {
        const a = Math.random() * 6.283, sp = (1.2 + Math.random() * 4.5) * Math.sqrt(s), up = (2.5 + Math.random() * 7.5) * Math.sqrt(s);
        this.emit({ x: x + Math.cos(a) * 0.3 * s, y: y + 0.05, z: z + Math.sin(a) * 0.3 * s, vx: Math.cos(a) * sp + dirX * 2.5, vy: up, vz: Math.sin(a) * sp + dirZ * 2.5, life: 0.7 + Math.random() * 1.1, size: (0.04 + Math.random() * 0.1) * (0.6 + 0.5 * s), kind: 1, alpha: 0.95, drag: 0.4, r: w[0] * 1.15, g: w[1] * 1.15, b: w[2] * 1.15 });
      }
      for (let i = 0; i < nm; i++) {
        const a = Math.random() * 6.283, sp = Math.random() * 2.2 * s;
        this.emit({ x: x + Math.cos(a) * 0.5 * s, y: y + 0.2, z: z + Math.sin(a) * 0.5 * s, vx: Math.cos(a) * sp + dirX, vy: 1.2 + Math.random() * 3.5 * Math.sqrt(s), vz: Math.sin(a) * sp + dirZ, life: 0.8 + Math.random() * 1.2, size: (0.45 + Math.random() * 0.9) * (0.22 + 0.8 * s), grow: 1.5 * s, kind: 0, alpha: 0.2 + 0.12 * Math.min(s, 1), grav: -3.2, drag: 1.4, r: w[0], g: w[1], b: w[2] });
      }
    },
    bubbles(x, y, z, n, spread = 0.2, size = 0.03, up = 0.5) {
      for (let i = 0; i < n; i++) {
        this.emit({ x: x + (Math.random() - 0.5) * spread, y: y + (Math.random() - 0.5) * spread, z: z + (Math.random() - 0.5) * spread, vx: (Math.random() - 0.5) * 0.5, vy: up * (0.5 + Math.random()), vz: (Math.random() - 0.5) * 0.5, life: 3 + Math.random() * 5, size: size * (0.35 + Math.random() * 1.2), kind: 2, alpha: 0.9, grav: 0.9, drag: 2.2, r: 1.5, g: 1.6, b: 1.6 });
      }
    },
    cloud(x, y, z, n, r, g, b, size = 0.4, life = 5) {
      for (let i = 0; i < n; i++) {
        this.emit({ x: x + (Math.random() - 0.5) * 0.3, y: y + (Math.random() - 0.5) * 0.3, z: z + (Math.random() - 0.5) * 0.3, vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.3) * 0.3, vz: (Math.random() - 0.5) * 0.5, life: life * (0.6 + Math.random() * 0.7), size: size * (0.6 + Math.random()), grow: size * 0.5, kind: 3, alpha: 0.5, grav: 0, drag: 1.5, r, g, b });
      }
    },
    update(dt, camera, under) {
      this.time += dt;
      const { pos, vel, life, max, grow, grav, drag, data, a0, col } = this;
      let n = this.n;
      for (let i = 0; i < n; i++) {
        life[i] -= dt;
        const kind = data[i * 4 + 2];
        const dead = life[i] <= 0 || (kind > 1.5 && kind < 2.5 && pos[i * 3 + 1] > -0.12) || (!under && kind < 1.5 && pos[i * 3 + 1] < -0.4);
        if (dead) {     // swap-remove
          n--;
          if (i !== n) {
            for (let c = 0; c < 3; c++) { pos[i * 3 + c] = pos[n * 3 + c]; vel[i * 3 + c] = vel[n * 3 + c]; col[i * 3 + c] = col[n * 3 + c]; }
            for (let c = 0; c < 4; c++) data[i * 4 + c] = data[n * 4 + c];
            life[i] = life[n]; max[i] = max[n]; grow[i] = grow[n]; grav[i] = grav[n]; drag[i] = drag[n]; a0[i] = a0[n];
          }
          i--; continue;
        }
        const k = Math.max(1 - drag[i] * dt, 0);
        vel[i * 3] *= k; vel[i * 3 + 2] *= k; vel[i * 3 + 1] = vel[i * 3 + 1] * k + grav[i] * dt;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        data[i * 4] += grow[i] * dt;
        const t = life[i] / max[i];
        data[i * 4 + 1] = a0[i] * (kind > 1.5 && kind < 2.5 ? Math.min(1, t * 6) : Math.min(1, t * 2.2));
      }
      this.n = n;
      const g = this.geo;
      g.setDrawRange(0, n);
      if (n) { g.attributes.position.needsUpdate = true; g.attributes.aData.needsUpdate = true; g.attributes.aColor.needsUpdate = true; }
      const u = this.mat.uniforms;
      u.uScale.value = DB.Post.h / (2 * Math.tan((camera.fov * Math.PI) / 360));
      u.uTime.value = this.time; u.uUnder.value = under ? 1 : 0;
    },
  });

  // ------------------------------------------------------------------ thick line (polyline expanded in screen space)
  const LVERT = /* glsl */ `
attribute vec3 aPrev, aNext; attribute float aSide;
uniform vec2 uRes; uniform float uWidth;
varying float vA;
void main(){
  vec4 c = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(aPrev, 1.0);
  vec4 n = projectionMatrix * viewMatrix * modelMatrix * vec4(aNext, 1.0);
  vec2 a = uRes * 0.5;
  vec2 d = normalize((n.xy / max(n.w, 1e-4) - p.xy / max(p.w, 1e-4)) * a + 1e-6);
  vec2 nrm = vec2(-d.y, d.x);
  float wpx = uWidth * uRes.y * 0.83 / max(c.w, 0.05);      // world-space thickness → pixels (fades to a hairline with distance)
  c.xy += nrm * aSide * clamp(wpx, 0.9, 5.0) / a * c.w;
  vA = clamp(wpx, 0.32, 1.0);
  gl_Position = c;
}`;
  const LFRAG = /* glsl */ `uniform vec3 uColor; uniform float uAlpha; varying float vA; void main(){ gl_FragColor = vec4(uColor, uAlpha * vA); }`;

  // DB.Line(n, thickness in metres, color) → { mesh, set(i, x, y, z), commit(count) }
  DB.Line = function (n, width, color, alpha = 1) {
    const pos = new Float32Array(n * 2 * 3), prev = new Float32Array(n * 2 * 3), next = new Float32Array(n * 2 * 3), side = new Float32Array(n * 2), idx = [];
    for (let i = 0; i < n; i++) { side[i * 2] = -1; side[i * 2 + 1] = 1; if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute('aPrev', new T.BufferAttribute(prev, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute('aNext', new T.BufferAttribute(next, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute('aSide', new T.BufferAttribute(side, 1));
    g.setIndex(idx);
    const mat = new T.ShaderMaterial({ vertexShader: LVERT, fragmentShader: LFRAG, transparent: true, depthWrite: false, toneMapped: false, side: T.DoubleSide,
      uniforms: { uRes: { value: new T.Vector2(1920, 1080) }, uWidth: { value: width }, uColor: { value: color }, uAlpha: { value: alpha } } });
    this.mesh = new T.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 15;
    this.pts = new Float32Array(n * 3); this.n = n; this.geo = g; this.mat = mat;
  };
  DB.Line.prototype.set = function (i, x, y, z) { this.pts[i * 3] = x; this.pts[i * 3 + 1] = y; this.pts[i * 3 + 2] = z; };
  DB.Line.prototype.commit = function (count) {
    const p = this.pts, g = this.geo, pos = g.attributes.position.array, prev = g.attributes.aPrev.array, next = g.attributes.aNext.array;
    for (let i = 0; i < count; i++) {
      const a = Math.max(i - 1, 0) * 3, b = Math.min(i + 1, count - 1) * 3;
      for (let s = 0; s < 2; s++) for (let c = 0; c < 3; c++) { const o = (i * 2 + s) * 3 + c; pos[o] = p[i * 3 + c]; prev[o] = p[a + c]; next[o] = p[b + c]; }
    }
    g.attributes.position.needsUpdate = g.attributes.aPrev.needsUpdate = g.attributes.aNext.needsUpdate = true;
    g.setDrawRange(0, Math.max(count - 1, 0) * 6);
    this.mat.uniforms.uRes.value.set(DB.Post.w, DB.Post.h);
  };
})();
