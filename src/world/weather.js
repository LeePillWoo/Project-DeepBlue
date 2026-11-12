// Project Deep Blue — weather: a storm that builds over the horizon, breaks over the boat and blows through.
// k (0 clear … 1 full storm) drives everything else: the overcast and the light (Env.applyStorm), the sea state, haze and fog,
// rain (streaks, splashes on the water, beads on the lens), lightning with thunder that arrives late, and which fish bite.
(function () {
  'use strict';
  const DB = window.DB, T = THREE, M = DB.M;
  const NR = 5200, BOX = [38, 24, 38];      // rain streaks, and the box of them that follows the camera
  const smooth = (x) => { const t = M.sat(x); return t * t * (3 - 2 * t); };
  const BUILD = 50, CLEAR = 45;             // seconds to come in and to blow out

  const RAIN_VERT = /* glsl */ `
attribute vec3 aSeed; attribute float aEnd;      // where in the box, and which end of the streak (0 head, 1 tail)
uniform float uTime; uniform vec3 uVel, uBox;
varying float vA;
void main(){
  vec3 vel = uVel * vec3(1.0, 0.8 + 0.4 * aSeed.x, 1.0);
  // each drop keeps to its own lane in the world; the box only decides which lanes are near enough to draw
  vec3 p = cameraPosition + (fract((aSeed * uBox + vel * uTime - cameraPosition) / uBox) - 0.5) * uBox;
  p -= normalize(vel) * aEnd * (0.45 + 0.5 * aSeed.z);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vA = smoothstep(0.4, 2.5, -mv.z) * (1.0 - smoothstep(9.0, 19.0, -mv.z)) * (1.0 - aEnd * 0.7);
  gl_Position = projectionMatrix * mv;
}`;
  const RAIN_FRAG = /* glsl */ `uniform vec3 uCol; uniform float uAlpha; varying float vA; void main(){ gl_FragColor = vec4(uCol, uAlpha * vA); }`;

  const Weather = (DB.Weather = {
    k: 0, state: 'clear', t: 0, next: 300, dur: 180, rain: 0, flash: 0, flashT: 9, flashK: 0, strikeT: 6, applied: -1, auto: !DB.params.has('noweather'),
    mist: 0,      // a local fog, set by whoever needs one (the ghost ship)

    init(scene) {
      this.scene = scene;
      // far things fade into the rain. The fog is there from the start (nearly nothing) so that switching it on does not recompile every material mid-game.
      scene.fog = new T.FogExp2(0x8090a0, 1e-6);
      const seed = new Float32Array(NR * 2 * 3), end = new Float32Array(NR * 2);
      for (let i = 0; i < NR; i++) { const a = Math.random(), b = Math.random(), c = Math.random(); for (let e = 0; e < 2; e++) { seed.set([a, b, c], (i * 2 + e) * 3); end[i * 2 + e] = e; } }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(new Float32Array(NR * 2 * 3), 3)); g.setAttribute('aSeed', new T.BufferAttribute(seed, 3)); g.setAttribute('aEnd', new T.BufferAttribute(end, 1));
      this.rainMat = new T.ShaderMaterial({ vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false, toneMapped: false, fog: false,
        uniforms: { uTime: { value: 0 }, uVel: { value: new T.Vector3(4, -17, 2) }, uBox: { value: new T.Vector3(...BOX) }, uCol: { value: new T.Vector3(1, 1, 1) }, uAlpha: { value: 0 } } });
      this.rainMesh = new T.LineSegments(g, this.rainMat); this.rainMesh.frustumCulled = false; this.rainMesh.renderOrder = 25; this.rainMesh.visible = false; scene.add(this.rainMesh);
      // lightning: a trunk and two forks, drawn as HDR ribbons so the bloom makes them glare
      this.boltCol = new T.Vector3(0, 0, 0);
      this.bolts = [26, 10, 10].map((n, i) => { const l = new DB.Line(n, i ? 2.2 : 4.5, this.boltCol, 1); l.mesh.visible = false; l.mesh.renderOrder = 24; scene.add(l.mesh); return l; });
      this.flashDir = new T.Vector3(0, 0.3, 1);
    },

    // R, and DB.debug.storm(): bring one on now, or send the one overhead away
    toggle() { if (this.state === 'clear' || this.state === 'clearing') this.call(); else this.dismiss(); return this.state; },
    call() { if (this.state === 'storm' || this.state === 'build') return; this.t = this.state === 'clearing' ? BUILD * this.k : 0; this.state = 'build'; this.dur = 150 + Math.random() * 70; DB.emit('weather', 'build'); },
    dismiss() { if (this.state === 'clear' || this.state === 'clearing') return; this.t = CLEAR * (1 - this.k); this.state = 'clearing'; DB.emit('weather', 'clearing'); },
    // straight to a given strength (headless checks and screenshots)
    set(k) { this.k = M.sat(k); this.state = k >= 1 ? 'storm' : k <= 0 ? 'clear' : 'build'; this.t = k >= 1 ? 0 : BUILD * this.k; this.apply(); },
    get stormy() { return this.k > 0.5; },      // the fish that only bite in this

    strike(camera) {
      const a = Math.random() * 6.283, d = 260 + Math.random() * 900, x = camera.position.x + Math.cos(a) * d, z = camera.position.z + Math.sin(a) * d;
      const top = [x + (Math.random() - 0.5) * 300, 1180, z + (Math.random() - 0.5) * 300], n = this.bolts[0].n;
      let fork = 0, jx = 0, jz = 0;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1); jx += (Math.random() - 0.5) * 70 * (1 - t * 0.5); jz += (Math.random() - 0.5) * 70 * (1 - t * 0.5);
        const px = M.lerp(top[0], x, t) + jx * Math.sin(Math.PI * t), py = M.lerp(top[1], 0, t), pz = M.lerp(top[2], z, t) + jz * Math.sin(Math.PI * t);
        this.bolts[0].set(i, px, py, pz);
        if (fork < 2 && i > 6 && i < 17 && (i - 7) % 5 === 0) {      // a fork leaves the trunk here and dies in mid-air
          const b = this.bolts[++fork], fa = Math.random() * 6.283; let fx = px, fy = py, fz = pz;
          for (let j = 0; j < b.n; j++) { b.set(j, fx, fy, fz); fx += Math.cos(fa) * 28 + (Math.random() - 0.5) * 40; fy -= 22 + Math.random() * 30; fz += Math.sin(fa) * 28 + (Math.random() - 0.5) * 40; }
          b.commit(b.n);
        }
      }
      this.bolts[0].commit(n);
      this.flashT = 0; this.flashK = M.clamp(1.25 - d / 1100, 0.35, 1);
      this.flashDir.set(x - camera.position.x, 500, z - camera.position.z).normalize();
      DB.FX.splash(x, 0, z, 3); DB.Ocean.addRipple(x, z, 3);
      DB.emit('thunder', { d });
    },

    // push k into everything that depends on it
    apply() {
      const k = this.k, O = DB.Ocean, E = DB.Env, sky = Math.max(k, this.mist * 0.62);      // a mist closes the sky in and dims the light like a storm two-thirds built, without the sea or the rain
      if (Math.abs(sky - this.applied) > 0.004) {
        this.applied = sky; E.applyStorm(sky); O.syncLight(); DB.Boat.syncLight();
        if (sky > 0 && sky < 1) { E.dirty = true; E.cubeAge += 1.5; }      // while it changes, the sky reflections are redone every few seconds, not every 25
      }
      O.sea = 0.72 + 0.62 * k;
      const U = O.uniforms; U.uFoamJ.value = 0.735 + 0.085 * k; U.uHaze.value = 5.5e-5 + 7.5e-4 * k + 9e-4 * this.mist; U.uRain.value = this.rain;
    },

    update(dt, camera, under, playing) {
      // --- the cycle
      if (this.state === 'clear') { if (this.auto && playing && (this.next -= dt) <= 0) this.call(); }
      else {
        this.t += dt;
        if (this.state === 'build') { this.k = smooth(this.t / BUILD); if (this.t >= BUILD) { this.state = 'storm'; this.t = 0; this.k = 1; DB.emit('weather', 'storm'); } }
        else if (this.state === 'storm') { if (this.t > this.dur) this.dismiss(); }
        else { this.k = 1 - smooth(this.t / CLEAR); if (this.t >= CLEAR) { this.state = 'clear'; this.k = 0; this.next = 280 + Math.random() * 220; DB.emit('weather', 'clear'); } }
      }
      const k = this.k;
      this.rain = smooth((k - 0.35) / 0.5);
      // --- lightning: mostly while it is overhead, the odd one as it comes and goes
      if (k > 0.6 && playing && (this.strikeT -= dt) <= 0) { this.strikeT = (3.5 + Math.random() * 8) / k; this.strike(camera); }
      this.flashT += dt;
      const ft = this.flashT, f = ft < 0.7 ? this.flashK * (Math.exp(-ft * 10) + 0.75 * Math.exp(-(ft - 0.15) * (ft - 0.15) * 800) + 0.45 * Math.exp(-(ft - 0.31) * (ft - 0.31) * 600)) : 0;
      this.flash = f;
      const on = f > 0.02 && !under;
      for (const b of this.bolts) b.mesh.visible = on;
      this.boltCol.set(34, 38, 52).multiplyScalar(Math.min(f * 1.6, 1));
      DB.Env.setFlash(f, this.flashDir);
      this.apply();
      // --- rain and murk
      const fog = this.scene.fog, hz = DB.Env.horizonColor;
      fog.density = under ? 1e-6 : 1e-6 + 0.0026 * k * k + 0.011 * this.mist; fog.color.setRGB(hz.r * 0.9 + f * 0.22, hz.g * 0.9 + f * 0.25, hz.b * 0.9 + f * 0.32);
      const rm = this.rainMesh, u = this.rainMat.uniforms;
      rm.visible = this.rain > 0.01 && !under;
      if (rm.visible) {
        u.uTime.value += dt; rm.geometry.setDrawRange(0, Math.round(NR * (0.25 + 0.75 * this.rain)) * 2);
        const a = DB.Env.ambColor, w = 3 + 5 * k; u.uVel.value.set(w, -17 - 4 * k, w * 0.45);
        u.uCol.value.set(a.r * 2.2 + 0.03 + f * 1.5, a.g * 2.2 + 0.035 + f * 1.6, a.b * 2.2 + 0.04 + f * 1.9); u.uAlpha.value = 0.5 * this.rain;
      }
    },
  });
})();
