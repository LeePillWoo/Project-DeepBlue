// Project Deep Blue — the big animals that pass through: an orca pod, a sperm whale. One mesh each, wearing the submerged material
// during a dive and the surface material from the deck. A pass is a straight transit that comes close to whoever is watching;
// they come up to breathe on the way, so from the boat you see backs, fins and blows, and from below the whole animal.
(function () {
  'use strict';
  const DB = window.DB, T = THREE, M = DB.M;
  const V3 = (x, y, z) => new T.Vector3(x, y, z), _a = V3();
  // animals: [length m, metres to the right of the leader, metres ahead]. speed m/s. depth: cruising depth. rise: how far the back clears
  // the surface, as a share of the length. breath: seconds between breaths, up: how long each one takes, tilt: how much the body follows the climb. near / see: closest approach of the line and sighting range, [deck, dive].
  const GROUPS = [
    { key: 'orca', animals: [[6.8, 0, 0], [5.9, 5, -6], [4.3, -3.5, -9]], speed: 3.4, depth: 3.4, rise: 0.075, breath: 9, up: 2.8, tilt: 0.9, near: [22, 9], see: [80, 20], amp: 0.5, beat: 2.6, blow: 0.6 },
    { key: 'spermWhale', animals: [[14, 0, 0]], speed: 1.7, depth: 9, rise: 0.07, breath: 20, up: 10, tilt: 0.3, near: [36, 13], see: [95, 30], amp: 0.34, beat: 1.4, blow: 1.3 },
  ];

  // the spout: a column of mist thrown up and a little forward
  function blow(x, y, z, s, dx, dz) {
    const F = DB.FX, w = F.white(1.1);
    for (let i = 0; i < 26; i++) {
      const up = (3.5 + Math.random() * 5) * s, a = Math.random() * 6.283, sp = Math.random() * 0.9 * s;
      F.emit({ x, y: y + 0.1, z, vx: Math.cos(a) * sp + dx * 1.6 * s, vy: up, vz: Math.sin(a) * sp + dz * 1.6 * s, life: 1.1 + Math.random() * 1.3, size: (0.35 + Math.random() * 0.6) * s, grow: 1.4 * s, kind: 0, alpha: 0.3, grav: -4.5, drag: 1.3, r: w[0], g: w[1], b: w[2] });
    }
  }

  const Wild = (DB.Wild = {
    groups: [], pass: null, wait: 40, turn: 0,

    init(scene) {
      for (const g of GROUPS) {
        if (!DB.Fish.has(g.key)) continue;
        const f = DB.Fish.get(g.key), sp = DB.Species[g.key];
        const grp = Object.assign({}, g, { sp, list: [] });
        g.animals.forEach(([L, right, ahead], i) => {
          const uw = DB.UW.material({ map: f.tex, vertexColors: f.col, swim: true, swimV: sp.swimV, silver: g.key === 'orca' ? 0.16 : 0.06, side: T.DoubleSide });
          const surf = DB.Fish.surfaceMaterial(g.key);
          const mesh = new T.Mesh(f.geo, uw); mesh.scale.setScalar(L); mesh.rotation.order = 'YZX'; mesh.frustumCulled = false; mesh.visible = false; scene.add(mesh);
          grp.list.push({ mesh, uw, surf, L, right, ahead, phase: i * 2.1, bt: i * 2.7, k: 0, pos: V3(), y: -g.depth, pitch: 0 });
        });
        this.groups.push(grp);
      }
    },

    // send a group past the camera now (also the debug hook: DB.debug.wild('orca'))
    start(key, camera, under) {
      const g = this.groups.find((x) => x.key === key) || this.groups[this.turn++ % Math.max(this.groups.length, 1)];
      if (!g) return null;
      const c = camera.position, W = DB.World, ui = under ? 1 : 0;
      // under water the line runs along the reef edge on the deep side of the diver; from the deck any heading will do
      let a = Math.random() * 6.283, side = Math.random() < 0.5 ? 1 : -1;
      if (under) { a = Math.atan2(W.deepDir.z, W.deepDir.x) + Math.PI / 2 + (Math.random() - 0.5) * 0.5; side = -1; }
      const dx = Math.cos(a), dz = Math.sin(a), near = g.near[ui] * (0.85 + Math.random() * 0.4), run = under ? 62 : 120;
      // (dz, -dx) is to the right of the heading; with side = -1 and the heading a quarter turn on from deepDir, the line lies on the deep side
      const px = c.x - dz * near * side, pz = c.z + dx * near * side;
      this.pass = { g, x: px - dx * run, z: pz - dz * run, dx, dz, t: 0, len: run * 2 + 20, seen: false, first: true };
      for (const o of this.groups) for (const an of o.list) { an.mesh.visible = o === g; an.k = 0; }
      return this.pass;
    },

    update(dt, camera, under, playing) {
      const p = this.pass, O = DB.Ocean, W = DB.World;
      if (!p) {
        if (playing && this.groups.length && (this.wait -= dt) <= 0) this.start(null, camera, under);
        return;
      }
      const g = p.g, ui = under ? 1 : 0, c = camera.position;
      p.t += dt; p.x += p.dx * g.speed * dt; p.z += p.dz * g.speed * dt;
      const head = Math.atan2(p.dx, p.dz) - Math.PI / 2, fw = _a.set(0, 0, -1).applyQuaternion(camera.quaternion);
      let nearest = 1e9, up = false, inView = false;
      for (const an of g.list) {
        const x = p.x + p.dx * an.ahead + p.dz * an.right, z = p.z + p.dz * an.ahead - p.dx * an.right, wh = O.height(x, z);
        // the breath: over the last g.up seconds of each cycle the animal arcs up until its back is awash, then slides under again
        const cyc = (p.t + an.bt) % g.breath, k = Math.sin(Math.PI * M.sat((cyc - (g.breath - g.up)) / g.up));
        let y = M.lerp(-g.depth, wh - an.L * (0.11 - g.rise), k);
        y = Math.max(y, W.height(x, z) + an.L * 0.14 + 0.8);      // clear of the seabed
        const vy = (y - an.y) / Math.max(dt, 1e-3); an.y = y;
        if (k > 0.86 && an.k <= 0.86) {      // at the top of the arc: the blow
          const d = Math.hypot(x - c.x, z - c.z);
          if (!under) { blow(x + p.dx * an.L * 0.36, wh, z + p.dz * an.L * 0.36, g.blow * (0.6 + an.L / g.animals[0][0] * 0.4), p.dx, p.dz); O.addRipple(x, z, 1.5); }
          DB.emit('wildBlow', { key: g.key, d, first: p.first && d < 110, under }); if (d < 110) p.first = false;
        }
        an.k = k; an.pos.set(x, y, z);
        an.phase += dt * g.beat;
        an.pitch = M.damp(an.pitch, M.clamp(Math.atan2(vy, g.speed) * g.tilt, -0.5, 0.5), 3, dt);
        const m = an.mesh; m.position.copy(an.pos); m.rotation.set(0, head, an.pitch);
        if (under) { m.material = an.uw; an.uw.uniforms.uSwim.value.set(an.phase, g.amp, 0, 0); }
        else { m.material = an.surf; const u = an.surf.userData.u; u.uSwim.value.set(an.phase, g.amp, 0, 0); u.uWaterY.value = wh; }
        const ddx = x - c.x, ddy = y - c.y, ddz = z - c.z, d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
        nearest = Math.min(nearest, d); if (k > 0.25) up = true;
        if ((ddx * fw.x + ddy * fw.y + ddz * fw.z) / (d || 1) > 0.5) inView = true;
      }
      p.near = nearest;
      // a sighting: close enough, in front of you, and (from the deck) with something showing above the water
      if (!p.seen && nearest < g.see[ui] && inView && (under || up)) {
        p.seen = true; const L = g.animals[0][0];
        DB.emit('catch', { key: g.key, L, kg: g.sp.wK * L * L * L, method: 'watch' });
      }
      if (p.t * g.speed > p.len) { for (const an of g.list) an.mesh.visible = false; this.pass = null; this.wait = 75 + Math.random() * 70; }
    },
  });
})();
