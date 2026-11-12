// Project Deep Blue — things that happen at sea: a message in a bottle with a treasure map, a ghost ship, a sea serpent,
// pirates who give chase and open fire, a kraken that has to be driven off with flares.
// One at a time, a few minutes apart; DB.debug.event('ghost') starts one now. Each kind has weight / init / start / update / end;
// update returns false when it is over. What they show on the HUD goes through Events.pin (one label) and Events.marks (minimap).
(function () {
  'use strict';
  const DB = window.DB, T = THREE, M = DB.M, G = DB.G;
  const V3 = (x, y, z) => new T.Vector3(x, y, z), _a = V3(), _b = V3(), _c = V3(), _d = V3();
  const segSeg = (p0, p1, q0, q1) => DB.segDist(p0, p1, q0, q1);      // closest distance between two segments
  // additive, but leaves the alpha channel alone (the ocean pass owns it)
  const ADD = { transparent: true, blending: T.CustomBlending, blendSrc: T.SrcAlphaFactor, blendDst: T.OneFactor, blendSrcAlpha: T.ZeroFactor, blendDstAlpha: T.OneFactor, depthWrite: false, toneMapped: false, fog: false };
  const inView = (camera, x, y, z, cos = 0.5) => { const c = camera.position, f = _a.set(0, 0, -1).applyQuaternion(camera.quaternion), dx = x - c.x, dy = y - c.y, dz = z - c.z, d = Math.hypot(dx, dy, dz) || 1; return (dx * f.x + dy * f.y + dz * f.z) / d > cos; };
  // a point `d` metres from the boat, clear of the island and the other boats
  function clearSpot(B, d0, d1) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * 6.283, d = d0 + Math.random() * (d1 - d0), x = B.x + Math.cos(a) * d, z = B.z + Math.sin(a) * d;
      if (!DB.Sea.colliders.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 12)) return { x, z, a };
    }
    return { x: B.x + d0, z: B.z, a: 0 };
  }
  // sand on the reef, clear of the wreck, at a depth worth the swim: where the map says to dig
  function digSpot() {
    const W = DB.World, R = DB.Reef;
    for (let i = 0; i < 300; i++) {
      const a = Math.random() * 6.283, d = 12 + Math.random() * 38, x = Math.cos(a) * d, z = Math.sin(a) * d, h = W.height(x, z);
      if (W.rockiness(x, z) < 0.3 && h < -7 && h > -24 && Math.hypot(x - R.wreck.x, z - R.wreck.z) > 14) return { x, z };
    }
    return { x: 18, z: -12 };
  }

  // ------------------------------------------------------------------ sea serpent, built here: arches of body and a head on a neck
  // a tube along a curve given as points; radius by t; dark back, pale belly, a row of fins along the top
  function serpentTube(pts, rad, fins) {
    const curve = new T.CatmullRomCurve3(pts), N = pts.length * 6, MR = 10, pos = [], col = [], idx = [], fin = [], up = V3(0, 1, 0), tan = V3(), side = V3(), nrm = V3(), p = V3();
    for (let i = 0; i <= N; i++) {
      const t = i / N, r = rad(t); curve.getPointAt(t, p); curve.getTangentAt(t, tan);
      side.crossVectors(tan, up).normalize(); if (side.lengthSq() < 0.01) side.set(0, 0, 1); nrm.crossVectors(side, tan).normalize();
      for (let j = 0; j < MR; j++) {
        const a = (j / MR) * 6.283, c = Math.cos(a), s = Math.sin(a), band = 0.75 + 0.25 * Math.sin(t * N * 0.9);
        pos.push(p.x + (nrm.x * s + side.x * c) * r, p.y + (nrm.y * s + side.y * c) * r, p.z + (nrm.z * s + side.z * c) * r);
        const k = M.smooth(-0.5, 0.3, s);      // 0 belly … 1 back
        col.push(M.lerp(0.34, 0.016 * band, k), M.lerp(0.36, 0.05 * band, k), M.lerp(0.24, 0.045 * band, k));
      }
      if (i < N) for (let j = 0; j < MR; j++) { const a0 = i * MR + j, a1 = i * MR + ((j + 1) % MR); idx.push(a0, a1, a0 + MR, a1, a1 + MR, a0 + MR); }
      if (fins && i < N && i % 2 === 0) {      // a fin: a triangle standing on the back (added after the rings, which are indexed by position)
        const h = r * 0.9;
        fin.push(p.x + nrm.x * r * 0.9 - tan.x * r * 0.5, p.y + nrm.y * r * 0.9 - tan.y * r * 0.5, p.z + nrm.z * r * 0.9 - tan.z * r * 0.5,
          p.x + nrm.x * r * 0.9 + tan.x * r * 0.5, p.y + nrm.y * r * 0.9 + tan.y * r * 0.5, p.z + nrm.z * r * 0.9 + tan.z * r * 0.5,
          p.x + nrm.x * (r + h) - tan.x * r * 0.2, p.y + nrm.y * (r + h) - tan.y * r * 0.2, p.z + nrm.z * (r + h) - tan.z * r * 0.2);
      }
    }
    for (let q = 0; q < fin.length; q += 9) { const o = pos.length / 3; for (let e = 0; e < 9; e++) pos.push(fin[q + e]); for (let e = 0; e < 3; e++) col.push(0.05, 0.02, 0.02); idx.push(o, o + 1, o + 2); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  let _serp = null;
  function serpentGeo() {
    if (_serp) return _serp;
    const arch = serpentTube(Array.from({ length: 9 }, (_, i) => { const a = (i / 8) * Math.PI; return V3(-Math.cos(a) * 5, Math.sin(a) * 5.4 - 1.6, 0); }), () => 1.15, true);
    // neck: up out of the water and forward; +x is the way it is going
    const neck = serpentTube([V3(-3.5, -3, 0), V3(-2.6, 1, 0), V3(-1.2, 5, 0), V3(1, 7.6, 0), V3(3.4, 8.2, 0)], (t) => 1.15 - 0.4 * t, true);
    const dark = 0x0a1a16, parts = [neck];
    parts.push(G.tint(G.xf(G.sph(1, 14, 10), [5.1, 8.05, 0], [0, 0, -0.12], [2.3, 0.78, 0.95]), dark));                      // skull
    parts.push(G.tint(G.xf(G.sph(1, 12, 8), [5.4, 7.35, 0], [0, 0, -0.42], [1.9, 0.32, 0.8]), 0x3a2a22));                    // lower jaw, hanging open
    for (const s of [-1, 1]) {
      parts.push(G.tint(G.xf(G.sph(0.17, 8, 6), [5.9, 8.5, s * 0.66]), 0xffd24a));                                           // eye
      parts.push(G.tint(G.xf(G.cyl(0.0, 0.2, 1.5, 6), [3.5, 9.2, s * 0.5], [0, 0, 0.9]), 0x241410));                          // horn, swept back
      for (let i = 0; i < 5; i++) parts.push(G.tint(G.xf(G.cyl(0.0, 0.07, 0.42, 5), [5.6 + i * 0.33, 7.62 - i * 0.13, s * 0.55], [Math.PI, 0, 0]), 0xd8d2c0));      // teeth
    }
    _serp = { arch, head: G.merge(parts.map((g) => { if (!g.attributes.color) G.tint(g, dark); return g; })) };
    return _serp;
  }

  const KINDS = {
    // ---------------------------------------------------------------- a bottle adrift → a map → a chest buried on the reef
    bottle: {
      weight: (E) => (E.map ? 0 : 3),
      init(E) {
        const prof = [[0, 0], [0.046, 0], [0.05, 0.02], [0.05, 0.2], [0.03, 0.27], [0.016, 0.3], [0.016, 0.36], [0.021, 0.366], [0.021, 0.385], [0, 0.385]].map((p) => new T.Vector2(p[0], p[1]));
        const g = (this.obj = new T.Group());
        g.add(new T.Mesh(new T.LatheGeometry(prof, 14), new T.MeshPhysicalMaterial({ color: 0x2c7a55, roughness: 0.06, metalness: 0, clearcoat: 1, emissive: 0x0a2a1c, emissiveIntensity: 0.6 })));
        g.add(new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.2, 8).translate(0, 0.13, 0), new T.MeshStandardMaterial({ color: 0xd8c9a0, roughness: 0.9 })));      // the rolled map
        g.add(new T.Mesh(new T.CylinderGeometry(0.018, 0.015, 0.05, 8).translate(0, 0.39, 0), new T.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.9 })));   // cork
        g.scale.setScalar(1.5);
        const tex = DB.canvasTex(64, 64, (c, w) => { const gr = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(0.2, 'rgba(210,255,225,0.55)'); gr.addColorStop(1, 'rgba(160,255,200,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, w); }, { repeat: false });
        this.glint = new T.Sprite(new T.SpriteMaterial(Object.assign({ map: tex }, ADD))); this.glint.position.y = 0.2; g.add(this.glint);
        g.visible = false; E.group.add(g);
      },
      start(E, ctx) {
        const s = clearSpot(ctx.boat.group.position, 32, 58); this.x = s.x; this.z = s.z; this.spin = Math.random() * 6; this.obj.visible = true;
        DB.emit('event', { name: 'bottle', phase: 'start' });
      },
      update(E, dt, ctx) {
        const O = DB.Ocean, B = ctx.boat.group.position, t = E.t, d = Math.hypot(this.x - B.x, this.z - B.z);
        O.drift(this.x, this.z, _a); this.x += _a.x * dt * 0.4; this.z += _a.z * dt * 0.4;
        this.obj.position.set(this.x, O.height(this.x, this.z) - 0.05, this.z);
        this.obj.rotation.set(1.15 + Math.sin(t * 1.3) * 0.15, this.spin + t * 0.2, Math.sin(t * 0.9) * 0.2);
        const s = 1.2 + 0.9 * Math.pow(Math.max(Math.sin(t * 2.3), 0), 6); this.glint.scale.set(s, s, 1);
        E.pin = { pos: this.obj.position, text: `◈ 떠다니는 병  ${d.toFixed(0)} m` }; E.marks.push({ x: this.x, z: this.z, col: '#9dffc8', label: '병' });
        if (d < 7) {      // alongside: scooped up, and there is a map in it
          E.map = digSpot(); DB.Dive.setDig(E.map.x, E.map.z);
          DB.FX.splash(this.x, this.obj.position.y, this.z, 0.2); DB.emit('event', { name: 'bottle', phase: 'got' });
          return false;
        }
        if (t > 300) { DB.emit('event', { name: 'bottle', phase: 'lost' }); return false; }
        return true;
      },
      end() { this.obj.visible = false; },
    },

    // ---------------------------------------------------------------- the ghost ship: glides past out of a mist, and is gone
    ghost: {
      weight: () => (!DB.Assets.has('dutch_ship_medium') ? 0 : DB.Weather.k > 0.3 || DB.Env.tod !== 'day' ? 3 : 1.4),
      init(E) {
        const A = DB.Assets; if (!A.has('dutch_ship_medium')) return;
        const mat = (this.mat = new T.ShaderMaterial(Object.assign({
          vertexShader: 'varying vec3 vN; varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }',
          fragmentShader: `uniform float uTime, uFade; uniform vec3 uCol; varying vec3 vN; varying vec3 vW;
            void main(){ vec3 V = normalize(cameraPosition - vW); float fr = pow(1.0 - abs(dot(normalize(vN), V)), 1.6);
              float fl = 0.78 + 0.22 * sin(vW.y * 2.3 - uTime * 1.7) * sin(vW.x * 0.7 + uTime * 0.9);
              gl_FragColor = vec4(uCol * (0.5 + 1.7 * fr), uFade * (0.13 + 0.62 * fr) * fl * smoothstep(-0.4, 1.6, vW.y)); }`,
          uniforms: { uTime: { value: 0 }, uFade: { value: 0 }, uCol: { value: new T.Vector3(0.3, 1.0, 0.62) } }, side: T.DoubleSide,
        }, ADD)));
        const hull = new T.Group(), inner = new T.Group(), obj = (this.obj = new T.Group());
        A.parts('dutch_ship_medium').forEach((p, i) => hull.add(new T.Mesh(A.geo('dutch_ship_medium', i), mat)));
        if (A.has('dutch_ship_sails')) hull.add(new T.Mesh(A.geo('dutch_ship_sails', 0), mat));
        hull.rotation.y = Math.PI / 2; hull.position.y = -0.75; inner.add(hull); inner.scale.setScalar(1.6); obj.add(inner); obj.rotation.order = 'YXZ';
        // the crew: skeletons standing where the deck is (found by dropping a ray through the model)
        if (A.has('fab_skeleton')) {
          obj.updateMatrixWorld(true);
          const sg = A.geo('fab_skeleton', 0);
          for (const [x, z, ry] of [[1.6, -11, 0.4], [-1.8, -7, -1.2], [0.4, -2, 2.6], [2.2, 2, 1.2], [-2, 5, -0.6], [0.2, 9.5, 3.0], [-1.2, 12.5, 0.2]]) {
            const hit = new T.Raycaster(V3(x, 60, z), V3(0, -1, 0), 0, 90).intersectObject(inner, true)[0]; if (!hit || hit.point.y < 2) continue;
            const sk = new T.Mesh(sg, mat); sk.position.set(x, hit.point.y, z); sk.rotation.y = ry; sk.scale.setScalar(1.2); obj.add(sk);
          }
        }
        obj.traverse((o) => { o.frustumCulled = false; }); obj.visible = false; E.group.add(obj);
      },
      start(E, ctx) {
        const B = ctx.boat.group.position, a = Math.random() * 6.283, dx = Math.cos(a), dz = Math.sin(a), near = 42 + Math.random() * 18, side = Math.random() < 0.5 ? 1 : -1, run = 150;
        this.dx = dx; this.dz = dz; this.x = B.x - dz * near * side - dx * run; this.z = B.z + dx * near * side - dz * run; this.len = run * 2; this.s = 0; this.bell = 3; this.logged = false;
        this.obj.visible = true; this.obj.rotation.y = Math.atan2(-dx, -dz);
        DB.emit('event', { name: 'ghost', phase: 'start' });
      },
      update(E, dt, ctx) {
        const v = 5; this.s += v * dt; this.x += this.dx * v * dt; this.z += this.dz * v * dt;
        const fade = M.smooth(0, 40, this.s) * (1 - M.smooth(this.len - 50, this.len, this.s)), t = E.t, B = ctx.boat.group.position, d = Math.hypot(this.x - B.x, this.z - B.z);
        this.obj.position.set(this.x, Math.sin(t * 0.4) * 0.25, this.z); this.obj.rotation.x = Math.sin(t * 0.33) * 0.02; this.obj.rotation.z = Math.sin(t * 0.27) * 0.04;
        this.mat.uniforms.uTime.value = t; this.mat.uniforms.uFade.value = fade * (0.85 + 0.15 * Math.sin(t * 7.3) * Math.sin(t * 2.9));
        DB.Weather.mist = fade;
        if ((this.bell -= dt) <= 0) { this.bell = 5 + Math.random() * 5; DB.emit('event', { name: 'ghost', phase: 'bell', d }); }
        if (!this.logged && fade > 0.6 && d < 130 && !ctx.under && inView(ctx.camera, this.x, 12, this.z)) { this.logged = true; DB.emit('catch', { key: 'ghostShip', L: 54, kg: 0, method: 'watch' }); }
        return this.s < this.len;
      },
      end() { this.obj.visible = false; DB.Weather.mist = 0; },
    },

    // ---------------------------------------------------------------- a sea serpent, far off: coils rolling through the swell, a head that looks about
    serpent: {
      weight: () => 1.6,
      init(E) {
        const sg = serpentGeo(), mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.15, side: T.DoubleSide });
        const obj = (this.obj = new T.Group()); obj.rotation.order = 'YXZ';
        this.head = new T.Mesh(sg.head, mat); obj.add(this.head);
        this.arches = [0, 1, 2, 3].map((i) => { const m = new T.Mesh(sg.arch, mat); m.position.x = -10.5 - i * 10.8; m.scale.setScalar(1 - i * 0.12); obj.add(m); return m; });
        obj.traverse((o) => { o.frustumCulled = false; }); obj.visible = false; E.group.add(obj);
      },
      start(E, ctx) {
        const B = ctx.boat.group.position, s = clearSpot(B, 115, 165), a = s.a + Math.PI / 2 + (Math.random() - 0.5) * 0.8;
        this.x = s.x; this.z = s.z; this.dx = Math.cos(a); this.dz = Math.sin(a); this.obj.visible = true; this.obj.rotation.y = -a; this.logged = false; this.roar = 4.5; this.wake = 0;
        DB.emit('event', { name: 'serpent', phase: 'start' });
      },
      update(E, dt, ctx) {
        const O = DB.Ocean, t = E.t, DUR = 30, v = 3.6, B = ctx.boat.group.position;
        this.x += this.dx * v * dt; this.z += this.dz * v * dt;
        const rise = M.smooth(0, 5, t) * (1 - M.smooth(DUR - 6, DUR, t));      // up out of the sea, and down again at the end
        this.obj.position.set(this.x, O.height(this.x, this.z, 20) - 10.5 * (1 - rise), this.z);
        this.head.rotation.y = Math.sin(t * 0.6) * 0.5; this.head.rotation.z = Math.sin(t * 0.45) * 0.1;
        this.arches.forEach((m, i) => { m.position.y = Math.sin(t * 1.1 - i * 1.25) * 1.5 - 1.1; m.rotation.x = Math.sin(t * 0.7 + i) * 0.12; });
        if ((this.wake -= dt) <= 0 && rise > 0.5) {      // white water where the coils cut the surface
          this.wake = 0.35; const i = Math.floor(Math.random() * 4), k = -10.5 - i * 10.8 + (Math.random() < 0.5 ? -5 : 5);
          const wx = this.x + this.dx * k, wz = this.z + this.dz * k; DB.FX.splash(wx, O.height(wx, wz), wz, 0.9); O.addRipple(wx, wz, 1.5);
        }
        const d = Math.hypot(this.x - B.x, this.z - B.z);
        if ((this.roar -= dt) <= 0 && rise > 0.8) { this.roar = 99; DB.emit('event', { name: 'serpent', phase: 'roar', d }); }
        if (!this.logged && rise > 0.8 && !ctx.under && inView(ctx.camera, this.x, 5, this.z)) { this.logged = true; DB.emit('catch', { key: 'serpent', L: 45, kg: 0, method: 'watch' }); }
        E.marks.push({ x: this.x, z: this.z, col: '#7dff9c', label: '?' });
        return t < DUR;
      },
      end() { this.obj.visible = false; },
    },
    // ---------------------------------------------------------------- pirates: a ship that runs you down and opens fire; outrun it
    raid: {
      weight: () => (DB.Assets.has('dutch_ship_medium') ? 1.5 : 0),
      init(E) {
        const A = DB.Assets, Sea = DB.Sea; if (!A.has('dutch_ship_medium')) return;
        const hull = new T.Group();
        A.parts('dutch_ship_medium').forEach((p, i) => hull.add(new T.Mesh(A.geo('dutch_ship_medium', i), A.stdMaterial('dutch_ship_medium', p.mat, { side: T.DoubleSide, color: new T.Color(0.5, 0.42, 0.4) }))));
        if (A.has('dutch_ship_sails')) hull.add(new T.Mesh(A.geo('dutch_ship_sails', 0), A.stdMaterial('dutch_ship_sails', A.parts('dutch_ship_sails')[0].mat, { side: T.DoubleSide, color: new T.Color(0.32, 0.1, 0.09) })));      // blood-red sails
        hull.add(Sea.makeFlag(2.6, 1.6, -1.2, 23.2, 0));
        // it rides the swell and blocks the way like every other boat; parked far off and without a collider until it is wanted
        const b = (this.ship = Sea.addBoat({ id: 'raider', label: '', model: hull, fix: Math.PI / 2, wl: 0.75, scale: 1.3, x: 9e4, z: 9e4, h: 0, L: 28, W: 6, w0: 1.6, r: 0, swing: 0 }));
        this.obj = b.obj; b.obj.visible = false;
        const ballG = new T.SphereGeometry(0.24, 10, 8), ballM = new T.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.5, metalness: 0.6 });
        this.balls = [0, 1, 2, 3, 4, 5].map(() => { const m = new T.Mesh(ballG, ballM); m.visible = false; E.group.add(m); return { m, live: false, v: V3(), smoke: 0 }; });
      },
      start(E, ctx) {
        const B = ctx.boat.group.position, s = clearSpot(B, 235, 285), b = this.ship;
        b.x = s.x; b.z = s.z; b.h0 = b.h = Math.atan2(-(B.x - s.x), -(B.z - s.z)); b.col.r = 12; b.obj.visible = true;
        this.phase = 'chase'; this.fireT = 5; this.hits = 0; this.shots = 0; this.px = B.x; this.pz = B.z; this.vx = this.vz = 0; this.nearT = 0;
        DB.emit('event', { name: 'raid', phase: 'start' });
      },
      update(E, dt, ctx) {
        const O = DB.Ocean, b = this.ship, B = ctx.boat.group.position, dx = B.x - b.x, dz = B.z - b.z, d = Math.hypot(dx, dz) || 1, t = E.t;
        // where the player is going (for laying the guns)
        this.vx = M.damp(this.vx, (B.x - this.px) / Math.max(dt, 1e-3), 3, dt); this.vz = M.damp(this.vz, (B.z - this.pz) / Math.max(dt, 1e-3), 3, dt); this.px = B.x; this.pz = B.z;
        // helm: come round toward the quarry (or away, once it has given up); she is fast for her size but no match for twin diesels
        // inside 70 m she stops closing and swings round to keep the range, broadside on
        const away = this.phase === 'leave', want = Math.atan2(away ? dx : -dx, away ? dz : -dz) + (away ? 0 : M.smooth(75, 42, d) * 1.75), sp = away ? 9 : d < 75 ? 5.5 : 8.5;
        b.h0 += M.clamp(M.wrapPi(want - b.h0), -0.24 * dt, 0.24 * dt);
        b.x += -Math.sin(b.h0) * sp * dt; b.z += -Math.cos(b.h0) * sp * dt;
        if (Math.random() < dt * 3) { const bx = b.x - Math.sin(b.h0) * 15, bz = b.z - Math.cos(b.h0) * 15; DB.FX.splash(bx, O.height(bx, bz), bz, 0.5, -Math.sin(b.h0), -Math.cos(b.h0)); }      // bow wave
        if (!away) {
          E.pin = { pos: b.obj.position, text: `☠ 해적선  ${d.toFixed(0)} m` }; E.marks.push({ x: b.x, z: b.z, h: b.h0, col: '#ff5a4a', label: '해적' });
          // guns: one round every few seconds once in range, laid ahead of the boat with a scatter that grows with the distance
          if ((this.fireT -= dt) <= 0 && d < 200 && !ctx.under) {
            this.fireT = 2.6 + Math.random() * 1.8;
            const ball = this.balls.find((q) => !q.live);
            if (ball) {
              const T_ = 1.5 + d / 95, sc = 4 + d * 0.065 + Math.hypot(this.vx, this.vz) * 0.9, a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * sc;      // a fast boat is a hard mark
              const tx = B.x + this.vx * T_ + Math.cos(a) * r, tz = B.z + this.vz * T_ + Math.sin(a) * r, y0 = b.y + 4.5;
              ball.m.position.set(b.x, y0, b.z); ball.v.set((tx - b.x) / T_, -y0 / T_ + 4.905 * T_, (tz - b.z) / T_); ball.live = true; ball.m.visible = true; this.shots++;
              for (let i = 0; i < 10; i++) DB.FX.emit({ x: b.x, y: y0, z: b.z, vx: ball.v.x * 0.12 + (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, vz: ball.v.z * 0.12 + (Math.random() - 0.5) * 3, life: 1.5 + Math.random() * 1.5, size: 1.2 + Math.random() * 1.4, grow: 1.6, kind: 0, alpha: 0.5, grav: 0.4, drag: 1.2, r: i < 3 ? 3 : 0.35, g: i < 3 ? 1.6 : 0.35, b: i < 3 ? 0.5 : 0.37 });
              DB.emit('event', { name: 'raid', phase: 'fire', d });
            }
          }
          if (d > 320) { this.phase = 'leave'; DB.emit('event', { name: 'raid', phase: 'escaped', hits: this.hits }); }
          else if (t > 110) { this.phase = 'leave'; DB.emit('event', { name: 'raid', phase: 'gaveup', hits: this.hits }); }
        }
        // shot in flight
        for (const q of this.balls) {
          if (!q.live) continue;
          q.v.y -= 9.81 * dt; q.m.position.addScaledVector(q.v, dt); const p = q.m.position;
          if ((q.smoke -= dt) <= 0) { q.smoke = 0.07; DB.FX.emit({ x: p.x, y: p.y, z: p.z, life: 0.7, size: 0.5, grow: 0.8, kind: 0, alpha: 0.22, grav: 0, drag: 1, r: 0.4, g: 0.4, b: 0.42 }); }
          if (p.y < O.height(p.x, p.z)) {      // the fall of shot: a column of water — and trouble if it is close
            q.live = false; q.m.visible = false;
            const miss = Math.hypot(p.x - B.x, p.z - B.z);
            DB.FX.splash(p.x, p.y, p.z, 2.6); DB.FX.splash(p.x, p.y, p.z, 1.4); O.addRipple(p.x, p.z, 3);
            if (miss < 4.5) this.hits++;
            DB.emit('event', { name: 'raid', phase: 'fall', miss });
          }
        }
        return !(away && (d > 430 || t > 170));
      },
      end() { const b = this.ship; b.obj.visible = false; b.col.r = 0; b.x = b.z = 9e4; for (const q of this.balls) { q.live = false; q.m.visible = false; } },
    },

    // ---------------------------------------------------------------- the kraken: arms come up round the anchored boat and beat on it; drive them off with flares
    kraken: {
      weight: (E, ctx) => (ctx && ctx.boat.mode === 'anchor' && !ctx.drive ? 1.3 : 0),
      init(E) {
        const H = 10, NS = 30, MR = 10, pos = [], col = [], idx = [];
        // one arm: a tapering tube standing on the water, pale underside with a double row of suckers; the vertex shader makes it sway
        for (let i = 0; i <= NS; i++) {
          const t = i / NS, r = 0.78 * Math.pow(1 - t, 0.85) + 0.05, cx = Math.sin(t * 2.6) * 0.8 * t;
          for (let j = 0; j < MR; j++) {
            const a = (j / MR) * 6.283, c = Math.cos(a), s = Math.sin(a), n = 0.8 + 0.4 * M.noise2(t * 19 + 3, j * 2.7), under = M.smooth(0.2, 0.75, c);
            pos.push(cx + c * r, t * H, s * r);
            col.push(M.lerp(0.17 * n, 0.4, under), M.lerp(0.03 * n, 0.17, under), M.lerp(0.028 * n, 0.15, under));
          }
          if (i < NS) for (let j = 0; j < MR; j++) { const a0 = i * MR + j, a1 = i * MR + ((j + 1) % MR); idx.push(a0, a0 + MR, a1, a1, a0 + MR, a1 + MR); }
        }
        const tube = new T.BufferGeometry(); tube.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); tube.setAttribute('color', new T.Float32BufferAttribute(col, 3)); tube.setIndex(idx); tube.computeVertexNormals();
        const parts = [tube];
        for (let i = 1; i < 26; i++) for (const sd of [-1, 1]) {
          const t = i / 27, r = 0.78 * Math.pow(1 - t, 0.85) + 0.05, cx = Math.sin(t * 2.6) * 0.8 * t;
          parts.push(G.tint(G.xf(G.cyl(r * 0.2, r * 0.26, r * 0.14, 8), [cx + r * 0.94, t * H, sd * r * 0.3], [0, 0, -Math.PI / 2]), 0xd8b8a8));
        }
        this.geo = G.merge(parts);
        this.arms = [0, 1, 2, 3, 4, 5].map((i) => {
          const u = { uT: { value: i * 1.7 } }, mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.05 });
          mat.onBeforeCompile = (sh) => {
            sh.uniforms.uT = u.uT;
            sh.vertexShader = 'uniform float uT;\n' + sh.vertexShader.replace('#include <begin_vertex>', `vec3 transformed = vec3(position); float kt = position.y / ${H.toFixed(1)};
              transformed.x += sin(uT * 1.6 + kt * 4.0) * kt * kt * 1.3; transformed.z += cos(uT * 1.25 + kt * 3.3) * kt * kt * 1.1;`);
          };
          mat.customProgramCacheKey = () => 'krakenArm';
          const m = new T.Mesh(this.geo, mat); m.rotation.order = 'YXZ'; m.frustumCulled = false; m.visible = false; m.castShadow = true; E.group.add(m);
          return { m, u, st: 'gone', t: 0, y: -12, lean: 0, ang: 0, r: 8 };
        });
        this.obj = this.arms[0].m;
        // flare pistol, held low on the right; the flare itself is a point of red light that burns as it flies
        const gun = (this.gun = new T.Group()), or = new T.MeshStandardMaterial({ color: 0xe8541c, roughness: 0.45 }), dk = new T.MeshStandardMaterial({ color: 0x15161a, roughness: 0.6 });
        gun.add(new T.Mesh(new T.CylinderGeometry(0.024, 0.026, 0.19, 12).rotateX(Math.PI / 2).translate(0, 0, -0.1), or));
        gun.add(new T.Mesh(new T.BoxGeometry(0.036, 0.11, 0.05).translate(0, -0.06, 0.02), or));
        gun.add(new T.Mesh(new T.CylinderGeometry(0.05, 0.062, 0.5, 10).rotateX(Math.PI / 2 - 0.5).translate(0.03, -0.25, 0.25), dk));      // sleeve
        gun.add(new T.Mesh(new T.SphereGeometry(0.052, 10, 8).translate(0, -0.075, 0.035), dk));                                              // glove
        gun.position.set(0.22, -0.2, -0.45); gun.visible = false; DB.camera.add(gun);
        const tex = DB.canvasTex(64, 64, (c, w) => { const gr = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,250,235,1)'); gr.addColorStop(0.18, 'rgba(255,120,70,0.85)'); gr.addColorStop(1, 'rgba(255,40,20,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, w); }, { repeat: false });
        this.flare = { m: new T.Sprite(new T.SpriteMaterial(Object.assign({ map: tex }, ADD))), live: false, v: V3(), t: 0 }; this.flare.m.scale.set(1.6, 1.6, 1); this.flare.m.visible = false; E.group.add(this.flare.m);
      },
      start(E, ctx) {
        const B = ctx.boat, a0 = Math.random() * 6.283;
        this.arms.forEach((arm, i) => { arm.ang = a0 + (i / 6) * 6.283 + (Math.random() - 0.5) * 0.4; arm.r = 7.2 + Math.random() * 2.4; arm.st = 'wait'; arm.t = 2.4 + i * 0.35; arm.y = -12; arm.lean = 0; arm.m.visible = true; });
        this.cool = 7; this.hits = 0; this.reload = 0; this.over = 0; this.flare.live = false; this.logged = false;
        DB.Fishing.setActive(false); this.gun.visible = false;
        DB.emit('event', { name: 'kraken', phase: 'start' });
      },
      // world position of a point `k` of the way up an arm (0 base … 1 tip), allowing for its lean
      armPoint(arm, k, out) { return out.set(0, 10 * k, 0).applyMatrix4(arm.m.matrixWorld); },
      update(E, dt, ctx) {
        const O = DB.Ocean, B = ctx.boat.group.position, t = E.t, cam = ctx.camera, inp = ctx.inp;
        const alive = this.arms.filter((a) => a.st !== 'gone' && a.st !== 'sink');
        this.gun.visible = t > 2 && !this.over; this.gun.rotation.x = M.damp(this.gun.rotation.x, 0, 8, dt);
        this.cool -= dt;
        for (const arm of this.arms) {
          if (arm.st === 'gone') continue;
          arm.t -= dt; arm.u.uT.value += dt * (arm.st === 'windup' ? 2.2 : 1);
          const x = B.x + Math.cos(arm.ang) * arm.r, z = B.z + Math.sin(arm.ang) * arm.r;
          let yT = -1.2, leanT = 0.1;      // lean > 0 tips the arm toward the boat
          if (arm.st === 'wait') { yT = -12; if (arm.t <= 0) { arm.st = 'sway'; arm.t = 2 + Math.random() * 4; DB.FX.splash(x, O.height(x, z), z, 1.6); O.addRipple(x, z, 2.5); } }
          else if (arm.st === 'sway') { if (arm.t <= 0 && this.cool <= 0 && !this.over) { arm.st = 'windup'; arm.t = 1.5; this.cool = 3.2 - Math.min((6 - alive.length) * 0.2, 1); DB.emit('event', { name: 'kraken', phase: 'windup' }); } }      // one arm at a time, a little quicker as they are driven off
          else if (arm.st === 'windup') { yT = 0.6; leanT = -0.45; if (arm.t <= 0) { arm.st = 'slam'; arm.t = 0.34; } }
          else if (arm.st === 'slam') {
            leanT = 1.32; yT = -0.6;
            if (arm.t <= 0) {      // down across the boat
              arm.st = 'recover'; arm.t = 1.3; this.hits++;
              DB.FX.splash(B.x + Math.cos(arm.ang) * 2.5, O.height(B.x, B.z) + 0.5, B.z + Math.sin(arm.ang) * 2.5, 2.2); O.addRipple(B.x, B.z, 3);
              DB.emit('event', { name: 'kraken', phase: 'slam', hits: this.hits });
            }
          } else if (arm.st === 'recover') { leanT = 0.5; if (arm.t <= 0) { arm.st = 'sway'; arm.t = 2.5 + Math.random() * 4; } }
          else if (arm.st === 'sink') { yT = -13; leanT = -0.7; if (arm.t <= 0) { arm.st = 'gone'; arm.m.visible = false; } }
          arm.y = M.damp(arm.y, yT, arm.st === 'sink' ? 1.6 : 2.6, dt); arm.lean = M.damp(arm.lean, leanT, arm.st === 'slam' ? 22 : 4, dt);
          arm.m.position.set(x, O.height(x, z, 6) + arm.y, z);
          arm.m.rotation.set(0, -arm.ang + Math.PI, 0); arm.m.rotateZ(-arm.lean);      // local +x points at the boat; a negative roll about z tips the top toward it
          arm.m.updateMatrixWorld(true);
        }
        if (!this.logged && t > 4 && alive.some((a) => inView(cam, a.m.position.x, 4, a.m.position.z))) { this.logged = true; DB.emit('catch', { key: 'kraken', L: 30, kg: 0, method: 'watch' }); }
        // --- the flare pistol
        this.reload -= dt;
        const fl = this.flare;
        if (this.gun.visible && inp && inp.mouseDown(0) && this.reload <= 0 && !fl.live) {
          const f = _a.set(0, 0, -1).applyQuaternion(cam.quaternion);
          fl.m.position.copy(cam.position).addScaledVector(f, 0.8); fl.m.position.y -= 0.12; fl.v.copy(f).multiplyScalar(58); fl.live = true; fl.t = 0; fl.m.visible = true;
          this.reload = 0.75; this.gun.rotation.x = 0.35; DB.emit('event', { name: 'kraken', phase: 'fire' });
        }
        if (fl.live) {
          fl.t += dt; fl.v.y -= 5 * dt; const p0 = _b.copy(fl.m.position); fl.m.position.addScaledVector(fl.v, dt); const p = fl.m.position;
          if (Math.random() < dt * 60) DB.FX.emit({ x: p.x, y: p.y, z: p.z, vy: 0.4, life: 0.6, size: 0.35, grow: 0.5, kind: 0, alpha: 0.35, grav: 0.5, drag: 1, r: 2.4, g: 0.5, b: 0.3 });
          let hit = null;
          for (const arm of alive) {      // the flare against the arm's line (base to most of the way up)
            if (arm.st === 'wait') continue;
            const a = this.armPoint(arm, 0.05, _c), b = this.armPoint(arm, 0.85, _d);
            if (segSeg(p0, p, a, b) < 1.25) { hit = arm; break; }
          }
          if (hit) {
            hit.st = 'sink'; hit.t = 1.5; fl.live = false; fl.m.visible = false;
            for (let i = 0; i < 26; i++) DB.FX.emit({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 9, vy: Math.random() * 7, vz: (Math.random() - 0.5) * 9, life: 0.5 + Math.random() * 0.7, size: 0.16, kind: 1, alpha: 1, drag: 0.6, r: 3, g: 0.6, b: 0.25 });
            DB.emit('event', { name: 'kraken', phase: 'burn', left: alive.length - 1 });
          } else if (fl.t > 2.6 || p.y < O.height(p.x, p.z)) { fl.live = false; fl.m.visible = false; }
        }
        // --- how it ends: every arm burnt, or the boat beaten five times
        if (!this.over) {
          if (!alive.length && t > 4) { this.over = 1; this.endT = 2; DB.emit('event', { name: 'kraken', phase: 'beaten', hits: this.hits }); }
          else if (this.hits >= 5) { this.over = 2; this.endT = 2.5; for (const a of alive) { a.st = 'sink'; a.t = 1.8; } DB.emit('event', { name: 'kraken', phase: 'robbed' }); }
        } else if ((this.endT -= dt) <= 0) return false;
        return true;
      },
      end(E) { for (const a of this.arms) { a.st = 'gone'; a.m.visible = false; } this.gun.visible = false; this.flare.live = false; this.flare.m.visible = false; this.over = 0; DB.emit('event', { name: 'kraken', phase: 'end' }); },
    },
  };

  const Events = (DB.Events = {
    KINDS, cur: null, name: '', t: 0, wait: 120, last: '', map: null, pin: null, marks: [], auto: !DB.params.has('noevents'),

    init(scene) {
      this.group = new T.Group(); scene.add(this.group);
      for (const k in KINDS) KINDS[k].init(this);
    },
    // start a named event now (DB.debug.event), or let the weights choose; false when it cannot run
    start(name, ctx) {
      if (this.cur) this.stop();
      let pick = name;
      if (!pick) {
        const pool = Object.keys(KINDS).map((k) => [k, k === this.last ? 0 : KINDS[k].weight(this, ctx)]).filter((p) => p[1] > 0);
        let r = Math.random() * pool.reduce((a, p) => a + p[1], 0);
        for (const [k, w] of pool) if ((r -= w) <= 0) { pick = k; break; }
      }
      const k = KINDS[pick]; if (!k || !k.obj) return false;      // (a kind whose model pack is missing has nothing to show)
      this.cur = k; this.name = this.last = pick; this.t = 0; k.start(this, ctx);
      return true;
    },
    stop() { if (this.cur) { this.cur.end(this); this.cur = null; this.name = ''; this.wait = 150 + Math.random() * 110; } },

    // ctx: { camera, boat, under, playing, calm (no fish on the line), drive, inp (the input, or a null one when the player is not in control) }
    update(dt, ctx) {
      this.pin = null; this.marks.length = 0; this.group.visible = !ctx.under;
      if (this.map) {
        this.marks.push({ x: this.map.x, z: this.map.z, col: '#ffd24a', label: '보물', cross: true });
        if (ctx.under && DB.Dive.dig) this.pin = { pos: DB.Dive.dig.pos, text: `✕ 지도의 보물  ${DB.Dive.dig.pos.distanceTo(DB.Dive.pos).toFixed(0)} m` };
      }
      if (!this.cur) { if (this.auto && ctx.playing && !ctx.under && ctx.calm && (this.wait -= dt) <= 0) this.start(null, ctx); return; }
      this.t += dt;
      if (this.cur.update(this, dt, ctx) === false) this.stop();
    },
    // the chest the map led to has been dug up
    found() { this.map = null; },
    // plain models for the field-guide portraits
    portrait(key) {
      const A = DB.Assets, g = new T.Group();
      if (key === 'ghost') {
        if (!A.has('dutch_ship_medium')) return null;
        const m = new T.MeshStandardMaterial({ color: 0x7dffb8, emissive: 0x1f8a55, roughness: 0.7, side: T.DoubleSide });
        A.parts('dutch_ship_medium').forEach((p, i) => g.add(new T.Mesh(A.geo('dutch_ship_medium', i), m)));
        if (A.has('dutch_ship_sails')) g.add(new T.Mesh(A.geo('dutch_ship_sails', 0), m));
        g.rotation.y = 0.9;
      } else if (key === 'serpent') {
        const sg = serpentGeo(), m = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, side: T.DoubleSide });
        g.add(new T.Mesh(sg.head, m));
        for (let i = 0; i < 2; i++) { const a = new T.Mesh(sg.arch, m); a.position.set(-10.5 - i * 10.8, -1.1, 0); g.add(a); }
        g.rotation.y = -0.6;
      } else if (key === 'kraken') {
        const m = new T.Mesh(KINDS.kraken.geo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 })); m.rotation.set(0, 0.6, -0.5); g.add(m);
      } else return null;
      return g;
    },
  });
})();
