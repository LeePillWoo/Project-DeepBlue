// Project Deep Blue — post chain: HDR scene target (MSAA) → underwater light shafts → bloom → lens/tonemap.
(function () {
  'use strict';
  const DB = window.DB, T = THREE;

  const DOWN = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uClamp; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
     + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c /= 8.0;
  if (uClamp > 0.0) { float m = max(c.r, max(c.g, c.b)); c *= min(1.0, uClamp / max(m, 1e-4)); }
  gl_FragColor = vec4(c, 1.0);
}`;
  const UP = /* glsl */ `
uniform sampler2D tSrc, tAdd; uniform vec2 uTexel; uniform float uMix; varying vec2 vUv;
void main(){
  vec2 o = uTexel;
  vec3 c = texture2D(tSrc, vUv + vec2(-o.x * 2.0, 0.0)).rgb + texture2D(tSrc, vUv + vec2(o.x * 2.0, 0.0)).rgb
         + texture2D(tSrc, vUv + vec2(0.0, -o.y * 2.0)).rgb + texture2D(tSrc, vUv + vec2(0.0, o.y * 2.0)).rgb;
  c += 2.0 * (texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb
            + texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb);
  c /= 12.0;
  gl_FragColor = vec4(mix(texture2D(tAdd, vUv).rgb, c, uMix), 1.0);
}`;

  // volumetric sun shafts under water: march the view ray, sample a light pattern projected along the refracted sun
  const RAYS = /* glsl */ `
uniform sampler2D tDepth; uniform vec2 uNearFar; uniform vec3 uCamPos, uCamRight, uCamUp, uCamFwd; uniform float uTanHalfFov, uAspect, uSteps, uJitter;
varying vec2 vUv;
${DB.GLSL.common}
${DB.GLSL.water}
float shaft(vec2 q, float t){
  float a = vnoise(q * 0.42 + vec2(t * 0.17, t * 0.11)) * vnoise(q * 0.19 - vec2(t * 0.09, -t * 0.06) + 5.3);
  return smoothstep(0.16, 0.5, a);
}
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  vec3 dir = uCamFwd + uCamRight * (p.x * uTanHalfFov * uAspect) + uCamUp * (p.y * uTanHalfFov);
  float dl = length(dir); vec3 rd = dir / dl;
  float d = texture2D(tDepth, vUv).x;
  float zv = 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - (d * 2.0 - 1.0) * (uNearFar.y - uNearFar.x));
  float tmax = min(zv * dl, 46.0);
  if (rd.y > 0.0) tmax = min(tmax, max(-uCamPos.y, 0.0) / rd.y);     // stop at the surface
  tmax = max(tmax, 0.0);
  int N = int(uSteps);
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uJitter);
  float dt = tmax / float(N);
  float mu = dot(rd, uSunDirW);
  float ph = 0.22 + 1.5 * pow(max(mu, 0.0), 3.0) + 0.5 * pow(max(mu, 0.0), 24.0);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 40; i++) {
    if (i >= N) break;
    float t = (float(i) + jit) * dt;
    vec3 x = uCamPos + rd * t; float depth = max(-x.y, 0.0);
    vec2 q = x.xz + uSunDirW.xz * (depth / max(uSunDirW.y, 0.25));
    float s = shaft(q, uWTime);
    acc += s * exp(-uWK * depth / max(uSunDirW.y, 0.3)) * exp(-uWC * t);
  }
  gl_FragColor = vec4(acc * dt * ph * uSunColW * 0.016, 1.0);
}`;

  const FINAL = /* glsl */ `
