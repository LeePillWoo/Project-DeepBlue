// Project Deep Blue — ocean: Gerstner wave field (GLSL + JS mirror), surface shading from above and below,
// shared underwater optics (absorption / inscatter / caustics).
(function () {
  'use strict';
  const DB = window.DB, T = THREE, M = DB.M;
  const NW = 10, GRAV = 9.81, MAIN_DIR = -37;
  // [direction offset°, wavelength m, amplitude m, orbit ratio q]
  const WAVE_DEF = [
    [0, 74, 0.62, 0.9], [22, 47, 0.42, 0.9], [-17, 29, 0.30, 0.95], [38, 18.5, 0.22, 1.0], [-31, 11.8, 0.155, 1.0],
    [12, 7.6, 0.11, 1.0], [-48, 4.9, 0.075, 1.0], [55, 3.1, 0.05, 1.0], [-8, 2.0, 0.033, 1.0], [-64, 1.3, 0.021, 1.0],
  ];

  // ------------------------------------------------------------------ shared GLSL
  const WAVES_GLSL = /* glsl */ `
#define NW ${NW}
uniform vec4 uWaveA[NW];   // dir.x, dir.z, k, omega
uniform vec4 uWaveB[NW];   // amplitude, q, phase, wavelength
uniform float uTime;
float groupMod(vec2 x, float t){ return 1.0 + 0.2 * sin(0.031 * x.x + 0.017 * x.y - 0.11 * t) + 0.16 * sin(-0.013 * x.x + 0.027 * x.y + 0.07 * t + 1.7); }
`;

  // underwater optics shared by every submerged material
  DB.GLSL.water = /* glsl */ `
uniform vec3 uWC;        // beam attenuation 1/m
uniform vec3 uWK;        // diffuse attenuation 1/m
uniform vec3 uWS;        // inscatter source
uniform vec3 uSunDirW;   // direction to the (refracted) sun
uniform vec3 uSunColW;   // sun irradiance just under the surface
uniform vec3 uAmbColW;   // sky irradiance just under the surface
uniform float uWTime;
vec3 waterColumn(vec3 rd, float camDepth){
  float mu = dot(rd, uSunDirW);
  float ph = 0.72 + 1.1 * pow(max(mu, 0.0), 5.0);
  return uWS * ph * exp(-uWK * max(camDepth, 0.0)) / (uWC - uWK * rd.y);
}
vec3 waterFog(vec3 col, vec3 rd, float dist, float camDepth){
  vec3 k = uWC - uWK * rd.y;
  return col * exp(-uWC * dist) + waterColumn(rd, camDepth) * (1.0 - exp(-k * dist));
}
float causticTile(vec2 uv, float t){
  const float TAU = 6.28318530718;
  vec2 p = mod(uv * TAU, TAU) - 250.0; vec2 i = p; float c = 1.0; const float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0; c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
float caustics(vec3 wp){
  float depth = max(-wp.y, 0.0);
  vec2 p = wp.xz + uSunDirW.xz * (depth / max(uSunDirW.y, 0.25));
  float c = causticTile(p * 0.23, uWTime * 0.55) + causticTile(p * 0.41 + 3.7, uWTime * 0.72) * 0.55;
  return mix(1.0, 0.22 + c * 3.4, exp(-depth * 0.035));
}
vec3 sunAtDepth(float depth){ return uSunColW * exp(-uWK * depth / max(uSunDirW.y, 0.3)); }
vec3 ambAtDepth(float depth){ return uAmbColW * exp(-uWK * depth); }
`;

  const SURF_COMMON = /* glsl */ `
${DB.GLSL.common}
${WAVES_GLSL}
uniform sampler2D uDetail, uFoamTex;
uniform samplerCube uEnv;
uniform vec3 uSunDir, uSunCol, uAmbCol, uBodyCol, uSssCol;
uniform vec4 uBoat;       // x, z, heading, speed
uniform vec4 uRipple[6];  // x, z, startTime, strength
uniform float uSea, uFoamJ;
varying vec2 vX0; varying vec3 vWorld;

struct Surf { vec2 slope; float J; float h; float varU; };   // J is unfiltered so distant whitecaps survive
Surf surfAt(vec2 x0, float t, float foot){
  Surf s; s.slope = vec2(0.0); s.h = 0.0; s.varU = 0.0;
  float gm = groupMod(x0, t) * uSea;
  float sumQ = 0.0, Jxx = 1.0, Jzz = 1.0, Jxz = 0.0;
  for (int i = 0; i < NW; i++) {
    vec4 a = uWaveA[i], b = uWaveB[i];
    float A = b.x * gm, ka = a.z * A;
    float th = a.z * dot(a.xy, x0) - a.w * t + b.z;
    float c = cos(th), sn = sin(th);
    float fade = 1.0 - smoothstep(0.3, 0.85, foot / b.w);
    s.slope += a.xy * (ka * c * fade);
    float qr = b.y * ka * sn, qs = qr * fade;
    sumQ += qs; Jxx -= qr * a.x * a.x; Jzz -= qr * a.y * a.y; Jxz -= qr * a.x * a.y;
    s.varU += (1.0 - fade * fade) * ka * ka * 0.5;
    s.h += A * sn * fade;
  }
  s.slope /= max(1.0 - sumQ, 0.35);
  s.J = Jxx * Jzz - Jxz * Jxz;
  return s;
}
float jacobianAt(vec2 x0, float t){
  float gm = groupMod(x0, t) * uSea;
  float Jxx = 1.0, Jzz = 1.0, Jxz = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 a = uWaveA[i], b = uWaveB[i];
    float qs = b.y * a.z * b.x * gm * sin(a.z * dot(a.xy, x0) - a.w * t + b.z);
    Jxx -= qs * a.x * a.x; Jzz -= qs * a.y * a.y; Jxz -= qs * a.x * a.y;
  }
  return Jxx * Jzz - Jxz * Jxz;
}
vec2 detailSlope(vec2 x0, float t, float foot, out float varU){
  vec2 x2 = vec2(0.454 * x0.x - 0.891 * x0.y, 0.891 * x0.x + 0.454 * x0.y);
  vec2 x3 = vec2(-0.669 * x0.x - 0.743 * x0.y, 0.743 * x0.x - 0.669 * x0.y);
  vec2 s1 = texture2D(uDetail, x0 / 13.0 + t * vec2(0.011, 0.006)).xy - 0.5;
  vec2 s2 = texture2D(uDetail, x2 / 4.3 + t * vec2(-0.019, 0.015)).xy - 0.5;
  vec2 s3 = texture2D(uDetail, x3 / 1.27 + t * vec2(0.033, -0.026)).xy - 0.5;
  s2 = vec2(0.454 * s2.x + 0.891 * s2.y, -0.891 * s2.x + 0.454 * s2.y);
  s3 = vec2(-0.669 * s3.x + 0.743 * s3.y, -0.743 * s3.x - 0.669 * s3.y);
  const float K1 = 0.42, K2 = 0.46, K3 = 0.44;        // slope strength per layer (stored rms 0.16)
  float l1 = log2(max(foot, 1e-4) / (13.0 / 512.0)), l2 = log2(max(foot, 1e-4) / (4.3 / 512.0)), l3 = log2(max(foot, 1e-4) / (1.27 / 512.0));
  varU = 0.0512 * (K1 * K1 * smoothstep(1.5, 7.5, l1) + K2 * K2 * smoothstep(1.5, 7.5, l2) + K3 * K3 * smoothstep(1.5, 7.5, l3));
  return s1 * K1 + s2 * K2 + s3 * K3;
}
vec2 boatLocal(vec2 xz){ vec2 d = xz - uBoat.xy; float c = cos(uBoat.z), s = sin(uBoat.z); return vec2(c * d.x - s * d.y, s * d.x + c * d.y); }
float hullSDF(vec2 b){   // boat-local (x starboard, y = z toward stern); < 0 inside the waterline footprint
  float w = 1.36 * (1.0 - pow(sat((-b.y - 0.8) / 3.8), 1.7));
  return max(abs(b.x) - w, max(b.y - 3.95, -4.5 - b.y));
}
vec2 rippleSlope(vec2 xz, out float foam){
  vec2 sl = vec2(0.0); foam = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 r = uRipple[i]; float age = uTime - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 7.0) continue;
    vec2 dv = xz - r.xy; float d = length(dv) + 1e-3;
    float front = 0.5 + age * 1.9;
    float env = r.w * exp(-age * 0.55) * smoothstep(front + 0.6, front - 0.4, d) * smoothstep(-0.5, front * 0.5, d);
    sl += (dv / d) * cos((d - front) * 4.2) * env * 0.32;
    foam = max(foam, r.w * (1.0 - smoothstep(0.0, 0.7 + age * 1.3, d)) * sat(1.0 - age / 3.5));
  }
  return sl;
}
`;

  const VERT = /* glsl */ `
${WAVES_GLSL}
uniform float uSea;
varying vec2 vX0; varying vec3 vWorld;
void main(){
  vec2 x0 = (modelMatrix * vec4(position, 1.0)).xz;
  float dist = length(position.xz);
  float spacing = max(dist * 0.024 + dist * dist / 8000.0, 0.02);
  float gm = groupMod(x0, uTime) * uSea;
  vec3 d = vec3(0.0);
  for (int i = 0; i < NW; i++) {
    vec4 a = uWaveA[i], b = uWaveB[i];
    float att = smoothstep(3.0, 6.0, b.w / spacing);
    float th = a.z * dot(a.xy, x0) - a.w * uTime + b.z;
    float A = b.x * gm * att;
    d.xz += a.xy * (b.y * A * cos(th));
    d.y += A * sin(th);
  }
  vec3 wp = vec3(x0.x + d.x, d.y, x0.y + d.z);
  vX0 = x0; vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

  const FRAG_TOP = /* glsl */ `
${SURF_COMMON}
uniform float uHaze;
void main(){
  vec3 toCam = cameraPosition - vWorld; float dist = length(toCam); vec3 V = toCam / dist;
  float foot = max(length(dFdx(vX0)), length(dFdy(vX0)));
  vec2 bl = boatLocal(vWorld.xz); float hs = hullSDF(bl);
  if (hs < -0.1) discard;

  Surf s = surfAt(vX0, uTime, foot);
  float varD; vec2 ds = detailSlope(vX0, uTime, foot, varD);
  float rFoam; vec2 rs = rippleSlope(vWorld.xz, rFoam);
  vec2 sl = s.slope + ds + rs;
  vec3 N = normalize(vec3(-sl.x, 1.0, -sl.y));

  float sigma2 = s.varU + varD + 0.0010;
  float sig = sqrt(sigma2);
  float alpha = clamp(sqrt(2.0 * sigma2), 0.05, 0.6);
  float NV = max(dot(N, V), 0.001);
  float F = 0.02 + 0.98 * pow(1.0 - NV, 5.0 * exp(-2.69 * sig)) / (1.0 + 22.7 * pow(sig, 1.5));

  vec3 R = reflect(-V, N); R.y = abs(R.y); R = normalize(R + vec3(0.0, sig * 0.7, 0.0));
  vec3 refl = textureLod(uEnv, R, 0.6 + alpha * 7.0).rgb;

  vec3 H = normalize(V + uSunDir);
  float NH = max(dot(N, H), 0.0), NL = max(dot(N, uSunDir), 0.0), VH = max(dot(V, H), 0.0);
  float a2 = alpha * alpha, dd = NH * NH * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dd * dd);
  float vis = 0.5 / (NL * sqrt(NV * NV * (1.0 - a2) + a2) + NV * sqrt(NL * NL * (1.0 - a2) + a2) + 1e-4);
  vec3 spec = min(uSunCol * (D * vis * (0.02 + 0.98 * pow(1.0 - VH, 5.0)) * NL), vec3(90.0));

  // water body: upwelling light + forward scattering through crests
  vec3 Lh = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
  float toward = pow(sat(dot(V, -Lh) * 0.5 + 0.5), 3.0);
  float crest = sat(s.h / (uSea * 1.6) * 0.5 + 0.5);
  vec3 body = uBodyCol * (0.8 + 0.35 * crest) + uSssCol * crest * crest * (0.25 + 1.5 * toward) * sat(1.3 - N.y * N.y + 0.25);

  vec3 col = mix(body, refl, F) + spec;

  // foam: breaking crests (Jacobian), their decaying trails, hull wash, splashes
  float wc = sat((uFoamJ - s.J) * 5.0);
  float trail = 0.0;
  if (foot < 2.5) {
    trail = max(sat((uFoamJ - jacobianAt(vX0, uTime - 1.7)) * 5.0) * 0.6, sat((uFoamJ - jacobianAt(vX0, uTime - 4.0)) * 5.0) * 0.32);
  }
  float hull = (1.0 - smoothstep(0.0, 0.75, hs)) * (0.42 + 0.3 * sin(uTime * 1.3 + bl.y * 1.7) * sin(uTime * 0.83 - bl.y * 0.6));
  // wake when under way: turbulent trail behind the stern + spreading bow wave
  float spd = uBoat.w;
  if (spd > 0.3) {
    float back = bl.y - 3.6;
    float w = 1.2 + max(back, 0.0) * 0.22;
    float core = (1.0 - smoothstep(w * 0.6, w, abs(bl.x))) * smoothstep(-0.5, 1.0, back) * exp(-max(back, 0.0) / (spd * 3.0));
    float arm = abs(abs(bl.x) - (1.45 + max(bl.y + 4.0, 0.0) * 0.33));
    float vw = (1.0 - smoothstep(0.0, 0.5 + max(bl.y + 4.0, 0.0) * 0.07, arm)) * exp(-max(bl.y + 4.0, 0.0) / (spd * 2.6)) * step(-5.5, bl.y);
    hull = max(hull, sat(max(core, vw * 0.8) * min(spd * 0.4, 1.0)));
  }
  float foamAmt = max(max(wc, trail), max(hull, rFoam));
  float ft = texture2D(uFoamTex, vX0 * 0.105 + uTime * 0.004).r * 0.62 + texture2D(uFoamTex, vX0 * 0.37 - uTime * 0.007).r * 0.38;
  float streak = smoothstep(0.83, 1.0, texture2D(uFoamTex, vX0 * 0.031).g) * 0.2 * (1.0 - smoothstep(60.0, 220.0, dist));
  foamAmt = max(foamAmt, streak);
  float foam = smoothstep(1.0 - foamAmt, 1.0 - foamAmt + 0.42, ft) * sat(foamAmt * 4.0);
  vec3 foamCol = (uSunCol * (0.3 + 0.7 * sat(dot(N, uSunDir))) / PI + uAmbCol) * 0.8;
  col = mix(col, foamCol, foam * 0.94);

  // aerial perspective toward the horizon
  vec3 hz = textureLod(uEnv, normalize(vec3(-V.x, 0.02, -V.z)), 2.5).rgb;
  col = mix(col, hz, 1.0 - exp(-dist * uHaze));

  gl_FragColor = vec4(col, 1.0);
}
`;

  const FRAG_BOTTOM = /* glsl */ `
${SURF_COMMON}
${DB.GLSL.water}
void main(){
  vec3 toP = vWorld - cameraPosition; float dist = length(toP); vec3 I = toP / dist;
  float foot = max(length(dFdx(vX0)), length(dFdy(vX0)));
  vec2 bl = boatLocal(vWorld.xz); float hs = hullSDF(bl);
  if (hs < -0.1) discard;
  Surf s = surfAt(vX0, uTime, foot);
  float varD; vec2 ds = detailSlope(vX0, uTime, foot, varD);
  float rFoam; vec2 rs = rippleSlope(vWorld.xz, rFoam);
  vec2 sl = s.slope + ds * 1.25 + rs;
  vec3 N = normalize(vec3(-sl.x, 1.0, -sl.y));
  vec3 Nd = -N;
  float camDepth = max(-cameraPosition.y, 0.0);

  vec3 Td = refract(I, Nd, 1.333);
  float cosI = max(dot(-I, Nd), 0.0);
  float F = 1.0;
  vec3 through = vec3(0.0);
  if (dot(Td, Td) > 0.0) {
    float cosT = max(Td.y, 0.0);
    float r0 = 0.02;
    F = r0 + (1.0 - r0) * pow(1.0 - cosT, 5.0);
    vec3 sky = textureLod(uEnv, Td, 1.0).rgb;
    float sunSpot = pow(max(dot(Td, uSunDir), 0.0), 1400.0) * 40.0 + pow(max(dot(Td, uSunDir), 0.0), 60.0) * 0.5;
    through = (sky + uSunCol * sunSpot) * vec3(0.82, 0.95, 1.0);
  }
  vec3 Rd = reflect(I, Nd);
  vec3 under = waterColumn(normalize(vec3(Rd.x, -abs(Rd.y) - 0.05, Rd.z)), 0.0) * 0.85;
  vec3 col = mix(through, under, F);
  // foam seen from below reads as a bright diffuse patch
  float wc = sat((uFoamJ - s.J) * 5.0);
  float hull = (1.0 - smoothstep(0.0, 0.75, hs)) * 0.5;
  float foamAmt = max(max(wc, hull), rFoam);
  float ft = texture2D(uFoamTex, vX0 * 0.105).r;
  float foam = smoothstep(1.0 - foamAmt, 1.0 - foamAmt + 0.42, ft) * sat(foamAmt * 4.0);
  col = mix(col, (uSunCol * 0.14 + uAmbCol) * vec3(0.8, 0.95, 1.0), foam * 0.8);
  col = waterFog(col, I, dist, camDepth);
  gl_FragColor = vec4(col, 1.0);
}
`;

  // tiling slope map: sum of sines with integer wave vectors (table generated in JS so the rms is known)
  function detailBakeFrag(n) {
    return /* glsl */ `
uniform vec4 uW[${n}];   // kx, ky, amp, phase
varying vec2 vUv;
void main(){
  vec2 p = vUv * 6.28318530718; vec2 sl = vec2(0.0); float h = 0.0;
  for (int i = 0; i < ${n}; i++) { float a = dot(uW[i].xy, p) + uW[i].w; h += uW[i].z * sin(a); sl += uW[i].xy * (uW[i].z * cos(a)); }
  gl_FragColor = vec4(sl * 1.6 + 0.5, h * 0.5 + 0.5, 1.0);
}`;
  }
  const FOAM_BAKE = /* glsl */ `
varying vec2 vUv;
${DB.GLSL.common}
vec2 worley(vec2 p, float per){
  vec2 i = floor(p), f = fract(p); float d1 = 9.0, d2 = 9.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)); vec2 o = hash22(mod(i + g, per) + per * 7.0);
    float d = length(g + o - f); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return vec2(d1, d2);
}
float tfbm(vec2 p, float per){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) {
    vec2 ip = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
    float n = mix(mix(hash12(mod(ip, per)), hash12(mod(ip + vec2(1,0), per)), u.x), mix(hash12(mod(ip + vec2(0,1), per)), hash12(mod(ip + vec2(1,1), per)), u.x), u.y);
    s += a * n; p *= 2.0; per *= 2.0; a *= 0.5; } return s; }
