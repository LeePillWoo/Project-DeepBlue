// Project Deep Blue — environment: physically based sky, volumetric clouds, sun, IBL cube.
(function () {
  'use strict';
  const DB = window.DB, T = THREE, M = DB.M;

  // shared atmosphere constants (GLSL + JS port use the same numbers)
  const A = { RE: 6360e3, RA: 6420e3, HR: 7994, HM: 1200, BR: [5.8e-6, 13.5e-6, 33.1e-6], OZ: [2.0e-6, 4.0e-6, 0.4e-6], BM: 21e-6 * 1.6, G: 0.76, SUN_E: 22, GAIN: 2.4 };

  const SKY_GLSL = /* glsl */ `
const float RE = ${A.RE.toFixed(1)}, RA = ${A.RA.toFixed(1)}, HR = ${A.HR.toFixed(1)}, HM = ${A.HM.toFixed(1)};
const vec3 BETA_R = vec3(${A.BR.join(',')});
const float BETA_M = ${A.BM};
const vec3 OZONE = vec3(${A.OZ.join(',')});      // crude ozone absorption (tied to the air column): keeps low-sun skies from going green
vec2 raySphere(vec3 ro, vec3 rd, float r){ float b = dot(ro, rd); float c = dot(ro, ro) - r*r; float d = b*b - c; if (d < 0.0) return vec2(1e9, -1e9); d = sqrt(d); return vec2(-b - d, -b + d); }
// single scattering (Nishita), quadratic step distribution; returns radiance
vec3 atmosphere(vec3 rd, vec3 sd){
  vec3 ro = vec3(0.0, RE + 30.0, 0.0);
  float tmax = raySphere(ro, rd, RA).y;
  vec2 tg = raySphere(ro, rd, RE); if (tg.x > 0.0) tmax = min(tmax, tg.x);
  float mu = dot(rd, sd);
  float phR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  const float g = ${A.G};
  float phM = 3.0 / (8.0 * PI) * ((1.0 - g*g) * (1.0 + mu*mu)) / ((2.0 + g*g) * pow(1.0 + g*g - 2.0*g*mu, 1.5));
  vec3 sumR = vec3(0.0), sumM = vec3(0.0); float odR = 0.0, odM = 0.0, tPrev = 0.0;
  for (int i = 0; i < 12; i++) {
    float f = float(i + 1) / 12.0; float tNext = tmax * f * f;
    float dt = tNext - tPrev; float t = tPrev + dt * 0.5; tPrev = tNext;
    vec3 p = ro + rd * t; float h = max(length(p) - RE, 0.0);
    float hr = exp(-h / HR) * dt, hm = exp(-h / HM) * dt;
    odR += hr; odM += hm;
    float tl = raySphere(p, sd, RA).y; float dl = tl / 5.0; float odLR = 0.0, odLM = 0.0;
    for (int j = 0; j < 5; j++) { vec3 pl = p + sd * (float(j) + 0.5) * dl; float hl = length(pl) - RE; odLR += exp(-hl / HR) * dl; odLM += exp(-hl / HM) * dl; }
    vec3 att = exp(-((BETA_R + OZONE) * (odR + odLR) + BETA_M * 1.1 * (odM + odLM)));
    sumR += att * hr; sumM += att * hm;
  }
  return ${A.SUN_E.toFixed(1)} * ${A.GAIN.toFixed(2)} * (sumR * BETA_R * phR + sumM * BETA_M * phM);
}
`;

  const SKY_FRAG = /* glsl */ `
uniform int uMode, uFace;
uniform vec3 uCamRight, uCamUp, uCamFwd; uniform float uTanHalfFov, uAspect;
uniform vec3 uSunDir, uSunCol, uAmbCol, uSeaCol;
uniform float uTime, uCoverage, uSteps, uJitter, uCirrus;
uniform sampler2D uNoise;
varying vec2 vUv;
${DB.GLSL.common}
${DB.GLSL.noise3}
${SKY_GLSL}
const float CB = 1250.0, CT = 2550.0;
float hg(float mu, float g){ float g2 = g*g; return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0*g*mu, 1.5)); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return textureLod(uNoise, (i + f + 0.5) / 256.0, 0.0).b; }

float cloudMap(vec3 p, bool cheap){
  float h = (p.y - CB) / (CT - CB);
  if (h < 0.0 || h > 1.0) return 0.0;
  vec3 q = p / 1450.0; q.xz += uTime * vec2(0.0042, 0.0019);
  float cov = uCoverage + (tnoise(vec3(p.xz / 7500.0 + vec2(uTime * 0.0005, 3.0), 7.3)) - 0.5) * 0.6;
  float n = tnoise(q) * 0.5; q = q * 2.03 + 11.7;
  n += tnoise(q) * 0.25; q = q * 2.02 + 5.3;
  if (!cheap) { n += tnoise(q) * 0.125; q = q * 2.6 + 1.7; n += tnoise(q) * 0.07; n *= 1.058; } else n *= 1.333;
  float d = n + cov - 1.0 - smoothstep(0.2, 1.0, h) * 0.42;
  d *= smoothstep(0.0, 0.1, h);
  return clamp(d * 3.2, 0.0, 1.0);
}

// returns (inscattered light, transmittance)
vec4 clouds(vec3 rd, vec3 bg, float jit){
  if (rd.y < 0.018) return vec4(0.0, 0.0, 0.0, 1.0);
  float t0 = CB / rd.y, t1 = min(CT / rd.y, 52000.0);
  if (t0 > 50000.0) return vec4(0.0, 0.0, 0.0, 1.0);
  int N = int(uSteps);
  float dt = (t1 - t0) / float(N), t = t0 + dt * jit;
  float mu = dot(rd, uSunDir);
  float ph = 0.52 + 0.85 * hg(mu, 0.74) + 0.25 * hg(mu, 0.2);
  float Tr = 1.0; vec3 L = vec3(0.0);
  for (int i = 0; i < 64; i++) {
    if (i >= N || Tr < 0.02) break;
    vec3 p = rd * t;
    float d = cloudMap(p, false);
    if (d > 0.002) {
      float ld = 0.0;
      for (int j = 0; j < 4; j++) ld += cloudMap(p + uSunDir * (60.0 + float(j) * 130.0), true);
      float tau = ld * 130.0 * 0.011;
      float beer = exp(-tau) * 0.82 + exp(-tau * 0.22) * 0.18;       // dual-term: fake multiple scattering
      float h = sat((p.y - CB) / (CT - CB));
      vec3 lum = uSunCol * 0.27 * beer * ph * (1.0 - exp(-d * 6.0 - 0.3)) + uAmbCol * (0.55 + 0.75 * h);
      float fogA = 1.0 - exp(-t * 3.3e-5);
      lum = mix(lum, bg, fogA);                                      // aerial perspective
      float a = 1.0 - exp(-d * 0.014 * dt);
      L += Tr * lum * a; Tr *= 1.0 - a;
    }
    t += dt;
  }
  return vec4(L, Tr);
}

vec4 cirrus(vec3 rd){
  if (rd.y < 0.04) return vec4(0.0);
  vec2 p = rd.xz * (9000.0 / rd.y) / 5200.0 + uTime * vec2(0.0011, 0.0004);
  vec2 w = p + 1.7 * vec2(n2(p * 0.4 + 3.1), n2(p * 0.4 + 9.7));
  float n = 0.0, a = 0.5; vec2 s = w * vec2(0.55, 2.3);
  for (int i = 0; i < 4; i++) { n += a * n2(s); s = s * 2.07 + 7.1; a *= 0.5; }
  float d = smoothstep(0.50, 0.86, n + (n2(p * 0.18) - 0.5) * 0.5) * uCirrus;
  d *= smoothstep(0.04, 0.22, rd.y);
  float mu = dot(rd, uSunDir);
  vec3 c = uSunCol * (0.085 + 0.25 * hg(mu, 0.6)) + uAmbCol * 0.35;
  return vec4(c * d, d);
}

vec3 skyDir(){
  vec2 p = vUv * 2.0 - 1.0;
  if (uMode == 0) return normalize(uCamFwd + uCamRight * (p.x * uTanHalfFov * uAspect) + uCamUp * (p.y * uTanHalfFov));
  if (uFace == 0) return normalize(vec3(1.0, -p.y, -p.x));
  if (uFace == 1) return normalize(vec3(-1.0, -p.y, p.x));
  if (uFace == 2) return normalize(vec3(p.x, 1.0, p.y));
  if (uFace == 3) return normalize(vec3(p.x, -1.0, -p.y));
  if (uFace == 4) return normalize(vec3(p.x, -p.y, 1.0));
  return normalize(vec3(-p.x, -p.y, -1.0));
}

void main(){
  vec3 rd = skyDir();
  vec3 col; float Tr = 1.0;
  if (rd.y < -0.004) {
    // below the horizon: ocean stand-in (for IBL + what shows through the water surface)
    col = uSeaCol;
    if (uMode == 1) {
      vec3 r = normalize(vec3(rd.x, -rd.y + 0.12, rd.z));
      float F = 0.02 + 0.5 * pow(1.0 + rd.y, 5.0);
      col = mix(uSeaCol, atmosphere(r, uSunDir), F);
    }
  } else {
    vec3 ad = normalize(vec3(rd.x, max(rd.y, 0.0), rd.z));
    vec3 hd = normalize(vec3(rd.x, max(rd.y, 0.045), rd.z));     // single scattering goes murky at the horizon: clamp
    col = atmosphere(hd, uSunDir);
    float mu = dot(ad, uSunDir);
    col += uSunCol * 0.012 * pow(max(mu, 0.0), 900.0);            // tight aureole
    vec4 ci = cirrus(ad);
    col = col * (1.0 - ci.a) + ci.rgb;
    Tr *= 1.0 - ci.a * 0.8;
    float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uJitter);
    vec4 cl = clouds(ad, col, uMode == 0 ? jit : 0.5);
    col = col * cl.a + cl.rgb;
    Tr *= cl.a;
  }
  gl_FragColor = vec4(col, Tr);
}
`;

  const BLUR_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main(){
  vec2 o = uTexel * 0.75;
  gl_FragColor = 0.25 * (texture2D(tSrc, vUv + vec2(-o.x, -o.y)) + texture2D(tSrc, vUv + vec2(o.x, -o.y)) + texture2D(tSrc, vUv + vec2(-o.x, o.y)) + texture2D(tSrc, vUv + vec2(o.x, o.y)));
}`;

  const DOME_FRAG = /* glsl */ `
uniform sampler2D tSky; uniform vec2 uRes;
uniform vec3 uCamRight, uCamUp, uCamFwd; uniform float uTanHalfFov, uAspect;
uniform vec3 uSunDir, uSunCol;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 s = texture2D(tSky, uv);
  vec2 p = uv * 2.0 - 1.0;
  vec3 rd = normalize(uCamFwd + uCamRight * (p.x * uTanHalfFov * uAspect) + uCamUp * (p.y * uTanHalfFov));
  float mu = dot(rd, uSunDir);
  float disk = smoothstep(0.99988, 0.99996, mu) * step(0.0, rd.y);
  vec3 col = s.rgb + uSunCol * disk * 55.0 * s.a * s.a;
  gl_FragColor = vec4(col, 1.0);
}
`;

  // ---- JS port of the atmosphere (used for light colors, not per-pixel) ----
  function raySphere(oy, rd, r) {
    const b = oy * rd[1], c = oy * oy - r * r, d = b * b - c;
    if (d < 0) return [1e9, -1e9];
    const s = Math.sqrt(d);
    return [-b - s, -b + s];
  }
  function opticalDepthToSun(py, px, pz, sd, n) { // from point (px,py,pz) (planet-centered) toward the sun
    const b = px * sd[0] + py * sd[1] + pz * sd[2], c = px * px + py * py + pz * pz - A.RA * A.RA;
    const tl = -b + Math.sqrt(Math.max(b * b - c, 0)), dl = tl / n;
    let r = 0, m = 0;
    for (let j = 0; j < n; j++) {
      const s = (j + 0.5) * dl, x = px + sd[0] * s, y = py + sd[1] * s, z = pz + sd[2] * s;
      const h = Math.sqrt(x * x + y * y + z * z) - A.RE;
      r += Math.exp(-h / A.HR) * dl; m += Math.exp(-h / A.HM) * dl;
    }
    return [r, m];
  }
  function sunTransmittance(sd) {
    const [r, m] = opticalDepthToSun(A.RE + 30, 0, 0, sd, 24);
    return A.BR.map((b, k) => Math.exp(-((b + A.OZ[k]) * r + A.BM * 1.1 * m)));
  }
  function atmosphereJS(rd, sd) {
    const oy = A.RE + 30;
    let tmax = raySphere(oy, rd, A.RA)[1];
    const tg = raySphere(oy, rd, A.RE); if (tg[0] > 0) tmax = Math.min(tmax, tg[0]);
    const mu = rd[0] * sd[0] + rd[1] * sd[1] + rd[2] * sd[2], g = A.G;
    const phR = 3 / (16 * Math.PI) * (1 + mu * mu);
    const phM = 3 / (8 * Math.PI) * ((1 - g * g) * (1 + mu * mu)) / ((2 + g * g) * Math.pow(1 + g * g - 2 * g * mu, 1.5));
    const sumR = [0, 0, 0], sumM = [0, 0, 0];
    let odR = 0, odM = 0, tPrev = 0;
    for (let i = 0; i < 16; i++) {
      const f = (i + 1) / 16, tNext = tmax * f * f, dt = tNext - tPrev, t = tPrev + dt * 0.5; tPrev = tNext;
      const px = rd[0] * t, py = oy + rd[1] * t, pz = rd[2] * t;
      const h = Math.max(Math.sqrt(px * px + py * py + pz * pz) - A.RE, 0);
      const hr = Math.exp(-h / A.HR) * dt, hm = Math.exp(-h / A.HM) * dt;
      odR += hr; odM += hm;
      const [lr, lm] = opticalDepthToSun(py, px, pz, sd, 6);
      for (let k = 0; k < 3; k++) {
        const att = Math.exp(-((A.BR[k] + A.OZ[k]) * (odR + lr) + A.BM * 1.1 * (odM + lm)));
        sumR[k] += att * hr; sumM[k] += att * hm;
      }
    }
    return [0, 1, 2].map((k) => A.SUN_E * A.GAIN * (sumR[k] * A.BR[k] * phR + sumM[k] * A.BM * phM));
  }

  const TOD = {
    day: { el: 40, az: 148, coverage: 0.40, cirrus: 0.55, exposure: 0.50, label: '한낮' },
    golden: { el: 7.5, az: 168, coverage: 0.43, cirrus: 0.75, exposure: 0.70, label: '석양' },
    morning: { el: 20, az: 120, coverage: 0.36, cirrus: 0.4, exposure: 0.56, label: '아침' },
  };

  const Env = (DB.Env = {
    sunDir: new T.Vector3(0, 1, 0), sunColor: new T.Color(), ambColor: new T.Color(), horizonColor: new T.Color(), seaColor: new T.Color(0.01, 0.035, 0.07),
    exposure: 0.5, tod: 'day', TOD, time: 0, frame: 0, cubeAge: 1e9, cubeFace: -1,

    init(renderer) {
      this.renderer = renderer;
      this.noiseTex = DB.makeNoiseTex();
      const camU = { uCamRight: { value: new T.Vector3() }, uCamUp: { value: new T.Vector3() }, uCamFwd: { value: new T.Vector3() }, uTanHalfFov: { value: 1 }, uAspect: { value: 1 } };
      this.camU = camU;
      this.skyMat = DB.fsMat(SKY_FRAG, Object.assign({
        uMode: { value: 0 }, uFace: { value: 0 }, uSunDir: { value: this.sunDir }, uSunCol: { value: this.sunColor }, uAmbCol: { value: this.ambColor },
        uSeaCol: { value: this.seaColor }, uTime: { value: 0 }, uCoverage: { value: 0.4 }, uSteps: { value: DB.Q.cloudSteps }, uJitter: { value: 0 },
        uCirrus: { value: 0.5 }, uNoise: { value: this.noiseTex },
      }, camU));
      const so = { type: T.HalfFloatType, depthBuffer: false, minFilter: T.LinearFilter, magFilter: T.LinearFilter };
      this.rtSkyRaw = new T.WebGLRenderTarget(4, 4, so);
      this.rtSky = new T.WebGLRenderTarget(4, 4, so);
      this.blurMat = DB.fsMat(BLUR_FRAG, { tSrc: { value: this.rtSkyRaw.texture }, uTexel: { value: new T.Vector2() } });
      this.cubeRT = new T.WebGLCubeRenderTarget(128, { type: T.HalfFloatType, generateMipmaps: true, minFilter: T.LinearMipmapLinearFilter, magFilter: T.LinearFilter });
      this.pmremGen = new T.PMREMGenerator(renderer);
      this.pmrem = null;
      // background dome (fullscreen triangle at the far plane)
      const domeMat = new T.ShaderMaterial({
        vertexShader: 'void main(){ gl_Position = vec4(position.xy, 1.0, 1.0); }', fragmentShader: DOME_FRAG,
        uniforms: Object.assign({ tSky: { value: this.rtSky.texture }, uRes: { value: new T.Vector2(1, 1) }, uSunDir: { value: this.sunDir }, uSunCol: { value: this.sunColor } }, camU),
        depthTest: false, depthWrite: false, toneMapped: false,
      });
      this.dome = new T.Mesh(new T.PlaneGeometry(2, 2), domeMat);
      this.dome.frustumCulled = false; this.dome.renderOrder = -1000;
      this.setTimeOfDay(DB.params.get('tod') || 'day');
    },

    setTimeOfDay(name) {
      const p = TOD[name] || TOD.day;
      this.tod = TOD[name] ? name : 'day';
      this.skyMat.uniforms.uCoverage.value = p.coverage;
      this.skyMat.uniforms.uCirrus.value = p.cirrus;
      this.exposure = p.exposure;
      this.setSun(p.el, p.az);
    },

    setSun(elDeg, azDeg) {
      const el = (elDeg * Math.PI) / 180, az = (azDeg * Math.PI) / 180;
      this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
      this.sunEl = elDeg;
      const sd = [this.sunDir.x, this.sunDir.y, this.sunDir.z];
      const tr = sunTransmittance(sd);
      const E = A.SUN_E * 0.86;
      this.sunColor.setRGB(E * tr[0], E * tr[1], E * tr[2]);
      // ambient: cosine-ish weighted average of sky radiance over the dome
      const acc = [0, 0, 0]; let wsum = 0;
      const els = [85, 55, 30, 12], ws = [0.6, 1.0, 0.8, 0.35];
      for (let e = 0; e < els.length; e++) for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + e, ce = Math.cos((els[e] * Math.PI) / 180), se = Math.sin((els[e] * Math.PI) / 180);
        const c = atmosphereJS([Math.cos(a) * ce, se, Math.sin(a) * ce], sd);
        acc[0] += c[0] * ws[e]; acc[1] += c[1] * ws[e]; acc[2] += c[2] * ws[e]; wsum += ws[e];
      }
      this.ambColor.setRGB(acc[0] / wsum, acc[1] / wsum, acc[2] / wsum);
      const hz = [0, 0, 0];
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; const c = atmosphereJS([Math.cos(a) * 0.9994, 0.035, Math.sin(a) * 0.9994], sd); hz[0] += c[0] / 8; hz[1] += c[1] / 8; hz[2] += c[2] / 8; }
      this.horizonColor.setRGB(hz[0], hz[1], hz[2]);
      this.cubeAge = 1e9; // force IBL refresh
      this.dirty = true;
    },

    resize(w, h) {
      const s = DB.Q.skyScale;
      const sw = Math.max(8, Math.round(w * s)), sh = Math.max(8, Math.round(h * s));
      this.rtSkyRaw.setSize(sw, sh); this.rtSky.setSize(sw, sh);
      this.blurMat.uniforms.uTexel.value.set(1 / sw, 1 / sh);
      this.dome.material.uniforms.uRes.value.set(w, h);
    },

    // refresh the IBL cube (all faces) + PMREM
    refreshCube(full) {
      const r = this.renderer, u = this.skyMat.uniforms;
      u.uMode.value = 1; u.uSteps.value = 14;
      for (let f = 0; f < 6; f++) { u.uFace.value = f; DB.renderFS(r, this.skyMat, this.cubeRT, f); }
      u.uMode.value = 0; u.uSteps.value = DB.Q.cloudSteps;
      r.setRenderTarget(null);
      if (full || !this.pmrem) {
        const old = this.pmrem;
        this.pmrem = this.pmremGen.fromCubemap(this.cubeRT.texture);
        if (old) old.dispose();
        this.envMap = this.pmrem.texture;
        if (this.onEnvMap) this.onEnvMap(this.envMap);
      }
      this.cubeAge = 0;
    },

    update(dt, camera) {
      this.time += dt; this.frame++;
      const u = this.skyMat.uniforms, c = this.camU;
      const e = camera.matrixWorld.elements;
      c.uCamRight.value.set(e[0], e[1], e[2]).normalize();
      c.uCamUp.value.set(e[4], e[5], e[6]).normalize();
      c.uCamFwd.value.set(-e[8], -e[9], -e[10]).normalize();
      c.uTanHalfFov.value = Math.tan((camera.fov * Math.PI) / 360);
      c.uAspect.value = camera.aspect;
      u.uTime.value = this.time;
      u.uJitter.value = (this.frame * 0.61803398875) % 1;
      this.cubeAge += dt;
      if (this.cubeAge > 25) { this.refreshCube(this.dirty || !this.pmrem); this.dirty = false; }
    },

    // render the half-res sky buffer for the current camera (call once per frame when above water)
    renderSky() {
      DB.renderFS(this.renderer, this.skyMat, this.rtSkyRaw);
      DB.renderFS(this.renderer, this.blurMat, this.rtSky);      // tent blur hides the march jitter
    },
  });
})();
