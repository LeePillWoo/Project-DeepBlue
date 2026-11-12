// Project Deep Blue — audio: everything is synthesised with WebAudio (no sample files, so it runs from file://).
// Three buses: surf (above water), under (diving), master (UI jingles). Beds run continuously; one-shots go through play().
(function () {
  'use strict';
  const DB = window.DB, M = DB.M;
  let ctx = null, master, surf, under, noiseBuf;

  const now = () => ctx.currentTime;
  function noise(dest, { type = 'lowpass', f = 800, f2, q = 0.7, a = 0.005, d = 0.4, g = 0.5, delay = 0 }) {
    const t = now() + delay, src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), gn = ctx.createGain();
    src.buffer = noiseBuf; src.loop = true; src.loopStart = Math.random() * 1.5;
    flt.type = type; flt.frequency.setValueAtTime(f, t); if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + d); flt.Q.value = q;
    gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g, t + a); gn.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    src.connect(flt).connect(gn).connect(dest); src.start(t, Math.random() * 1.5); src.stop(t + a + d + 0.05);
  }
  function tone(dest, { type = 'sine', f = 440, f2, a = 0.005, d = 0.2, g = 0.3, delay = 0 }) {
    const t = now() + delay, o = ctx.createOscillator(), gn = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g, t + a); gn.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    o.connect(gn).connect(dest); o.start(t); o.stop(t + a + d + 0.05);
  }
  // a voiced, nasal note: sawtooth through a narrow band (gull cries, creaking timber, horns)
  function voice(dest, { f = 1200, f2, band = 2400, q = 4, a = 0.02, d = 0.3, g = 0.2, delay = 0, vib = 0 }) {
    const t = now() + delay, o = ctx.createOscillator(), flt = ctx.createBiquadFilter(), gn = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    if (vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = vib; lg.gain.value = f * 0.04; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + a + d + 0.05); }
    flt.type = 'bandpass'; flt.frequency.value = band; flt.Q.value = q;
    gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g, t + a); gn.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    o.connect(flt).connect(gn).connect(dest); o.start(t); o.stop(t + a + d + 0.05);
  }
  function loopNoise(dest, type, f, q, g) {
    const src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), gn = ctx.createGain();
    src.buffer = noiseBuf; src.loop = true; flt.type = type; flt.frequency.value = f; flt.Q.value = q; gn.gain.value = g;
    src.connect(flt).connect(gn).connect(dest); src.start();
    return { flt, gn };
  }
  const near = (d, half) => 1 / (1 + (d / half) * (d / half));      // loudness of something d metres away

  // every one-shot. S = above water, U = under water, X = master. o: { s strength, delay, d distance }
  const SOUNDS = {
    cast: (S) => { noise(S, { type: 'bandpass', f: 500, f2: 2600, q: 1.2, d: 0.28, g: 0.3 }); noise(S, { type: 'highpass', f: 3000, d: 0.9, g: 0.05, delay: 0.1 }); },
    plop: (S, U, X, o) => { noise(S, { f: 1800, f2: 400, d: 0.3, g: 0.2, delay: o.delay }); tone(S, { f: 300, f2: 120, d: 0.1, g: 0.15, delay: o.delay }); },
    splash: (S, U, X, o) => { const s = o.s || 1, dl = o.delay; noise(S, { f: 3200, f2: 350, a: 0.01, d: 0.7 + s * 0.8, g: 0.35 * s, delay: dl }); noise(S, { type: 'highpass', f: 2500, d: 1.0 + s, g: 0.1 * s, delay: dl + 0.05 }); tone(S, { f: 90, f2: 45, d: 0.25, g: 0.3 * s, delay: dl }); },
    bite: (S) => { tone(S, { f: 150, f2: 60, d: 0.14, g: 0.5 }); noise(S, { type: 'bandpass', f: 2200, q: 2, a: 0.001, d: 0.06, g: 0.3 }); },
    nibble: (S) => noise(S, { type: 'bandpass', f: 2600, q: 4, a: 0.001, d: 0.03, g: 0.12 }),
    snap: (S) => { noise(S, { type: 'highpass', f: 2200, a: 0.001, d: 0.05, g: 0.7 }); tone(S, { type: 'sawtooth', f: 520, f2: 90, d: 0.22, g: 0.3 }); },
    lost: (S) => tone(S, { type: 'triangle', f: 330, f2: 180, d: 0.35, g: 0.2 }),
    catch: (S, U, X) => [523, 659, 784, 1047].forEach((f, i) => tone(X, { type: 'triangle', f, d: 0.45, g: 0.16, delay: i * 0.09 })),
    record: (S, U, X) => [659, 784, 988, 1319, 1568].forEach((f, i) => tone(X, { type: 'triangle', f, d: 0.5, g: 0.15, delay: i * 0.08 })),
    ui: (S, U, X) => tone(X, { f: 880, d: 0.06, g: 0.1 }),
    dive: (S, U, X) => { noise(X, { f: 2600, f2: 220, a: 0.01, d: 1.6, g: 0.5 }); tone(X, { f: 80, f2: 38, d: 0.5, g: 0.4 }); },
    surface: (S, U, X) => noise(X, { f: 400, f2: 3000, a: 0.3, d: 0.9, g: 0.3 }),
    shoot: (S, U) => { noise(U, { f: 900, f2: 200, a: 0.002, d: 0.09, g: 0.55 }); tone(U, { f: 190, f2: 65, d: 0.13, g: 0.5 }); noise(U, { type: 'bandpass', f: 1200, f2: 300, q: 2, d: 0.5, g: 0.08, delay: 0.03 }); },
    thud: (S, U) => { tone(U, { f: 95, f2: 45, d: 0.16, g: 0.4 }); noise(U, { f: 500, d: 0.12, g: 0.15 }); },
    hit: (S, U) => { tone(U, { f: 130, f2: 50, d: 0.2, g: 0.55 }); noise(U, { type: 'bandpass', f: 650, q: 1.5, d: 0.16, g: 0.3 }); },
    reload: (S, U) => { noise(U, { type: 'bandpass', f: 1800, q: 5, a: 0.001, d: 0.03, g: 0.2 }); noise(U, { type: 'bandpass', f: 1300, q: 5, a: 0.001, d: 0.04, g: 0.25, delay: 0.45 }); },
    exhale: (S, U) => {      // regulator: gurgling exhale, then a dry hissing inhale
      noise(U, { type: 'bandpass', f: 320, f2: 760, q: 1.4, a: 0.08, d: 1.25, g: 0.26 });
      for (let i = 0; i < 12; i++) tone(U, { f: 420 + Math.random() * 500, f2: 900 + Math.random() * 900, a: 0.004, d: 0.045, g: 0.07, delay: 0.05 + Math.random() * 1.2 });
      noise(U, { type: 'highpass', f: 2400, a: 0.25, d: 1.0, g: 0.05, delay: 1.9 });
    },
    sting: (S, U) => { tone(U, { type: 'sawtooth', f: 900, f2: 200, d: 0.25, g: 0.2 }); noise(U, { type: 'highpass', f: 3000, d: 0.2, g: 0.12 }); },
    bitten: (S, U) => { tone(U, { type: 'sawtooth', f: 70, f2: 38, d: 0.5, g: 0.6 }); noise(U, { f: 600, f2: 120, d: 0.6, g: 0.5 }); },
    alarm: (S, U) => { tone(U, { type: 'square', f: 1250, d: 0.09, g: 0.07 }); tone(U, { type: 'square', f: 1250, d: 0.09, g: 0.07, delay: 0.16 }); },
    click: (S, U) => tone(U, { f: 1500, d: 0.03, g: 0.1 }),
    // ---- under way
    engineStart: (S) => { voice(S, { f: 60, f2: 150, band: 500, q: 1.2, a: 0.05, d: 0.55, g: 0.3, vib: 14 }); noise(S, { type: 'bandpass', f: 300, q: 1, a: 0.3, d: 0.6, g: 0.22, delay: 0.45 }); tone(S, { f: 70, f2: 48, d: 0.4, g: 0.35, delay: 0.5 }); },
    slam: (S, U, X, o) => { const s = o.s || 1; tone(S, { f: 62, f2: 30, a: 0.004, d: 0.4, g: 0.75 * s }); noise(S, { f: 900, f2: 160, a: 0.004, d: 0.5, g: 0.5 * s }); noise(S, { type: 'highpass', f: 2200, a: 0.02, d: 0.9 + s * 0.5, g: 0.16 * s, delay: 0.04 }); },
    spray: (S, U, X, o) => noise(S, { type: 'highpass', f: 1900, a: 0.03, d: 0.55, g: 0.13 * (o.s || 1) }),
    bump: (S) => { tone(S, { type: 'square', f: 105, f2: 55, d: 0.22, g: 0.4 }); noise(S, { type: 'bandpass', f: 420, q: 1.2, a: 0.002, d: 0.3, g: 0.45 }); },
    anchor: (S) => { for (let i = 0; i < 14; i++) noise(S, { type: 'bandpass', f: 2200 + Math.random() * 1600, q: 7, a: 0.001, d: 0.03, g: 0.16, delay: i * 0.075 + Math.random() * 0.03 }); noise(S, { f: 1500, f2: 300, d: 0.5, g: 0.25, delay: 1.1 }); tone(S, { f: 160, f2: 70, d: 0.2, g: 0.2, delay: 1.1 }); },
    // ---- life around the boat
    gull: (S, U, X, o) => {      // three or four falling cries
      const g = 0.16 * near(o.d || 20, 28), n = 3 + Math.floor(Math.random() * 2), base = 1500 + Math.random() * 500;
      for (let i = 0; i < n; i++) voice(S, { f: base * (1 + 0.12 * (i === 0)), f2: base * 0.62, band: 2600, q: 3.5, a: 0.03, d: 0.2 + Math.random() * 0.12, g, delay: i * 0.3 + Math.random() * 0.05, vib: 28 });
    },
    bell: (S, U, X, o) => { const g = 0.3 * near(o.d || 30, 45); [[620, 1.9, 1], [1711, 1.3, 0.5], [3348, 0.7, 0.3], [5520, 0.35, 0.16]].forEach(([f, d, k]) => tone(S, { f, a: 0.002, d, g: g * k })); },
    horn: (S, U, X, o) => { const g = 0.3 * near(o.d || 80, 110); for (const f of [147, 185]) voice(S, { f, band: 420, q: 0.8, a: 0.12, d: 1.5, g }); },
    creak: (S, U, X, o) => voice(S, { f: 62 + Math.random() * 30, f2: 80 + Math.random() * 50, band: 650 + Math.random() * 500, q: 9, a: 0.08, d: 0.5 + Math.random() * 0.5, g: 0.2 * near(o.d || 20, 35), vib: 9 }),
    // ---- finds
    discover: (S, U, X, o) => [784, 988, 1175, 1568].forEach((f, i) => { tone(X, { f, a: 0.004, d: 0.7, g: 0.13, delay: o.delay + i * 0.11 }); tone(X, { f: f * 2, a: 0.004, d: 0.35, g: 0.04, delay: o.delay + i * 0.11 }); }),
    pickup: (S, U) => { tone(U, { f: 520, f2: 900, a: 0.004, d: 0.1, g: 0.25 }); for (let i = 0; i < 4; i++) tone(U, { f: 700 + Math.random() * 900, f2: 1500 + Math.random() * 800, a: 0.003, d: 0.04, g: 0.06, delay: 0.06 + Math.random() * 0.25 }); },
    treasure: (S, U, X) => { tone(U, { f: 110, f2: 60, d: 0.25, g: 0.4 }); for (let i = 0; i < 12; i++) tone(X, { f: 2200 + Math.random() * 2600, a: 0.002, d: 0.18 + Math.random() * 0.2, g: 0.05, delay: 0.1 + Math.random() * 0.8 }); },
    ink: (S, U) => noise(U, { f: 520, f2: 140, a: 0.03, d: 0.7, g: 0.3 }),
    whale: (S, U) => { const f = 150 + Math.random() * 90; tone(U, { f, f2: f * 1.9, a: 0.6, d: 1.6, g: 0.05 }); tone(U, { f: f * 1.9, f2: f * 1.25, a: 0.3, d: 1.8, g: 0.045, delay: 1.9 }); },
    dexOpen: (S, U, X) => { tone(X, { f: 660, d: 0.08, g: 0.09 }); tone(X, { f: 990, d: 0.1, g: 0.08, delay: 0.07 }); },
    dexClose: (S, U, X) => { tone(X, { f: 990, d: 0.08, g: 0.08 }); tone(X, { f: 660, d: 0.1, g: 0.08, delay: 0.07 }); },
  };

  const Audio = (DB.Audio = {
    ready: false, scene: 'title', t: 0, slapT: 2, clickT: 0, beatT: 0, gullT: 4, bellT: 3, hornT: 30, creakT: 3, whaleT: 35, swimT: 0, vol: 0.8, names: Object.keys(SOUNDS),
    init() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = this.vol;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5;
      master.connect(comp).connect(ctx.destination);
      surf = ctx.createGain(); under = ctx.createGain(); surf.gain.value = 0; under.gain.value = 0; surf.connect(master); under.connect(master);
      const n = ctx.sampleRate * 2; noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      // beds
      this.sea = loopNoise(surf, 'lowpass', 520, 0.4, 0.2); this.hiss = loopNoise(surf, 'bandpass', 1700, 0.5, 0.035); this.wind = loopNoise(surf, 'bandpass', 380, 0.9, 0.05);
      this.rumble = loopNoise(under, 'lowpass', 150, 0.6, 0.5); this.uwmid = loopNoise(under, 'bandpass', 520, 0.8, 0.04);
      this.rush = loopNoise(surf, 'bandpass', 950, 0.5, 0);      // water tearing past the hull
      // reel clicker: square wave through a resonant band = ratchet / drag scream
      this.reelOsc = ctx.createOscillator(); this.reelOsc.type = 'square'; this.reelOsc.frequency.value = 30;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2700; bp.Q.value = 2.5;
      this.reelGain = ctx.createGain(); this.reelGain.gain.value = 0; this.reelOsc.connect(hp).connect(bp).connect(this.reelGain).connect(surf); this.reelOsc.start();
      // line whine at high tension
      this.whine = ctx.createOscillator(); this.whine.type = 'sine'; this.whine.frequency.value = 900; this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0; this.whine.connect(this.whineGain).connect(surf); this.whine.start();
      // shark drone
      this.drone = ctx.createOscillator(); this.drone.type = 'sawtooth'; this.drone.frequency.value = 46; const df = ctx.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 140;
      this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0; this.drone.connect(df).connect(this.droneGain).connect(under); this.drone.start();
      // twin diesels: two detuned saws + their octave through a low-pass that opens with the revs, heard on both buses
      this.eng = [0, 1, 2].map((i) => { const o = ctx.createOscillator(); o.type = i === 2 ? 'square' : 'sawtooth'; o.frequency.value = 40; return o; });
      this.engFlt = ctx.createBiquadFilter(); this.engFlt.type = 'lowpass'; this.engFlt.frequency.value = 300; this.engFlt.Q.value = 1.2;
      this.engGain = ctx.createGain(); this.engGain.gain.value = 0; this.engUnder = ctx.createGain(); this.engUnder.gain.value = 0;
      for (const o of this.eng) { o.connect(this.engFlt); o.start(); }
      this.engFlt.connect(this.engGain).connect(surf); this.engFlt.connect(this.engUnder).connect(under);
      this.ready = true;
      this.setScene(this.scene);
    },
    setScene(s) {
      this.scene = s; if (!this.ready) return;
      const t = now();
      surf.gain.cancelScheduledValues(t); under.gain.cancelScheduledValues(t);
      surf.gain.setTargetAtTime(s === 'dive' ? 0 : s === 'title' ? 0.55 : 1, t, 0.25);
      under.gain.setTargetAtTime(s === 'dive' ? 1 : 0, t, 0.2);
    },
    suspend(on) { if (ctx) (on ? ctx.suspend() : ctx.resume()); },

    // p: { reel, out, tension, shark, o2,  engine (0 off .. 1 running), thr, spd (m/s), air,  gull / buoy / ship / trawler distances (m), excited, swim (m/s) }
    update(dt, p) {
      if (!this.ready) return;
      this.t += dt; const t = now(), spd = p.spd || 0;
      this.sea.gn.gain.setTargetAtTime(0.16 + 0.07 * Math.sin(this.t * 0.7) + 0.05 * Math.sin(this.t * 0.23), t, 0.3);
      this.sea.flt.frequency.setTargetAtTime(460 + 160 * Math.sin(this.t * 0.31), t, 0.4);
      const out = p.out || 0, reel = p.reel || 0;
      const g = out > 0.3 ? Math.min(0.05 + out * 0.012, 0.13) : reel > 0.05 ? 0.035 : 0;
      this.reelGain.gain.setTargetAtTime(g, t, 0.03);
      this.reelOsc.frequency.setTargetAtTime(out > 0.3 ? 45 + out * 13 : 16 + reel * 16, t, 0.04);
      const hi = M.sat(((p.tension || 0) - 0.8) / 0.2);
      this.whineGain.gain.setTargetAtTime(hi * 0.035, t, 0.05); this.whine.frequency.setTargetAtTime(820 + hi * 520 + Math.sin(this.t * 31) * 22, t, 0.03);
      // engines: revs follow the throttle, race when the props come out of the water
      const run = p.engine || 0, rev = M.sat(0.12 + 0.75 * Math.abs(p.thr || 0) + spd * 0.012 + (p.air ? 0.35 : 0)), f0 = 30 + rev * 62 + Math.sin(this.t * 23) * 0.6;
      this.eng[0].frequency.setTargetAtTime(f0, t, 0.08); this.eng[1].frequency.setTargetAtTime(f0 * 1.012 + 0.7, t, 0.08); this.eng[2].frequency.setTargetAtTime(f0 * 2.003, t, 0.08);
      this.engFlt.frequency.setTargetAtTime(210 + rev * 1500, t, 0.1);
      this.engGain.gain.setTargetAtTime(run * (0.05 + rev * 0.1), t, 0.15); this.engUnder.gain.setTargetAtTime(run * (0.03 + rev * 0.06), t, 0.3);
      this.rush.gn.gain.setTargetAtTime(Math.min(spd * 0.014, 0.2), t, 0.2); this.rush.flt.frequency.setTargetAtTime(700 + spd * 60, t, 0.2);
      this.wind.gn.gain.setTargetAtTime(0.05 + Math.min(spd * 0.009, 0.12), t, 0.3); this.wind.flt.frequency.setTargetAtTime(380 + spd * 28, t, 0.3);
      if (this.scene === 'boat') {
        this.slapT -= dt;
        if (this.slapT <= 0) { this.slapT = 1.6 + Math.random() * 3.2; noise(surf, { f: 700, f2: 180, d: 0.5, g: 0.16 + Math.random() * 0.12 }); tone(surf, { f: 85, f2: 50, d: 0.2, g: 0.12 }); }
        // gulls overhead, the reef buoy's bell, the trawler's horn, the galleon's timbers
        if ((this.gullT -= dt) <= 0) { this.gullT = (p.excited ? 1.5 : 5) + Math.random() * (p.excited ? 3 : 12); if (p.gull < 90) this.play('gull', { d: p.gull }); }
        if ((this.bellT -= dt) <= 0) { this.bellT = 2.4 + Math.random() * 4; if (p.buoy < 220) this.play('bell', { d: p.buoy }); }
        if ((this.hornT -= dt) <= 0) { this.hornT = 45 + Math.random() * 60; if (p.trawler < 260) this.play('horn', { d: p.trawler }); }
        if ((this.creakT -= dt) <= 0) { this.creakT = 2.5 + Math.random() * 5; if (p.ship < 90) this.play('creak', { d: p.ship }); }
      } else if (this.scene === 'dive') {
        this.clickT -= dt;       // snapping shrimp crackle
        if (this.clickT <= 0) { this.clickT = 0.05 + Math.random() * 0.25; noise(under, { type: 'bandpass', f: 3500 + Math.random() * 3000, q: 6, a: 0.001, d: 0.012, g: 0.02 + Math.random() * 0.03 }); }
        const sh = p.shark ? M.sat(1 - p.shark / 18) : 0;
        this.droneGain.gain.setTargetAtTime(sh * 0.3, t, 0.5); this.drone.frequency.setTargetAtTime(44 + sh * 10, t, 0.5);
        const stress = Math.max(sh, p.o2 < 0.25 ? 1 - p.o2 / 0.25 : 0);
        if (stress > 0.05) { this.beatT -= dt; if (this.beatT <= 0) { this.beatT = 1.05 - stress * 0.5; tone(under, { f: 62, f2: 42, d: 0.12, g: 0.5 * stress + 0.15 }); tone(under, { f: 58, f2: 40, d: 0.1, g: 0.35 * stress + 0.1, delay: 0.16 }); } }
        if ((this.whaleT -= dt) <= 0) { this.whaleT = 45 + Math.random() * 70; this.play('whale'); }      // something very large, very far away
        if ((p.swim || 0) > 1.2 && (this.swimT -= dt) <= 0) { this.swimT = 0.5 + Math.random() * 0.5; noise(under, { type: 'bandpass', f: 260, f2: 520, q: 1, a: 0.08, d: 0.3, g: 0.05 + p.swim * 0.02 }); }      // fin strokes
      }
    },

    play(name, o = {}) {
      if (!this.ready || !SOUNDS[name]) return;
      SOUNDS[name](surf, under, master, { s: o.s, delay: o.delay || 0, d: o.d });
    },

    // every sound rendered offline: [{ name, peak }] — the self-test checks none is silent or broken (it cannot judge how they sound)
    async probe() {
      const OAC = window.OfflineAudioContext; if (!OAC) return [];
      const live = { ctx, master, surf, under, noiseBuf }, res = [], wasReady = this.ready;
      this.ready = false;      // the live graph sits out while the module's buses point at the offline context
      for (const name of this.names) {
        const oc = new OAC(1, 44100 * 4, 44100); let err = '';
        ctx = oc; master = surf = under = oc.destination;
        noiseBuf = oc.createBuffer(1, 44100 * 2, 44100); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        try { SOUNDS[name](surf, under, master, { s: 1, delay: 0, d: 10 }); } catch (e) { err = String(e.message || e); }
        const buf = (await oc.startRendering()).getChannelData(0); let peak = 0, bad = false;
        for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (!(v <= 1e9)) bad = true; else if (v > peak) peak = v; }
        res.push({ name, peak: +peak.toFixed(3), ok: !err && !bad && peak > 0.004, err });
      }
      ({ ctx, master, surf, under, noiseBuf } = live); this.ready = wasReady;
      return res;
    },
  });
})();
