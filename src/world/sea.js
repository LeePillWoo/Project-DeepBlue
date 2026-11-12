// Project Deep Blue — the sea around the boat: pirate island + lighthouse, a moored galleon, working boats with crew, gulls.
// Everything here is above-water set dressing (standard PBR materials); the reef site itself lives in reef.js.
(function () {
  'use strict';
  const DB = window.DB, T = THREE, M = DB.M;
  const V3 = (x, y, z) => new T.Vector3(x, y, z);
  const _m = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler(0, 0, 0, 'YXZ'), _p = V3(), _s = V3(1, 1, 1);

  // island rocks, island-local: [model, x, y, z, rotY, scale, collider radius (0 = none)]
  const ROCKS = [
    ['cliff_a', 0, -3, 0, 0.5, 3.2, 31],
    ['cliff_b', 43, -2.5, 10, 2.2, 2.7, 17],
    ['cliff_c', -16, -3, -18, Math.PI + 0.25, 2.3, 22],
    ['cliff_d', 22, -2.5, -30, 2.75, 1.9, 15],
    ['cliff_b', -70, -2, -34, 0.9, 1.5, 10],      // sea stacks standing off the island
    ['cliff_b', 78, -1.5, -52, 4.0, 1.1, 8],
  ];

  function jollyRoger() {
    return DB.canvasTex(256, 160, (c, w, h) => {
      c.fillStyle = '#0a0a0c'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#e9e6dc'; c.fillStyle = '#e9e6dc'; c.lineCap = 'round'; c.lineWidth = 11;
      for (const s of [-1, 1]) {      // crossed bones
        c.beginPath(); c.moveTo(w / 2 - 62 * s, 112); c.lineTo(w / 2 + 62 * s, 142); c.stroke();
        for (const [x, y] of [[w / 2 - 62 * s, 112], [w / 2 + 62 * s, 142]]) { c.beginPath(); c.arc(x - 5, y - 5, 8, 0, 7); c.arc(x + 5, y + 5, 8, 0, 7); c.fill(); }
      }
      c.beginPath(); c.ellipse(w / 2, 66, 40, 37, 0, 0, 7); c.fill(); c.fillRect(w / 2 - 22, 88, 44, 26);
      c.fillStyle = '#0a0a0c';
      c.beginPath(); c.ellipse(w / 2 - 16, 66, 11, 12, 0, 0, 7); c.ellipse(w / 2 + 16, 66, 11, 12, 0, 0, 7); c.fill();
      c.beginPath(); c.moveTo(w / 2, 80); c.lineTo(w / 2 - 6, 92); c.lineTo(w / 2 + 6, 92); c.fill();
      for (let i = -2; i <= 2; i++) c.fillRect(w / 2 + i * 8 - 1, 100, 2, 14);
    }, { repeat: false });
  }

  // one gull, wingspan 1.3 m, nose toward -z. aW = signed distance along the wing (the shader flaps with it)
  function gullGeo() {
    const body = new T.SphereGeometry(1, 6, 5).toNonIndexed(); body.scale(0.055, 0.05, 0.23);
    const pos = Array.from(body.attributes.position.array), n0 = pos.length / 3, aw = new Array(n0).fill(0), col = [];
    for (let i = 0; i < n0; i++) { const k = pos[i * 3 + 2] > 0.17 ? 0.5 : 0.9; col.push(k, k, k); }
    const tri = (pts) => { for (const [x, y, z, c] of pts) { pos.push(x, y, z); aw.push(x); col.push(c, c, c * 1.04); } };
    for (const s of [-1, 1]) {
      const r0 = [s * 0.045, 0.02, -0.085, 0.86], r1 = [s * 0.045, 0.02, 0.1, 0.8], m0 = [s * 0.34, 0.03, -0.1, 0.62], m1 = [s * 0.34, 0.03, 0.065, 0.56], t = [s * 0.66, 0, 0.05, 0.05];
      tri([r0, m0, r1]); tri([r1, m0, m1]); tri([m0, t, m1]);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('aW', new T.Float32BufferAttribute(aw, 1)); g.setAttribute('aCol', new T.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }

  // wave-following for a hull that is not the player's: fit a plane through four points, spring toward it
  function ride(b, dt) {
    const O = DB.Ocean, s = Math.sin(b.h), c = Math.cos(b.h), hl = b.L * 0.4, hw = b.W * 0.4;
    const hb = O.height(b.x - s * hl, b.z - c * hl, 8), hs = O.height(b.x + s * hl, b.z + c * hl, 8), hp = O.height(b.x - c * hw, b.z + s * hw, 6), hsb = O.height(b.x + c * hw, b.z - s * hw, 6);
    const sd = (cur, vel, target, w, z) => vel + (w * w * (target - cur) - 2 * z * w * vel) * dt;
    b.vy = sd(b.y, b.vy, (hb + hs + hp + hsb) / 4, b.w0, 0.6); b.y += b.vy * dt;
    b.vp = sd(b.pitch, b.vp, Math.atan2(hb - hs, 2 * hl), b.w0, 0.55); b.pitch += b.vp * dt;
    b.vr = sd(b.roll, b.vr, Math.atan2(hsb - hp, 2 * hw), b.w0 * 0.9, 0.4); b.roll += b.vr * dt;
    b.obj.position.set(b.x, b.y, b.z); b.obj.rotation.set(b.pitch, b.h, b.roll);
    b.col.x = b.x; b.col.z = b.z;
  }

  const Sea = (DB.Sea = {
    group: new T.Group(), boats: [], colliders: [], pois: [], crew: [], flags: [], t: 0, excited: 0, found: {},
    REEF_R: 62,                                   // diving is possible within this distance of the reef marker (world origin)

    init(scene) {
      const A = DB.Assets, grp = this.group, I = DB.World.island;
      scene.add(grp);
      this.pois.push({ id: 'reef', x: 0, z: 0, r: this.REEF_R, label: '다이빙 포인트' });
      if (!A.has('cliff_a')) return;      // sea pack missing: open ocean only

      // ---- island
      const isl = (this.island = new T.Group()); isl.position.set(I.x, 0, I.z); grp.add(isl);
      const wet = (mat, lo = 0.4, hi = 2.8, dark = 0.4) => {      // dark, glossy band where the swell washes the rock (narrower and lighter on sand)
        const band = `(1.0 - smoothstep(${lo.toFixed(2)}, ${hi.toFixed(2)}, vWy))`;
        mat.onBeforeCompile = (sh) => {
          sh.vertexShader = 'varying float vWy;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vWy = (modelMatrix * vec4(transformed, 1.0)).y;');
          sh.fragmentShader = 'varying float vWy;\n' + sh.fragmentShader
            .replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb *= mix(1.0, ${dark.toFixed(2)}, ${band});`)
            .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.22, ${band});`);
        };
        mat.customProgramCacheKey = () => `wet${lo}_${hi}_${dark}`;
        return mat;
      };
      const rockMat = {};
      for (const [name, x, y, z, ry, s, cr] of ROCKS) {
        const mat = rockMat[name] || (rockMat[name] = wet(A.stdMaterial(name, A.parts(name)[0].mat)));
        const mesh = new T.Mesh(A.geo(name, 0), mat); mesh.position.set(x, y, z); mesh.rotation.y = ry; mesh.scale.setScalar(s); isl.add(mesh);
        if (cr) this.colliders.push({ x: I.x + x, z: I.z + z, r: cr });
      }
      // sand spit in the lee of the rock: a low dome with a ragged edge
      const BX = 34, BZ = -58, BR = 36, seg = 48, rings = 14, pos = [], uv = [], idx = [];
      const beachH = (r, a) => { const k = r / (BR * (1 + 0.16 * Math.sin(a * 3 + 1) + 0.09 * Math.sin(a * 7))); return 4.4 * Math.pow(Math.max(1 - k * k, 0), 0.75) - 0.8 + 0.25 * M.fbm2(Math.cos(a) * r * 0.2 + 5, Math.sin(a) * r * 0.2, 2); };
      this.beachY = (lx, lz) => beachH(Math.hypot(lx - BX, lz - BZ), Math.atan2(lz - BZ, lx - BX));
      for (let j = 0; j <= rings; j++) for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * 6.2832, r = (j / rings) * BR * 1.3;
        pos.push(BX + Math.cos(a) * r, beachH(r, a), BZ + Math.sin(a) * r); uv.push((BX + Math.cos(a) * r) / 3.1, (BZ + Math.sin(a) * r) / 3.1);
        if (j < rings && i < seg) { const o = j * (seg + 1) + i; idx.push(o, o + 1, o + seg + 1, o + 1, o + seg + 2, o + seg + 1); }      // wound so the normals face up
      }
      const bg = new T.BufferGeometry(); bg.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); bg.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); bg.setIndex(idx); bg.computeVertexNormals();
      const sand = A.texSet('coast_sand_01');
      isl.add(new T.Mesh(bg, wet(new T.MeshStandardMaterial({ map: sand.map, normalMap: sand.normalMap, normalScale: new T.Vector2(1, -1), roughness: 0.92, color: new T.Color(2.1, 1.95, 1.7) }), 0.05, 0.75, 0.55)));
      this.colliders.push({ x: I.x + BX, z: I.z + BZ, r: BR * 0.72 });
      // things on the beach
      const put = (obj, lx, lz, ry = 0, s = 1, dy = 0, tilt = 0) => { obj.position.set(lx, this.beachY(lx, lz) + dy, lz); obj.rotation.set(tilt, ry, tilt * 0.6); obj.scale.setScalar(s); isl.add(obj); return obj; };
      const palm = A.object('palm');
      for (const [lx, lz, s, ry, tl] of [[28, -50, 1.0, 0.3, 0.06], [37, -54, 1.25, 2.1, -0.08], [24, -60, 0.85, 4.0, 0.1], [42, -64, 1.05, 5.2, 0.05], [33, -70, 0.9, 1.2, -0.12], [46, -50, 0.75, 3.3, 0.09], [20, -70, 0.7, 2.6, 0.1]]) put(palm.clone(), lx, lz, ry, s, -0.25, tl);
      put(A.object('rowboat'), 44, -80, 0.9, 1.15, -0.05, 0.08);
      const barrel = A.object('barrel');
      put(barrel.clone(), 35.5, -61.5, 0.4, 1, -0.04); put(barrel.clone(), 36.4, -62.2, 1.7, 1, -0.04); put(barrel.clone(), 35.2, -63, 2.2, 1, 0.26).rotation.set(1.5, 0.6, 0);
      if (A.has('fab_chest')) put(A.object('fab_chest'), 34, -64.5, 2.4, 0.62, -0.03);
      // pirate colours on a spar by the camp
      const pole = new T.Mesh(new T.CylinderGeometry(0.05, 0.07, 6.4, 8), new T.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 })); pole.position.y = 3.2;
      const camp = new T.Group(); camp.add(pole); put(camp, 32.5, -67, 0, 1, -0.3);
      this.flagTex = jollyRoger();
      camp.add(this.makeFlag(2.3, 1.45, 0, 5.55, 0));
      // lighthouse on the shoulder of the east rock
      const lh = (this.lighthouse = A.object('lighthouse')); lh.scale.setScalar(1.75); lh.position.set(44, 19.5, 11); isl.add(lh);
      const glowTex = DB.canvasTex(64, 64, (c, w) => { const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, 'rgba(255,244,214,1)'); g.addColorStop(0.25, 'rgba(255,214,140,0.5)'); g.addColorStop(1, 'rgba(255,190,90,0)'); c.fillStyle = g; c.fillRect(0, 0, w, w); }, { repeat: false });
      // additive, but leaves the alpha channel alone (the ocean pass owns it)
      this.lamp = new T.Sprite(new T.SpriteMaterial({ map: glowTex, blending: T.CustomBlending, blendSrc: T.SrcAlphaFactor, blendDst: T.OneFactor, blendSrcAlpha: T.ZeroFactor, blendDstAlpha: T.OneFactor, depthWrite: false, toneMapped: false }));
      this.lamp.position.set(44, 19.5 + 8.85 * 1.75, 11); isl.add(this.lamp);
      this.pois.push({ id: 'island', x: I.x + 12, z: I.z - 12, r: 60, label: '해적섬' }, { id: 'light', x: I.x + 44, z: I.z + 11, label: '등대' });

      // ---- the galleon, moored in the lee of the island
      if (A.has('dutch_ship_medium')) {
        const hull = new T.Group(), SC = 1.6;
        A.parts('dutch_ship_medium').forEach((p, i) => hull.add(new T.Mesh(A.geo('dutch_ship_medium', i), A.stdMaterial('dutch_ship_medium', p.mat, { side: T.DoubleSide }))));
        if (A.has('dutch_ship_sails')) hull.add(new T.Mesh(A.geo('dutch_ship_sails', 0), A.stdMaterial('dutch_ship_sails', A.parts('dutch_ship_sails')[0].mat, { side: T.DoubleSide })));
        hull.add(this.makeFlag(2.6, 1.6, -1.2, 23.2, 0));
        this.addBoat({ id: 'ship', label: '해적선', model: hull, fix: Math.PI / 2, wl: 0.75, scale: SC, x: I.x + 62, z: I.z - 96, h: 2.2, L: 34, W: 7.5, w0: 1.5, r: 15, swing: 0.05 });
      }
      // ---- working boats
      if (A.has('npc_boat_aberdeen')) {
        const b = this.addBoat({ id: 'aberdeen', label: '어선', model: A.object('npc_boat_aberdeen'), fix: 0, wl: 0.55, scale: 1, x: 58, z: 44, h: 0.6, L: 14, W: 6, w0: 2.4, r: 7.5, swing: 0.12 });
        this.addCrew(b, 1.9, 3.4, Math.PI / 2);
        this.addRod(b, 2.75, 3.9, 1);
      }
      if (A.has('npc_boat_wood')) {
        const b = this.addBoat({ id: 'wood', label: '목선', model: A.object('npc_boat_wood'), fix: Math.PI / 2, wl: 0.2, scale: 1, x: -74, z: 82, h: -1.1, L: 11.5, W: 2.8, w0: 2.8, r: 5.5, swing: 0.2 });
        this.addCrew(b, -0.55, 3.6, -Math.PI / 2);
        this.addRod(b, -1.2, 3.9, -1);
      }
      if (A.has('npc_trawler')) this.addBoat({ id: 'trawler', label: '트롤선', model: A.object('npc_trawler'), fix: Math.PI, wl: 1.75, scale: 1.25, x: 0, z: 0, h: 0, L: 15, W: 5.5, w0: 2.2, r: 8, path: { cx: 70, cz: -60, R: 205, v: 3.4, a: 2.4 } });

      // ---- gulls: a flock that follows the boat, another wheeling round the lighthouse
      const NG = 22, gg = gullGeo(), ph = new Float32Array(NG);
      this.gulls = [];
      for (let i = 0; i < NG; i++) {
        ph[i] = Math.random() * 6.283;
        this.gulls.push({ home: i < 13 ? 0 : 1, r: 9 + Math.random() * 26, h: 8 + Math.random() * 16, a: Math.random() * 6.283, dir: Math.random() < 0.5 ? -1 : 1, v: 6 + Math.random() * 3, ph: Math.random() * 9, x: 0, y: 12, z: 0 });
      }
      gg.setAttribute('aPh', new T.InstancedBufferAttribute(ph, 1));
      this.gullMesh = new T.InstancedMesh(gg, new T.ShaderMaterial({
        vertexShader: `attribute float aW; attribute vec3 aCol; attribute float aPh; uniform float uTime; varying vec3 vC; varying vec3 vN;
          void main(){ vec3 p = position; float flap = smoothstep(-0.25, 0.45, sin(uTime * 0.37 + aPh * 3.1)), a = sin(uTime * 8.5 + aPh) * 0.7 * flap + 0.13, s = abs(aW);
            p.y += s * sin(a) * (0.75 + 0.5 * s) - s * s * 0.22 * (1.0 - flap); p.x *= 1.0 - 0.2 * a * a;
            mat4 mm = modelMatrix * instanceMatrix; vN = normalize(mat3(mm) * normal); vC = aCol; gl_Position = projectionMatrix * viewMatrix * (mm * vec4(p, 1.0)); }`,
        fragmentShader: `uniform vec3 uSun, uAmb, uSunDir; varying vec3 vC; varying vec3 vN;
          void main(){ vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0); gl_FragColor = vec4(vC * (uSun * (0.25 + 0.75 * max(dot(n, uSunDir), 0.0)) / 3.14159 + uAmb * (0.7 + 0.3 * n.y)), 1.0); }`,
        uniforms: { uTime: { value: 0 }, uSun: { value: DB.Env.sunColor }, uAmb: { value: DB.Env.ambColor }, uSunDir: { value: DB.Env.sunDir } }, side: T.DoubleSide, toneMapped: false,
      }), NG);
      this.gullMesh.frustumCulled = false; grp.add(this.gullMesh);
      this.flockC = V3(0, 0, 0);
    },

    // model: Object3D whose bow may point anywhere — `fix` turns it to the game's boat frame (bow = -z), wl = model height of the waterline
    addBoat(o) {
      const obj = new T.Group(), inner = new T.Group();
      inner.add(o.model); o.model.rotation.y = o.fix; o.model.position.y = -o.wl; inner.scale.setScalar(o.scale);
      obj.add(inner); obj.rotation.order = 'YXZ'; this.group.add(obj);
      const b = Object.assign({ obj, inner, y: 0, pitch: 0, roll: 0, vy: 0, vp: 0, vr: 0, h0: o.h, col: { x: o.x, z: o.z, r: o.r, boat: true } }, o);
      this.boats.push(b); this.colliders.push(b.col); this.pois.push({ id: o.id, boat: b, label: o.label });
      return b;
    },
    // a fisherman standing on deck at boat-frame (x, z); deck height found by casting a ray down through the model
    addCrew(b, x, z, faceY) {
      const ch = DB.Assets.character('fisherman'); if (!ch) return;
      b.obj.updateMatrixWorld(true);
      const from = V3(x, 30, z).applyMatrix4(b.obj.matrixWorld), hit = new T.Raycaster(from, V3(0, -1, 0), 0, 60).intersectObject(b.inner, true)[0];
      ch.group.position.set(x, hit ? 30 - hit.distance : 1, z); ch.group.rotation.y = faceY;
      b.obj.add(ch.group); ch.actions.idle.play(); ch.mixer.setTime(Math.random() * 10);
      this.crew.push(ch);
    },
    // rod in a holder on the rail with a line down to the water
    addRod(b, x, z, side) {
      const g = new T.Group(), rod = new T.Mesh(new T.CylinderGeometry(0.006, 0.016, 2.6, 6).translate(0, 1.3, 0), new T.MeshStandardMaterial({ color: 0x15181c, roughness: 0.4 }));
      const line = new T.Mesh(new T.CylinderGeometry(0.004, 0.004, 5, 4).translate(0, -2.5, 0), new T.MeshBasicMaterial({ color: 0xd8e6f0 }));
      rod.rotation.z = -side * 0.75; line.position.set(side * 1.77, 1.9, 0); line.rotation.z = side * 0.1;
      g.add(rod, line); g.position.set(x, 1.6, z);
      b.obj.updateMatrixWorld(true);
      const hit = new T.Raycaster(V3(x - side * 0.5, 30, z).applyMatrix4(b.obj.matrixWorld), V3(0, -1, 0), 0, 60).intersectObject(b.inner, true)[0];
      if (hit) g.position.y = 30 - hit.distance + 0.75;
      b.obj.add(g);
    },
    makeFlag(w, h, x, y, z) {
      const g = new T.PlaneGeometry(w, h, 14, 6); g.translate(w / 2, 0, 0);
      const mesh = new T.Mesh(g, new T.MeshStandardMaterial({ map: this.flagTex, side: T.DoubleSide, roughness: 0.95 }));
      mesh.position.set(x, y, z); mesh.rotation.y = -0.35; mesh.userData = { base: g.attributes.position.array.slice(), w, seed: Math.random() * 9 };
      this.flags.push(mesh); return mesh;
    },

    setVisible(on) { this.group.visible = on; },
    excite(sec) { this.excited = Math.max(this.excited, sec); },

    update(dt, camera) {
      if (!this.group.visible) return;
      this.t += dt; const t = this.t, B = DB.Boat.group.position;
      // boats
      for (const b of this.boats) {
        if (b.path) {      // steaming round a big circle
          b.path.a += (b.path.v / b.path.R) * dt;
          b.x = b.path.cx + Math.cos(b.path.a) * b.path.R; b.z = b.path.cz + Math.sin(b.path.a) * b.path.R;
          b.h = -b.path.a - Math.PI;      // bow along the direction of travel
        } else b.h = b.h0 + Math.sin(t * 0.05 + b.x) * (b.swing || 0);
        ride(b, dt);
      }
      for (const c of this.crew) c.mixer.update(dt);
      // flags
      for (const f of this.flags) {
        const a = f.geometry.attributes.position, base = f.userData.base, w = f.userData.w;
        for (let i = 0; i < a.count; i++) { const x = base[i * 3], y = base[i * 3 + 1], k = x / w; a.setXYZ(i, x - k * k * 0.12, y - k * 0.18 + Math.sin(x * 2.2 - t * 4.2 + f.userData.seed) * 0.05 * k, Math.sin(x * 2.7 - t * 5.5 + y * 1.3 + f.userData.seed) * 0.2 * (k + 0.12)); }
        a.needsUpdate = true; f.geometry.computeVertexNormals();
      }
      // lighthouse: a slow sweep that flashes when it crosses the viewer
      if (this.lamp) {
        const low = M.sat(1 - DB.Env.sunDir.y * 2.2), flash = Math.pow(Math.max(Math.sin(t * 0.9), 0), 24);
        const s = (2.5 + low * 5) * (0.35 + flash * 2.4); this.lamp.scale.set(s, s, 1); this.lamp.material.opacity = 0.25 + 0.5 * low + flash * 0.6;
      }
      // gulls
      if (this.gullMesh) {
        this.excited = Math.max(this.excited - dt, 0);
        this.flockC.x = M.damp(this.flockC.x, B.x, 0.6, dt); this.flockC.z = M.damp(this.flockC.z, B.z, 0.6, dt);
        const I = DB.World.island, ex = this.excited > 0 ? 0.55 : 1;
        this.gulls.forEach((g, i) => {
          const cx = g.home ? I.x + 44 : this.flockC.x, cz = g.home ? I.z + 11 : this.flockC.z, r = g.r * (g.home ? 1.6 : ex) * (1 + 0.25 * Math.sin(t * 0.13 + g.ph));
          g.a += ((g.v * g.dir) / r) * dt;
          g.x = cx + Math.cos(g.a) * r; g.z = cz + Math.sin(g.a) * r; g.y = (g.home ? 44 : 0) + g.h * (g.home ? 0.6 : ex) + Math.sin(t * 0.4 + g.ph) * 2.2;
          _e.set(Math.cos(t * 0.4 + g.ph) * 0.12, -g.a + (g.dir > 0 ? Math.PI : 0), -g.dir * 0.42);
          _m.compose(_p.set(g.x, g.y, g.z), _q.setFromEuler(_e), _s); this.gullMesh.setMatrixAt(i, _m);
        });
        this.gullMesh.instanceMatrix.needsUpdate = true; this.gullMesh.material.uniforms.uTime.value = t;
      }
      // first sight of the landmarks
      const I = DB.World.island, di = Math.hypot(B.x - I.x, B.z - I.z);
      if (di < 170 && !this.found.island) { this.found.island = true; DB.emit('landmark', '해적섬 발견 — 등대 아래 해적선이 정박해 있습니다'); }
    },

    // distance from (x, z) to the nearest gull / named thing, for audio
    nearestGull(x, y, z) { let d = 1e9; if (this.gulls) for (const g of this.gulls) d = Math.min(d, Math.hypot(g.x - x, g.y - y, g.z - z)); return d; },
    inReef(x, z) { return Math.hypot(x, z) < this.REEF_R; },
  });
})();
