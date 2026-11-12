// Project Deep Blue — spearfishing: diver controller, oxygen/depth, speargun + drag ballistics, reef fish AI, sharks, jellyfish.
(function () {
  'use strict';
  const DB = window.DB, T = THREE, M = DB.M, G = DB.G;
  const V3 = (x, y, z) => new T.Vector3(x, y, z);
  const YAX = V3(0, 1, 0), _a = V3(), _b = V3(), _c = V3(), _d = V3(), _e = new T.Euler(0, 0, 0, 'YZX'), _q = new T.Quaternion(), _m = new T.Matrix4(), _s = V3();
  const f0 = V3(), f1 = V3(), s0 = V3(), s1 = V3();      // segment end points handed to segDist (which owns _a.._d)
  const SILVER = { jack: 1.0, amberjack: 0.9, tuna: 1.0, marlin: 0.85, sailfish: 0.8, mahi: 0.7, seabream: 0.5, parrotfish: 0.3, grouper: 0.14, giantGrouper: 0.12, shark: 0.28 };
  // behaviour: shy = flee radius (m), cruise / burst speed (m/s), hp, hover height above the seabed, roam radius
  const AI = {
    grouper: { shy: 2.6, cruise: 0.45, burst: 3.6, hp: 95, hover: 0.9, roam: 5 }, giantGrouper: { shy: 2.0, cruise: 0.35, burst: 3.0, hp: 210, hover: 1.4, roam: 6 },
    seabream: { shy: 3.8, cruise: 0.8, burst: 4.6, hp: 45, hover: 1.6, roam: 9 }, parrotfish: { shy: 3.2, cruise: 0.7, burst: 4.2, hp: 30, hover: 0.8, roam: 7 },
    amberjack: { shy: 4.6, cruise: 1.9, burst: 6.5, hp: 70, hover: 4.5, roam: 26 },
  };

  // closest distance between segments p0p1 and q0q1
  function segDist(p0, p1, q0, q1) {
    const u = _a.subVectors(p1, p0), v = _b.subVectors(q1, q0), w = _c.subVectors(p0, q0);
    const a = u.dot(u), b = u.dot(v), c = v.dot(v), d = u.dot(w), e = v.dot(w), D = a * c - b * b;
    let sN, sD = D, tN, tD = D;
    if (D < 1e-9) { sN = 0; sD = 1; tN = e; tD = c; } else { sN = b * e - c * d; tN = a * e - b * d; if (sN < 0) { sN = 0; tN = e; tD = c; } else if (sN > sD) { sN = sD; tN = e + b; tD = c; } }
    if (tN < 0) { tN = 0; if (-d < 0) sN = 0; else if (-d > a) sN = sD; else { sN = -d; sD = a; } }
    else if (tN > tD) { tN = tD; if (-d + b < 0) sN = 0; else if (-d + b > a) sN = sD; else { sN = -d + b; sD = a; } }
    const sc = Math.abs(sN) < 1e-9 ? 0 : sN / sD, tc = Math.abs(tN) < 1e-9 ? 0 : tN / (tD || 1);
    return _d.copy(w).addScaledVector(u, sc).addScaledVector(v, -tc).length();
  }
  const yawOf = (vx, vz) => Math.atan2(vx, vz) - Math.PI / 2;

  // distance from point p to segment ab
  function segPoint(a, b, p) {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z, l2 = abx * abx + aby * aby + abz * abz;
    const t = l2 > 1e-9 ? M.sat(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2) : 0;
    return Math.hypot(a.x + abx * t - p.x, a.y + aby * t - p.y, a.z + abz * t - p.z);
  }

  // sea urchin: a flattened test bristling with spines (about 2 units across; instances are scaled to ~15 cm)
  let _urchin = null;
  function urchinGeo() {
    if (_urchin) return _urchin;
    const r = M.rng(77), q = new T.Quaternion(), up = V3(0, 1, 0), d = V3();
    const test = new T.SphereGeometry(0.4, 12, 8); test.scale(1, 0.7, 1); test.translate(0, 0.28, 0);
    const parts = [test];
    for (let i = 0; i < 120; i++) {
      const y = -0.15 + r() * 1.15, th = r() * 6.2832, rr = Math.sqrt(Math.max(1 - y * y, 0)), len = 0.42 + r() * 0.3;
      d.set(Math.cos(th) * rr, y, Math.sin(th) * rr).normalize();
      const g = new T.CylinderGeometry(0.002, 0.022, len, 4, 1, true); g.translate(0, len / 2, 0);
      g.applyQuaternion(q.setFromUnitVectors(up, d)); g.translate(d.x * 0.36, 0.28 + d.y * 0.25, d.z * 0.36);
      parts.push(g);
    }
    return (_urchin = G.merge(parts));
  }

  // octopus, resting pose: mantle toward +x (it leads when the animal jets), eight arms splayed on the ground.
  // aArm = (distance along the arm, phase) drives the writhing / trailing in the submerged material's vertex shader.
  let _octo = null;
  function octopusGeo() {
    if (_octo) return _octo;
    const pos = [], col = [], arm = [], idx = [], skin = [0.36, 0.13, 0.075], pale = [0.6, 0.42, 0.36];
    const add = (g, c) => {      // a body part (not on an arm)
      const p = g.attributes.position, off = pos.length / 3;
      for (let i = 0; i < p.count; i++) { const k = 0.8 + 0.4 * M.noise2(p.getX(i) * 31 + 3, p.getZ(i) * 31 + p.getY(i) * 17); pos.push(p.getX(i), p.getY(i), p.getZ(i)); col.push(c[0] * k, c[1] * k, c[2] * k); arm.push(0, 0); }
      for (let i = 0; i < g.index.count; i++) idx.push(off + g.index.getX(i));
    };
    const mantle = new T.SphereGeometry(1, 20, 14); mantle.scale(0.21, 0.125, 0.135); mantle.rotateZ(0.32); mantle.translate(0.2, 0.125, 0);
    const head = new T.SphereGeometry(0.1, 16, 12); head.scale(1.05, 0.85, 1); head.translate(0.01, 0.075, 0);
    add(mantle, skin); add(head, skin);
    for (const s of [-1, 1]) {
      const eye = new T.SphereGeometry(0.03, 10, 8); eye.translate(0.035, 0.135, s * 0.07); add(eye, [0.85, 0.7, 0.3]);
      const pupil = new T.SphereGeometry(0.014, 8, 6); pupil.scale(1.5, 0.45, 1.3); pupil.translate(0.04, 0.138, s * 0.09); add(pupil, [0.02, 0.02, 0.02]);
    }
    const NA = 8, NS = 18, NR = 6;
    for (let a = 0; a < NA; a++) {
      const ang = ((a + 0.5) / NA) * 6.2832, dx = Math.cos(ang), dz = Math.sin(ang), ph = a * 1.7 + 0.4, len = 0.5 + 0.08 * Math.sin(a * 2.3), off = pos.length / 3;
      for (let s = 0; s <= NS; s++) {
        const t = s / NS, r = 0.04 * Math.pow(1 - t, 1.15) + 0.004, d = 0.05 + t * len, curl = Math.sin(t * 5 + ph) * 0.07 * t;
        const cx = dx * d - dz * curl, cz = dz * d + dx * curl, cy = 0.03 + r * 0.9 + 0.035 * Math.sin(t * 3.14) * (a % 2 ? 1 : 0.4);
        for (let k = 0; k < NR; k++) {
          const th = (k / NR) * 6.2832, ox = Math.cos(th) * r, oy = Math.sin(th) * r, c = oy < -r * 0.3 ? pale : skin, n = 0.8 + 0.4 * M.noise2(a * 7 + t * 23, k * 3 + t * 11);
          pos.push(cx - dz * ox, cy + oy, cz + dx * ox); col.push(c[0] * n, c[1] * n, c[2] * n); arm.push(t, ph);
        }
      }
      for (let s = 0; s < NS; s++) for (let k = 0; k < NR; k++) { const a0 = off + s * NR + k, a1 = off + s * NR + ((k + 1) % NR); idx.push(a0, a0 + NR, a1, a1, a0 + NR, a1 + NR); }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    g.setAttribute('aArm', new T.Float32BufferAttribute(arm, 2)); g.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    g.setIndex(idx); g.computeVertexNormals();
    return (_octo = g);
  }

  const Dive = (DB.Dive = {
    active: false, pos: V3(), vel: V3(), o2: 1, depth: 0, maxDepth: 40, bag: [], torch: false, loaded: true, sprint: false,
    targets: [], sharks: [], warn: '', sharkNear: 0, prompt: '', t: 0, breathT: 0, blackout: 0, hurt: 0, marker: null, spear: { state: 'loaded', pos: V3(), vel: V3(), prev: V3(), t: 0, fish: null },
    items: [], octos: [], turtles: [], seen: new Set(), chest: null, chestOpen: false, lock: null, pick: null, _lk: { pos: null, vel: null, dist: 0, name: '' },

    init(scene, camera) {
      this.scene = scene; this.camera = camera;
      const UW = DB.UW, A = DB.Assets, fleece = A.texSet('knitted_fleece');
      const rig = (this.rig = new T.Group()); rig.visible = false; camera.add(rig);
      const gun = (this.gun = new T.Group()); rig.add(gun);
      // --- speargun (gun space: barrel along -Z, origin at the top of the grip)
      const P = [], rot = (g, x, y, z) => G.xf(g, null, [x, y, z]);
      P.push(G.tint(G.xf(G.cyl(0.0165, 0.0165, 1.02, 14), [0, 0, -0.47], [Math.PI / 2, 0, 0]), 0x101113));
      P.push(G.tint(G.xf(G.cyl(0.0245, 0.022, 0.06, 14), [0, 0, -0.99], [Math.PI / 2, 0, 0]), 0x1b1c20));
      P.push(G.tint(G.xf(G.box(0.007, 0.007, 1.0), [0, 0.0195, -0.47]), 0x25272b));
      P.push(G.tint(G.xf(G.rbox(0.037, 0.125, 0.05, 0.013, 2), [0, -0.072, 0.036], [-0.3, 0, 0]), 0x141518));
      P.push(G.tint(G.xf(G.torus(0.027, 0.004, 6, 14, Math.PI), [0, -0.022, -0.02], [0, Math.PI / 2, Math.PI]), 0x1b1c20));
      P.push(G.tint(G.xf(G.box(0.006, 0.03, 0.009), [0, -0.034, -0.016], [0.35, 0, 0]), 0x9aa0a6));
      P.push(G.tint(G.xf(G.rbox(0.05, 0.058, 0.04, 0.013, 2), [0, -0.004, 0.09]), 0x18191c));
      P.push(G.tint(G.xf(G.cyl(0.03, 0.03, 0.03, 16), [0, -0.05, -0.3], [0, 0, Math.PI / 2]), 0x202226));
      P.push(G.tint(G.xf(G.cyl(0.022, 0.022, 0.032, 14), [0, -0.05, -0.3], [0, 0, Math.PI / 2]), 0xd9dcc8));
      for (const sx of [-1, 1]) P.push(G.tint(G.tube([V3(sx * 0.026, 0.002, -0.985), V3(sx * 0.03, 0.012, -0.8), V3(sx * 0.024, 0.026, -0.55), V3(sx * 0.006, 0.031, -0.41)], 0.0085, 7), 0x8a5f1c));
      const body = new T.Mesh(G.merge(P), UW.material({ vertexColors: true, normalMap: fleece.normalMap, normalFlip: -1, uv: 2 }));
      body.frustumCulled = false; gun.add(body);
      // shaft (detaches when fired)
      const sh = [G.tint(G.xf(G.cyl(0.0037, 0.0037, 1.3, 8), [0, 0, -0.61], [Math.PI / 2, 0, 0]), 0xd0d4d8), G.tint(G.xf(G.cyl(0.0, 0.0075, 0.055, 8), [0, 0, -1.285], [Math.PI / 2, 0, 0]), 0xe0e4e8),
        G.tint(G.xf(G.box(0.002, 0.013, 0.07), [0, 0.008, -1.2], [0.14, 0, 0]), 0xc0c4c8)];
      this.shaftGeo = G.merge(sh);
      const shaftMat = UW.material({ vertexColors: true, silver: 0.6 });
      this.shaft = new T.Mesh(this.shaftGeo, shaftMat); this.shaft.position.set(0, 0.029, 0.04); this.shaft.frustumCulled = false; gun.add(this.shaft);
      this.flying = new T.Mesh(this.shaftGeo, shaftMat); this.flying.visible = false; this.flying.frustumCulled = false; scene.add(this.flying);
      this.line = new DB.Line(14, 0.004, new T.Vector3(0.9, 1.0, 1.0), 0.8); this.line.mesh.visible = false; scene.add(this.line.mesh);
      // arms in black neoprene
      const am = { glove: UW.material({ vertexColors: true, normalMap: fleece.normalMap, normalFlip: -1, uv: 3 }), sleeve: UW.material({ color: 0x0d0e11, normalMap: fleece.normalMap, normalFlip: -1, uv: 6 }) };
      this.armR = new DB.Rig.Arm(false, 0.021, am); this.armL = new DB.Rig.Arm(true, 0.0185, am);
      for (const a of [this.armR, this.armL]) { a.hand.frustumCulled = a.fore.frustumCulled = false; gun.add(a.group); }
      this.elR = V3(0.46, -0.6, 0.12); this.elL = V3(-0.3, -0.66, -0.02);
      this.kick = 0; this.reloadT = 0; this.swayX = 0; this.swayY = 0;

      this.buildCreatures();
      this.buildExtras();
    },

    // ---------------------------------------------------------------- creatures
    makeFish(key, L) {
      const f = DB.Fish.get(key), mat = DB.UW.material({ map: f.tex, swim: true, silver: SILVER[key] || 0.5, side: T.DoubleSide });
      const mesh = new T.Mesh(f.geo, mat); mesh.scale.setScalar(L); mesh.rotation.order = 'YZX'; mesh.frustumCulled = false;
      return mesh;
    },
    addTarget(key, x, z, opts = {}) {
      const ind = DB.Fish.roll(key, this.rnd, opts.bias || 1.5), ai = AI[key] || AI.seabream, W = DB.World;
      const mesh = this.makeFish(key, ind.L); DB.Reef.group.add(mesh);
      const y = Math.min(W.height(x, z) + ai.hover + ind.L * 0.3 + (opts.dy || 0), -1.5);
      const f = Object.assign(ind, { ai, mesh, home: V3(x, y, z), pos: V3(x, y, z), vel: V3(), goal: V3(x, y, z), head: this.rnd() * 6.28, pitch: 0, state: 'idle', timer: this.rnd() * 3, hp: ai.hp * (0.6 + 0.8 * (ind.L - ind.sp.L[0]) / (ind.sp.L[1] - ind.sp.L[0])), phase: this.rnd() * 9, alive: true, bleed: 0, radius: Math.max(ind.sp.prof.reduce((m, p) => Math.max(m, p[1], p[2]), 0) * ind.L, 0.07) });
      this.targets.push(f); return f;
    },
    buildCreatures() {
      const W = DB.World, R = DB.Reef, rnd = (this.rnd = M.rng(2024));
      const near = (b, r) => { const a = rnd() * 6.283; return [b.x + Math.cos(a) * (b.r + r), b.z + Math.sin(a) * (b.r + r)]; };
      const bom = W.bommies.filter((b) => Math.hypot(b.x, b.z) < 60 && W.height(b.x, b.z) > -30);
      for (let i = 0; i < 6; i++) { const b = bom[(i * 3) % bom.length], [x, z] = near(b, 1.5); this.addTarget('grouper', x, z); }
      for (let i = 0; i < 9; i++) { const b = bom[(i * 2 + 1) % bom.length], [x, z] = near(b, 2.5); this.addTarget('parrotfish', x, z); }
      for (let i = 0; i < 7; i++) { const a = rnd() * 6.283, d = 8 + rnd() * 34; this.addTarget('seabream', Math.cos(a) * d, Math.sin(a) * d); }
      for (let i = 0; i < 3; i++) { const t = this.addTarget('amberjack', -22 + rnd() * 10, 14 + rnd() * 10, { dy: 2 }); t.home.set(-26, -9, 20); }
      this.addTarget('grouper', R.wreck.x + 6, R.wreck.z - 5); this.addTarget('grouper', R.wreck.x - 7, R.wreck.z + 6);
      this.giant = this.addTarget('giantGrouper', R.wreck.x + 2, R.wreck.z + 3, { bias: 1 });
      // schools of jacks (instanced)
      const f = DB.Fish.get('jack', true), NSCH = 220;
      const ph = new Float32Array(NSCH * 4); for (let i = 0; i < NSCH; i++) { ph[i * 4] = rnd() * 6.28; ph[i * 4 + 1] = 9 + rnd() * 5; }
      const g = f.geo.clone(); g.setAttribute('aPhase', new T.InstancedBufferAttribute(ph, 4));
      const im = (this.schoolMesh = new T.InstancedMesh(g, DB.UW.material({ map: f.tex, swim: true, instPhase: true, silver: 1.0, side: T.DoubleSide }), NSCH));
      im.frustumCulled = false; R.group.add(im);
      this.schools = [{ n: 120, c: V3(10, -6, -14), r: 4.5 }, { n: 100, c: V3(-20, -8, 12), r: 4 }].map((s, si) => Object.assign(s, { v: V3(1, 0, 0), goal: V3(), timer: 0, scare: 0, si }));
      this.sfish = [];
      let k = 0;
      for (const s of this.schools) for (let i = 0; i < s.n; i++) {
        const a = rnd() * 6.283, b = Math.acos(rnd() * 2 - 1), rr = Math.cbrt(rnd());
        this.sfish.push({ s, i: k++, o: V3(Math.sin(b) * Math.cos(a) * rr, Math.cos(b) * rr * 0.55, Math.sin(b) * Math.sin(a) * rr), w: 0.3 + rnd() * 0.5, p: rnd() * 6.28, L: 0.24 + rnd() * 0.12, pos: V3(), alive: true });
      }
      // sharks
      for (let i = 0; i < 2; i++) {
        const mesh = this.makeFish('shark', 2.5 + i * 0.5); R.group.add(mesh);
        this.sharks.push({ mesh, L: 2.5 + i * 0.5, pos: V3(-50 - i * 20, -14 - i * 5, 40 - i * 60), vel: V3(), head: 0, pitch: 0, state: 'patrol', timer: 70 + i * 80, ang: i * 3, phase: 0, orbit: 9, radius: 0.34 });
      }
      // jellyfish
      const bell = new T.LatheGeometry([[0.0, 0.26], [0.1, 0.25], [0.2, 0.2], [0.27, 0.1], [0.29, 0.0], [0.25, -0.04], [0.2, -0.02]].map((p) => new T.Vector2(p[0], p[1])), 16), parts = [bell];
      for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.283, r0 = 0.16 + (i % 3) * 0.035; parts.push(G.tube([V3(Math.cos(a) * r0, -0.02, Math.sin(a) * r0), V3(Math.cos(a) * r0 * 0.9, -0.4, Math.sin(a) * r0 * 0.9), V3(Math.cos(a + 0.4) * r0 * 0.7, -0.85, Math.sin(a + 0.4) * r0 * 0.7), V3(Math.cos(a + 0.2) * r0 * 0.6, -1.3, Math.sin(a + 0.2) * r0 * 0.6)], 0.006, 4, false, 10)); }
      const jg = G.merge(parts), NJ = 12, jp = new Float32Array(NJ); for (let i = 0; i < NJ; i++) jp[i] = rnd() * 6.28;
      jg.setAttribute('aJ', new T.InstancedBufferAttribute(jp, 1));
      this.jelly = new T.InstancedMesh(jg, new T.ShaderMaterial({
        vertexShader: `attribute float aJ; uniform float uWTime; varying vec3 vW; varying vec3 vN; varying float vY;
          void main(){ vec3 p = position; float pulse = sin(uWTime * 1.7 + aJ); float k = smoothstep(-0.1, 0.26, p.y);
            p.xz *= 1.0 + pulse * 0.16 * (1.0 - k) * step(-0.05, p.y) ; p.y += pulse * 0.03;
            if (p.y < -0.05) { p.x += sin(uWTime * 1.3 + p.y * 5.0 + aJ) * 0.05 * -p.y; p.z += cos(uWTime * 1.1 + p.y * 4.0 + aJ) * 0.05 * -p.y; }
            vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vY = position.y; gl_Position = projectionMatrix * viewMatrix * wp; }`,
        fragmentShader: `varying vec3 vW; varying vec3 vN; varying float vY;\n${DB.GLSL.common}\n${DB.GLSL.water}\n void main(){ vec3 toP = vW - cameraPosition; float d = length(toP); vec3 rd = toP / d;
            float rim = pow(1.0 - abs(dot(normalize(vN), -rd)), 1.6); float depth = max(-vW.y, 0.0);
            vec3 c = (vec3(0.95, 0.55, 0.85) * (0.25 + rim * 1.3) + vec3(0.3, 0.6, 1.0) * 0.12) * (sunAtDepth(depth) * 0.3 + ambAtDepth(depth) * 0.6 + 0.02);
            c = waterFog(c, rd, d, max(-cameraPosition.y, 0.0)); gl_FragColor = vec4(c, (0.18 + rim * 0.75) * (vY < -0.05 ? 0.6 : 1.0)); }`,
        uniforms: DB.Ocean.water, transparent: true, depthWrite: false, side: T.DoubleSide, toneMapped: false,
      }), NJ);
      this.jelly.frustumCulled = false; this.jelly.renderOrder = 12; R.group.add(this.jelly);
      this.jellies = [];
      for (let i = 0; i < NJ; i++) { const a = rnd() * 6.283, d = 14 + rnd() * 46; this.jellies.push({ pos: V3(Math.cos(a) * d - 8, -3 - rnd() * 9, Math.sin(a) * d + 6), ph: rnd() * 6, s: 0.7 + rnd() * 0.9, cd: 0 }); }
    },

    // ---------------------------------------------------------------- things to gather, the octopus, turtles, the chest
    buildExtras() {
      const W = DB.World, R = DB.Reef, A = DB.Assets, UW = DB.UW, rnd = this.rnd, items = (this.items = []);
      const spot = (rocky, rmax) => {      // somewhere on the reef: rocky ground or open sand, clear of the wreck
        for (let i = 0; i < 80; i++) {
          const a = rnd() * 6.283, d = 6 + Math.sqrt(rnd()) * (rmax - 6), x = Math.cos(a) * d, z = Math.sin(a) * d, rk = W.rockiness(x, z), h = W.height(x, z);
          if ((rocky ? rk > 0.6 : rk < 0.25) && h > -26 && Math.hypot(x - R.wreck.x, z - R.wreck.z) > 12) return { x, z, y: h };
        }
        return null;
      };
      const mapped = (name) => { const m = A.maps(name, A.parts(name)[0].mat); return UW.material({ map: m.map, normalMap: m.normalMap, normalFlip: -1 }); };
      const kinds = [
        { key: 'urchin', geo: urchinGeo(), mat: UW.material({ color: 0x2a1238, detail: R.detailTex, detailScale: 9 }), n: 18, rocky: true, size: [0.07, 0.1], lift: 0 },
        A.has('lambis_shell') && { key: 'conch', geo: A.geo('lambis_shell', 0), mat: mapped('lambis_shell'), n: 12, rocky: false, size: [1.7, 2.8], lift: 0.01 },
        A.has('fab_starfish') && { key: 'starfish', geo: A.geo('fab_starfish', 0), mat: mapped('fab_starfish'), n: 16, rocky: false, size: [2.0, 3.4], lift: 0.005 },
      ].filter(Boolean);
      for (const k of kinds) {
        const im = new T.InstancedMesh(k.geo, k.mat, k.n); im.frustumCulled = false; R.group.add(im);
        k.geo.computeBoundingBox(); const dim = k.geo.boundingBox.getSize(_a), native = Math.max(dim.x, dim.y, dim.z);
        for (let i = 0; i < k.n; i++) {
          const p = spot(k.rocky, 52); if (!p) { im.count = i; break; }
          const s = k.size[0] + rnd() * (k.size[1] - k.size[0]);
          items.push({ key: k.key, im, i, pos: V3(p.x, p.y + k.lift, p.z), s, rot: rnd() * 6.283, tx: (rnd() - 0.5) * 0.3, tz: (rnd() - 0.5) * 0.3, L: native * s, alive: true });
        }
      }
      // two octopuses, each with a den on rock
      this.octos = [];
      for (let i = 0; i < 2; i++) {
        const mesh = new T.Mesh(octopusGeo(), UW.material({ vertexColors: true, octo: true, detail: R.detailTex, detailScale: 5, side: T.DoubleSide }));
        mesh.rotation.order = 'YZX'; mesh.frustumCulled = false; R.group.add(mesh);
        const L = 0.5 + rnd() * 0.4, den = spot(true, 38) || { x: 8 + i * 9, z: -6, y: W.height(8 + i * 9, -6) }, sp = DB.Species.octopus;
        this.octos.push({ key: 'octopus', sp, mesh, L, kg: sp.wK * L * L * L, den: V3(den.x, den.y + 0.03 * L, den.z), pos: V3(), vel: V3(), goal: V3(), head: rnd() * 6.28, state: 'sit', jets: 0, calm: 0, jet: 0, flush: 0, timer: 0, alive: true, radius: 0.16 * L, t: rnd() * 9 });
      }
      // two green turtles cruising over the reef
      this.turtles = [];
      if (A.has('fab_turtle')) for (let i = 0; i < 2; i++) {
        const mesh = new T.Mesh(A.geo('fab_turtle', 0), UW.material({ vertexColors: true, flap: true, detail: R.detailTex, detailScale: 3.5 }));
        mesh.rotation.order = 'YZX'; mesh.frustumCulled = false; R.group.add(mesh);
        const L = 1.0 + rnd() * 0.3, sp = DB.Species.turtle; mesh.scale.setScalar(L);
        this.turtles.push({ key: 'turtle', sp, mesh, L, kg: sp.wK * L * L * L, pos: V3(-8 + i * 26, -5 - i * 2, 8 - i * 24), vel: V3(), goal: V3(-8 + i * 26, -5, 8 - i * 24), head: rnd() * 6.28, pitch: 0, timer: 0, phase: rnd() * 6, scare: 0, radius: 0.3 * L });
      }
      // the pirates' chest, half sunk in the sand beside the wreck
      if (A.has('fab_chest')) {
        const g = (this.chest = new T.Group()), mats = window.DBA.models.fab_chest.mats, x = R.wreck.x + 7.5, z = R.wreck.z - 6.5, y = W.height(x, z);
        A.parts('fab_chest').forEach((p, i) => { const m = A.maps('fab_chest', p.mat), mesh = new T.Mesh(A.geo('fab_chest', i), UW.material({ map: m.map, normalMap: m.normalMap, normalFlip: -1, emis: /gold/i.test(mats[p.mat].name) ? 0.22 : 0.02 })); mesh.frustumCulled = false; g.add(mesh); });
        g.position.set(x, y - 0.06, z); g.rotation.set(0.1, 2.2, -0.07); g.scale.setScalar(0.62); R.group.add(g);
        this.chestPos = V3(x, y + 0.3, z);
      }
    },
    resetExtras() {
      const ims = new Set();
      for (const it of this.items) { it.alive = true; _m.compose(it.pos, _q.setFromEuler(_e.set(it.tx, it.rot, it.tz)), _s.set(it.s, it.s, it.s)); it.im.setMatrixAt(it.i, _m); ims.add(it.im); }
      for (const im of ims) im.instanceMatrix.needsUpdate = true;
      for (const o of this.octos) { o.alive = true; o.mesh.visible = true; o.state = 'sit'; o.jets = 0; o.jet = 0; o.flush = 0; o.pos.copy(o.den); o.vel.set(0, 0, 0); }
      for (const t of this.turtles) t.scare = 0;
      this.seen.clear(); this.chestOpen = false; this.pick = null; this.lock = null;
    },

    // what the spear would be pulled onto: the target nearest the crosshair, within the line's reach
    findLock(fw) {
      const cam = this.camera.position, lk = this._lk; let best = null, bs = 1e9;
      const test = (pos, vel, radius, name) => {
        const dx = pos.x - cam.x, dy = pos.y - cam.y, dz = pos.z - cam.z, along = dx * fw.x + dy * fw.y + dz * fw.z;
        if (along < 0.6 || along > 9.2) return;
        const lat = Math.sqrt(Math.max(dx * dx + dy * dy + dz * dz - along * along, 0)), tol = Math.max(0.22 + along * 0.06, radius * 1.2), sc = lat / tol + along * 0.03;
        if (lat < tol && sc < bs) { bs = sc; best = lk; lk.pos = pos; lk.vel = vel; lk.dist = along; lk.name = name; }
      };
      if (this.spear.state === 'loaded' && this.blackout === 0) {
        for (const f of this.targets) if (f.alive && f.state !== 'speared') test(f.pos, f.vel, f.radius, f.sp.name);
        for (const o of this.octos) if (o.alive) test(o.pos, o.vel, o.radius, o.sp.name);
        for (const s of this.sharks) if (s.state === 'approach' || s.state === 'charge') test(s.pos, s.vel, 0.4, DB.Species.shark.name);
        if (!best) for (const sf of this.sfish) if (sf.alive) test(sf.pos, sf.s.v, 0.08, DB.Species.jack.name);
      }
      this.lock = best && this.clearShot(best.pos) ? best : null;
    },
    // is the straight line from the eye to p clear of the seabed and the big rocks?
    clearShot(p) {
      const c = this.camera.position, W = DB.World, d = c.distanceTo(p);
      for (let i = 1; i <= 6; i++) { const t = i / 7, x = c.x + (p.x - c.x) * t, z = c.z + (p.z - c.z) * t; if (c.y + (p.y - c.y) * t < W.height(x, z) + 0.05) return false; }
      for (const k of DB.Reef.colliders) if (Math.hypot(k.x - c.x, k.y - c.y, k.z - c.z) < d && segPoint(c, p, k) < k.r * 0.85) return false;
      return true;
    },

    // octopus or turtle in the spear's path? true when it took the shot
    spearExtras(tail, tip) {
      const S = this.spear;
      for (const o of this.octos) if (o.alive && segPoint(tail, tip, o.pos) < o.radius * 1.4 + 0.12) {
        o.alive = false; o.state = 'speared'; S.fish = o;
        DB.FX.cloud(o.pos.x, o.pos.y, o.pos.z, 14, 0.012, 0.012, 0.02, 0.6, 6); DB.emit('ink'); DB.emit('spearHit', { kill: true });
        S.state = 'back'; S.t = -0.3; return true;
      }
      for (const t of this.turtles) if (segPoint(tail, tip, t.pos) < t.radius + 0.1) {      // the shaft glances off the shell; she is protected anyway
        t.scare = 6; t.timer = 6; t.goal.copy(t.pos).addScaledVector(S.vel, 0.9); t.goal.y = Math.min(t.pos.y + 2, -2);
        DB.emit('thud'); DB.emit('protected'); S.state = 'back'; S.t = -0.1; return true;
      }
      return false;
    },
    octoJet(o, from) {
      const W = DB.World;
      o.jets++; o.calm = 0; o.state = 'jet'; o.timer = 5;
      DB.FX.cloud(o.pos.x, o.pos.y + 0.15, o.pos.z, 26, 0.012, 0.012, 0.02, 0.75, 7);        // ink
      // away from the diver, to another patch of rock if there is one
      let a = Math.atan2(o.pos.z - from.z, o.pos.x - from.x) + (Math.random() - 0.5) * 1.2, best = null;
      for (let i = 0; i < 8; i++) { const d = 6 + Math.random() * 4, x = o.pos.x + Math.cos(a) * d, z = o.pos.z + Math.sin(a) * d; if (Math.hypot(x, z) < 55) { best = { x, z }; if (W.rockiness(x, z) > 0.5) break; } a += 0.5; }
      if (!best) best = { x: o.den.x, z: o.den.z };
      o.goal.set(best.x, W.height(best.x, best.z) + 0.03 * o.L, best.z);
      DB.emit('ink');
    },
    take(pk) {
      let rec;
      if (pk === 'chest') { this.chestOpen = true; rec = { key: 'treasure', L: 0.7, kg: DB.Species.treasure.wK * 0.343, method: 'hand' }; DB.FX.cloud(this.chestPos.x, this.chestPos.y, this.chestPos.z, 10, 0.75, 0.7, 0.6, 0.3, 2.5); }
      else if (pk.key === 'octopus') { pk.alive = false; pk.mesh.visible = false; rec = { key: 'octopus', L: pk.L, kg: pk.kg, method: 'hand' }; DB.FX.cloud(pk.pos.x, pk.pos.y + 0.1, pk.pos.z, 8, 0.012, 0.012, 0.02, 0.5, 5); }
      else {
        pk.alive = false; _m.makeScale(0, 0, 0); pk.im.setMatrixAt(pk.i, _m); pk.im.instanceMatrix.needsUpdate = true;
        rec = { key: pk.key, L: pk.L, kg: DB.Species[pk.key].wK * pk.L * pk.L * pk.L, method: 'hand' }; DB.FX.cloud(pk.pos.x, pk.pos.y + 0.05, pk.pos.z, 5, 0.75, 0.7, 0.6, 0.22, 2);
      }
      this.bag.push(rec); this.pick = null; DB.emit('catch', rec);
    },
    updateExtras(dt, inp, fw) {
      const P = this.pos, W = DB.World, cam = this.camera.position;
      // --- octopus: sits camouflaged; jets off in a cloud of ink when crowded, and is spent after two bursts
      for (const o of this.octos) {
        if (!o.alive) continue;
        o.t += dt;
        const u = o.mesh.material.uniforms;
        if (o.state === 'sit') {
          o.calm += dt; if (o.calm > 22) o.jets = 0;
          if (o.jets < 2 && o.pos.distanceToSquared(P) < 2.7 * 2.7) this.octoJet(o, P);
        } else {
          const to = _a.subVectors(o.goal, o.pos), tl = to.length(); o.timer -= dt;
          if (tl < 0.35 || o.timer <= 0) { o.state = 'sit'; o.pos.copy(o.goal); o.vel.set(0, 0, 0); o.calm = 0; }
          else {
            o.vel.lerp(to.multiplyScalar(Math.min(3.4, 0.8 + tl * 1.4) / tl), 1 - Math.exp(-4 * dt)); o.pos.addScaledVector(o.vel, dt);
            const fl = W.height(o.pos.x, o.pos.z) + 0.25; if (o.pos.y < fl) o.pos.y = fl;
            o.head = M.dampAngle(o.head, yawOf(o.vel.x, o.vel.z), 8, dt);
          }
        }
        o.jet = M.damp(o.jet, o.state === 'jet' ? 1 : 0, o.state === 'jet' ? 9 : 2.5, dt);
        u.uOcto.value.set(o.t, o.state === 'sit' ? 0.05 : 0.02, o.jet, 0);
        o.flush = M.damp(o.flush, o.jets >= 2 || o.state === 'jet' ? 1 : 0, 2, dt);      // mottled like the rock while it hides, flushed pale once alarmed
        u.uTint.value.setRGB(1 + o.flush * 0.9, 1 + o.flush * 0.45, 1 + o.flush * 0.35);
        o.mesh.position.copy(o.pos); o.mesh.rotation.set(0, o.head, o.jet * 0.15); o.mesh.scale.setScalar(o.L);
      }
      // --- turtles: unhurried, protected. Swimming up close logs the sighting.
      for (const t of this.turtles) {
        t.timer -= dt; t.scare = Math.max(t.scare - dt, 0);
        if (t.timer <= 0 || t.pos.distanceToSquared(t.goal) < 2) {
          const a = Math.random() * 6.283, d = 8 + Math.random() * 38; t.goal.set(Math.cos(a) * d, 0, Math.sin(a) * d);
          t.goal.y = Math.min(W.height(t.goal.x, t.goal.z) + 2.5 + Math.random() * 6, -1.8); t.timer = 14 + Math.random() * 14;
        }
        const to = _a.subVectors(t.goal, t.pos), tl = to.length() || 1;
        t.vel.lerp(to.multiplyScalar((t.scare > 0 ? 1.9 : 0.62) / tl), 1 - Math.exp(-0.8 * dt)); t.pos.addScaledVector(t.vel, dt);
        const fl = W.height(t.pos.x, t.pos.z) + 0.9; if (t.pos.y < fl) t.pos.y = fl; if (t.pos.y > -1.4) t.pos.y = -1.4;
        const hs = Math.hypot(t.vel.x, t.vel.z);
        if (hs > 0.03) t.head = M.dampAngle(t.head, yawOf(t.vel.x, t.vel.z), 1.6, dt);
        t.pitch = M.damp(t.pitch, Math.atan2(t.vel.y, Math.max(hs, 0.2)) * 0.7, 2, dt);
        t.phase += dt * (1.5 + t.vel.length() * 1.6);
        t.mesh.position.copy(t.pos); t.mesh.rotation.set(Math.sin(t.phase * 0.5) * 0.06, t.head, t.pitch);
        t.mesh.material.uniforms.uFlap.value.set(t.phase, 0.34, 0, 0);
        if (!this.seen.has(t) && t.pos.distanceToSquared(P) < 16) { this.seen.add(t); DB.emit('catch', { key: 'turtle', L: t.L, kg: t.kg, method: 'watch' }); }
      }
      // --- within arm's reach under the crosshair?
      let pk = null, bd = 2.3;
      const reach = (pos, slack) => { const dx = pos.x - cam.x, dy = pos.y - cam.y, dz = pos.z - cam.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz); return d < bd && (dx * fw.x + dy * fw.y + dz * fw.z) / (d || 1) > 0.62 - slack ? d : 0; };
      for (const it of this.items) if (it.alive) { const d = reach(it.pos, 0); if (d) { bd = d; pk = it; } }
      for (const o of this.octos) if (o.alive && o.state === 'sit') { const d = reach(o.pos, 0.1); if (d) { bd = d; pk = o; } }
      if (this.chest && !this.chestOpen) { const d = reach(this.chestPos, 0.15); if (d) { bd = d; pk = 'chest'; } }
      this.pick = pk ? { name: DB.Species[pk === 'chest' ? 'treasure' : pk.key].name, verb: pk === 'chest' ? '열기' : pk.key === 'octopus' ? '잡기' : '채집' } : null;
      if (pk && inp.pressed('KeyE') && this.blackout === 0) this.take(pk);
    },

    // plain-PBR copies of the things above, for the field-guide portraits
    model(key) {
      const A = DB.Assets, std = (o) => new T.MeshStandardMaterial(Object.assign({ roughness: 0.6, metalness: 0 }, o));
      if (key === 'octopus') { const m = new T.Mesh(octopusGeo(), std({ vertexColors: true, side: T.DoubleSide })); m.rotation.y = 2.3; return m; }
      if (key === 'turtle' && A.has('fab_turtle')) { const m = new T.Mesh(A.geo('fab_turtle', 0), std({ vertexColors: true })); m.rotation.y = 0.55; return m; }
      if (key === 'urchin') return new T.Mesh(urchinGeo(), std({ color: 0x3a1c4e, roughness: 0.45 }));
      if (key === 'conch' && A.has('lambis_shell')) return A.object('lambis_shell');
      if (key === 'starfish' && A.has('fab_starfish')) { const o = A.object('fab_starfish'); o.rotation.x = 0.8; return o; }
      if (key === 'treasure' && A.has('fab_chest')) { const o = A.object('fab_chest'); o.rotation.y = 2.3; return o; }
      return null;
    },
    // where the boarding ladder is
    ladder(out) { return out.set(0, 0, 4.7).applyMatrix4(DB.Boat.group.matrixWorld); },

    // ---------------------------------------------------------------- enter / leave
    enter(opts = {}) {
      const B = DB.Boat;
      this.active = true; this.rig.visible = true; this.o2 = 1; this.bag = []; this.blackout = 0; this.hurt = 0; this.t = 0; this.breathT = 1.5; this.marker = null;
      this.pos.set(-2.7, 0, 2.4).applyMatrix4(B.group.matrixWorld); this.pos.y = -1.4; this.vel.set(0, -1.6, 0);
      this.spear.state = 'loaded'; this.shaft.visible = true; this.flying.visible = false; this.line.mesh.visible = false; this.loaded = true;
      // everyone back to their posts
      for (const f of this.targets) if (!f.escapee) { f.alive = true; f.mesh.visible = true; f.pos.copy(f.home); f.vel.set(0, 0, 0); f.state = 'idle'; f.hp = f.ai.hp; f.bleed = 0; }
      for (const s of this.sfish) s.alive = true;
      this.resetExtras();
      this.sharks.forEach((s, i) => { s.state = 'patrol'; s.timer = 65 + i * 70 + Math.random() * 30; });      // time to hunt before the first one turns up
      this.targets = this.targets.filter((f) => { if (f.escapee) { DB.Reef.group.remove(f.mesh); return false; } return true; });
      if (opts.chase) this.spawnEscapee(opts.chase);
      DB.FX.clear(); DB.FX.bubbles(this.pos.x, this.pos.y + 0.6, this.pos.z, 170, 1.6, 0.05, 1.2);
    },
    leave() { this.active = false; this.rig.visible = false; this.flying.visible = false; this.line.mesh.visible = false; DB.UW.torch.uTorch.value.x = 0; this.torch = false; },

    // the fish that just broke the line: tired, trailing the leader, slowly making for open water
    spawnEscapee(e) {
      const ind = { key: e.key, sp: DB.Species[e.key], L: e.L, kg: e.kg }, mesh = this.makeFish(e.key, e.L); DB.Reef.group.add(mesh);
      const dir = _a.set(e.x - this.pos.x, 0, e.z - this.pos.z); if (dir.lengthSq() < 1) dir.set(DB.World.deepDir.x, 0, DB.World.deepDir.z); dir.normalize();
      const x = this.pos.x + dir.x * 19, z = this.pos.z + dir.z * 19, y = Math.max(DB.World.height(x, z) + 3, -9);
      const f = Object.assign(ind, { ai: { shy: 0, cruise: 0.5 + 2.4 * e.S, burst: 0.9 + 3.2 * e.S, hp: 60 + 140 * e.S, hover: 3, roam: 0 }, mesh, home: V3(x, y, z), pos: V3(x, y, z), vel: V3(dir.x, 0, dir.z), goal: V3(), head: 0, pitch: 0, state: 'escapee', timer: 75, hp: 60 + 140 * e.S, phase: 0, alive: true, bleed: 0, escapee: true, dir: V3(dir.x, 0, dir.z), radius: Math.max(ind.sp.prof.reduce((m, p) => Math.max(m, p[1], p[2]), 0) * e.L, 0.1) });
      this.targets.push(f); this.marker = f;
    },

    canBoard() { this.ladder(_a); return this.depth < 4 && Math.hypot(this.pos.x - _a.x, this.pos.z - _a.z) < 7; },

    // ---------------------------------------------------------------- per-frame
    update(dt, inp, look) {
      if (!this.active) return;
      this.t += dt;
      const W = DB.World, O = DB.Ocean, cam = this.camera, P = this.pos, V = this.vel;
      // --- swim
      const fw = (this._fw || (this._fw = V3())).set(0, 0, -1).applyQuaternion(cam.quaternion), rt = (this._rt || (this._rt = V3())).set(1, 0, 0).applyQuaternion(cam.quaternion);
      const ctl = this.blackout > 0 ? 0 : 1;
      const f = (inp.down('KeyW') ? 1 : 0) - (inp.down('KeyS') ? 1 : 0), s = (inp.down('KeyD') ? 1 : 0) - (inp.down('KeyA') ? 1 : 0), u = (inp.down('Space') ? 1 : 0) - (inp.down('KeyC') ? 1 : 0);      // not Ctrl: Ctrl+W would close the tab mid-dive
      this.sprint = inp.down('ShiftLeft') && (f || s || u) && ctl;
      const acc = (this.sprint ? 6.2 : 3.4) * ctl;
      V.x += (fw.x * f + rt.x * s) * acc * dt; V.y += (fw.y * f + u * 0.9) * acc * dt; V.z += (fw.z * f + rt.z * s) * acc * dt;
      const drag = Math.exp(-1.7 * dt); V.multiplyScalar(drag);
      const vmax = this.sprint ? 3.3 : 1.9, sp = V.length(); if (sp > vmax) V.multiplyScalar(vmax / sp);
      V.y += Math.sin(this.t * 1.55) * 0.02 * dt + (this.blackout > 0 ? 0.5 * dt : 0);
      // current pushes back toward the reef when straying off the site (the reef is centred on the world origin; the boat may lie anywhere over it)
      const far = Math.hypot(P.x, P.z);
      this.warn = '';
      if (far > DB.Reef.radius - 6) { const k = M.sat((far - DB.Reef.radius + 6) / 8); V.x -= (P.x / far) * k * 6 * dt; V.z -= (P.z / far) * k * 6 * dt; this.warn = 'far'; }
      P.addScaledVector(V, dt);
      // collisions: seabed, surface, big rocks, wreck hull
      const floor = W.height(P.x, P.z) + 0.55; if (P.y < floor) { P.y = floor; if (V.y < 0) V.y = 0; }
      const top = O.height(P.x, P.z) - 0.45; if (P.y > top) { P.y = top; if (V.y > 0) V.y = 0; }
      for (const c of DB.Reef.colliders) { const dx = P.x - c.x, dy = P.y - c.y, dz = P.z - c.z, d2 = dx * dx + dy * dy + dz * dz, rr = c.r + 0.35; if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2), k = (rr - d) / d; P.x += dx * k; P.y += dy * k; P.z += dz * k; } }
      this.depth = Math.max(-P.y, 0);
      if (this.depth > this.maxDepth) this.warn = 'deep';
      // --- air
      const use = 0.00165 * (1 + this.depth / 10) * (this.sprint ? 2.1 : 1) * (this.hurt > 0 ? 1.6 : 1) * (this.depth > this.maxDepth ? 2.2 : 1);
      this.o2 = Math.max(this.o2 - use * dt, 0); this.hurt = Math.max(this.hurt - dt, 0);
      this.breathT -= dt * (this.sprint ? 1.7 : 1) * (this.o2 < 0.2 ? 1.5 : 1);
      if (this.breathT <= 0 && this.blackout === 0) {
        this.breathT = 4.4; DB.emit('exhale');
        const m = _c.copy(P).addScaledVector(fw, 0.25); DB.FX.bubbles(m.x, m.y - 0.14, m.z, 14, 0.12, 0.035, 0.7);
      }
      if (this.o2 <= 0) { if (this.blackout === 0) DB.emit('blackoutStart'); this.blackout += dt; if (this.blackout > 3.2) { this.blackout = -1; DB.emit('blackout'); return; } }
      // --- look + torch
      if (inp.pressed('KeyL')) { this.torch = !this.torch; DB.emit('torch', this.torch); }
      const tu = DB.UW.torch; tu.uTorch.value.x = M.damp(tu.uTorch.value.x, this.torch ? 2.6 : 0, 12, dt); tu.uTorchPos.value.copy(P).addScaledVector(rt, 0.18).addScaledVector(fw, 0.3); tu.uTorchDir.value.copy(fw);
      // --- gun pose (lags behind the view a little, kicks on fire, dips while reloading)
      this.swayX = M.damp(this.swayX, M.clamp(look.dYaw || 0, -0.5, 0.5), 9, dt); this.swayY = M.damp(this.swayY, M.clamp(look.dPitch || 0, -0.5, 0.5), 9, dt);
      this.kick = M.damp(this.kick, 0, 7, dt);
      const rl = this.spear.state === 'reload' ? Math.sin(Math.PI * M.sat(this.reloadT / 0.9)) : 0, aim = inp.mouse(2) ? 1 : 0;
      this.aimK = M.damp(this.aimK || 0, aim, 10, dt);
      const bob = Math.sin(this.t * 1.55) * 0.006;
      this.gun.position.set(0.19 - this.aimK * 0.07 + this.swayX * 0.05, -0.2 + this.aimK * 0.04 + bob - rl * 0.1 + this.swayY * 0.04, -0.4 + this.kick * 0.09 - this.aimK * 0.03);
      this.gun.rotation.set(0.075 - this.aimK * 0.02 + this.kick * 0.12 - rl * 0.5 - this.swayY * 0.12, 0.09 - this.aimK * 0.05 + this.swayX * 0.14, rl * 0.25, 'YXZ');
      this.gun.updateMatrix();
      const iv = _m.copy(this.gun.matrix).invert();
      this.armR.pose(_s.set(0, -0.075, 0.037), _d.set(0, 0.955, -0.295), _c.copy(this.elR).applyMatrix4(iv));
      const lz = -0.52 + rl * 0.2;
      this.armL.pose(_s.set(0, 0, lz), _d.set(0, 0, 1), _c.copy(this.elL).applyMatrix4(iv));
      this.gun.updateMatrixWorld(true);
      // --- spear
      this.findLock(fw);
      this.updateSpear(dt, inp, fw);
      // --- life
      this.updateTargets(dt, sp); this.updateSchools(dt); this.updateSharks(dt); this.updateJellies(dt); this.updateExtras(dt, inp, fw);
      this.prompt = this.canBoard() ? 'board' : '';
    },

    muzzle(out) { return out.set(0, 0.029, -1.02).applyMatrix4(this.gun.matrixWorld); },

    updateSpear(dt, inp, fw) {
      const S = this.spear, W = DB.World;
      if (S.state === 'loaded') {
        if (inp.mouseDown(0) && this.blackout === 0) {
          this.muzzle(S.pos); S.prev.copy(S.pos);
          // aim assist: a target near the crosshair pulls the shot onto where it will be when the shaft arrives (drag included);
          // otherwise converge on what the crosshair is looking at
          const lk = this.lock, aimP = _c;
          if (lk) { const tt = (Math.exp(0.115 * lk.dist) - 1) / (0.115 * 27); aimP.copy(lk.pos).addScaledVector(lk.vel, tt); aimP.y += tt * tt; }
          else aimP.copy(this.camera.position).addScaledVector(fw, 9);
          S.vel.subVectors(aimP, S.pos).normalize().multiplyScalar(27);
          S.state = 'fly'; S.t = 0; S.fish = null; this.loaded = false; this.kick = 1;
          this.shaft.visible = false; this.flying.visible = true; this.line.mesh.visible = true;
          DB.FX.bubbles(S.pos.x, S.pos.y, S.pos.z, 12, 0.08, 0.02, 0.4); DB.emit('shoot');
        }
      } else if (S.state === 'fly') {
        S.t += dt; S.prev.copy(S.pos);
        const v = S.vel.length(); S.vel.multiplyScalar(1 / (1 + 0.115 * v * dt)); S.vel.y -= 2.0 * dt;      // quadratic water drag
        S.pos.addScaledVector(S.vel, dt);
        this.muzzle(_c);
        const out = S.pos.distanceTo(_c);
        if (Math.random() < dt * 40) DB.FX.bubbles(S.pos.x, S.pos.y, S.pos.z, 1, 0.03, 0.012, 0.2);
        // hits
        const tipP = S.pos, tailP = S.prev;
        let hit = null;
        for (const f of this.targets) { if (!f.alive || f.state === 'speared') continue; if (Math.abs(f.pos.x - tipP.x) + Math.abs(f.pos.z - tipP.z) > 8) continue; if (this.fishSeg(f, tailP, tipP) < f.radius * 1.35 + 0.09) { hit = f; break; } }
        if (!hit) for (const sf of this.sfish) { if (sf.alive && sf.pos.distanceToSquared(tipP) < 0.09) { hit = sf; break; } }
        let shark = null;
        if (!hit) for (const sh of this.sharks) {
          const hx = Math.cos(sh.head) * sh.L * 0.4, hz = -Math.sin(sh.head) * sh.L * 0.4;
          if (segDist(tailP, tipP, s0.set(sh.pos.x - hx, sh.pos.y, sh.pos.z - hz), s1.set(sh.pos.x + hx, sh.pos.y, sh.pos.z + hz)) < sh.radius * sh.L * 0.3 + 0.12) { shark = sh; break; }
        }
        if (hit) this.onHit(hit, v);
        else if (shark) { shark.state = 'retreat'; shark.timer = 45; DB.FX.cloud(S.pos.x, S.pos.y, S.pos.z, 6, 0.5, 0.02, 0.02, 0.35, 4); DB.emit('sharkHit', shark); S.state = 'back'; S.t = 0; }
        else if (this.spearExtras(tailP, tipP)) { /* an octopus is on the shaft, or it glanced off a turtle */ }
        else if (DB.Reef.colliders.some((k) => (tipP.x - k.x) * (tipP.x - k.x) + (tipP.y - k.y) * (tipP.y - k.y) + (tipP.z - k.z) * (tipP.z - k.z) < k.r * k.r * 0.72)) { DB.emit('thud'); S.state = 'back'; S.t = -0.2; }      // struck a boulder
        else if (S.pos.y < W.height(S.pos.x, S.pos.z) + 0.03) { S.pos.y = W.height(S.pos.x, S.pos.z) + 0.03; DB.FX.cloud(S.pos.x, S.pos.y + 0.1, S.pos.z, 7, 0.75, 0.7, 0.6, 0.3, 2.5); DB.emit('thud'); S.state = 'back'; S.t = -0.25; }
        else if (out > 9.5 || v < 2.2 || S.t > 1.6) { S.state = 'back'; S.t = -0.1; }
      } else if (S.state === 'back') {      // reel the shaft (and anything on it) back to the muzzle
        S.t += dt;
        if (S.t > 0) {
          this.muzzle(_c); const d = _c.sub(S.pos), len = d.length(), step = (S.fish && S.fish.kg > 15 ? 5 : 10) * dt;
          if (len < step + 0.05) {
            if (S.fish) this.bagFish(S.fish);
            S.state = 'reload'; this.reloadT = 0; this.flying.visible = false; this.line.mesh.visible = false; DB.emit('reload');
          } else { S.pos.addScaledVector(d, step / len); S.vel.copy(d).multiplyScalar(-1); }
          if (S.fish) { const f = S.fish; f.pos.copy(S.pos); if (f.mesh) { f.phase += dt * 24; f.mesh.position.copy(f.pos); f.mesh.material.uniforms.uSwim.value.set(f.phase, 1.5, 0, 0); } if (Math.random() < dt * 14) DB.FX.cloud(S.pos.x, S.pos.y, S.pos.z, 1, 0.35, 0.01, 0.01, 0.25, 4); }
        }
      } else if (S.state === 'reload') {
        this.reloadT += dt;
        if (this.reloadT > 0.9) { S.state = 'loaded'; this.loaded = true; this.shaft.visible = true; }
      }
      if (this.flying.visible) {
        const dir = _a.copy(S.vel); if (dir.lengthSq() < 1e-6) dir.copy(fw); dir.normalize();
        this.flying.quaternion.setFromUnitVectors(_b.set(0, 0, -1), dir);        // S.pos tracks the tip; the mesh origin sits 1.31 m behind it
        this.flying.position.copy(S.pos); this.flying.translateZ(1.31);
        // line: muzzle → shaft tail
        this.muzzle(_c); const tail = _d.copy(S.pos).addScaledVector(dir, -1.28), n = 12;
        for (let i = 0; i < n; i++) { const t = i / (n - 1), sag = Math.sin(t * Math.PI) * 0.15 * (S.state === 'back' ? 0.3 : 1); this.line.set(i, M.lerp(_c.x, tail.x, t), M.lerp(_c.y, tail.y, t) - sag, M.lerp(_c.z, tail.z, t)); }
        this.line.commit(n);
      }
    },
    fishSeg(f, p0, p1) {
      const hx = Math.cos(f.head) * Math.cos(f.pitch), hz = -Math.sin(f.head) * Math.cos(f.pitch), hy = Math.sin(f.pitch);
      return segDist(p0, p1, f0.set(f.pos.x - hx * f.L * 0.36, f.pos.y - hy * f.L * 0.36, f.pos.z - hz * f.L * 0.36), f1.set(f.pos.x + hx * f.L * 0.4, f.pos.y + hy * f.L * 0.4, f.pos.z + hz * f.L * 0.4));
    },
    onHit(f, speed) {
      const S = this.spear, dmg = 55 + speed * 5;
      DB.FX.cloud(S.pos.x, S.pos.y, S.pos.z, 9, 0.45, 0.015, 0.015, 0.3, 6);
      if (f.s) {       // school fish: always a clean kill
        f.alive = false; S.fish = { key: 'jack', sp: DB.Species.jack, L: f.L, kg: 14 * f.L * f.L * f.L, pos: V3().copy(S.pos), school: f };
        f.s.scare = 2.5; DB.emit('spearHit', { kill: true });
      } else {
        f.hp -= dmg; f.bleed = 8;
        if (f.hp <= 0) { f.state = 'speared'; S.fish = f; DB.emit('spearHit', { kill: true }); }
        else { f.state = 'flee'; f.timer = 4; f.vel.copy(S.vel).setLength(f.ai.burst); DB.emit('spearHit', { kill: false, key: f.key }); }
      }
      // blood draws sharks
      for (const sh of this.sharks) if (sh.state === 'patrol' && Math.random() < 0.55) { sh.state = 'approach'; sh.timer = 26 + Math.random() * 12; sh.orbit = 10; DB.emit('sharkNear'); }
      S.state = 'back'; S.t = -0.3;
    },
    bagFish(f) {
      const rec = { key: f.key, L: f.L, kg: f.kg, method: f.escapee ? 'chase' : 'spear' };
      this.bag.push(rec);
      if (f.mesh) { f.alive = false; f.mesh.visible = false; if (f.escapee) this.marker = null; }
      else if (f.school) { /* instance already hidden */ }
      DB.emit('catch', rec);
    },

    updateTargets(dt, pSpeed) {
      const P = this.pos, W = DB.World;
      for (const f of this.targets) {
        if (!f.alive || f.state === 'speared') continue;
        const ai = f.ai, dx = f.pos.x - P.x, dy = f.pos.y - P.y, dz = f.pos.z - P.z, dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const fleeR = ai.shy * (0.6 + pSpeed * 0.45);      // creep up and they let you close; charge in and they are gone
        f.timer -= dt; let speed = ai.cruise;
        if (f.state === 'escapee') {
          speed = dist < 7 ? ai.burst : ai.cruise;
          f.dir.applyAxisAngle(YAX, Math.sin(this.t * 0.3) * 0.25 * dt);
          f.goal.copy(f.pos).addScaledVector(f.dir, 6); f.goal.y = Math.max(W.height(f.goal.x, f.goal.z) + 3, -11);
          if (f.timer <= 0 || Math.hypot(f.pos.x, f.pos.z) > DB.Reef.radius + 12) { f.alive = false; f.mesh.visible = false; this.marker = null; DB.emit('escaped'); continue; }
        } else if (f.state === 'flee') {
          speed = ai.burst * M.sat(f.timer / 2 + 0.3);
          if (f.timer <= 0) { f.state = 'idle'; f.timer = 0; }
        } else {
          if (dist < fleeR) {       // bolt away, biased toward home cover
            f.state = 'flee'; f.timer = 2 + Math.random() * 2;
            f.goal.set(f.pos.x + (dx / dist) * 14 + (Math.random() - 0.5) * 10, 0, f.pos.z + (dz / dist) * 14 + (Math.random() - 0.5) * 10);
            f.goal.y = Math.min(W.height(f.goal.x, f.goal.z) + ai.hover + 0.4, -1.5);
          } else if (dist < fleeR * 1.9) { f.state = 'alert'; speed = ai.cruise * 0.35; }
          else if (f.state === 'alert') f.state = 'idle';
          if (f.state !== 'flee' && (f.timer <= 0 || f.pos.distanceToSquared(f.goal) < 0.5)) {
            const a = Math.random() * 6.283, d = Math.random() * ai.roam;
            f.goal.set(f.home.x + Math.cos(a) * d, 0, f.home.z + Math.sin(a) * d); f.goal.y = Math.min(W.height(f.goal.x, f.goal.z) + ai.hover + f.L * 0.3 + Math.random() * ai.hover, -1.5);
            f.timer = 3 + Math.random() * 6;
          }
        }
        // steer
        const to = _a.subVectors(f.goal, f.pos), tl = to.length() || 1; to.multiplyScalar(speed / tl);
        f.vel.lerp(to, 1 - Math.exp(-(f.state === 'flee' ? 5 : 1.6) * dt));
        f.pos.addScaledVector(f.vel, dt);
        const fl = W.height(f.pos.x, f.pos.z) + f.L * 0.22 + 0.3; if (f.pos.y < fl) { f.pos.y = fl; f.vel.y = Math.max(f.vel.y, 0.2); } if (f.pos.y > -1.2) f.pos.y = -1.2;
        const hs = Math.hypot(f.vel.x, f.vel.z);
        if (hs > 0.03) f.head = M.dampAngle(f.head, yawOf(f.vel.x, f.vel.z), 5, dt);
        f.pitch = M.damp(f.pitch, Math.atan2(f.vel.y, Math.max(hs, 0.2)) * 0.8, 4, dt);
        f.phase += dt * (3 + f.vel.length() * 5.5) / Math.max(Math.sqrt(f.L), 0.5);
        if (f.bleed > 0) { f.bleed -= dt; if (Math.random() < dt * 8) DB.FX.cloud(f.pos.x, f.pos.y, f.pos.z, 1, 0.4, 0.012, 0.012, 0.22, 5); }
        f.mesh.position.copy(f.pos); f.mesh.rotation.set(0, f.head, f.pitch);
        f.mesh.material.uniforms.uSwim.value.set(f.phase, 0.55 + Math.min(f.vel.length() * 0.25, 0.9), 0, 0);
      }
    },

    updateSchools(dt) {
      const P = this.pos, W = DB.World, im = this.schoolMesh;
      for (const s of this.schools) {
        s.timer -= dt; s.scare = Math.max(s.scare - dt, 0);
        const d = s.c.distanceTo(P);
        if (d < 6.5 && s.scare <= 0) { s.scare = 1.8; s.goal.copy(s.c).addScaledVector(_a.subVectors(s.c, P).setY(0).normalize(), 22); s.goal.y = s.c.y; s.timer = 4; }
        if (s.timer <= 0) { const a = Math.random() * 6.283, r = 10 + Math.random() * 38; s.goal.set(Math.cos(a) * r - 4, 0, Math.sin(a) * r + 2); s.goal.y = Math.min(W.height(s.goal.x, s.goal.z) + 3 + Math.random() * 5, -2.5); s.timer = 9 + Math.random() * 10; }
        const to = _a.subVectors(s.goal, s.c), tl = to.length() || 1, spd = s.scare > 0 ? 5.5 : 1.3;
        s.v.lerp(to.multiplyScalar(spd / tl), 1 - Math.exp(-1.2 * dt)); s.c.addScaledVector(s.v, dt);
        const fl = W.height(s.c.x, s.c.z) + 2.5; if (s.c.y < fl) s.c.y = fl; if (s.c.y > -2) s.c.y = -2;
      }
      const t = this.t;
      for (const f of this.sfish) {
        const s = f.s, R = s.r * (1 + s.scare * 0.5);
        if (!f.alive) { _m.makeScale(0, 0, 0); im.setMatrixAt(f.i, _m); continue; }
        const a = t * f.w + f.p, ca = Math.cos(a * 0.4), sa = Math.sin(a * 0.4);
        f.pos.set(s.c.x + (f.o.x * ca - f.o.z * sa) * R + Math.sin(a * 1.7) * 0.25, s.c.y + f.o.y * R + Math.sin(a * 1.3 + f.p) * 0.2, s.c.z + (f.o.x * sa + f.o.z * ca) * R + Math.cos(a * 1.5) * 0.25);
        const hv = Math.hypot(s.v.x, s.v.z) || 1;
        _e.set(0, yawOf(s.v.x, s.v.z) + Math.sin(a) * 0.25, Math.atan2(s.v.y, hv) + Math.sin(a * 1.3) * 0.1);
        _m.compose(f.pos, _q.setFromEuler(_e), _s.set(f.L, f.L, f.L)); im.setMatrixAt(f.i, _m);
      }
      im.instanceMatrix.needsUpdate = true;
    },

    updateSharks(dt) {
      const P = this.pos, W = DB.World; let nearest = 99;
      for (const s of this.sharks) {
        s.timer -= dt; let speed = 1.5; const goal = _a;
        const dist = s.pos.distanceTo(P);
        if (s.state === 'patrol') {
          s.ang += dt * 0.022; goal.set(Math.cos(s.ang) * 62 - 16, -13 - 5 * Math.sin(s.ang * 3), Math.sin(s.ang) * 62 + 12);
          if (s.timer <= 0) { s.state = 'approach'; s.timer = 22 + Math.random() * 14; s.orbit = 11; DB.emit('sharkNear'); }
        } else if (s.state === 'approach') {     // circle in, tightening
          s.ang += dt * (2.0 / Math.max(s.orbit, 4)); s.orbit = Math.max(s.orbit - dt * 0.22, 5.2); speed = 2.3;
          goal.set(P.x + Math.cos(s.ang) * s.orbit, P.y + Math.sin(s.ang * 0.7) * 1.2, P.z + Math.sin(s.ang) * s.orbit);
          if (s.timer <= 0) { s.state = 'charge'; s.timer = 4; DB.emit('sharkCharge'); }
        } else if (s.state === 'charge') {
          speed = 6.8; goal.copy(P);
          if (dist < 1.25) {
            s.state = 'retreat'; s.timer = 35; this.o2 = Math.max(this.o2 - 0.2, 0.02); this.hurt = 6;
            this.vel.addScaledVector(_b.subVectors(P, s.pos).normalize(), 4);
            const stolen = this.bag.pop(); DB.FX.cloud(P.x, P.y, P.z, 8, 0.5, 0.02, 0.02, 0.3, 4); DB.FX.bubbles(P.x, P.y, P.z, 40, 0.5, 0.04, 1);
            DB.emit('sharkBite', { stolen: stolen || null, L: s.L });
          } else if (s.timer <= 0) { s.state = 'approach'; s.timer = 10; s.orbit = 8; }
        } else {      // retreat
          speed = 4.5; goal.copy(s.pos).addScaledVector(_b.subVectors(s.pos, P).setY(0).normalize(), 20); goal.y = -16;
          if (s.timer <= 0) { s.state = 'patrol'; s.timer = 70 + Math.random() * 50; }
        }
        const to = _c.subVectors(goal, s.pos), tl = to.length() || 1; to.multiplyScalar(speed / tl);
        s.vel.lerp(to, 1 - Math.exp(-(s.state === 'charge' ? 3 : 1.1) * dt)); s.pos.addScaledVector(s.vel, dt);
        const fl = W.height(s.pos.x, s.pos.z) + 1.2; if (s.pos.y < fl) s.pos.y = fl; if (s.pos.y > -1.6) s.pos.y = -1.6;
        const hs = Math.hypot(s.vel.x, s.vel.z);
        if (hs > 0.05) s.head = M.dampAngle(s.head, yawOf(s.vel.x, s.vel.z), 3.5, dt);
        s.pitch = M.damp(s.pitch, Math.atan2(s.vel.y, Math.max(hs, 0.3)) * 0.7, 3, dt);
        s.phase += dt * (2.2 + s.vel.length() * 1.5);
        s.mesh.position.copy(s.pos); s.mesh.rotation.set(0, s.head, s.pitch); s.mesh.material.uniforms.uSwim.value.set(s.phase, 0.8, 0, 0);
        if (s.state !== 'patrol' && s.state !== 'retreat') nearest = Math.min(nearest, dist);
        if (s.state === 'approach' || s.state === 'charge') this.sharkDir = Math.atan2(s.pos.x - P.x, s.pos.z - P.z);
      }
      this.sharkNear = nearest < 99 ? nearest : 0;
    },

    updateJellies(dt) {
      const P = this.pos, im = this.jelly;
      this.jellies.forEach((j, i) => {
        j.pos.x += Math.sin(this.t * 0.11 + j.ph) * 0.06 * dt; j.pos.z += Math.cos(this.t * 0.09 + j.ph) * 0.06 * dt; j.pos.y += Math.sin(this.t * 0.2 + j.ph) * 0.05 * dt;
        j.cd -= dt;
        if (j.cd <= 0 && j.pos.distanceToSquared(_a.copy(P).setY(P.y + 0.3)) < 0.6 * 0.6 * j.s * j.s + 0.2) { j.cd = 3; this.o2 = Math.max(this.o2 - 0.06, 0.02); this.hurt = 3; DB.emit('sting'); }
        _m.compose(j.pos, _q.setFromEuler(_e.set(Math.sin(this.t * 0.3 + j.ph) * 0.15, 0, Math.cos(this.t * 0.27 + j.ph) * 0.15)), _s.set(j.s, j.s, j.s)); im.setMatrixAt(i, _m);
      });
      im.instanceMatrix.needsUpdate = true;
    },
  });
})();
