// Project Deep Blue — boat: procedural sport-fisher, wave-following buoyancy, sun/shadow rig, live fish finder.
(function () {
  'use strict';
  const DB = window.DB, T = THREE, M = DB.M, G = DB.G;
  const V3 = (x, y, z) => new T.Vector3(x, y, z);

  // hull lines — boat-local: +x starboard, +y up, +z aft. deck sole y=0, design waterline y=-0.72
  const WL = -0.72;
  const HB = (z) => 1.55 * (1 - Math.pow(M.sat((-z - 0.6) / 5.0), 2.3));     // half beam at sheer
  const YS = (z) => 0.74 + 0.38 * Math.pow(M.sat((-z + 1) / 6.6), 1.5);       // sheer height
  const YC = (z) => -0.85 + 0.98 * Math.pow(M.sat((-z - 1.5) / 4.1), 2);      // chine height
  const HC = (z) => HB(z) * 0.88;                                              // chine half beam
  const YK = (z) => -1.28 + 1.25 * Math.pow(M.sat((-z - 2.4) / 3.2), 2.2);    // keel

  function grid(rows, uvFn) {
    const n = rows.length, m = rows[0].length, pos = new Float32Array(n * m * 3), uv = new Float32Array(n * m * 2), idx = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      const p = rows[i][j], o = i * m + j;
      pos[o * 3] = p.x; pos[o * 3 + 1] = p.y; pos[o * 3 + 2] = p.z;
      const t = uvFn ? uvFn(p) : [j / (m - 1), i / (n - 1)];
      uv[o * 2] = t[0]; uv[o * 2 + 1] = t[1];
    }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < m - 1; j++) { const a = i * m + j, b = a + 1, c = a + m, d = c + 1; idx.push(a, b, c, b, d, c); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  const mirrorX = (g) => { const c = g.clone(); c.scale(-1, 1, 1); c.computeVertexNormals(); return c; };

  // ------------------------------------------------------------------ textures
  function teakRailTex() {
    return DB.canvasTex(1024, 128, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#a96a33'); g.addColorStop(0.5, '#96592a'); g.addColorStop(1, '#a86933');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      const r = M.rng(9);
      for (let i = 0; i < 700; i++) {
        const y = r() * h, len = 80 + r() * 520, x = r() * w, dark = r() < 0.72;
        c.strokeStyle = dark ? `rgba(${(36 + r() * 36) | 0},${(18 + r() * 18) | 0},${(4 + r() * 10) | 0},${0.05 + r() * 0.17})` : `rgba(255,205,140,${0.03 + r() * 0.06})`;
        c.lineWidth = 0.5 + r() * 1.8;
        for (const ox of [0, -w]) {
          c.beginPath(); c.moveTo(x + ox, y);
          c.bezierCurveTo(x + ox + len * 0.33, y + (r() - 0.5) * 6, x + ox + len * 0.66, y + (r() - 0.5) * 6, x + ox + len, y + (r() - 0.5) * 4);
          c.stroke();
        }
      }
    }, { aniso: 16 });
  }
  function teakDeckTex() {
    return DB.canvasTex(512, 512, (c, w, h) => {
      const r = M.rng(21), pw = w / 8;
      for (let p = 0; p < 8; p++) {
        const t = r();
        c.fillStyle = `rgb(${(168 + t * 26) | 0},${(138 + t * 24) | 0},${(101 + t * 22) | 0})`;
        c.fillRect(p * pw, 0, pw, h);
        for (let i = 0; i < 70; i++) {
          const x = p * pw + 4 + r() * (pw - 8), y = r() * h, len = 40 + r() * 260;
          c.strokeStyle = r() < 0.7 ? `rgba(70,48,26,${0.04 + r() * 0.12})` : `rgba(255,240,215,${0.04 + r() * 0.07})`;
          c.lineWidth = 0.6 + r() * 1.4;
          for (const oy of [0, -h]) { c.beginPath(); c.moveTo(x, y + oy); c.lineTo(x + (r() - 0.5) * 3, y + oy + len); c.stroke(); }
        }
        const jy = r() * h; c.fillStyle = '#1b1713'; c.fillRect(p * pw, jy, pw, 3);       // butt joint
      }
      c.fillStyle = '#16130f';
      for (let p = 0; p < 8; p++) c.fillRect(p * pw - 2.5, 0, 5, h);                      // caulking
      c.fillRect(w - 2.5, 0, 2.5, h);
    }, { aniso: 16 });
  }
  function nonskidTex() {      // subtle diamond grip pattern (used as bump)
    return DB.canvasTex(128, 128, (c, w, h) => {
      c.fillStyle = '#808080'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#b8b8b8';
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { c.beginPath(); c.arc(x * 16 + (y % 2 ? 8 : 0) + 4, y * 16 + 8, 4.2, 0, 7); c.fill(); }
    }, { srgb: false });
  }

  // ------------------------------------------------------------------ fish finder
  const Finder = {
    W: 512, H: 320, SX: 286, SW: 226, SH: 290, acc: 0, arches: [], range: 30, depth: 12, clock: 13 * 60 + 42,
    init() {
      this.canvas = document.createElement('canvas'); this.canvas.width = this.W; this.canvas.height = this.H;
      this.ctx = this.canvas.getContext('2d');
      this.sonar = document.createElement('canvas'); this.sonar.width = this.SW; this.sonar.height = this.SH;
      this.sctx = this.sonar.getContext('2d');
      const g = this.sctx.createLinearGradient(0, 0, 0, this.SH); g.addColorStop(0, '#0b2350'); g.addColorStop(1, '#030a1c');
      this.bg = g; this.sctx.fillStyle = g; this.sctx.fillRect(0, 0, this.SW, this.SH);
      this.tex = new T.CanvasTexture(this.canvas); this.tex.colorSpace = T.SRGBColorSpace; this.tex.anisotropy = 8;
      this.buildChart();
      for (let i = 0; i < 90; i++) this.column(11 + Math.sin(i * 0.13) * 1.5, 0.5);      // pre-roll history
      this.compose({ x: 0, z: 0, heading: 0, speed: 0 });
    },
    buildChart() {
      const cw = 280, ch = 296, s = 1.7;           // metres per pixel
      const cv = (this.chart = document.createElement('canvas')); cv.width = cw; cv.height = ch;
      const c = cv.getContext('2d'), img = c.createImageData(cw, ch), d = img.data;
      const bands = [8, 12, 16, 22, 30, 45, 65], cols = [[232, 246, 240], [212, 238, 240], [190, 228, 238], [166, 212, 234], [140, 192, 226], [116, 170, 214], [96, 148, 200], [78, 126, 186]];
      const band = new Uint8Array(cw * ch);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const dep = DB.World.depth((x - cw / 2) * s, (y - ch / 2) * s);
        let b = 0; while (b < bands.length && dep > bands[b]) b++;
        band[y * cw + x] = b;
      }
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const i = y * cw + x, b = band[i], edge = (x > 0 && band[i - 1] !== b) || (y > 0 && band[i - cw] !== b);
        const col = cols[b], k = edge ? 0.62 : 1;
        d[i * 4] = col[0] * k; d[i * 4 + 1] = col[1] * k; d[i * 4 + 2] = col[2] * k; d[i * 4 + 3] = 255;
      }
      c.putImageData(img, 0, 0);
      c.font = '9px Arial'; c.fillStyle = 'rgba(20,50,110,0.85)'; c.textAlign = 'center';
      for (let y = 26; y < ch; y += 44) for (let x = 24; x < cw; x += 50) {
        const dep = DB.World.depth((x - cw / 2) * s, (y - ch / 2) * s);
        c.fillText(dep.toFixed(dep < 20 ? 1 : 0), x, y);
      }
      this.chartScale = s;
    },
    addArch(depth, size = 1) { this.arches.push({ depth, size, t: 0, dur: 1.8 + Math.random() * 1.6 }); },
    column(depth, dt) {
      const c = this.sctx, W = this.SW, H = this.SH, step = 3;
      c.drawImage(this.sonar, -step, 0);
      const x = W - step;
      c.fillStyle = this.bg; c.fillRect(x, 0, step, H);
      const want = depth < 24 ? 30 : depth < 50 ? 60 : depth < 100 ? 120 : 240;
      if (want !== this.range) { this.range = want; c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x, 0, 1, H); }
      const R = this.range, py = (m) => (m / R) * H;
      for (let y = 0; y < 7; y++) { c.fillStyle = Math.random() < 0.6 ? '#ffe04a' : '#ff5a2a'; if (Math.random() < 0.9 - y * 0.1) c.fillRect(x, y, step, 1); }   // surface clutter
      for (let i = 0; i < 5; i++) { c.fillStyle = `rgba(90,200,255,${0.15 + Math.random() * 0.3})`; c.fillRect(x + Math.random() * step, 8 + Math.random() * Math.max(py(depth) - 12, 4), 1, 1); }
      for (const a of this.arches) {            // fish returns draw as arches over time
        const p = a.t / a.dur, yy = py(a.depth + a.size * 1.5 * (2 * p - 1) * (2 * p - 1)), th = 1.5 + a.size * 3.2 * Math.sin(Math.PI * p);
        c.fillStyle = '#3ad86a'; c.fillRect(x, yy - th * 0.5 - 1, step, th + 2);
        c.fillStyle = '#ffd23a'; c.fillRect(x, yy - th * 0.5, step, th);
        if (a.size > 0.8) { c.fillStyle = '#ff4a22'; c.fillRect(x, yy - th * 0.22, step, th * 0.44); }
        a.t += dt;
      }
      this.arches = this.arches.filter((a) => a.t < a.dur);
      const yb = py(depth);
      if (yb < H) {
        const rough = Math.random() * 2;
        c.fillStyle = '#ff2415'; c.fillRect(x, yb, step, 5 + rough);
        c.fillStyle = '#ff8a1e'; c.fillRect(x, yb + 5 + rough, step, 4);
        c.fillStyle = '#ffd83a'; c.fillRect(x, yb + 9 + rough, step, 4);
        for (let y = yb + 13 + rough; y < Math.min(H, yb + 70); y += 2) {
          const k = 1 - (y - yb - 13) / 57;
          c.fillStyle = `rgba(${(60 * k) | 0},${(190 * k + Math.random() * 30) | 0},${(120 + 80 * k) | 0},${0.75 * k})`; c.fillRect(x, y, step, 2);
        }
        const y2 = py(depth * 2); if (y2 < H) { c.fillStyle = 'rgba(255,170,40,0.28)'; c.fillRect(x, y2, step, 3); }      // second echo
      }
    },
    compose(st) {
      const c = this.ctx, W = this.W, H = this.H;
      c.fillStyle = '#05070a'; c.fillRect(0, 0, W, H);
      // chart
      c.save(); c.beginPath(); c.rect(2, 22, 280, 296); c.clip();
      const s = this.chartScale, ox = 142 - st.x / s, oy = 170 - st.z / s;
      c.drawImage(this.chart, ox - 140, oy - 148);
      c.strokeStyle = 'rgba(190,40,40,0.75)'; c.setLineDash([4, 3]); c.lineWidth = 1; c.beginPath(); c.arc(142, 170, 34, 0, 7); c.stroke(); c.setLineDash([]);
      c.translate(142, 170); c.rotate(-st.heading);
      c.strokeStyle = '#c81e1e'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(0, -8); c.lineTo(0, -46); c.stroke();
      c.fillStyle = '#16181c'; c.beginPath(); c.moveTo(0, -10); c.lineTo(5.5, 7); c.lineTo(0, 4); c.lineTo(-5.5, 7); c.closePath(); c.fill();
      c.restore();
      c.fillStyle = '#c81e1e'; c.font = 'bold 10px Arial'; c.textAlign = 'left'; c.fillText('⚑ REEF', 142 + (6 - st.x) / s + 6, 170 + (-8 - st.z) / s);
      c.fillStyle = 'rgba(10,20,40,0.78)'; c.fillRect(6, 292, 84, 20);
      c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(12, 306); c.lineTo(12 + 50 / s, 306); c.stroke();
      c.fillStyle = '#fff'; c.font = '10px Arial'; c.fillText('50 m', 16 + 50 / s, 309);
      // sonar
      c.drawImage(this.sonar, this.SX, 26);
      c.strokeStyle = 'rgba(255,255,255,0.5)'; c.fillStyle = '#e8f2ff'; c.font = '10px Arial'; c.textAlign = 'right'; c.lineWidth = 1;
      for (let i = 0; i <= 3; i++) {
        const y = 26 + (i / 3) * this.SH;
        c.beginPath(); c.moveTo(W - 8, y); c.lineTo(W, y); c.stroke();
        c.fillText(((this.range * i) / 3).toFixed(0), W - 10, Math.min(Math.max(y + 3, 36), H - 4));
      }
      c.textAlign = 'left'; c.lineJoin = 'round';
      c.font = 'bold 34px Arial'; c.strokeStyle = '#000'; c.lineWidth = 4;
      const ds = this.depth.toFixed(1);
      c.strokeText(ds, this.SX + 8, 62); c.fillStyle = '#fff'; c.fillText(ds, this.SX + 8, 62);
      c.font = 'bold 13px Arial'; const dw = c.measureText(ds).width * 2.62;
      c.lineWidth = 3; c.strokeText('m', this.SX + 10 + dw, 62); c.fillText('m', this.SX + 10 + dw, 62);
      c.font = '11px Arial'; c.lineWidth = 3;
      const l2 = `24.6°C   ${(st.speed * 1.944).toFixed(1)} kn`;
      c.strokeText(l2, this.SX + 9, 78); c.fillStyle = '#cfe6ff'; c.fillText(l2, this.SX + 9, 78);
      // header + divider
      c.fillStyle = '#10151c'; c.fillRect(0, 0, W, 22); c.fillRect(282, 22, 4, H);
      c.fillStyle = '#9fd0ff'; c.font = 'bold 11px Arial'; c.fillText('CHART', 8, 15); c.fillText('SONAR 200kHz', this.SX + 6, 15);
      c.fillStyle = '#e6edf5'; c.font = '11px Arial'; c.textAlign = 'right';
      const hh = Math.floor(this.clock / 60) % 24, mm = Math.floor(this.clock % 60);
      c.fillText(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, W - 8, 15);
      c.textAlign = 'center'; c.fillStyle = '#b9c4d0';
      c.fillText(`33°14.${String(520 + Math.round(-st.z)).padStart(3, '0')}'N  126°33.${String(180 + Math.round(st.x)).padStart(3, '0')}'E`, 170, 15);
      this.tex.needsUpdate = true;
    },
    tick(dt, st) {
      this.acc += dt; this.clock += dt / 60;
      if (this.acc < 0.12) return;
      this.depth = M.lerp(this.depth, st.depth, 0.5);
      this.column(st.depth, this.acc);
      this.compose(st);
      this.acc = 0;
    },
  };

  // ------------------------------------------------------------------ boat
  const Boat = (DB.Boat = {
    Finder, WL, group: new T.Group(), eyeLocal: V3(-0.3, 1.62, 2.5), speed: 0, heading: 0,
    vy: 0, vp: 0, vr: 0, pitch: 0, roll: 0, y: -WL, t: 0, anchor: V3(0, 0, 0),
    mode: 'anchor', u: 0, vs: 0, yawRate: 0, throttle: 0, rudder: 0, headBase: 0, air: 0, slam: 0, slopeFwd: 0, colliders: [],
    _p: { x: 0, z: 0 }, _sw: { x: 0, z: 0, h: 0 }, _v: V3(), _h: [], _spray: 0, _bumpT: -9, _bowT: -9,
    // buoyancy sample points: [x, z, share of the weight] (shares balance about the centre of gravity)
    PTS: [[0, -4.3, 0.2133], [-1.25, -0.8, 0.2], [1.25, -0.8, 0.2], [-1.05, 3.2, 0.1933], [1.05, 3.2, 0.1933]],
    HB, YS,

    init(scene, env) {
      this.env = env;
      Finder.init();
      const mats = (this.mats = this.makeMaterials());
      const P = { gel: [], hull: [], bottom: [], stripe: [], teak: [], deck: [], steel: [], black: [], glass: [], vinyl: [], rubber: [], alu: [], tank: [], gold: [] };

      // --- hull shell
      const zs = []; for (let z = 4.0; z > -5.61; z -= 0.4) zs.push(Math.max(z, -5.6));
      const bottom = [], boot = [], top = [];
      for (const z of zs) {
        const hb = HB(z), hc = HC(z), yk = YK(z), yc = YC(z), ys = YS(z);
        const tp = (s) => V3(hc + (hb - hc) * Math.pow(s, 0.8), yc + (ys - yc) * s, z);
        bottom.push([V3(0, yk, z), V3(hc * 0.5, M.lerp(yk, yc, 0.5) - 0.035 * hc, z), V3(hc, yc, z)]);
        boot.push([tp(0), tp(0.1), tp(0.2)]);
        top.push([tp(0.2), tp(0.45), tp(0.72), tp(1)]);
      }
      for (const [rows, key] of [[bottom, 'bottom'], [boot, 'stripe'], [top, 'hull']]) { const g = grid(rows); P[key].push(g, mirrorX(g)); }
      const zt = 4.0, tr = new T.Shape([new T.Vector2(-HB(zt), YS(zt)), new T.Vector2(HB(zt), YS(zt)), new T.Vector2(HC(zt), YC(zt)), new T.Vector2(0, YK(zt)), new T.Vector2(-HC(zt), YC(zt))]);
      P.hull.push(G.xf(new T.ShapeGeometry(tr), [0, 0, zt]));

      // --- cockpit liner: sole, inner walls, transom wall
      const sole = [], wallS = [], zc = [];
      for (let z = -1.2; z <= 3.76; z += 0.45) zc.push(Math.min(z, 3.75));
      for (const z of zc) {
        const w = HB(z) - 0.2;
        sole.push([V3(-w, 0, z), V3(w, 0, z)]);
        wallS.push([V3(w, 0, z), V3(w + 0.012, YS(z) * 0.5, z), V3(w, YS(z) - 0.004, z)]);
      }
      P.deck.push(grid(sole, (p) => [p.x / 0.56, p.z / 0.56]));
      const ws = grid(wallS); P.gel.push(ws, mirrorX(ws));
      const wt = HB(3.75) - 0.2;
      P.gel.push(grid([[V3(-wt, 0, 3.75), V3(wt, 0, 3.75)], [V3(-wt, YS(3.75), 3.75), V3(wt, YS(3.75), 3.75)]]));
      // cove moulding where sole meets walls
      P.gel.push(G.xf(G.box(wt * 2, 0.03, 0.03), [0, 0.015, 3.735]));

      // --- foredeck + house
      const fd = [];
      for (let z = -1.2; z > -5.56; z -= 0.4) { const w = Math.max(HB(z) - 0.03, 0.01), y = YS(z) - 0.012; fd.push([V3(-w, y, z), V3(0, y + 0.05, z), V3(w, y, z)]); }
      P.gel.push(grid(fd));
      P.gel.push(G.xf(G.rbox(2.56, 1.3, 3.0, 0.16), [0, YS(-2.7) + 0.62, -2.72]));                      // cabin house
      P.gel.push(G.xf(G.rbox(2.72, 2.02, 0.09, 0.03), [0, 1.01, -1.2]));                                // helm bulkhead
      P.glass.push(G.xf(G.rbox(0.64, 1.5, 0.03, 0.012), [-0.12, 0.84, -1.146]));                        // companionway door
      P.glass.push(G.xf(G.rbox(0.9, 0.4, 0.03, 0.012), [0.78, 1.66, -1.146]));
      P.glass.push(G.xf(G.rbox(2.3, 0.42, 0.04, 0.015), [0, 1.86, -4.2], [-0.5, 0, 0]));                 // windshield
      P.glass.push(G.xf(G.rbox(0.03, 0.36, 2.2, 0.012), [1.285, 1.72, -2.7]), G.xf(G.rbox(0.03, 0.36, 2.2, 0.012), [-1.285, 1.72, -2.7]));
      P.steel.push(G.xf(G.cyl(0.012, 0.012, 0.16, 8), [-0.38, 0.9, -1.12], [0, 0, 0]));                 // door handle

      // --- hardtop, legs, rocket launcher with spare rods, outriggers, antennas
      P.gel.push(G.xf(G.rbox(2.86, 0.07, 2.5, 0.03), [0, 2.115, -0.18]));
      for (const sx of [-1, 1]) {
        P.steel.push(G.tube([V3(sx * 1.3, 2.09, 0.95), V3(sx * 1.36, 1.5, 1.02), V3(sx * 1.44, YS(1.05) + 0.03, 1.05)], 0.024, 10));
        P.steel.push(G.tube([V3(sx * 1.3, 2.09, 0.2), V3(sx * 1.36, 1.5, 0.3), V3(sx * 1.44, YS(0.4) + 0.03, 0.42)], 0.02, 10));
        P.alu.push(G.tube([V3(sx * 1.4, 2.16, -0.5), V3(sx * 2.25, 3.7, 0.25), V3(sx * 3.05, 5.2, 1.0)], 0.014, 6));     // outrigger
        P.alu.push(G.xf(G.cyl(0.004, 0.008, 2.6, 6), [sx * 0.9, 3.45, -1.0], [0.06, 0, sx * -0.03]));                     // whip antenna
      }
      P.gel.push(G.xf(G.cyl(0.27, 0.3, 0.2, 24), [0, 2.25, -0.95]));                                    // radar dome
      for (let i = 0; i < 5; i++) {
        const x = -1.0 + i * 0.5;
        P.steel.push(G.xf(G.cyl(0.03, 0.03, 0.3, 12, true), [x, 2.24, 0.98], [0.42, 0, 0]));
        if (i === 1 || i === 2 || i === 4) {
          const rod = [G.xf(G.cyl(0.004, 0.011, 1.75, 8), [0, 1.3, 0]), G.xf(G.cyl(0.016, 0.017, 0.52, 10), [0, 0.2, 0])];
          P.black.push(...rod.map((g) => G.xf(g, [x, 2.14, 0.94], [0.42, 0, 0])));
          P.gold.push(G.xf(G.xf(G.cyl(0.042, 0.042, 0.075, 16), [0, 0.5, 0.05], [0, 0, Math.PI / 2]), [x, 2.14, 0.94], [0.42, 0, 0]));
        }
      }

      // --- helm: dash, wheel, throttles, seat
      P.gel.push(G.xf(G.rbox(0.98, 0.34, 0.3, 0.04), [0.74, 1.05, -1.0], [0.35, 0, 0]));
      P.glass.push(G.xf(G.rbox(0.34, 0.2, 0.02, 0.008), [0.56, 1.13, -0.855], [0.35, 0, 0]));
      const wheel = [G.torus(0.185, 0.013, 8, 28), G.xf(G.cyl(0.035, 0.035, 0.03, 14), [0, 0, 0], [Math.PI / 2, 0, 0])];
      for (let i = 0; i < 3; i++) wheel.push(G.xf(G.cyl(0.008, 0.008, 0.185, 6), [Math.sin((i * 2 * Math.PI) / 3) * 0.092, Math.cos((i * 2 * Math.PI) / 3) * 0.092, 0], [0, 0, (-i * 2 * Math.PI) / 3]));
      this.wheel = new T.Mesh(G.merge(wheel), mats.steel);      // its own mesh: it turns with the rudder
      this.wheel.position.set(0.92, 1.1, -0.79); this.wheel.rotation.set(-0.5, 0, 0); this.wheel.castShadow = true; this.group.add(this.wheel);
      P.steel.push(G.xf(G.cyl(0.012, 0.012, 0.17, 8), [1.22, 1.2, -0.92], [0.5, 0, 0]), G.xf(G.cyl(0.012, 0.012, 0.17, 8), [1.27, 1.2, -0.92], [0.3, 0, 0]));
      P.black.push(G.xf(G.sph(0.022, 10, 8), [1.22, 1.275, -0.88]), G.xf(G.sph(0.022, 10, 8), [1.27, 1.28, -0.895]));
      // leaning post behind the helm (the skipper stands at the wheel)
      for (const lx of [0.66, 1.16]) P.steel.push(G.xf(G.cyl(0.022, 0.022, 0.92, 10), [lx, 0.46, 0.12]));
      P.vinyl.push(G.xf(G.rbox(0.62, 0.17, 0.22, 0.06), [0.91, 0.99, 0.12]));

      // --- dive tanks, cooler, cleats, rod holders, swim platform + ladder
      for (const tx of [-1.02, -0.8]) {
        P.tank.push(G.xf(G.cyl(0.092, 0.092, 0.56, 20), [tx, 0.3, -0.98]), G.xf(G.sph(0.092, 20, 10), [tx, 0.58, -0.98], null, [1, 0.7, 1]));
        P.black.push(G.xf(G.cyl(0.03, 0.035, 0.07, 10), [tx, 0.67, -0.98]), G.xf(G.cyl(0.096, 0.096, 0.07, 20), [tx, 0.04, -0.98]), G.xf(G.cyl(0.014, 0.014, 0.1, 8), [tx + 0.04, 0.7, -0.98], [0, 0, 1.57]));
      }
      P.black.push(G.xf(G.rbox(0.5, 0.05, 0.05, 0.015), [-0.91, 0.42, -0.87]));
      P.vinyl.push(G.xf(G.rbox(0.47, 0.4, 0.84, 0.05), [1.03, 0.2, 1.2]), G.xf(G.rbox(0.49, 0.07, 0.86, 0.03), [1.03, 0.435, 1.2]));
      P.black.push(G.xf(G.box(0.012, 0.07, 0.05), [0.785, 0.39, 0.95]), G.xf(G.box(0.012, 0.07, 0.05), [0.785, 0.39, 1.45]));
      for (const sx of [-1, 1]) {
        const cy = YS(3.86) + 0.045;
        P.steel.push(G.xf(G.cap(0.011, 0.15, 8), [sx * 1.12, cy + 0.045, 3.875], [0, 0, Math.PI / 2]), G.xf(G.cyl(0.011, 0.014, 0.04, 8), [sx * 1.07, cy + 0.02, 3.875]), G.xf(G.cyl(0.011, 0.014, 0.04, 8), [sx * 1.17, cy + 0.02, 3.875]));
        for (const z of [0.95, 2.25]) {
          const hy = YS(z) + 0.048, hx = sx * (HB(z) - 0.1);
          P.steel.push(G.xf(G.torus(0.034, 0.008, 8, 20), [hx, hy, z], [Math.PI / 2, 0, 0]));
          P.black.push(G.xf(G.cyl(0.03, 0.03, 0.004, 16), [hx, hy - 0.004, z]));
        }
      }
      const plat = G.rbox(2.3, 0.05, 0.56, 0.02); { const a = plat.attributes.uv; for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * 4.1, a.getY(i)); }
      P.deck.push(G.xf(plat, [0, -0.44, 4.3]));
      for (const lx of [-0.24, 0.24]) P.steel.push(G.tube([V3(lx, -0.2, 4.56), V3(lx, -0.3, 4.6), V3(lx, -0.8, 4.61), V3(lx, -1.7, 4.61)], 0.016, 8));
      for (let i = 0; i < 4; i++) P.steel.push(G.xf(G.cyl(0.014, 0.014, 0.48, 8), [0, -0.7 - i * 0.3, 4.61], [0, 0, Math.PI / 2]));
      // running gear (seen from below)
      for (const sx of [-1, 1]) {
        P.steel.push(G.xf(G.cyl(0.02, 0.02, 1.3, 8), [sx * 0.55, -1.22, 2.55], [1.42, 0, 0]));
        P.gold.push(G.xf(G.cyl(0.19, 0.19, 0.02, 5), [sx * 0.55, -1.32, 3.2], [1.42, 0, 0]));
        P.steel.push(G.xf(G.box(0.03, 0.42, 0.26), [sx * 0.55, -1.33, 3.62]));
      }

      // --- teak cap rail (single U-shaped sweep)
      const rail = [], R = 0.32, xr = HB(3.5) - 0.1, zr = 3.875, yr = YS(3.6) + 0.021;
      for (let z = -5.38; z <= 3.3; z += 0.31) rail.push(V3(-(HB(z) - 0.1), YS(z) + 0.021, z));
      for (let a = 165; a >= 90; a -= 15) rail.push(V3(-(xr - R) + R * Math.cos((a * Math.PI) / 180), yr, zr - R + R * Math.sin((a * Math.PI) / 180)));
      for (let a = 75; a >= 15; a -= 15) rail.push(V3(xr - R + R * Math.cos((a * Math.PI) / 180), yr, zr - R + R * Math.sin((a * Math.PI) / 180)));
      for (let z = 3.3; z >= -5.38; z -= 0.31) rail.push(V3(HB(z) - 0.1, YS(z) + 0.021, z));
      const railGeo = G.sweep(rail, G.rrect(0.236, 0.052, 0.022, 3));
      const ruv = railGeo.attributes.uv; for (let i = 0; i < ruv.count; i++) ruv.setX(i, ruv.getX(i) / 1.6);
      P.teak.push(railGeo);
      // rub rail
      const rub = []; for (let z = 4.0; z >= -5.5; z -= 0.3) rub.push(V3(HB(z) + 0.012, YS(z) - 0.07, z));
      const rubGeo = G.sweep(rub, G.rrect(0.035, 0.05, 0.015, 2)); P.rubber.push(rubGeo, mirrorX(rubGeo));

      const add = (key, mat, cast = true, recv = true) => {
        if (!P[key].length) return null;
        const m = new T.Mesh(G.merge(P[key]), mat);
        m.castShadow = cast; m.receiveShadow = recv; this.group.add(m); return m;
      };
      add('gel', mats.gel); add('hull', mats.hull); add('bottom', mats.bottom); add('stripe', mats.stripe); add('teak', mats.teak); add('deck', mats.deck);
      add('steel', mats.steel); add('black', mats.black); add('glass', mats.glass); add('vinyl', mats.vinyl); add('rubber', mats.rubber);
      add('alu', mats.alu); add('tank', mats.tank); add('gold', mats.gold);

      this.buildFinder(mats);
      this.dress(scene);

      // sun + shadows
      const sun = (this.sun = new T.DirectionalLight(0xffffff, 1));
      sun.castShadow = true;
      sun.shadow.mapSize.set(DB.Q.shadow, DB.Q.shadow);
      const sc = sun.shadow.camera; sc.left = -7.5; sc.right = 7.5; sc.top = 7.5; sc.bottom = -7.5; sc.near = 1; sc.far = 70;
      sc.updateProjectionMatrix();
      sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.025; sun.shadow.radius = 2.5;
      scene.add(sun, sun.target);
      this.group.rotation.order = 'YXZ';
      scene.add(this.group);
      this.syncLight();
    },

    makeMaterials() {
      const teak = teakRailTex(), deck = teakDeckTex(), ns = nonskidTex();
      ns.repeat.set(1, 1);
      const ph = (o) => new T.MeshPhysicalMaterial(o), st = (o) => new T.MeshStandardMaterial(o);
      return {
        gel: ph({ color: 0xf1f0ea, roughness: 0.32, clearcoat: 0.35, clearcoatRoughness: 0.2, side: T.DoubleSide }),
        hull: ph({ color: 0xf3f2ee, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.1, side: T.DoubleSide }),
        bottom: st({ color: 0x0b2038, roughness: 0.75, side: T.DoubleSide }),
        stripe: ph({ color: 0x0a1c33, roughness: 0.25, clearcoat: 0.6, side: T.DoubleSide }),
        teak: ph({ map: teak, color: 0xffffff, roughness: 0.38, clearcoat: 0.85, clearcoatRoughness: 0.12 }),
        deck: st({ map: deck, color: 0xffffff, roughness: 0.78, side: T.DoubleSide }),
        steel: st({ color: 0xe2e6e9, metalness: 1, roughness: 0.13 }),
        black: st({ color: 0x0c0d0e, roughness: 0.42 }),
        glass: ph({ color: 0x030507, roughness: 0.05, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03 }),
        vinyl: st({ color: 0xeeeae0, roughness: 0.55 }),
        rubber: st({ color: 0x0e0e0e, roughness: 0.85 }),
        alu: st({ color: 0xc9cdd0, metalness: 0.9, roughness: 0.35 }),
        tank: st({ color: 0xd8b21e, metalness: 0.5, roughness: 0.36 }),
        gold: st({ color: 0xc79a3c, metalness: 1, roughness: 0.25 }),
        screen: ph({ color: 0x000000, emissive: 0xffffff, emissiveMap: Finder.tex, emissiveIntensity: 1.15, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04 }),
      };
    },

    buildFinder(mats) {
      const u = new T.Group(), blk = [], stl = [];
      blk.push(G.rbox(0.335, 0.218, 0.062, 0.02));
      blk.push(G.xf(G.rbox(0.345, 0.228, 0.03, 0.014), [0, 0, -0.022]));
      for (let i = 0; i < 5; i++) blk.push(G.xf(G.cyl(0.0085, 0.0085, 0.008, 12), [0.142, 0.07 - i * 0.027, 0.033], [Math.PI / 2, 0, 0]));
      blk.push(G.xf(G.cyl(0.017, 0.019, 0.02, 20), [0.142, -0.078, 0.038], [Math.PI / 2, 0, 0]));
      // gimbal bracket + knobs + stalk
      blk.push(G.xf(G.cyl(0.024, 0.024, 0.03, 16), [0.183, -0.01, -0.005], [0, 0, Math.PI / 2]), G.xf(G.cyl(0.024, 0.024, 0.03, 16), [-0.183, -0.01, -0.005], [0, 0, Math.PI / 2]));
      blk.push(G.xf(G.box(0.012, 0.16, 0.045), [0.177, -0.08, -0.005]), G.xf(G.box(0.012, 0.16, 0.045), [-0.177, -0.08, -0.005]), G.xf(G.box(0.366, 0.012, 0.05), [0, -0.158, -0.005]));
      blk.push(G.xf(G.sph(0.03, 14, 10), [0, -0.185, -0.005]), G.xf(G.cyl(0.02, 0.022, 0.1, 12), [0, -0.235, -0.012], [0.12, 0, 0]), G.xf(G.sph(0.03, 14, 10), [0, -0.285, -0.02]));
      blk.push(G.xf(G.cyl(0.05, 0.056, 0.022, 20), [0, -0.312, -0.02]));
      stl.push(G.xf(G.box(0.05, 0.007, 0.002), [-0.025, -0.096, 0.0315]));
      const body = new T.Mesh(G.merge(blk), new T.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.5 }));
      const logo = new T.Mesh(G.merge(stl), mats.steel);
      const scr = new T.Mesh(new T.PlaneGeometry(0.262, 0.164), mats.screen); scr.position.set(-0.025, 0.012, 0.0318);
      body.castShadow = true; body.receiveShadow = true; scr.receiveShadow = false;
      u.add(body, logo, scr);
      const fz = 3.12, base = V3(-(HB(fz) - 0.1), YS(fz) + 0.047, fz);      // port cap rail, right of the default view
      u.position.set(base.x, base.y + 0.323, base.z);
      u.lookAt(this.eyeLocal.x - 0.1, this.eyeLocal.y - 0.1, this.eyeLocal.z + 0.1);
      this.finderUnit = u; this.group.add(u);
    },

    // scanned CC0 props (Poly Haven) scattered around the cockpit + a marker buoy on the reef edge
    dress(scene) {
      const A = DB.Assets;
      if (!A || !A.has('lifebuoy')) return;
      const put = (name, origin, p, r, s = 1) => { const o = A.object(name, origin); o.position.set(p[0], p[1], p[2]); o.rotation.set(r[0], r[1], r[2]); o.scale.setScalar(s); this.group.add(o); return o; };
      put('lifebuoy', 'center', [-0.93, 1.33, -1.07], [0, 0, 0.3]);
      put('life_jacket', 'center', [1.03, 0.56, 1.18], [-Math.PI / 2, 0, 0.12]);
      put('plastic_crate_02', 'base', [0.98, 0, 2.12], [0, 0.2, 0]);
      put('plastic_thermos', 'base', [1.05, 0.03, 2.08], [0, 1.1, 0]);
      put('fishermans_hat', 'base', [0.91, 1.075, 0.12], [0, 0.7, 0]);
      put('fish_knife', 'center', [0.62, YS(3.875) + 0.062, 3.87], [Math.PI / 2, 0, 1.25]);
      const b = (this.buoy = A.object('ocean_buoy', 'base'));
      b.userData.home = V3(-34, 0, 27); b.rotation.order = 'YXZ';
      scene.add(b);
    },

    syncLight() {
      const e = this.env;
      this.sun.color.copy(e.sunColor);
      this.sun.intensity = e.sunDir.y > 0.0 ? 1 : 0;
    },

    // world position of a boat-local point on the horizontal plan (heading only)
    plan(lx, lz, out) {
      const c = Math.cos(this.heading), s = Math.sin(this.heading);
      out.x = this.group.position.x + lx * c + lz * s; out.z = this.group.position.z - lx * s + lz * c; return out;
    },

    // ---------------------------------------------------------------- motion
    // 'anchor' = riding at anchor (fishing), 'drive' = under power, 'coast' = engines cut, running the way off before the anchor goes down
    setMode(m) {
      if (m === 'drive') this.mode = 'drive';
      else if (this.mode === 'drive') { if (Math.abs(this.u) > 0.5) this.mode = 'coast'; else this.dropAnchor(); }
    },
    swingAt(t, out) { out.x = Math.sin(t * 0.043) * 2.6 + Math.sin(t * 0.017 + 1) * 1.4; out.z = Math.sin(t * 0.031 + 2) * 2.1; out.h = Math.sin(t * 0.027) * 0.16 + Math.sin(t * 0.061 + 0.7) * 0.05; return out; },
    dropAnchor() {      // pick the anchor point that makes the swing continue from exactly where she lies now
      const o = this.swingAt(this.t, this._sw), g = this.group;
      this.anchor.set(g.position.x - o.x, 0, g.position.z - o.z); this.headBase = this.heading - o.h;
      this.mode = 'anchor'; this.u = this.vs = this.yawRate = this.throttle = 0;
      DB.emit('anchor');
    },
    // riding at anchor: slow swing around the anchor point
    swing() {
      const o = this.swingAt(this.t, this._sw), g = this.group;
      g.position.x = this.anchor.x + o.x; g.position.z = this.anchor.z + o.z; this.heading = this.headBase + o.h;
      this.rudder *= 0.9; this.speed = Math.hypot(Math.cos(this.t * 0.043) * 0.11, Math.cos(this.t * 0.031 + 2) * 0.065);
    },
    // under power. ctl: { throttle -1..1, steer -1..1 (+ = to port) } or null when coasting
    sail(dt, ctl) {
      const g = this.group, th = ctl ? ctl.throttle : 0, st = ctl ? ctl.steer : 0;
      this.throttle = M.damp(this.throttle, th, th === 0 ? 1.8 : 2.6, dt);
      this.rudder = M.damp(this.rudder, st, 4.5, dt);
      const u = this.u;
      const aT = this.throttle * (this.throttle > 0 ? 7.0 : 3.2) * (this.air > 0.12 ? 0.2 : 1);      // the props bite air when the hull leaves the water
      // coasting (engines cut, waiting to anchor): the hull squats and drags hard, and the swell must not keep her surfing
      const aD = ctl ? -(0.2 * u + 0.022 * u * Math.abs(u)) : -(0.9 * u + 0.04 * u * Math.abs(u));
      this.u += (aT + aD - 9.81 * this.slopeFwd * (ctl ? 0.7 : 0.1)) * dt;      // under power she slows climbing a face and surfs down the back
      // the turning circle grows with speed; a little prop-walk lets her answer the helm from a standstill
      const rT = this.rudder * (this.u / (7 + 0.15 * this.u * this.u) + this.throttle * 0.12);
      this.yawRate = M.damp(this.yawRate, rT, 2.8, dt);
      this.heading += this.yawRate * dt;
      this.vs += (this.u * this.yawRate * 0.8 - 2.6 * this.vs) * dt;      // the stern slides out in a hard turn
      const s = Math.sin(this.heading), c = Math.cos(this.heading);
      g.position.x += (-s * this.u + c * this.vs) * dt; g.position.z += (-c * this.u - s * this.vs) * dt;
      // islands and other boats: slide along, lose way
      for (const k of this.colliders) {
        const dx = g.position.x - k.x, dz = g.position.z - k.z, rr = k.r + 3.2, d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-4) {
          const d = Math.sqrt(d2), into = -((-s * this.u) * dx + (-c * this.u) * dz) / d;
          g.position.x += (dx / d) * (rr - d); g.position.z += (dz / d) * (rr - d);
          if (into > 1.5 && this.t - this._bumpT > 0.6) { this._bumpT = this.t; DB.emit('bump', M.sat(into / 8)); }
          if (into > 0) this.u *= Math.exp(-3.5 * dt) * (into > 3 ? 0.6 : 1);
        }
      }
      this.speed = Math.hypot(this.u, this.vs);
      this.spray(dt);
    },
    // heave / pitch / roll from buoyancy at five hull points. Each point carries its share of the weight when the design
    // waterline sits at the surface, more when pushed under, nothing once it is clear of the water — so she can leave a crest and slam.
    heave(dt) {
      // on the plane the hull rides high on a small, stiff patch of water: little has to fall away before she is airborne
      const O = DB.Ocean, PTS = this.PTS, p = this._p, sp = Math.abs(this.u), plane = M.sat((sp - 4) / 9), K = 2.6 * (1 + 3.2 * plane), C = 0.75 * (1 + 0.7 * plane);
      const lift = 0.3 * M.sat(sp / 12) * M.sat(sp / 12);
      let aY = -9.81, aP = 0, aR = 0, wet = 0, hb = 0, hs = 0, bowIn = 0;
      for (let i = 0; i < PTS.length; i++) {
        const q = PTS[i], h = O.height(this.plan(q[0], q[1], p).x, p.z, 5);
        const yq = this.y + WL + lift - q[1] * this.pitch + q[0] * this.roll;      // height of the waterline mark at this point
        const d = h - yq, hPrev = this._h[i] === undefined ? h : this._h[i];
        const vq = this.vy - q[1] * this.vp + q[0] * this.vr - (dt > 0 ? (h - hPrev) / dt : 0);      // hull speed relative to the water at that point
        this._h[i] = h;
        let a = q[2] * 9.81 + K * d;
        if (a > 0) { a = Math.max(a - C * vq, 0); wet++; } else a = 0;
        aY += a; aP += a * -q[1]; aR += a * q[0];
        if (i === 0) { hb = h; bowIn = d > 0.5 && vq < -1.8 ? d : 0; } else if (i >= 3) hs += h * 0.5;
      }
      this.slopeFwd = (hb - hs) / 7.5; this.wet = wet;
      if (dt <= 0) return;
      // bow-up squat over the hump, flatter once she is planing; bank into the turn
      const trim = 0.075 * M.sat(sp / 5) * (1 - 0.55 * M.sat((sp - 6) / 8)) + 0.03 * Math.max(this.throttle, 0), bank = 0.035 * this.yawRate * this.u;
      aP = aP / 5.8 + (wet ? 17.5 * trim : 0); aR = aR / 0.8 + (wet ? 16.6 * bank : 0);
      this.vy += aY * dt; this.vp = (this.vp + aP * dt) * Math.exp(-0.9 * dt); this.vr = (this.vr + aR * dt) * Math.exp(-1.4 * dt);
      this.y += this.vy * dt; this.pitch = M.clamp(this.pitch + this.vp * dt, -0.6, 0.6); this.roll = M.clamp(this.roll + this.vr * dt, -0.7, 0.7);
      // airborne → slam
      if (wet <= 1) this.air += dt;
      else {
        if (this.air > 0.16 && this.vy < -1.1) { const k = Math.min((-this.vy - 0.8) / 3.5 + this.air * 0.6, 1.6); this.u *= 0.95; this.slam = k; this.wash(k); DB.emit('slam', k); }
        this.air = 0;
      }
      if (bowIn && this.t - this._bowT > 0.45 && sp > 3) { this._bowT = this.t; const k = Math.min(bowIn * 0.9 + sp * 0.03, 1.2); this.wash(k * 0.7); DB.emit('bowSplash', k); }
      this.slam = Math.max(this.slam - dt * 2.5, 0);
    },
    // sheets of white water thrown from the bow
    wash(k) {
      const g = this.group, v = this._v, s = Math.sin(this.heading), c = Math.cos(this.heading);
      for (const side of [-1, 1]) { v.set(side * 0.9, -0.5, -3.4).applyMatrix4(g.matrixWorld); DB.FX.splash(v.x, v.y, v.z, 0.35 + k * 0.55, -s * this.u * 0.22 + c * side * 1.4, -c * this.u * 0.22 - s * side * 1.4); }
      DB.Ocean.addRipple(g.position.x - s * 3, g.position.z - c * 3, 1.2 + k);
    },
    // continuous spray: bow wave to both sides + the wash boiling up astern
    spray(dt) {
      const sp = Math.abs(this.u); if (sp < 2.2 || this.air > 0.1) return;
      const FX = DB.FX, w = FX.white(), g = this.group, v = this._v, k = M.sat((sp - 2) / 11), s = Math.sin(this.heading), c = Math.cos(this.heading), fx = -s * this.u, fz = -c * this.u;
      this._spray += dt * (14 + 80 * k);
      while (this._spray > 1) {
        this._spray--;
        const side = Math.random() < 0.5 ? -1 : 1, out = 1.5 + 4.5 * k * Math.random(), mist = Math.random() < 0.2;
        v.set(side * (0.95 + Math.random() * 0.35), -0.62, -2.9 + Math.random() * 2.2).applyMatrix4(g.matrixWorld);
        FX.emit({ x: v.x, y: v.y, z: v.z, vx: fx * 0.55 + c * side * out, vy: 0.8 + (1.5 + 3.2 * k) * Math.random(), vz: fz * 0.55 - s * side * out, life: 0.5 + Math.random() * 0.7, size: mist ? 0.25 + Math.random() * 0.4 : 0.05 + Math.random() * 0.1, grow: mist ? 0.9 : 0, kind: mist ? 0 : 1, alpha: mist ? 0.1 + 0.06 * k : 0.9, grav: mist ? -2.5 : -9.8, drag: mist ? 1.6 : 0.4, r: w[0] * 1.2, g: w[1] * 1.2, b: w[2] * 1.2 });
        if (Math.random() < 0.5) {      // droplets kicked up astern
          v.set((Math.random() - 0.5) * 1.8, -0.7, 4.1 + Math.random() * 1.4).applyMatrix4(g.matrixWorld);
          FX.emit({ x: v.x, y: v.y, z: v.z, vx: fx * 0.3 + (Math.random() - 0.5) * 2, vy: 1 + 3 * k * Math.random(), vz: fz * 0.3 + (Math.random() - 0.5) * 2, life: 0.4 + Math.random() * 0.6, size: 0.05 + Math.random() * 0.09, kind: 1, alpha: 0.9, drag: 0.4, r: w[0] * 1.2, g: w[1] * 1.2, b: w[2] * 1.2 });
        }
      }
    },

    update(dt, ctl) {
      this.t += dt;
      const O = DB.Ocean, g = this.group, p = this._p;
      if (this.mode === 'anchor') this.swing();
      else if (dt > 0) { this.sail(dt, this.mode === 'drive' ? ctl : null); if (this.mode === 'coast' && Math.abs(this.u) < 0.8) this.dropAnchor(); }
      this.heave(dt);
      g.position.y = this.y;
      g.rotation.set(this.pitch, this.heading, this.roll);
      g.updateMatrixWorld(true);
      if (this.wheel) this.wheel.rotation.z = this.rudder * 2.4;
      O.setBoat(g.position.x, g.position.z, this.heading, this.mode === 'anchor' ? 0 : this.speed);
      // shadow rig follows the boat
      const sd3 = this.env.sunDir;
      this.sun.position.set(g.position.x + sd3.x * 32, g.position.y + sd3.y * 32, g.position.z + sd3.z * 32);
      this.sun.target.position.copy(g.position);
      this.sun.target.updateMatrixWorld();
      if (this.buoy) {      // marker buoy rides the swell
        const b = this.buoy, h = b.userData.home, hx = O.height(h.x + 1, h.z, 3), hz = O.height(h.x, h.z + 1, 3), h0 = O.height(h.x, h.z, 3);
        b.position.set(h.x, M.damp(b.position.y, h0 - 0.95, 6, dt), h.z);
        b.rotation.set(M.damp(b.rotation.x, (hz - h0) * 0.9, 3, dt), 0.6, M.damp(b.rotation.z, -(hx - h0) * 0.9, 3, dt));
      }
      this.plan(0, 0, p);
      Finder.tick(dt, { depth: DB.World.depth(p.x, p.z) - 0.4, x: g.position.x, z: g.position.z, heading: this.heading, speed: this.speed });
    },

    // eye point in world space (+ fraction of deck tilt the head keeps)
    eyeWorld(out) { return out.copy(this.eyeLocal).applyMatrix4(this.group.matrixWorld); },
  });
})();