uniform sampler2D tScene, tBloom, tRays; uniform vec2 uRes;
uniform float uExposure, uBloom, uUnder, uTime, uVignette, uWet, uFlash, uFade, uDamage, uCA, uSat, uBlur, uDark;
varying vec2 vUv;
${DB.GLSL.common}
vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c){
  const mat3 mi = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 mo = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  return clamp(mo * RRTAndODTFit(mi * c), 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
// water beads on the lens: returns uv offset (xy) and coverage (z)
vec3 drops(vec2 uv, float scale, float seed){
  vec2 g = uv * vec2(uRes.x / uRes.y, 1.0) * scale; vec2 id = floor(g), f = fract(g) - 0.5;
  vec2 h = hash22(id + seed); float life = fract(h.x * 7.3 + seed);
  vec2 c = (h - 0.5) * 0.55; c.y -= (1.0 - uWet) * (0.4 + life) * 0.9;        // slide down as they dry
  float r = (0.10 + 0.16 * life) * smoothstep(0.0, 0.35, uWet - life * 0.55);
  vec2 d = f - c; d.y *= 0.82; float l = length(d);
  float m = smoothstep(r, r * 0.72, l) * step(0.64, fract(h.y * 13.7 + seed));      // only some cells carry a bead
  return vec3(-d * m * 0.6 / scale, m);
}
void main(){
  vec2 uv = vUv;
  if (uUnder > 0.5) uv += vec2(sin(uv.y * 23.0 + uTime * 1.2), cos(uv.x * 19.0 + uTime * 1.05)) * 0.0009;
  float wetM = 0.0;
  if (uWet > 0.01) { vec3 d1 = drops(vUv, 7.0, 3.1), d2 = drops(vUv + 0.37, 13.0, 9.7); uv += d1.xy + d2.xy; wetM = max(d1.z, d2.z); }
  vec2 c = uv - 0.5; float r2 = dot(c, c);
  vec3 col;
  col.g = texture2D(tScene, uv).g;
  col.r = texture2D(tScene, uv - c * r2 * uCA).r;
  col.b = texture2D(tScene, uv + c * r2 * uCA).b;
  vec3 bloom = texture2D(tBloom, uv).rgb;
  col = mix(col, bloom, max(uBloom, uBlur));
  if (uUnder > 0.5) {      // tent-filter the half-res shafts: hides the march jitter
    vec2 o = 1.5 / uRes;
    col += 0.25 * (texture2D(tRays, uv + vec2(-o.x, -o.y)).rgb + texture2D(tRays, uv + vec2(o.x, -o.y)).rgb + texture2D(tRays, uv + vec2(-o.x, o.y)).rgb + texture2D(tRays, uv + vec2(o.x, o.y)).rgb);
  }
  col *= uExposure * (1.0 + wetM * 0.12);
  col *= 1.0 - uVignette * smoothstep(0.18, 1.0, r2 * 2.1);
  col = aces(col);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSat);
  col = mix(col, vec3(0.42, 0.02, 0.01) * (0.4 + l), uDamage * smoothstep(0.05, 0.6, r2 * 2.0 + uDamage * 0.3));
  col *= 1.0 - uDark * smoothstep(0.0, 0.5, r2 * 1.6 + uDark * 0.35);     // tunnel vision (low oxygen)
  col = toSRGB(col);
  col = mix(col, vec3(0.93, 0.97, 1.0), uFlash);
  col *= 1.0 - uFade;
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * (1.6 / 255.0);
  gl_FragColor = vec4(col, 1.0);
}`;

  const Post = (DB.Post = {
    fx: { exposure: 0.5, bloom: 0.05, under: 0, vignette: 0.22, wet: 0, flash: 0, fade: 0, damage: 0, ca: 0.004, sat: 1.04, blur: 0, dark: 0 },
    init(renderer) {
      this.renderer = renderer;
      const hf = { type: T.HalfFloatType, depthBuffer: false, minFilter: T.LinearFilter, magFilter: T.LinearFilter };
      this.rtScene = new T.WebGLRenderTarget(4, 4, { type: T.HalfFloatType, samples: DB.Q.msaa, minFilter: T.LinearFilter, magFilter: T.LinearFilter });
      this.rtScene.depthTexture = new T.DepthTexture(4, 4);
      this.rtRays = new T.WebGLRenderTarget(4, 4, hf);
      this.levels = 6;
      this.down = []; this.up = [];
      for (let i = 0; i < this.levels; i++) { this.down.push(new T.WebGLRenderTarget(4, 4, hf)); this.up.push(new T.WebGLRenderTarget(4, 4, hf)); }
      this.mDown = DB.fsMat(DOWN, { tSrc: { value: null }, uTexel: { value: new T.Vector2() }, uClamp: { value: 0 } });
      this.mUp = DB.fsMat(UP, { tSrc: { value: null }, tAdd: { value: null }, uTexel: { value: new T.Vector2() }, uMix: { value: 0.6 } });
      this.mRays = DB.fsMat(RAYS, Object.assign({
        tDepth: { value: this.rtScene.depthTexture }, uNearFar: { value: new T.Vector2() }, uCamPos: { value: new T.Vector3() },
        uCamRight: { value: new T.Vector3() }, uCamUp: { value: new T.Vector3() }, uCamFwd: { value: new T.Vector3() },
        uTanHalfFov: { value: 1 }, uAspect: { value: 1 }, uSteps: { value: DB.Q.rays }, uJitter: { value: 0 },
      }, DB.Ocean.water));
      this.mFinal = DB.fsMat(FINAL, {
        tScene: { value: this.rtScene.texture }, tBloom: { value: this.up[0].texture }, tRays: { value: this.rtRays.texture }, uRes: { value: new T.Vector2() },
        uExposure: { value: 0.5 }, uBloom: { value: 0.05 }, uUnder: { value: 0 }, uTime: { value: 0 }, uVignette: { value: 0.2 }, uWet: { value: 0 },
        uFlash: { value: 0 }, uFade: { value: 0 }, uDamage: { value: 0 }, uCA: { value: 0.004 }, uSat: { value: 1.04 }, uBlur: { value: 0 }, uDark: { value: 0 },
      });
      this.frame = 0;
    },
    resize(w, h) {
      this.w = w; this.h = h;
      this.rtScene.setSize(w, h);
      this.rtRays.setSize(Math.max(2, w >> 1), Math.max(2, h >> 1));
      for (let i = 0; i < this.levels; i++) {
        const lw = Math.max(2, w >> (i + 1)), lh = Math.max(2, h >> (i + 1));
        this.down[i].setSize(lw, lh); this.up[i].setSize(lw, lh);
      }
      this.mFinal.uniforms.uRes.value.set(w, h);
    },
    render(scene, camera, time) {
      const r = this.renderer, fx = this.fx;
      this.frame++;
      r.setRenderTarget(this.rtScene);
      r.clear();
      r.render(scene, camera);

      if (fx.under > 0.5) {
        const u = this.mRays.uniforms, e = camera.matrixWorld.elements;
        u.uNearFar.value.set(camera.near, camera.far);
        u.uCamPos.value.copy(camera.position);
        u.uCamRight.value.set(e[0], e[1], e[2]); u.uCamUp.value.set(e[4], e[5], e[6]); u.uCamFwd.value.set(-e[8], -e[9], -e[10]);
        u.uTanHalfFov.value = Math.tan((camera.fov * Math.PI) / 360); u.uAspect.value = camera.aspect;
        u.uJitter.value = (this.frame * 0.61803398875) % 1;
        DB.renderFS(r, this.mRays, this.rtRays);
      }
      // bloom pyramid
      let src = this.rtScene;
      for (let i = 0; i < this.levels; i++) {
        const u = this.mDown.uniforms;
        u.tSrc.value = src.texture; u.uTexel.value.set(1 / src.width, 1 / src.height); u.uClamp.value = i === 0 ? 40 : 0;
        DB.renderFS(r, this.mDown, this.down[i]);
        src = this.down[i];
      }
      let acc = this.down[this.levels - 1];
      for (let i = this.levels - 2; i >= 0; i--) {
        const u = this.mUp.uniforms;
        u.tSrc.value = acc.texture; u.tAdd.value = this.down[i].texture; u.uTexel.value.set(1 / acc.width, 1 / acc.height);
        DB.renderFS(r, this.mUp, this.up[i]);
        acc = this.up[i];
      }
      const f = this.mFinal.uniforms;
      f.uExposure.value = fx.exposure; f.uBloom.value = fx.bloom; f.uUnder.value = fx.under; f.uTime.value = time; f.uVignette.value = fx.vignette;
      f.uWet.value = fx.wet; f.uFlash.value = fx.flash; f.uFade.value = fx.fade; f.uDamage.value = fx.damage; f.uCA.value = fx.ca; f.uSat.value = fx.sat;
      f.uBlur.value = fx.blur; f.uDark.value = fx.dark;
      DB.renderFS(r, this.mFinal, null);
    },
  });
})();
