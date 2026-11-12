// Project Deep Blue — underwater world: submerged material (absorption / caustics / fog / torch), seabed, scanned rocks,
// shipwreck, procedural corals + plants, marine snow.
(function () {
  'use strict';
  const DB = window.DB, T = THREE, M = DB.M, G = DB.G;
  const V3 = (x, y, z) => new T.Vector3(x, y, z);

  // ------------------------------------------------------------------ submerged material
  const UW_VERT = /* glsl */ `
varying vec3 vWorld; varying vec3 vNormal; varying vec2 vUv; varying vec3 vCol;
uniform float uWTime;
#ifdef SWIM
${DB.Fish.SWIM}
  #ifdef INST_PHASE
attribute vec4 aPhase;      // phase, amplitude, bend, tint
  #endif
#endif
#ifdef SWAY
uniform vec2 uSway;         // amplitude, height
#endif
#ifdef TERRAIN
attribute float aRock; varying float vRock;
#endif
#ifdef FLAP
uniform vec4 uFlap;         // stroke phase, amplitude
#endif
#ifdef OCTO
attribute vec2 aArm;        // distance along the arm (0 = body), phase
uniform vec4 uOcto;         // time, writhe amplitude, jet (0 = arms spread on the rock, 1 = trailing behind the mantle)
#endif
void main(){
  vec3 p = position, n = normal;
  vCol = vec3(1.0);
#ifdef USE_COLOR
  vCol *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vCol *= instanceColor;
#endif
#ifdef SWIM
  #ifdef INST_PHASE
  float ph = aPhase.x + uWTime * aPhase.y; float amp = 1.0;
  #else
  float ph = uSwim.x; float amp = 1.0;
  #endif
  p.z += swimOff(position.x, ph) * amp; n.x -= swimSlope(position.x, ph) * n.z * amp; n = normalize(n);
#endif
#ifdef FLAP
  {     // sea turtle (+x = head): the flippers are whatever sticks out sideways from the shell ellipse
    float ex = (position.x + 0.035) / 0.378, ez = position.z / 0.347;
    float fl = smoothstep(0.92, 1.25, sqrt(ex * ex + ez * ez)) * smoothstep(0.08, 0.2, abs(position.z));
    float front = smoothstep(0.02, 0.2, position.x), reach = max(abs(position.z) - 0.2, 0.0);
    p.y += fl * (front * sin(uFlap.x - reach * 2.5) * uFlap.y * (0.25 + reach * 2.2) + (1.0 - front) * sin(uFlap.x + 1.6) * uFlap.y * 0.14);
    p.x += fl * front * cos(uFlap.x) * uFlap.y * reach * 0.7;
  }
#endif
#ifdef OCTO
  {
    float t = aArm.x;
    p += vec3(sin(uOcto.x * 1.3 + aArm.y + t * 5.0), 0.3 * sin(uOcto.x * 1.7 + aArm.y * 2.0 + t * 4.0) + 0.3, cos(uOcto.x * 1.1 + aArm.y * 3.0 + t * 6.0)) * t * t * uOcto.y;
    vec3 trail = vec3(-0.05 - t * 0.62, 0.07 + p.y * 0.3 + sin(uOcto.x * 9.0 + t * 7.0 + aArm.y) * 0.025 * t, p.z * 0.2);
    p = mix(p, trail, uOcto.z * smoothstep(0.0, 0.25, t));
    if (t == 0.0) p.yz *= 1.0 + uOcto.z * 0.12 * sin(uOcto.x * 9.0);      // the mantle pumps while jetting
  }
#endif
  mat4 mm = modelMatrix;
#ifdef USE_INSTANCING
  mm = modelMatrix * instanceMatrix;
#endif
#ifdef SWAY
  vec3 o = (mm * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float k = pow(clamp(position.y / uSway.y, 0.0, 1.0), 1.5), sp = uWTime * 1.25 + o.x * 0.37 + o.z * 0.29;
  p.x += sin(sp) * k * uSway.x; p.z += cos(sp * 0.83 + 1.3) * k * uSway.x * 0.7;
#endif
  vec4 wp = mm * vec4(p, 1.0);
  vWorld = wp.xyz; vNormal = normalize(mat3(mm) * n); vUv = uv;
#ifdef TERRAIN
  vRock = aRock;
#endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

  const UW_FRAG = /* glsl */ `
varying vec3 vWorld; varying vec3 vNormal; varying vec2 vUv; varying vec3 vCol;
uniform vec3 uColor, uTint; uniform float uUv, uSilver, uNormalFlip, uAlphaTest, uDetail, uEmis;
uniform sampler2D map, normalMap, detailMap;
uniform vec4 uTorch; uniform vec3 uTorchPos, uTorchDir;
#ifdef TERRAIN
varying float vRock; uniform sampler2D sandMap, sandNor, rockMap, rockNor, rock2Map;
#endif
${DB.GLSL.common}
${DB.GLSL.water}
vec3 perturb(vec3 N, vec2 uv, vec3 mapN){
  vec3 dp1 = dFdx(vWorld), dp2 = dFdy(vWorld); vec2 du1 = dFdx(uv), du2 = dFdy(uv);
  vec3 dp2p = cross(dp2, N), dp1p = cross(N, dp1);
  vec3 Tn = dp2p * du1.x + dp1p * du2.x, Bn = dp2p * du1.y + dp1p * du2.y;
  float im = inversesqrt(max(max(dot(Tn, Tn), dot(Bn, Bn)), 1e-12));
  return normalize(mat3(Tn * im, Bn * im, N) * mapN);
}
void main(){
  vec3 N = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 toP = vWorld - cameraPosition; float dist = length(toP); vec3 rd = toP / dist;
  float depth = max(-vWorld.y, 0.0), camDepth = max(-cameraPosition.y, 0.0);
  vec4 base = vec4(uColor, 1.0);
#ifdef TERRAIN
  vec2 xz = vWorld.xz;
  float big = vnoise(xz * 0.06) * 0.6 + vnoise(xz * 0.21) * 0.4;
  vec3 sand = texture2D(sandMap, xz / 2.7).rgb * mix(texture2D(sandMap, xz / 11.3).rgb * 2.4, vec3(1.0), 0.55);
  vec3 bw = pow(abs(N), vec3(4.0)); bw /= bw.x + bw.y + bw.z;
  vec3 rk = texture2D(rockMap, xz / 3.3).rgb * bw.y + texture2D(rockMap, vWorld.xy / 3.3).rgb * bw.z + texture2D(rockMap, vWorld.zy / 3.3).rgb * bw.x;
  vec3 rk2 = texture2D(rock2Map, xz / 4.7).rgb;
  vec3 rock = mix(rk, rk2, smoothstep(0.35, 0.7, big)) * mix(vec3(0.85, 0.8, 0.95), vec3(1.05, 1.0, 0.8), vnoise(xz * 0.13 + 7.0));
  float rmix = smoothstep(0.35, 0.65, vRock + (texture2D(rockMap, xz / 5.1).g - 0.45) * 0.5 + (1.0 - N.y) * 1.6);
  base.rgb = mix(sand * vec3(2.0, 1.95, 1.8), rock * 0.95, rmix);
  vec3 ns = texture2D(sandNor, xz / 2.7).xyz * 2.0 - 1.0, nr = texture2D(rockNor, xz / 3.3).xyz * 2.0 - 1.0;
  vec3 mn = mix(ns * vec3(0.7, -0.7, 1.0), nr * vec3(1.3, -1.3, 1.0), rmix);
  N = normalize(N + (vec3(mn.x, 0.0, mn.y)) * 0.75 * N.y);
#else
  #ifdef USE_MAP
  vec4 tx = texture2D(map, vUv * uUv);
  base *= tx;
  if (uAlphaTest > 0.0 && tx.a < uAlphaTest) discard;
  #endif
  base.rgb *= vCol;
  #ifdef USE_NORMALMAP
  vec3 mapN = texture2D(normalMap, vUv * uUv).xyz * 2.0 - 1.0; mapN.y *= uNormalFlip;
  N = perturb(N, vUv * uUv, mapN);
  #endif
  #ifdef USE_DETAIL
  vec3 bw = pow(abs(N), vec3(3.0)); bw /= bw.x + bw.y + bw.z;
  float dt = texture2D(detailMap, vWorld.xz * uDetail).g * bw.y + texture2D(detailMap, vWorld.xy * uDetail).g * bw.z + texture2D(detailMap, vWorld.zy * uDetail).g * bw.x;
  base.rgb *= 0.45 + dt * 1.25;
  #endif
#endif
  base.rgb *= uTint;
  // light that survives to this depth, modulated by caustics
  vec3 sun = sunAtDepth(depth) * caustics(vWorld);
  vec3 amb = ambAtDepth(depth);
  float NL = max(dot(N, uSunDirW), 0.0);
  vec3 col = base.rgb * (sun * NL + amb * (0.5 + 0.5 * N.y)) / PI;
#ifdef SILVER
  // guanine scales mirror the surrounding water: bright from above, dark from below
  vec3 R = reflect(rd, N);
  float fres = 0.35 + 0.65 * pow(1.0 - max(dot(-rd, N), 0.0), 2.0);
  col += waterColumn(normalize(R + vec3(0.0, 0.25, 0.0)), depth) * uSilver * fres * (0.4 + 0.6 * dot(base.rgb, vec3(0.3333)) * 2.0);
  col += sun * pow(max(dot(normalize(uSunDirW - rd), N), 0.0), 60.0) * uSilver * 0.35;
#endif
  // dive torch: white light restores the colours water has absorbed
  if (uTorch.x > 0.0) {
    vec3 tl = vWorld - uTorchPos; float td = length(tl); tl /= td;
    float cone = smoothstep(uTorch.z, uTorch.y, dot(tl, uTorchDir));
    col += base.rgb * uTorch.x * cone * max(dot(N, -tl), 0.0) / (1.0 + td * td * 0.35) * exp(-uWC * td);
  }
  col += base.rgb * uEmis;
  col = waterFog(col, rd, dist, camDepth);
  gl_FragColor = vec4(col, 1.0);
}`;

  const torchU = { uTorch: { value: new T.Vector4(0, 0.93, 0.8, 0) }, uTorchPos: { value: V3() }, uTorchDir: { value: V3(0, 0, -1) } };
  const white = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;

  const UW = (DB.UW = {
    torch: torchU,
    // o: { map, normalMap, normalFlip, color, vertexColors, uv, detail, detailScale, silver, swim, instPhase, sway:[amp,h], alphaTest, side, tint, emis, flap, octo, terrain:{...} }
    material(o = {}) {
      const defines = {};
      if (o.map) defines.USE_MAP = 1;
      if (o.normalMap) defines.USE_NORMALMAP = 1;
      if (o.detail) defines.USE_DETAIL = 1;
      if (o.silver) defines.SILVER = 1;
      if (o.swim) defines.SWIM = 1;
      if (o.instPhase) defines.INST_PHASE = 1;
      if (o.sway) defines.SWAY = 1;
      if (o.terrain) defines.TERRAIN = 1;
      if (o.flap) defines.FLAP = 1;
      if (o.octo) defines.OCTO = 1;
      const u = Object.assign({
        uColor: { value: new T.Color(o.color === undefined ? 0xffffff : o.color) }, uTint: { value: new T.Color(o.tint === undefined ? 0xffffff : o.tint) },
        uUv: { value: o.uv || 1 }, uSilver: { value: o.silver || 0 }, uNormalFlip: { value: o.normalFlip === undefined ? 1 : o.normalFlip }, uAlphaTest: { value: o.alphaTest || 0 },
        uDetail: { value: o.detailScale || 0.7 }, uEmis: { value: o.emis || 0 }, map: { value: o.map || white }, normalMap: { value: o.normalMap || white }, detailMap: { value: o.detail || white },
        uSwim: { value: new T.Vector4(0, 1, 0, 0) }, uSway: { value: new T.Vector2(o.sway ? o.sway[0] : 0, o.sway ? o.sway[1] : 1) },
        uFlap: { value: new T.Vector4(0, 0.3, 0, 0) }, uOcto: { value: new T.Vector4(0, 0.05, 0, 0) },
      }, o.terrain || {}, DB.Ocean.water, torchU);
      const m = new T.ShaderMaterial({ vertexShader: UW_VERT, fragmentShader: UW_FRAG, uniforms: u, defines, side: o.side === undefined ? T.FrontSide : o.side, vertexColors: !!o.vertexColors, toneMapped: false });
      return m;
    },
  });

  // ------------------------------------------------------------------ procedural coral / plant geometry
  function tapered(a, b, r0, r1, seg = 5) {
    const d = b.clone().sub(a), len = d.length(), g = new T.CylinderGeometry(r1, r0, len, seg, 1, true);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    return g;
  }
  function branchCoral(seed) {
    const r = M.rng(seed), parts = [];
    const grow = (p, dir, len, rad, depth) => {
      const end = p.clone().addScaledVector(dir, len);
      parts.push(tapered(p, end, rad, rad * 0.74));
      if (depth > 0) {
        const n = 2 + (r() < 0.45 ? 1 : 0);
        for (let i = 0; i < n; i++) grow(end, dir.clone().add(V3((r() - 0.5) * 1.6, 0.3 + r() * 0.5, (r() - 0.5) * 1.6)).normalize(), len * (0.6 + r() * 0.22), rad * 0.72, depth - 1);
      } else parts.push(G.xf(new T.SphereGeometry(rad * 0.8, 5, 4), [end.x, end.y, end.z]));
    };
    for (let i = 0; i < 4; i++) grow(V3((r() - 0.5) * 0.14, -0.03, (r() - 0.5) * 0.14), V3((r() - 0.5) * 0.9, 1, (r() - 0.5) * 0.9).normalize(), 0.15 + r() * 0.08, 0.023, 3);
    return G.merge(parts);
  }
  function tableCoral(seed) {
    const r = M.rng(seed), pts = [[0.05, -0.05], [0.07, 0.22], [0.2, 0.33], [0.46, 0.37], [0.52, 0.4], [0.45, 0.425], [0.2, 0.43], [0, 0.42]].map((p) => new T.Vector2(p[0], p[1]));
    const g = new T.LatheGeometry(pts, 20), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), k = 1 + 0.13 * Math.sin(a * 3 + r() * 0.3) + 0.07 * Math.sin(a * 7 + 1); p.setXYZ(i, x * k, p.getY(i) + Math.hypot(x, z) * 0.06 * Math.sin(a * 2), z * k); }
    g.computeVertexNormals(); return g;
  }
  function lumpCoral(seed) {
    const g = new T.SphereGeometry(1, 30, 22), p = g.attributes.position;      // indexed → smooth normals
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 0.78 + 0.34 * M.fbm2(x * 1.7 + seed, z * 1.7 + y * 1.3, 3) + 0.05 * Math.sin(x * 19 + y * 17) * Math.sin(z * 18);
      p.setXYZ(i, x * k, Math.max(y * k * 0.72, -0.2), z * k);
    }
    g.computeVertexNormals(); return g;
  }
  function tubeSponge(seed) {
    const r = M.rng(seed), parts = [];
    for (let i = 0; i < 5; i++) {
      const h = 0.25 + r() * 0.5, a = r() * 6.28, d = 0.03 + r() * 0.1, tilt = V3(Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3).normalize();
      const b = V3(Math.cos(a) * d, -0.03, Math.sin(a) * d), e = b.clone().addScaledVector(tilt, h), rad = 0.035 + r() * 0.035;
      parts.push(tapered(b, e, rad * 0.6, rad, 9));
      const rim = new T.TorusGeometry(rad, rad * 0.16, 5, 12); rim.applyQuaternion(new T.Quaternion().setFromUnitVectors(V3(0, 0, 1), tilt)); rim.translate(e.x, e.y, e.z); parts.push(rim);
    }
    return G.merge(parts);
  }
  function grassTuft(seed) {
    const r = M.rng(seed), pos = [], uv = [], idx = [];
    for (let b = 0; b < 6; b++) {
      const a = r() * 6.28, h = 0.3 + r() * 0.5, lean = 0.1 + r() * 0.3, w = 0.007 + r() * 0.007, ox = (r() - 0.5) * 0.2, oz = (r() - 0.5) * 0.2, n0 = pos.length / 3;
      for (let s = 0; s <= 5; s++) {
        const t = s / 5, ww = w * (1 - t * 0.8), cx = ox + Math.cos(a) * lean * t * t * h, cz = oz + Math.sin(a) * lean * t * t * h;
        pos.push(cx - Math.sin(a) * ww, t * h, cz + Math.cos(a) * ww, cx + Math.sin(a) * ww, t * h, cz - Math.cos(a) * ww); uv.push(0, t, 1, t);
        if (s < 5) idx.push(n0 + s * 2, n0 + s * 2 + 1, n0 + s * 2 + 2, n0 + s * 2 + 1, n0 + s * 2 + 3, n0 + s * 2 + 2);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3)); g.setAttribute('uv', new T.BufferAttribute(new Float32Array(uv), 2));
    g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  function fanTexture() {
    return DB.canvasTex(256, 256, (c, w, h) => {
      c.clearRect(0, 0, w, h); c.strokeStyle = '#fff'; c.lineCap = 'round';
      const r = M.rng(5);
      const br = (x, y, a, len, lw, d) => {
        const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
        c.lineWidth = lw; c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2); c.stroke();
        if (d > 0) { const n = 2 + (r() < 0.5 ? 1 : 0); for (let i = 0; i < n; i++) br(x2, y2, a + (i - (n - 1) / 2) * 0.5 + (r() - 0.5) * 0.25, len * 0.74, Math.max(lw * 0.7, 1.2), d - 1); }
      };
      br(w / 2, h - 2, -Math.PI / 2, 52, 7, 6);
    }, { repeat: false });
  }

  // ------------------------------------------------------------------ reef
  const Reef = (DB.Reef = {
    group: new T.Group(), size: 220, step: 1, radius: 78, wreck: V3(-46, 0, 22), t: 0, colliders: [],

    init(scene) {
      const A = DB.Assets, W = DB.World, grp = this.group, rnd = M.rng(909);
      grp.visible = false; scene.add(grp);

      // water-column backdrop
      const bg = new T.Mesh(new T.PlaneGeometry(2, 2), new T.ShaderMaterial({
        vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }',
        fragmentShader: `varying vec2 vP; uniform vec3 uCamRight, uCamUp, uCamFwd; uniform float uTanHalfFov, uAspect;\n${DB.GLSL.common}\n${DB.GLSL.water}\n void main(){ vec3 rd = normalize(uCamFwd + uCamRight * (vP.x * uTanHalfFov * uAspect) + uCamUp * (vP.y * uTanHalfFov)); gl_FragColor = vec4(waterColumn(rd, max(-cameraPosition.y, 0.0)), 1.0); }`,
        uniforms: Object.assign({}, DB.Env.camU, DB.Ocean.water), depthTest: false, depthWrite: false, toneMapped: false,
      }));
      bg.frustumCulled = false; bg.renderOrder = -1000; grp.add(bg);

      // seabed mesh
      const S = this.size, st = this.step, n = Math.round(S / st) + 1, half = S / 2;
      const hgt = new Float32Array(n * n), pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3), rock = new Float32Array(n * n), idx = new Uint32Array((n - 1) * (n - 1) * 6);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) hgt[j * n + i] = W.height(-half + i * st, -half + j * st);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const o = j * n + i, x = -half + i * st, z = -half + j * st;
        pos[o * 3] = x; pos[o * 3 + 1] = hgt[o]; pos[o * 3 + 2] = z;
        const hx = hgt[j * n + Math.min(i + 1, n - 1)] - hgt[j * n + Math.max(i - 1, 0)], hz = hgt[Math.min(j + 1, n - 1) * n + i] - hgt[Math.max(j - 1, 0) * n + i];
        const l = Math.hypot(hx, 2 * st, hz); nor[o * 3] = -hx / l; nor[o * 3 + 1] = (2 * st) / l; nor[o * 3 + 2] = -hz / l;
        rock[o] = W.rockiness(x, z);
      }
      let k = 0;
      for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i, b = a + 1, c = a + n, d = c + 1; idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d; }
      const tg = new T.BufferGeometry();
      tg.setAttribute('position', new T.BufferAttribute(pos, 3)); tg.setAttribute('normal', new T.BufferAttribute(nor, 3)); tg.setAttribute('aRock', new T.BufferAttribute(rock, 1));
      tg.setIndex(new T.BufferAttribute(idx, 1));
      const sand = A.texSet('coast_sand_01'), r1 = A.texSet('coral_fort_wall_02'), r2 = A.texSet('coral_ground_02');
      this.terrain = new T.Mesh(tg, UW.material({ terrain: { sandMap: { value: sand.map }, sandNor: { value: sand.normalMap }, rockMap: { value: r1.map }, rockNor: { value: r1.normalMap }, rock2Map: { value: r2.map } } }));
      this.terrain.frustumCulled = false; grp.add(this.terrain);
      this.detailTex = r1.map;

      const up = V3(0, 1, 0), q = new T.Quaternion(), e = new T.Euler(), m4 = new T.Matrix4(), sc = V3(), pp = V3(), col = new T.Color();
      // place n instances; pick(i) → {x,z,s,sink,tilt} or null
      const scatter = (geo, mat, count, pick, colors) => {
        const im = new T.InstancedMesh(geo, mat, count); let c = 0;
        for (let i = 0; i < count * 30 && c < count; i++) {
          const o = pick(i); if (!o) continue;
          let y = W.height(o.x, o.z);
          if (o.foot) {     // rest on the lowest ground under the footprint; skip steep spots, where the rock would sink into the slope and only its tips poke out
            let hi = y;
            for (let a = 0; a < 6; a++) { const h = W.height(o.x + Math.cos(a) * o.foot, o.z + Math.sin(a) * o.foot); y = Math.min(y, h); hi = Math.max(hi, h); }
            if (hi - y > o.foot * 0.55) continue;
          }
          y -= o.sink || 0;
          q.setFromEuler(e.set((rnd() - 0.5) * (o.tilt || 0), rnd() * Math.PI * 2, (rnd() - 0.5) * (o.tilt || 0)));
          m4.compose(pp.set(o.x, y, o.z), q, sc.set(o.s * (o.sx || 1), o.s * (o.sy || 1), o.s * (o.sz || 1)));
          im.setMatrixAt(c, m4);
          if (o.solid) this.colliders.push({ x: o.x, y: y + o.solid * o.s * 0.9, z: o.z, r: o.solid * o.s });
          if (colors) im.setColorAt(c, col.set(colors[Math.floor(rnd() * colors.length)]).multiplyScalar(0.8 + rnd() * 0.4));
          c++;
        }
        im.count = c; im.frustumCulled = false; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
        grp.add(im); return im;
      };
      const inRange = (x, z, rmax = this.radius + 8) => x * x + z * z < rmax * rmax && Math.hypot(x - this.wreck.x, z - this.wreck.z) > 13;
      const rockSpot = (min = 0.5) => () => { const a = rnd() * 6.283, d = Math.pow(rnd(), 0.72) * (this.radius + 6), x = Math.cos(a) * d, z = Math.sin(a) * d; return W.rockiness(x, z) > min && W.height(x, z) > -42 && inRange(x, z) ? { x, z } : null; };
      const sandSpot = () => { const a = rnd() * 6.283, d = Math.sqrt(rnd()) * this.radius, x = Math.cos(a) * d, z = Math.sin(a) * d; return W.rockiness(x, z) < 0.3 && W.height(x, z) > -32 && inRange(x, z) ? { x, z } : null; };
      const bommieSpot = () => { const b = W.bommies[Math.floor(rnd() * W.bommies.length)], a = rnd() * 6.283, d = Math.sqrt(rnd()) * b.r * 1.15; const x = b.x + Math.cos(a) * d, z = b.z + Math.sin(a) * d; return inRange(x, z) ? { x, z } : null; };

      // scanned mossy rocks (Poly Haven CC0)
      this.rocks = [];
      for (const set of ['rock_moss_set_01', 'rock_moss_set_02']) {
        if (!A.has(set)) continue;
        const mp = A.maps(set, 0), mat = UW.material({ map: mp.map, normalMap: mp.normalMap, normalFlip: -1, detail: r1.map, detailScale: 0.45, tint: 0xd8e0c8 });
        A.parts(set).forEach((part, pi) => {
          const big = set.endsWith('01');
          this.rocks.push(scatter(A.geo(set, pi), mat, big ? 13 : 11, (i) => {
            const o = i % 3 === 0 ? rockSpot(0.55)() : bommieSpot(); if (!o) return null;
            o.s = big ? 1.1 + Math.pow(rnd(), 1.6) * 2.6 : 1.6 + Math.pow(rnd(), 1.5) * 3.6; o.sy = 0.85 + rnd() * 0.6; o.sink = 0.22 * o.s; o.tilt = 0.35; o.foot = 0.9 * o.s; o.solid = Math.max(part.bmax[0] - part.bmin[0], part.bmax[2] - part.bmin[2]) * 0.3; return o;
          }));
        });
      }
      // shipwreck resting on the slope beyond the reef edge
      if (A.has('dutch_ship_medium')) {
        const ship = (this.ship = new T.Group());
        A.parts('dutch_ship_medium').forEach((part, pi) => {
          const mp = A.maps('dutch_ship_medium', part.mat);
          const mesh = new T.Mesh(A.geo('dutch_ship_medium', pi), UW.material({ map: mp.map, normalMap: mp.normalMap, normalFlip: -1, side: T.DoubleSide, tint: 0x9fb09a, detail: r2.map, detailScale: 0.35 }));
          mesh.frustumCulled = false; ship.add(mesh);
        });
        const wx = this.wreck.x, wz = this.wreck.z; this.wreck.y = W.height(wx, wz);
        const keel = Math.min(...A.parts('dutch_ship_medium').filter((p) => p.bmax[1] - p.bmin[1] < 12).map((p) => p.bmin[1]));
        ship.position.set(wx, this.wreck.y - keel - 1.3, wz); ship.rotation.order = 'YXZ'; ship.rotation.set(0.42, -0.93, 0.07);
        grp.add(ship);
      }
      // scanned Megascans (Fab): boulders + rock formations on the reef, coral heads on the bommies, starfish & shells on the sand
      const fabMat = (name, extra) => { const mp = A.maps(name, A.parts(name)[0].mat); return UW.material(Object.assign({ map: mp.map, normalMap: mp.normalMap, normalFlip: -1 }, extra)); };
      const fabScatter = (name, count, pick) => { if (!A.has(name)) return; const mat = fabMat(name); A.parts(name).forEach((part, pi) => { const ext = Math.max(part.bmax[0] - part.bmin[0], part.bmax[2] - part.bmin[2]); scatter(A.geo(name, pi), mat, Math.ceil(count / A.parts(name).length), () => pick(ext, part)); }); };
      for (const [name, n, smin, smax] of [['fab_boulder', 14, 0.8, 2.0], ['fab_rock_formation', 8, 0.7, 1.4], ['fab_beach_rocks', 10, 0.8, 1.8]]) fabScatter(name, n, (ext) => {
        const o = rnd() < 0.5 ? rockSpot(0.5)() : bommieSpot(); if (!o) return null;
        o.s = smin + rnd() * (smax - smin); o.sink = 0.15 * o.s; o.tilt = 0.25; o.foot = ext * 0.35 * o.s; o.solid = ext * 0.32; return o;
      });
      for (const name of ['fab_corals_a', 'fab_corals_b', 'fab_coral_c', 'fab_coral_d', 'fab_coral_set', 'fab_coral_stone']) fabScatter(name, 170, (ext) => {
        const o = rnd() < 0.65 ? bommieSpot() : rockSpot(0.4)(); if (!o || W.height(o.x, o.z) < -30) return null;
        o.s = (0.45 + Math.pow(rnd(), 1.6) * 1.3) / Math.max(ext, 0.08);     // 0.45–1.75 m coral heads
        o.sink = 0.04 * o.s * ext; o.tilt = 0.5; return o;
      });
      // (starfish, conch shells and urchins are things you can pick up — dive.js places those)
      fabScatter('fab_shells', 50, () => { const o = sandSpot(); if (o) { o.s = 1.2 + rnd(); o.sink = 0.01; o.tilt = 0.2; } return o; });

      // corals + plants
      const cmat = (extra) => UW.material(Object.assign({ detail: r2.map, detailScale: 2.4 }, extra));
      const palette = [0xc9a37a, 0xd3b24a, 0xc77d6b, 0x9cc08a, 0xd9c7a8, 0xb48aa0, 0xe0905a];
      for (let v = 0; v < 3; v++) scatter(branchCoral(40 + v), cmat({}), 60, () => { const o = rnd() < 0.55 ? bommieSpot() : rockSpot(0.5)(); if (o) { o.s = 0.9 + rnd() * 1.9; o.sink = 0.02; o.tilt = 0.25; if (W.height(o.x, o.z) < -30) return null; } return o; }, palette);
      for (let v = 0; v < 2; v++) scatter(tableCoral(60 + v), cmat({ side: T.DoubleSide }), 25, () => { const o = rnd() < 0.5 ? bommieSpot() : rockSpot(0.55)(); if (o) { o.s = 0.9 + rnd() * 1.8; o.sink = 0.02; o.tilt = 0.3; if (W.height(o.x, o.z) < -28) return null; } return o; }, [0xb9a57c, 0x9d8f77, 0xa9b78c, 0xc9b28c]);
      for (let v = 0; v < 2; v++) scatter(lumpCoral(70 + v * 9), cmat({ detailScale: 1.3 }), A.has('fab_coral_stone') ? 0 : 80, () => { const o = rnd() < 0.4 ? bommieSpot() : rockSpot(0.45)(); if (o) { o.s = 0.35 + rnd() * 1.1; o.sink = 0.05 * o.s; o.tilt = 0.3; } return o; }, [0x9a8a55, 0x7d8a4c, 0xa37a5e, 0x8a6470, 0xb89a4e]);
      scatter(tubeSponge(81), cmat({ side: T.DoubleSide, detailScale: 5 }), 90, () => { const o = rnd() < 0.5 ? bommieSpot() : rockSpot(0.5)(); if (o) { o.s = 0.8 + rnd() * 1.3; o.sink = 0.0; o.tilt = 0.3; } return o; }, [0xa06ab0, 0xd9a03a, 0xd06a3a, 0xc8b060]);
      const fanTex = fanTexture();
      scatter(new T.PlaneGeometry(1, 1).translate(0, 0.5, 0), UW.material({ map: fanTex, alphaTest: 0.4, side: T.DoubleSide, sway: [0.05, 1] }), 130, () => { const o = rnd() < 0.5 ? bommieSpot() : rockSpot(0.5)(); if (o) { o.s = 0.6 + rnd() * 1.1; o.sink = 0.03; } return o; }, [0xc23a3a, 0x8a3ac0, 0xd9a13a, 0xc05a8a]);
      for (let v = 0; v < 2; v++) scatter(grassTuft(90 + v), UW.material({ side: T.DoubleSide, sway: [0.16, 0.8], color: 0xffffff }), 700, () => { const o = rnd() < 0.7 ? sandSpot() : rockSpot(0.3)(); if (o) { o.s = 0.7 + rnd() * 1.0; o.sink = 0.02; if (M.noise2(o.x * 0.09, o.z * 0.09) < 0.42) return null; } return o; }, [0x6f9a4a, 0x8aa84a, 0x5f8a5a, 0x9aa85a]);

      // marine snow: specks wrapped around the camera
      const NS = 1400, sp = new Float32Array(NS * 3), sd = new Float32Array(NS);
      for (let i = 0; i < NS; i++) { sp[i * 3] = rnd() * 26; sp[i * 3 + 1] = rnd() * 26; sp[i * 3 + 2] = rnd() * 26; sd[i] = rnd(); }
      const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.BufferAttribute(sp, 3)); sg.setAttribute('aSeed', new T.BufferAttribute(sd, 1));
      this.snow = new T.Points(sg, new T.ShaderMaterial({
        vertexShader: `attribute float aSeed; uniform float uWTime, uScale; varying float vA; varying vec3 vW;
          void main(){ vec3 p = position + vec3(sin(uWTime * 0.3 + aSeed * 40.0) * 0.4, -uWTime * (0.02 + aSeed * 0.03), cos(uWTime * 0.27 + aSeed * 31.0) * 0.4);
            p = mod(p - cameraPosition, 26.0) - 13.0 + cameraPosition; vW = p; vec4 mv = viewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv; float d = -mv.z; gl_PointSize = clamp((0.012 + aSeed * 0.02) * uScale / max(d, 0.1), 1.0, 9.0);
            vA = smoothstep(0.25, 1.2, d) * (1.0 - smoothstep(8.0, 13.0, d)) * step(p.y, -0.2); }`,
        fragmentShader: `varying float vA; varying vec3 vW;\n${DB.GLSL.common}\n${DB.GLSL.water}\n void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float a = smoothstep(1.0, 0.1, length(q)) * vA; if (a < 0.01) discard;
            float depth = max(-vW.y, 0.0); vec3 c = (sunAtDepth(depth) * 0.3 + ambAtDepth(depth) * 0.4) * 0.6; gl_FragColor = vec4(c, a * 0.55); }`,
        uniforms: Object.assign({ uScale: { value: 500 } }, DB.Ocean.water), transparent: true, depthWrite: false, toneMapped: false,
      }));
      this.snow.frustumCulled = false; this.snow.renderOrder = 18; grp.add(this.snow);

      // anchor line from the bow to the seabed
      const rope = G.tube([V3(0, 0, 0), V3(0.22, -0.4, 0.22), V3(0.58, -0.8, 0.58), V3(1, -1, 1)], 0.004, 6);      // unit curve, stretched to fit each frame
      this.rope = new T.Mesh(rope, UW.material({ color: 0xb9ad8c, side: T.DoubleSide })); this.rope.frustumCulled = false; grp.add(this.rope);
      this.buildHullTwin();
    },

    // the boat seen from below uses submerged shading: twin meshes that follow the hull
    buildHullTwin() {
      const B = DB.Boat, mats = B.mats, twin = (this.hull = new T.Group());
      const pick = new Map([[mats.hull, 0xe9e9e4], [mats.bottom, 0x0d2440], [mats.stripe, 0x0b1c33], [mats.steel, 0x9aa3ab], [mats.deck, 0x9c7a52], [mats.gold, 0xa8843a]]);
      B.group.children.forEach((c) => { if (c.isMesh && pick.has(c.material)) { const mm = new T.Mesh(c.geometry, UW.material({ color: pick.get(c.material), side: T.DoubleSide })); mm.frustumCulled = false; twin.add(mm); } });
      twin.visible = false; B.group.add(twin);
    },

    setVisible(on) {
      this.group.visible = on; this.hull.visible = on;
      const B = DB.Boat;
      B.group.children.forEach((c) => { if (c !== this.hull) c.visible = !on; });
      if (B.buoy) B.buoy.visible = !on;
    },

    update(dt, camera) {
      this.t += dt;
      this.snow.material.uniforms.uScale.value = DB.Post.h / (2 * Math.tan((camera.fov * Math.PI) / 360));
      // anchor rode: bow chock → seabed
      const B = DB.Boat, bow = this._bow || (this._bow = V3()); bow.set(0, 0.6, -5.3).applyMatrix4(B.group.matrixWorld);
      const ax = B.anchor.x + 3, az = B.anchor.z - 16, ay = DB.World.height(ax, az);
      this.rope.position.copy(bow); this.rope.scale.set(ax - bow.x, bow.y - ay, az - bow.z);
    },
  });
})();