void main(){
  vec2 w1 = worley(vUv * 7.0, 7.0), w2 = worley(vUv * 19.0 + 3.3, 19.0), w3 = worley(vUv * 46.0, 46.0);
  float lace = (1.0 - smoothstep(0.0, 0.34, w1.y - w1.x)) * 0.55 + (1.0 - smoothstep(0.0, 0.4, w2.y - w2.x)) * 0.33 + (1.0 - smoothstep(0.0, 0.5, w3.y - w3.x)) * 0.22;
  float n = tfbm(vUv * 6.0, 6.0);
  float r = sat(lace * 0.75 + n * 0.55);
  gl_FragColor = vec4(r, tfbm(vUv * 4.0 + 2.0, 4.0), 1.0 - w2.x, 1.0);
}`;

  const Ocean = (DB.Ocean = {
    waves: [], sea: 0.72, time: 0,
    water: {     // shared underwater optics uniforms
      uWC: { value: new T.Vector3(0.38, 0.072, 0.047) }, uWK: { value: new T.Vector3(0.33, 0.052, 0.027) },
      uWS: { value: new T.Vector3(0.02, 0.02, 0.02) }, uSunDirW: { value: new T.Vector3(0, 1, 0) },
      uSunColW: { value: new T.Color() }, uAmbColW: { value: new T.Color() }, uWTime: { value: 0 },
    },

    init(renderer, env) {
      this.env = env;
      const r = M.rng(77);
      const A = [], B = [];
      for (let i = 0; i < NW; i++) {
        const [off, L, amp, q] = WAVE_DEF[i];
        const ang = ((MAIN_DIR + off) * Math.PI) / 180, k = (2 * Math.PI) / L, om = Math.sqrt(GRAV * k), ph = r() * Math.PI * 2;
        this.waves.push({ dx: Math.cos(ang), dz: Math.sin(ang), k, om, A: amp, q, ph, L });
        A.push(new T.Vector4(Math.cos(ang), Math.sin(ang), k, om));
        B.push(new T.Vector4(amp, q, ph, L));
      }
      // detail slope map
      const nd = 56, tbl = []; let ms = 0;
      for (let i = 0; i < nd; i++) {
        const mag = 2 + Math.floor(Math.pow(i + 1, 1.22) * 0.55), ang = r() * Math.PI * 2;
        let kx = Math.round(Math.cos(ang) * mag), ky = Math.round(Math.sin(ang) * mag);
        if (kx === 0 && ky === 0) kx = mag;
        const kk = Math.hypot(kx, ky), amp = 1 / Math.pow(kk, 1.55);
        tbl.push([kx, ky, amp, r() * Math.PI * 2]);
        ms += amp * amp * kk * kk * 0.25;        // per-component slope variance
      }
      const norm = 0.1 / Math.sqrt(ms);
      this.detailTex = DB.bake(renderer, detailBakeFrag(nd), 512, { uW: { value: tbl.map((w) => new T.Vector4(w[0], w[1], w[2] * norm, w[3])) } }, { aniso: 16 });
      this.foamTex = DB.bake(renderer, FOAM_BAKE, 512, {}, { aniso: 8 });

      const U = (this.uniforms = Object.assign({
        uWaveA: { value: A }, uWaveB: { value: B }, uTime: { value: 0 }, uSea: { value: this.sea }, uFoamJ: { value: 0.735 },
        uDetail: { value: this.detailTex }, uFoamTex: { value: this.foamTex }, uEnv: { value: env.cubeRT.texture },
        uSunDir: { value: env.sunDir }, uSunCol: { value: env.sunColor }, uAmbCol: { value: env.ambColor },
        uBodyCol: { value: new T.Vector3() }, uSssCol: { value: new T.Vector3() },
        uBoat: { value: new T.Vector4(0, 0, 0, 0) }, uRipple: { value: [0, 1, 2, 3, 4, 5].map(() => new T.Vector4(0, 0, -100, 0)) },
        uHaze: { value: 5.5e-5 },
      }, this.water));

      const geo = this.buildDisc(DB.Q.oceanSeg);
      // drawn after opaque geometry; blends by DESTINATION alpha: submerged things (fish, lure) write alpha < 1 to stay faintly visible through the surface
      this.matTop = new T.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG_TOP, uniforms: U, transparent: true, depthWrite: true, toneMapped: false,
        blending: T.CustomBlending, blendSrc: T.DstAlphaFactor, blendDst: T.OneMinusDstAlphaFactor, blendSrcAlpha: T.OneFactor, blendDstAlpha: T.ZeroFactor });
      this.matBottom = new T.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG_BOTTOM, uniforms: U, side: T.BackSide, toneMapped: false });
      this.top = new T.Mesh(geo, this.matTop); this.top.frustumCulled = false; this.top.renderOrder = -10;
      this.bottom = new T.Mesh(geo, this.matBottom); this.bottom.frustumCulled = false; this.bottom.visible = false;
      this.group = new T.Group(); this.group.add(this.top, this.bottom);
      this.ripIdx = 0;
      this.syncLight();
    },

    buildDisc(seg) {
      const radii = [0]; let r = 0.5;
      while (r < 26000) { radii.push(r); r *= 1.022 + r / 8000; }
      radii.push(r);
      const rings = radii.length, pos = new Float32Array(rings * seg * 3), idx = new Uint32Array((rings - 1) * seg * 6);
      for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2, o = (j * seg + i) * 3;
        pos[o] = Math.cos(a) * radii[j]; pos[o + 2] = Math.sin(a) * radii[j];
      }
      let n = 0;
      for (let j = 0; j < rings - 1; j++) for (let i = 0; i < seg; i++) {
        const i2 = (i + 1) % seg, a = j * seg + i, b = j * seg + i2, c = (j + 1) * seg + i, d = (j + 1) * seg + i2;
        idx[n++] = a; idx[n++] = b; idx[n++] = c; idx[n++] = b; idx[n++] = d; idx[n++] = c;
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      g.setIndex(new T.BufferAttribute(idx, 1));
      return g;
    },

    // light-dependent constants (call when the sun changes)
    syncLight() {
      const e = this.env, sy = Math.max(e.sunDir.y, 0);
      const Ed = [e.sunColor.r * sy + e.ambColor.r * Math.PI, e.sunColor.g * sy + e.ambColor.g * Math.PI, e.sunColor.b * sy + e.ambColor.b * Math.PI];
      this.uniforms.uBodyCol.value.set(0.00030 * Ed[0], 0.0031 * Ed[1], 0.0118 * Ed[2]);
      this.uniforms.uSssCol.value.set(0.0002 * Ed[0], 0.011 * Ed[1], 0.0125 * Ed[2]);
      e.seaColor.setRGB(0.0012 * Ed[0] + e.horizonColor.r * 0.05, 0.0045 * Ed[1] + e.horizonColor.g * 0.06, 0.0135 * Ed[2] + e.horizonColor.b * 0.07);
      // underwater light: refract the sun direction, lose a bit at the interface
      const s = e.sunDir, sinI = Math.sqrt(Math.max(1 - s.y * s.y, 0)), sinT = sinI / 1.333, cosT = Math.sqrt(1 - sinT * sinT);
      const h = Math.hypot(s.x, s.z) || 1;
      this.water.uSunDirW.value.set((s.x / h) * sinT, cosT, (s.z / h) * sinT);
      const tr = 0.93 * M.smooth(0.0, 0.25, s.y) + 0.02;
      this.water.uSunColW.value.setRGB(e.sunColor.r * sy * tr, e.sunColor.g * sy * tr, e.sunColor.b * sy * tr);
      this.water.uAmbColW.value.setRGB(e.ambColor.r * 2.6, e.ambColor.g * 2.6, e.ambColor.b * 2.6);
      const Es = [this.water.uSunColW.value.r + this.water.uAmbColW.value.r, this.water.uSunColW.value.g + this.water.uAmbColW.value.g, this.water.uSunColW.value.b + this.water.uAmbColW.value.b];
      this.water.uWS.value.set(Es[0] * 0.0008, Es[1] * 0.00066, Es[2] * 0.00122);
    },

    group_(x, z, t) { return 1 + 0.2 * Math.sin(0.031 * x + 0.017 * z - 0.11 * t) + 0.16 * Math.sin(-0.013 * x + 0.027 * z + 0.07 * t + 1.7); },

    // surface height at world (x,z); waves shorter than minL are ignored (hull-sized filtering)
    height(x, z, minL = 0, t = this.time) {
      let x0 = x, z0 = z;
      const ws = this.waves;
      for (let it = 0; it < 3; it++) {
        const gm = this.group_(x0, z0, t) * this.sea;
        let dx = 0, dz = 0;
        for (let i = 0; i < NW; i++) {
          const w = ws[i]; if (w.L < minL) continue;
          const c = Math.cos(w.k * (w.dx * x0 + w.dz * z0) - w.om * t + w.ph) * w.q * w.A * gm;
          dx += w.dx * c; dz += w.dz * c;
        }
        x0 = x - dx; z0 = z - dz;
      }
      const gm = this.group_(x0, z0, t) * this.sea;
      let y = 0;
      for (let i = 0; i < NW; i++) { const w = ws[i]; if (w.L < minL) continue; y += w.A * gm * Math.sin(w.k * (w.dx * x0 + w.dz * z0) - w.om * t + w.ph); }
      return y;
    },
    // horizontal orbital velocity of the water at the surface (for drifting objects)
    drift(x, z, out, t = this.time) {
      const gm = this.group_(x, z, t) * this.sea; let vx = 0, vz = 0;
      for (let i = 0; i < 6; i++) { const w = this.waves[i]; const s = Math.sin(w.k * (w.dx * x + w.dz * z) - w.om * t + w.ph) * w.q * w.A * gm * w.om; vx += w.dx * s; vz += w.dz * s; }
      out.x = vx; out.z = vz; return out;
    },

    addRipple(x, z, strength = 1) {
      const r = this.uniforms.uRipple.value[this.ripIdx];
      r.set(x, z, this.time, strength);
      this.ripIdx = (this.ripIdx + 1) % 6;
    },
    setBoat(x, z, heading, speed) { this.uniforms.uBoat.value.set(x, z, heading, speed); },

    update(dt, camera, underwater) {
      this.time += dt;
      this.uniforms.uTime.value = this.time;
      this.uniforms.uSea.value = this.sea;
      this.water.uWTime.value = this.time;
      this.group.position.set(camera.position.x, 0, camera.position.z);
      this.top.visible = !underwater; this.bottom.visible = !!underwater;
    },
  });
})();
