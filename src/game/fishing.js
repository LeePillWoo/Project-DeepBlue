// Project Deep Blue — boat fishing: first-person rod/reel/arms rig, line + lure physics, cast → bite → fight → land.
(function () {
  'use strict';
  const DB = window.DB, T = THREE, M = DB.M, G = DB.G;
  const V3 = (x, y, z) => new T.Vector3(x, y, z);
  const YAX = V3(0, 1, 0);

  // ------------------------------------------------------------------ shared arm rig (also used by the speargun)
  function capBetween(a, b, r, seg = 8) {
    const d = b.clone().sub(a), len = d.length(), g = new T.CapsuleGeometry(r, len, 4, seg);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(YAX, d.normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    return g;
  }
  function mirrorY(geo) {     // mirror + restore winding (non-indexed)
    const g = geo.clone(); g.scale(1, -1, 1);
    for (const name of ['position', 'normal', 'uv', 'color']) {
      const a = g.attributes[name]; if (!a) continue;
      const n = a.itemSize, arr = a.array;
      for (let i = 0; i < a.count; i += 3) for (let c = 0; c < n; c++) { const t = arr[(i + 1) * n + c]; arr[(i + 1) * n + c] = arr[(i + 2) * n + c]; arr[(i + 2) * n + c] = t; }
    }
    return g;
  }
  // right hand wrapped around a pole along +Y (thumb toward +Y), back of the hand on +X, wrist toward +Z
  function handGeo(Rg, cF = 0x17181b, cB = 0x1c1d21, cK = 0x33363c, cS = 0x09090b) {
    const parts = [], fr = [0.0102, 0.0106, 0.0099, 0.0088], fy = [0.0348, 0.0118, -0.0112, -0.0328];
    for (let i = 0; i < 4; i++) {
      const Rf = Rg + fr[i] * 0.9;
      const pts = [-8, -86, -157, -222 + i * 5].map((a) => V3(Math.cos((a * Math.PI) / 180) * Rf, fy[i], Math.sin((a * Math.PI) / 180) * Rf));
      for (let k = 0; k < 3; k++) parts.push(G.tint(capBetween(pts[k], pts[k + 1], fr[i] * (1 - k * 0.07), 10), cF));
      parts.push(G.tint(G.xf(G.sph(fr[i] * 1.3, 12, 10), [pts[0].x + 0.0035, pts[0].y, pts[0].z + 0.002]), cK));       // knuckle
    }
    // back of the hand: tapered dome instead of a slab
    const dome = G.sph(1, 24, 16), dp = dome.attributes.position;
    for (let i = 0; i < dp.count; i++) {
      const x = dp.getX(i), y = dp.getY(i), z = dp.getZ(i), t = z * 0.5 + 0.5;
      dp.setXYZ(i, Rg + 0.0155 + x * 0.0165 * (1 - 0.12 * t), y * 0.0485 * (1 - 0.24 * t), 0.041 + z * 0.056);
    }
    dome.computeVertexNormals(); parts.push(G.tint(dome, cB));
    parts.push(G.tint(G.xf(G.sph(1, 16, 10), [Rg + 0.0275, 0, 0.012], null, [0.0065, 0.036, 0.02]), cK));                  // knuckle guard
    // thumb + thenar
    const tA = V3(Rg + 0.012, 0.045, 0.056), tB = V3(Rg * 0.35, 0.058, Rg + 0.014), tC = V3(-(Rg + 0.003), 0.052, Rg * 0.35);
    parts.push(G.tint(capBetween(tA, tB, 0.0122, 10), cF), G.tint(capBetween(tB, tC, 0.0108, 10), cF), G.tint(G.xf(G.sph(0.0175, 12, 10), [tA.x - 0.002, tA.y - 0.006, tA.z + 0.008]), cB));
    // cuff + strap
    parts.push(G.tint(G.xf(G.cyl(0.0325, 0.0285, 0.06, 20), [Rg + 0.0155, 0, 0.104], [Math.PI / 2, 0, 0], [1, 1, 1.42]), cB));
    parts.push(G.tint(G.xf(G.cyl(0.0335, 0.0335, 0.016, 20), [Rg + 0.0155, 0, 0.098], [Math.PI / 2, 0, 0], [1, 1, 1.4]), cS));
    return G.merge(parts);
  }
  const foreGeo = (() => {      // unit-length sleeve along +Y (wrist at 0) with soft folds, cuff at the wrist end
    const g = new T.CylinderGeometry(0.049, 0.0335, 1, 22, 16, true); g.translate(0, 0.5, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), a = Math.atan2(p.getZ(i), p.getX(i));
      const k = 1 + 0.04 * Math.sin(y * 29 + Math.sin(a * 2) * 1.4) * (0.35 + 0.65 * Math.pow(Math.sin(a + y * 3.5), 2)) + 0.02 * Math.sin(a * 3 + y * 9);
      p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k * 1.26);
    }
    g.computeVertexNormals();
    const cuff = G.xf(G.torus(0.0345, 0.0065, 8, 22), [0, 0.014, 0], [Math.PI / 2, 0, 0], [1, 1.26, 1]);
    return G.merge([g, cuff]);
  })();

  function armMaterials(wet) {
    const A = DB.Assets, jersey = A && A.texSet('jersey_melange'), fleece = A && A.texSet('knitted_fleece');
    const rep = (t, x, y) => { if (!t) return null; const c = t.clone(); c.repeat.set(x, y); c.needsUpdate = true; return c; };
    const sleeve = new T.MeshStandardMaterial({ color: wet ? 0x0b0c0e : 0x2c3852, roughness: wet ? 0.5 : 0.95, map: !wet && jersey ? rep(jersey.map, 3, 5) : null, normalMap: jersey ? rep(wet ? fleece.normalMap : jersey.normalMap, wet ? 7 : 3, wet ? 12 : 5) : null, normalScale: new T.Vector2(wet ? 0.5 : 1, wet ? -0.5 : -1) });
    const glove = new T.MeshStandardMaterial({ vertexColors: true, roughness: wet ? 0.55 : 0.82, normalMap: fleece ? rep(fleece.normalMap, 3, 3) : null, normalScale: new T.Vector2(0.9, -0.9) });
    return { sleeve, glove };
  }

  function Arm(left, Rg, mats) {
    const hg = handGeo(Rg);
    this.hand = new T.Mesh(left ? mirrorY(hg) : hg, mats.glove);
    this.fore = new T.Mesh(foreGeo, mats.sleeve);
    this.hand.castShadow = this.fore.castShadow = true;
    this.Rg = Rg; this.group = new T.Group(); this.group.add(this.hand, this.fore);
  }
  const _x = V3(), _y = V3(), _z = V3(), _w = V3(), _d = V3(), _m = new T.Matrix4();
  // grip point, pole axis (thumb direction) and elbow position, all in the parent's space
  const ax = V3(), ay = V3(), az = V3(), aw = V3(), ad = V3(), am4 = new T.Matrix4();      // private: callers may pass the shared temporaries
  Arm.prototype.pose = function (grip, axis, elbow) {
    ay.copy(axis).normalize(); az.copy(elbow).sub(grip); az.addScaledVector(ay, -az.dot(ay)).normalize(); ax.crossVectors(ay, az);
    this.hand.quaternion.setFromRotationMatrix(am4.makeBasis(ax, ay, az)); this.hand.position.copy(grip);
    aw.set(this.Rg + 0.0165, 0, 0.112).applyQuaternion(this.hand.quaternion).add(grip);
    ad.copy(elbow).sub(aw); const len = ad.length();
    this.fore.position.copy(aw); this.fore.quaternion.setFromUnitVectors(YAX, ad.normalize()); this.fore.scale.set(1, len, 1);
  };
  DB.Rig = { Arm, armMaterials, capBetween, handGeo };

  // ------------------------------------------------------------------ rod
  const ROD_LEN = 1.86, BLANK_Y0 = 0.22, NS = 30, RS = 8;
  const GUIDES = [0.14, 0.26, 0.38, 0.49, 0.59, 0.68, 0.77, 0.85, 0.925, 1.0];
  const rodR = (s) => 0.0092 * (1 - s) + 0.0016 * s + 0.0012 * (1 - s) * (1 - s);

  const Fishing = (DB.Fishing = {
    state: 'idle', tension: 0, dist: 0, power: 0, active: true, hint: '', zone: 'ok', fish: null, escaped: null, count: 0,
    load: 0, yaw: 0, pitch: 0, crank: 0, over: 0, slack: 0, t: 0,

    init(scene, camera) {
      this.scene = scene; this.camera = camera;
      const rig = (this.rig = new T.Group()); camera.add(rig);
      const base = (this.base = new T.Group()); rig.add(base);
      const st = (o) => new T.MeshStandardMaterial(o);
      const mat = (this.mats = {
        eva: st({ color: 0x101113, roughness: 0.93 }), gold: st({ color: 0xc9a13a, metalness: 1, roughness: 0.27 }),
        anod: st({ color: 0x15171b, metalness: 0.85, roughness: 0.33 }), spool: st({ color: 0xdfe6c4, roughness: 0.55 }),
        steel: st({ color: 0xe0e4e8, metalness: 1, roughness: 0.16 }),
        blank: new T.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.07 }),
        lure: new T.MeshPhysicalMaterial({ color: 0x2a6fd0, metalness: 0.75, roughness: 0.22, clearcoat: 1 }),
      });
      const add = (geos, m, parent = base) => { const me = new T.Mesh(G.merge(geos), m); me.castShadow = true; parent.add(me); return me; };
      // grips, seat, reel body (rod-local: +Y toward tip, +Z = top where reel/guides sit)
      add([G.xf(G.cyl(0.0185, 0.019, 0.27, 16), [0, -0.165, 0]), G.xf(G.cyl(0.016, 0.0185, 0.145, 16), [0, 0.1475, 0])], mat.eva);
      add([G.xf(G.cyl(0.0215, 0.0215, 0.036, 16), [0, -0.318, 0]), G.xf(G.cyl(0.0158, 0.0158, 0.105, 16), [0, 0.0225, 0]), G.xf(G.cyl(0.0125, 0.0125, 0.01, 12), [0, 0.225, 0]),
        G.xf(G.cyl(0.046, 0.046, 0.011, 30), [0.036, 0.03, 0.06], [0, 0, Math.PI / 2]), G.xf(G.cyl(0.046, 0.046, 0.011, 30), [-0.036, 0.03, 0.06], [0, 0, Math.PI / 2])], mat.gold);
      add([G.xf(G.cyl(0.037, 0.037, 0.06, 26), [0, 0.03, 0.06], [0, 0, Math.PI / 2])], mat.spool);
      const bars = [G.xf(G.box(0.03, 0.07, 0.014), [0, 0.03, 0.02])];
      for (const a of [0.5, 1.7, 2.9, 4.2]) bars.push(G.xf(G.cyl(0.0042, 0.0042, 0.074, 8), [0, 0.03 + Math.cos(a) * 0.043, 0.06 + Math.sin(a) * 0.043], [0, 0, Math.PI / 2]));
      bars.push(G.xf(G.rbox(0.008, 0.03, 0.012, 0.003, 1), [0.046, 0.05, 0.096], [0.5, 0, 0]));       // drag lever
      add(bars, mat.anod);
      // crank handle (rotates about the spool axis)
      const handle = (this.handle = new T.Group()); handle.position.set(0.045, 0.03, 0.06); base.add(handle);
      add([G.xf(G.rbox(0.006, 0.086, 0.015, 0.0025, 1), [0.004, 0.026, 0]), G.xf(G.cyl(0.012, 0.012, 0.012, 14), [0.004, 0, 0], [0, 0, Math.PI / 2])], mat.steel, handle);
      add([G.xf(G.cap(0.0125, 0.03, 10), [0.03, 0.066, 0], [0, 0, Math.PI / 2])], mat.eva, handle);
      // bending blank (rebuilt every frame) with gold thread wraps at the guides
      const bg = (this.blankGeo = new T.BufferGeometry()), nv = (NS + 1) * RS;
      const col = new Float32Array(nv * 3), idx = [], cb = new T.Color(0x0a1022), cg = new T.Color(0xb8902e);
      for (let i = 0; i <= NS; i++) {
        const s = i / NS, wrap = GUIDES.some((gs) => Math.abs(gs - s) < 0.017) || s < 0.04;
        for (let j = 0; j < RS; j++) { const c = wrap ? cg : cb, o = (i * RS + j) * 3; col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b; }
        if (i < NS) for (let j = 0; j < RS; j++) { const j2 = (j + 1) % RS, a = i * RS + j, b = i * RS + j2, c2 = a + RS, d = b + RS; idx.push(a, c2, b, b, c2, d); }
      }
      bg.setAttribute('position', new T.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(T.DynamicDrawUsage));
      bg.setAttribute('normal', new T.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(T.DynamicDrawUsage));
      bg.setAttribute('color', new T.BufferAttribute(col, 3)); bg.setIndex(idx);
      const blank = new T.Mesh(bg, mat.blank); blank.castShadow = true; blank.frustumCulled = false; base.add(blank);
      this.guides = GUIDES.map((s, k) => { const r = M.lerp(0.0115, 0.0036, k / (GUIDES.length - 1)); const g = new T.Mesh(G.torus(r, Math.max(r * 0.16, 0.0009), 6, 18), mat.steel); g.userData = { s, r }; base.add(g); return g; });
      this.curve = []; for (let i = 0; i <= NS; i++) this.curve.push({ p: V3(), t: V3(), u: V3() });
      // arms
      const am = armMaterials(false);
      this.armL = new Arm(true, 0.0172, am); this.armR = new Arm(false, 0.0125, am);
      base.add(this.armL.group, this.armR.group);
      // lure + line (world space)
      const lg = G.merge([G.xf(new T.LatheGeometry([[0, -0.07], [0.008, -0.062], [0.016, -0.02], [0.017, 0.02], [0.012, 0.055], [0, 0.07]].map((p) => new T.Vector2(p[0], p[1])), 14), [0, 0, 0]),
        G.xf(G.torus(0.014, 0.0016, 6, 14, 4.2), [0, -0.085, 0], [0, 0, 2.2])]);
      this.lure = new T.Mesh(lg, mat.lure); this.lure.castShadow = true; scene.add(this.lure);
      this.lurePos = V3(); this.lureVel = V3(); this.lurePrev = V3();
      this.line = new DB.Line(48, 0.0014, new T.Vector3(2.4, 2.5, 2.5), 0.92); scene.add(this.line.mesh);
      this.tip = V3(); this.tipRest = V3(); this.end = V3();
      this.elL = V3(-0.5, -0.62, -0.05); this.elR = V3(0.3, -0.66, 0.0);
      this.poseRod(0, 0, 0.016);
      this.base.updateMatrixWorld(true);
      this.tipWorld();
      this.lurePos.copy(this.tip).add(V3(0, -0.8, 0)); this.lurePrev.copy(this.lurePos);
    },

    setActive(on) { this.active = on; this.rig.visible = on; this.lure.visible = on && this.state !== 'fight' && this.state !== 'trophy'; this.line.mesh.visible = on; if (this.fish) this.fish.mesh.visible = on; },

    // place the rod in camera space (yaw/pitch offsets in radians) and bend it toward `loadDir` (rod-local) by angle `bend`
    poseRod(yaw, pitch, bend, loadDir) {
      const b = this.base;
      b.position.set(-0.17 + yaw * 0.12, -0.275 + Math.min(pitch, 0) * 0.03, -0.47);
      const e = this._e || (this._e = new T.Euler(0, 0, 0, 'YXZ'));
      b.quaternion.setFromEuler(e.set(-0.84 + pitch, -0.36 - yaw, 0.16));     // rod-local +Y → forward & up, +Z → back toward the eye; pitch > 0 raises the rod
      // bend plane
      const n = this._n || (this._n = V3()), bb = this._b || (this._b = V3());
      if (loadDir) { n.copy(loadDir); n.y = 0; } else n.set(0, 0, -1);
      if (n.lengthSq() < 1e-6) n.set(0, 0, -1);
      n.normalize(); bb.crossVectors(YAX, n).normalize();
      const pa = this.blankGeo.attributes.position.array, na = this.blankGeo.attributes.normal.array, ds = ROD_LEN / NS, cv = this.curve;
      let px = 0, py = BLANK_Y0, pz = 0;
      const ua = n.z, uc = bb.z;                 // rod "top" (+Z) expressed in the bend frame
      for (let i = 0; i <= NS; i++) {
        const s = i / NS, phi = bend * Math.pow(s, 1.65), c = Math.cos(phi), sn = Math.sin(phi);
        const tx = n.x * sn, ty = c, tz = n.z * sn;                   // tangent
        const mx = n.x * c, my = -sn, mz = n.z * c;                   // in-plane normal
        const cp = cv[i]; cp.p.set(px, py, pz); cp.t.set(tx, ty, tz); cp.u.set(mx * ua + bb.x * uc, my * ua, mz * ua + bb.z * uc);
        const r = rodR(s);
        for (let j = 0; j < RS; j++) {
          const a = (j / RS) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), o = (i * RS + j) * 3;
          const nx = mx * ca + bb.x * sa, ny = my * ca, nz = mz * ca + bb.z * sa;
          pa[o] = px + nx * r; pa[o + 1] = py + ny * r; pa[o + 2] = pz + nz * r; na[o] = nx; na[o + 1] = ny; na[o + 2] = nz;
        }
        const phm = bend * Math.pow((i + 0.5) / NS, 1.65);
        px += n.x * Math.sin(phm) * ds; py += Math.cos(phm) * ds; pz += n.z * Math.sin(phm) * ds;
      }
      this.blankGeo.attributes.position.needsUpdate = this.blankGeo.attributes.normal.needsUpdate = true;
      for (const g of this.guides) {
        const f = g.userData.s * NS, i = Math.min(Math.floor(f), NS - 1), cp = cv[i], cn = cv[i + 1], k = f - i;
        _x.copy(cp.p).lerp(cn.p, k); _z.copy(cp.t).lerp(cn.t, k).normalize(); _y.copy(cp.u).lerp(cn.u, k).normalize();
        g.position.copy(_x).addScaledVector(_y, rodR(g.userData.s) + g.userData.r);
        _w.crossVectors(_y, _z); g.quaternion.setFromRotationMatrix(_m.makeBasis(_w, _y, _z));
      }
    },
    tipWorld() { const g = this.guides[this.guides.length - 1]; return g.getWorldPosition(this.tip); },

    // ---------------------------------------------------------------- fish selection
    pickSpecies(x, z) {
      this.count++;
      if (this.count === 1 && !DB.params.has('rnd')) return 'marlin';       // the first strike is always the showpiece
      const deep = DB.World.depth(x, z) > 30;
      const tbl = deep ? [['marlin', 26], ['sailfish', 22], ['tuna', 26], ['mahi', 26]] : [['amberjack', 34], ['seabream', 34], ['grouper', 22], ['mahi', 10]];
      let r = Math.random() * tbl.reduce((a, t) => a + t[1], 0);
      for (const [k, w] of tbl) { if ((r -= w) <= 0) return k; }
      return tbl[0][0];
    },

    hook(key) {
      const ind = DB.Fish.roll(key || this.pickSpecies(this.lurePos.x, this.lurePos.z)), sp = ind.sp;
      const f = DB.Fish.get(ind.key), mesh = new T.Mesh(f.geo, DB.Fish.surfaceMaterial(ind.key));
      mesh.scale.setScalar(ind.L); mesh.castShadow = true; mesh.rotation.order = 'YZX'; this.scene.add(mesh);
      const dx = this.lurePos.x - this.tip.x, dz = this.lurePos.z - this.tip.z;
      const size = (ind.L - sp.L[0]) / (sp.L[1] - sp.L[0]);
      this.fish = Object.assign(ind, {
        mesh, u: mesh.material.userData.u, S: 1, mode: 'run', modeT: 3.6 + Math.random() * 1.6, D: Math.max(Math.hypot(dx, dz), 8), bearing: Math.atan2(dx, dz), turn: (Math.random() - 0.5) * 0.3,
        depth: 0.8, size, age: 0, pos: this.lurePos.clone(), prev: this.lurePos.clone(), head: Math.atan2(dx, dz), pitchA: 0, phase: 0, jump: null, jumped: false, surge: false, wake: 0,
        pf: M.clamp(0.48 + 0.52 * sp.power * (0.55 + 0.45 * size), 0.38, 1.05), deepRun: sp.jump < 0.5,
      });
      this.state = 'fight'; this.tension = 0.5; this.over = 0; this.slack = 0; this.lure.visible = false;
      DB.FX.splash(this.lurePos.x, DB.Ocean.height(this.lurePos.x, this.lurePos.z), this.lurePos.z, 0.5 + size * 0.4);
      DB.Ocean.addRipple(this.lurePos.x, this.lurePos.z, 1.2);
      DB.emit('hook', this.fish);
    },

    endFight(result) {
      const f = this.fish;
      if (result === 'snap') {
        this.escaped = { key: f.key, L: f.L, kg: f.kg, S: f.S, x: f.pos.x, z: f.pos.z, t: 0 };
        DB.emit('snap', f);
      } else if (result === 'lost') DB.emit('lost', f);
      if (result !== 'land') { this.scene.remove(f.mesh); f.mesh.material.dispose(); this.fish = null; this.state = 'idle'; this.lure.visible = this.active; this.lurePos.copy(this.tip).y -= 0.8; this.lurePrev.copy(this.lurePos); this.lureVel.set(0, 0, 0); }
      this.tension = 0;
    },

    // ---------------------------------------------------------------- per-frame
    update(dt, inp, look) {
      this.t += dt;
      const O = DB.Ocean, cam = this.camera, reelHeld = inp.mouse(0) && this.active;
      this.tipWorld();
      if (this.escaped) { this.escaped.t += dt; if (this.escaped.t > 25) this.escaped = null; }
      let yawT = 0, pitchT = 0, loadT = 0.016, slackT = 0.4, cranking = 0;
      const fw = _d.set(0, 0, -1).applyQuaternion(cam.quaternion); const fwx = fw.x, fwz = fw.z, fl = Math.hypot(fwx, fwz) || 1;
      this.hint = '';

      switch (this.state) {
        case 'idle': {
          this.hangLure(dt);
          if (this.active && inp.mouseDown(0)) { this.state = 'charge'; this.power = 0; }
          this.end.copy(this.lurePos); slackT = 0;
          break;
        }
        case 'charge': {
          this.power = Math.min(this.power + dt / 1.15, 1);
          pitchT = 0.95 * this.power + 0.1; yawT = -0.25 * this.power;
          this.hangLure(dt); this.end.copy(this.lurePos); slackT = 0;
          if (!inp.mouse(0)) {      // release → launch
            const p = 0.3 + 0.7 * this.power, v = 12.5 + 14.5 * p, el = 0.5;
            this.lureVel.set((fwx / fl) * Math.cos(el) * v, Math.sin(el) * v, (fwz / fl) * Math.cos(el) * v);
            this.state = 'cast'; this.castT = 0; DB.emit('cast', p);
          }
          break;
        }
        case 'cast': {
          this.castT += dt; pitchT = M.lerp(0.9, -0.55, M.smooth(0, 0.16, this.castT)) * (1 - M.smooth(0.3, 0.9, this.castT) * 0.55);
          const v = this.lureVel; v.multiplyScalar(Math.max(1 - 0.045 * dt * v.length() * 0.2, 0)); v.y -= 9.81 * dt;
          this.lurePos.addScaledVector(v, dt);
          const wy = O.height(this.lurePos.x, this.lurePos.z);
          this.end.copy(this.lurePos); slackT = 0.25;
          if (this.lurePos.y <= wy) {
            this.lurePos.y = wy; this.state = 'wait';
            DB.FX.splash(this.lurePos.x, wy, this.lurePos.z, 0.16); O.addRipple(this.lurePos.x, this.lurePos.z, 0.5); DB.emit('plop');
            this.biteT = this.count === 0 ? 2.6 + Math.random() * 1.5 : 3 + Math.random() * 7; this.arched = false; this.nibble = 0; this.popT = 0;
          }
          break;
        }
        case 'wait': {
          const dx = this.lurePos.x - this.tip.x, dz = this.lurePos.z - this.tip.z, d = Math.hypot(dx, dz) || 1;
          this.dist = d; pitchT = -0.2; yawT = M.clamp(M.wrapPi(Math.atan2(dx, dz) - Math.atan2(fwx, fwz)), -0.4, 0.4);
          if (reelHeld) {       // work the lure back
            cranking = 1; this.lurePos.x -= (dx / d) * 2.6 * dt; this.lurePos.z -= (dz / d) * 2.6 * dt; this.biteT -= dt * 0.6;
            this.popT -= dt; if (this.popT <= 0) { this.popT = 0.55 + Math.random() * 0.5; DB.FX.splash(this.lurePos.x, this.lurePos.y, this.lurePos.z, 0.05); O.addRipple(this.lurePos.x, this.lurePos.z, 0.25); }
          }
          this.lurePos.y = O.height(this.lurePos.x, this.lurePos.z) - 0.01;
          this.biteT -= dt; this.nibble = Math.max(this.nibble - dt * 3, 0);
          if (this.biteT < 2.2 && !this.arched) { this.arched = true; DB.Boat.Finder.addArch(2 + Math.random() * 5, 1.2); DB.emit('nibble'); this.nibble = 1; }
          if (this.biteT < 0.9 && this.nibble < 0.1 && Math.random() < dt * 3) { this.nibble = 0.8; DB.emit('nibble'); }
          loadT = 0.03 + this.nibble * 0.12; slackT = 0.4 - this.nibble * 0.3;
          this.end.copy(this.lurePos); this.hint = 'wait';
          if (d < 4.5) { this.state = 'idle'; this.lurePos.copy(this.tip).y -= 0.5; this.lurePrev.copy(this.lurePos); }
          else if (this.biteT <= 0) { this.state = 'bite'; this.biteWin = 1.6; DB.FX.splash(this.lurePos.x, this.lurePos.y, this.lurePos.z, 0.45); O.addRipple(this.lurePos.x, this.lurePos.z, 1); DB.emit('bite'); }
          break;
        }
        case 'bite': {
          this.biteWin -= dt; loadT = 0.5 + 0.15 * Math.sin(this.t * 30); slackT = 0; pitchT = 0.05;
          this.lurePos.y = O.height(this.lurePos.x, this.lurePos.z) - 0.3;
          this.end.copy(this.lurePos); this.hint = 'bite';
          if (inp.mouseDown(0) || reelHeld) this.hook();
          else if (this.biteWin <= 0) { this.state = 'wait'; this.biteT = 4 + Math.random() * 6; this.arched = false; DB.emit('missed'); }
          break;
        }
        case 'fight': {
          const r = this.fightStep(dt, reelHeld);
          yawT = r.yaw; pitchT = r.pitch; loadT = r.load; slackT = r.slack; cranking = r.crank;
          break;
        }
        case 'landing': {
          const f = this.fish; this.landT += dt;
          // thrash on the surface just off the quarter, where it can be seen over the rail
          const side = _w.set(f.pos.x - this.tip.x, 0, f.pos.z - this.tip.z).setLength(5.3).add(this.tip);
          f.pos.lerp(side, 1 - Math.exp(-3.5 * dt)); f.pos.y = O.height(f.pos.x, f.pos.z) - 0.25 + Math.sin(this.t * 9) * 0.1;
          f.head += dt * 2.2; f.phase += dt * 16; this.placeFish(f, 1.6);
          f.wake -= dt; if (f.wake <= 0) { f.wake = 0.16; DB.FX.splash(f.pos.x, f.pos.y + 0.25, f.pos.z, 0.3); O.addRipple(f.pos.x, f.pos.z, 0.7); }
          this.end.copy(f.pos); loadT = 0.75; slackT = 0; pitchT = 0.3; cranking = 1; yawT = -0.2;
          this.dist = this.tip.distanceTo(f.pos);
          if (this.landT > 1.7) this.toTrophy();
          break;
        }
        case 'trophy': {
          const f = this.fish; this.landT += dt;
          f.mesh.rotation.set(0, this.landT * 0.55 + 1.2, 0.0); f.u.uSwim.value.set(this.t * 3, 0.5, 0, 0);
          if ((this.landT > 1.2 && inp.mouseDown(0)) || this.landT > 9) {
            this.rig.remove(f.mesh); f.mesh.material.dispose(); this.fish = null; this.state = 'idle'; this.base.visible = true; this.lure.visible = true;
            this.lurePos.copy(this.tip).y -= 0.8; this.lurePrev.copy(this.lurePos); DB.emit('trophyDone');
          }
          break;
        }
      }
      // rod pose smoothing
      this.yaw = M.damp(this.yaw, yawT, this.state === 'cast' ? 20 : 7, dt);
      this.pitch = M.damp(this.pitch, pitchT, this.state === 'cast' ? 26 : 8, dt);
      this.load = M.damp(this.load, loadT, 10, dt);
      this.slackV = M.damp(this.slackV || 0.3, slackT, 5, dt);
      this.base.updateMatrixWorld(true);
      // bend toward the line end (in rod-local space)
      const inv = this._inv || (this._inv = new T.Matrix4()); inv.copy(this.base.matrixWorld).invert();
      const local = _w.copy(this.end).applyMatrix4(inv); local.y -= BLANK_Y0 + ROD_LEN * 0.8;
      const ang = Math.atan2(Math.hypot(local.x, local.z), local.y);
      this.poseRod(this.yaw, this.pitch, Math.min(this.load * 2.05, ang * 0.94), local);
      // crank + arms
      this.crank += cranking * dt * 11; this.handle.rotation.x = this.crank;
      const iv = this._ib || (this._ib = new T.Matrix4()); iv.copy(this.base.matrix).invert();
      this.armL.pose(_x.set(0, 0.145, 0), YAX, _z.copy(this.elL).applyMatrix4(iv));
      const kn = _x.set(0.045 + 0.03, 0.03 + Math.cos(this.crank) * 0.066, 0.06 + Math.sin(this.crank) * 0.066);
      this.armR.pose(kn, _y.set(-1, 0, 0), _z.copy(this.elR).applyMatrix4(iv));
      this.base.updateMatrixWorld(true);
      this.updateLine();
      this.lure.position.copy(this.lurePos);
      if (this.state === 'idle' || this.state === 'charge') { _d.copy(this.tip).sub(this.lurePos).normalize(); this.lure.quaternion.setFromUnitVectors(YAX, _d); }
      else if (this.state === 'cast') { _d.copy(this.lureVel).normalize().negate(); this.lure.quaternion.setFromUnitVectors(YAX, _d); }
    },

    hangLure(dt) {      // pendulum under the rod tip
      const l = 0.82, p = this.lurePos, v = this.lureVel;
      v.y -= 9.81 * dt; v.multiplyScalar(Math.max(1 - 1.2 * dt, 0)); p.addScaledVector(v, dt);
      _w.copy(p).sub(this.tip); const d = _w.length() || 1; p.copy(this.tip).addScaledVector(_w, l / d);
      v.copy(p).sub(this.lurePrev).divideScalar(Math.max(dt, 1e-3)); if (v.lengthSq() > 400) v.setLength(20);
      this.lurePrev.copy(p);
    },

    fightStep(dt, reel) {
      const f = this.fish, sp = f.sp, O = DB.Ocean, out = this._fo || (this._fo = {});
      let T_ = this.tension, pull = 0.2, shake = 0;
      const reelRate = 3.6 * (1 - 0.75 * T_ * T_);
      f.modeT -= dt;
      if (f.jump) {
        const j = f.jump; j.t += dt;
        f.pos.set(j.x + j.vx * j.t, j.y + j.vy * j.t - 0.5 * 10.5 * j.t * j.t, j.z + j.vz * j.t);
        const vy = j.vy - 10.5 * j.t, wy = O.height(f.pos.x, f.pos.z);
        f.pitchA = Math.atan2(vy, Math.hypot(j.vx, j.vz)); f.head = Math.atan2(j.vx, j.vz); f.phase += dt * 22; f.roll = Math.sin(j.t * 9) * 0.55;
        pull = 0.04;
        if (j.t > 0.35 && f.pos.y < wy - 0.2) {       // re-entry
          DB.FX.splash(f.pos.x, wy, f.pos.z, 0.9 + f.size * 0.9, j.vx * 0.1, j.vz * 0.1); O.addRipple(f.pos.x, f.pos.z, 2.2); DB.emit('splash', { d: this.dist, s: 1 });
          f.jump = null; f.roll = 0; f.depth = 1.2; f.mode = Math.random() < 0.5 ? 'run' : 'fight'; f.modeT = 1.6 + Math.random() * 2;
          f.D = Math.hypot(f.pos.x - this.tip.x, f.pos.z - this.tip.z); f.bearing = Math.atan2(f.pos.x - this.tip.x, f.pos.z - this.tip.z);
        }
      } else {
        const vigor = 0.5 + 0.5 * f.S;
        if (f.modeT <= 0) {       // choose the next behaviour
          if (f.S < 0.17) { f.mode = 'tired'; f.modeT = 99; }
          else {
            const r = Math.random();
            if (sp.jump > 0.4 && f.D > 12 && r < 0.3 * sp.jump) this.startJump(f);
            else if (r < 0.34 + 0.4 * f.S) { f.mode = 'run'; f.modeT = 1.6 + Math.random() * 2.2 * vigor; f.turn = (Math.random() - 0.5) * 0.5; }
            else { f.mode = 'fight'; f.modeT = 2.2 + Math.random() * 3; f.turn = (Math.random() - 0.5) * 0.9; }
          }
        }
        if (f.mode === 'tired' && !f.surge && f.D < 13) { f.surge = true; f.mode = 'run'; f.modeT = 1.5; f.turn = (Math.random() < 0.5 ? -1 : 1) * 0.6; DB.emit('surge'); }
        if (f.mode === 'run' && sp.jump > 0.4 && !f.jumped && f.modeT < 2.6) this.startJump(f);
        let depthT = 1.0;
        if (f.mode === 'run') {
          f.D += (2.3 + 3.5 * sp.power) * vigor * (reel ? 0.55 : 1) * dt; pull = 0.76 * f.pf + 0.06; depthT = f.deepRun ? 10 : 0.55;
        } else if (f.mode === 'fight') {
          f.D += (0.7 * vigor - (reel ? reelRate : 0)) * dt; pull = 0.45 * f.pf; shake = 0.13 * f.pf * Math.sin(this.t * 17) * Math.sin(this.t * 3.1); depthT = f.deepRun ? 5 : 1.6;
        } else {
          f.D += (0.25 - (reel ? reelRate * 1.25 : 0)) * dt; pull = 0.2 * f.pf + 0.03; depthT = 0.9;
        }
        if (!f.jump) {
          f.bearing += f.turn * dt * (f.mode === 'tired' ? 0.3 : 1) * Math.min(1, 14 / Math.max(f.D, 6));
          f.depth = M.damp(f.depth, depthT, 0.9, dt);
          f.pos.set(this.tip.x + Math.sin(f.bearing) * f.D, 0, this.tip.z + Math.cos(f.bearing) * f.D);
          f.pos.y = O.height(f.pos.x, f.pos.z) - f.depth;
          const mvx = f.pos.x - f.prev.x, mvz = f.pos.z - f.prev.z;
          if (mvx * mvx + mvz * mvz > 1e-6) f.head = M.dampAngle(f.head, Math.atan2(mvx, mvz), 6, dt);
          f.pitchA = M.damp(f.pitchA, 0, 4, dt); f.roll = 0;
          f.phase += dt * (f.mode === 'run' ? 19 : f.mode === 'fight' ? 12 : 6);
          // white water when a big fish charges just under the surface
          f.wake -= dt;
          if (f.depth < 1.3 && f.mode !== 'tired' && f.wake <= 0) { f.wake = 0.13; DB.FX.splash(f.pos.x, f.pos.y + f.depth, f.pos.z, 0.1 + f.size * 0.14 * (f.mode === 'run' ? 1.6 : 1)); if (Math.random() < 0.4) O.addRipple(f.pos.x, f.pos.z, 0.5); }
        }
        // stamina
        if (f.mode !== 'tired') f.S = Math.max(f.S - dt * (0.01 + 0.06 * T_) / (sp.stamina * (0.75 + 0.6 * f.size)) * (f.mode === 'run' ? 1.25 : 1), 0);
        else if (T_ < 0.2) f.S = Math.min(f.S + dt * 0.012, 0.3);
      }
      f.prev.copy(f.pos);
      this.placeFish(f, f.mode === 'tired' ? 0.6 : 1);
      // line tension
      f.age += dt;
      let target = M.clamp(pull * (reel ? 1.3 : 0.55) + (reel ? 0.22 : 0) + shake, 0, 1.25);
      if (f.age < 2.5) target = Math.min(target, 0.84);          // the hook-set itself never snaps the line
      this.tension = T_ = M.clamp(T_ + (target - T_) * Math.min((target > T_ ? 4.2 : 2.6) * dt, 1), 0, 1.15);
      this.over = T_ > 0.92 ? this.over + dt : Math.max(this.over - dt * 1.5, 0);
      this.slack = T_ < 0.14 ? this.slack + dt * (f.jump ? 1.3 : 1) : Math.max(this.slack - dt * 2, 0);
      this.zone = T_ > 0.86 ? 'high' : T_ < 0.17 ? 'low' : 'ok';
      this.dist = f.D; this.hint = f.jump ? 'jump' : f.mode;
      // line end = mouth
      const hx = Math.sin(f.head) * Math.cos(f.pitchA), hz = Math.cos(f.head) * Math.cos(f.pitchA);
      this.end.set(f.pos.x + hx * f.L * 0.42, f.pos.y + Math.sin(f.pitchA) * f.L * 0.42, f.pos.z + hz * f.L * 0.42);
      // rod aim relative to the view
      const fw = _d.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.fishOff = M.wrapPi(Math.atan2(f.pos.x - this.tip.x, f.pos.z - this.tip.z) - Math.atan2(fw.x, fw.z));     // how far off-axis the fish is (the view eases toward it)
      out.yaw = M.clamp(this.fishOff, -0.4, 0.4);
      out.pitch = (reel ? -0.1 : 0.2) + shake * 0.5 + (f.jump ? 0.12 : 0); out.load = 0.12 + 0.88 * Math.min(T_, 1); out.slack = Math.max(0.5 - T_ * 2.2, 0); out.crank = reel ? 1 - 0.6 * T_ : 0;
      if (this.over > 2.0 || f.D > 310) this.endFight('snap');
      else if (this.slack > 4.0) this.endFight('lost');
      else if (f.D < 5.6 && !f.jump && f.mode !== 'run') { this.state = 'landing'; this.landT = 0; DB.emit('landing', f); }
      return out;
    },

    startJump(f) {
      const O = DB.Ocean, a = f.bearing + (Math.random() < 0.5 ? 1 : -1) * (0.9 + Math.random() * 0.9), sp = 3.5 + Math.random() * 3;
      const up = (6.4 + 3.2 * Math.min(f.sp.jump, 1)) * (0.85 + 0.25 * f.S);
      f.jump = { t: 0, x: f.pos.x, y: O.height(f.pos.x, f.pos.z) - 0.2, z: f.pos.z, vx: Math.sin(a) * sp, vy: up, vz: Math.cos(a) * sp };
      f.jumped = true; f.mode = 'jump';
      DB.FX.splash(f.pos.x, f.jump.y + 0.2, f.pos.z, 0.8 + f.size * 0.8, f.jump.vx * 0.15, f.jump.vz * 0.15); O.addRipple(f.pos.x, f.pos.z, 2);
      DB.emit('jump', f); DB.emit('splash', { d: this.dist, s: 1 });
    },

    placeFish(f, amp) {
      const m = f.mesh;
      m.position.copy(f.pos); m.rotation.set(f.roll || 0, f.head - Math.PI / 2, f.pitchA || 0);
      f.u.uSwim.value.set(f.phase, amp, 0, 0);
      f.u.uWaterY.value = f.jump ? DB.Ocean.height(f.pos.x, f.pos.z) : f.pos.y + f.depth;
    },

    toTrophy() {
      const f = this.fish;
      this.state = 'trophy'; this.landT = 0; this.base.visible = false; this.tension = 0;
      this.scene.remove(f.mesh); this.rig.add(f.mesh);
      const dist = 0.75 + f.L * 0.92;
      f.mesh.position.set(0, -0.04 - f.L * 0.02, -dist); f.mesh.rotation.set(0, 1.2, 0); f.u.uWaterY.value = -1e4;
      DB.FX.splash(f.pos.x, f.pos.y + 0.3, f.pos.z, 0.6);
      DB.emit('catch', { key: f.key, L: f.L, kg: f.kg, method: 'rod' });
    },

    updateLine() {
      const ln = this.line; let n = 0;
      if (this.state === 'trophy') { ln.commit(0); return; }
      // reel → guides → tip
      _w.set(0, 0.06, 0.092).applyMatrix4(this.base.matrixWorld); ln.set(n++, _w.x, _w.y, _w.z);
      for (const g of this.guides) { g.getWorldPosition(_w); ln.set(n++, _w.x, _w.y, _w.z); }
      const tip = _w, e = this.end, sag = this.slackV || 0, K = 26;
      const len = tip.distanceTo(e), wob = this.state === 'fight' ? 0.004 * len * this.tension : 0;
      const tx = tip.x, ty = tip.y, tz = tip.z;
      // stop the visible line at the water surface when the end is submerged
      let tEnd = 1;
      if (this.state === 'fight' || this.state === 'bite' || this.state === 'landing') { const wy = DB.Ocean.height(e.x, e.z); if (e.y < wy - 0.02 && ty > wy) tEnd = Math.min((ty - wy) / (ty - e.y), 1); }
      for (let i = 1; i <= K; i++) {
        const t = (i / K) * tEnd, s = 4 * t * (1 - t);
        ln.set(n++, tx + (e.x - tx) * t + Math.sin(this.t * 2.3 + t * 5) * sag * s * 0.02 * len, ty + (e.y - ty) * t - s * sag * (0.07 * len + 0.25) + Math.sin(this.t * 31 + t * 9) * wob * s, tz + (e.z - tz) * t);
      }
      ln.commit(n);
    },
  });
})();
