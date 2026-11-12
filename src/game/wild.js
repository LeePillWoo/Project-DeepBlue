// Project Deep Blue — the big animals that pass through: an orca pod, a sperm whale, a blue whale, a humpback that breaches.
// One mesh each, wearing the submerged material during a dive and the surface material from the deck. A pass is a straight transit
// that comes close to whoever is watching; they come up to breathe on the way, so from the boat you see backs, fins and blows,
// and from below the whole animal.
(function () {
  'use strict';
  const DB = window.DB, T = THREE, M = DB.M;
  const V3 = (x, y, z) => new T.Vector3(x, y, z), _a = V3();
  const smooth = (a, b, x) => { const t = M.sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  // animals: [length m, metres to the right of the leader, metres ahead]. speed m/s. depth: cruising depth. back: height of the back above
  // the body axis (share of the length), out: metres of it shown at the top of a breath. breath: seconds between breaths, up: how long
  // each takes, tilt: how much the body follows the climb. near / see: closest approach of the line and sighting range, [deck, dive].
  const GROUPS = [
    { key: 'orca', animals: [[6.8, 0, 0], [5.9, 5, -6], [4.3, -3.5, -9]], speed: 3.4, depth: 3.4, back: 0.1, out: 0.45, breath: 9, up: 2.8, tilt: 0.9, near: [22, 9], see: [80, 20], amp: 0.5, beat: 2.6, blow: 0.6, silver: 0.16 },
    { key: 'spermWhale', animals: [[14, 0, 0]], speed: 1.7, depth: 9, back: 0.105, out: 0.9, breath: 20, up: 10, tilt: 0.3, near: [36, 13], see: [95, 30], amp: 0.34, beat: 1.4, blow: 1.3, silver: 0.06 },
    { key: 'blueWhale', animals: [[24, 0, 0]], speed: 2.4, depth: 11, back: 0.06, out: 0.7, breath: 24, up: 12, tilt: 0.25, near: [50, 15], see: [130, 38], amp: 0.3, beat: 1.0, blow: 2.4, silver: 0.07 },
    { key: 'humpback', animals: [[13, 0, 0]], speed: 2.2, depth: 6, back: 0.1, out: 0.6, breath: 16, up: 7, tilt: 0.35, near: [42, 14], see: [110, 28], amp: 0.4, beat: 1.5, blow: 1.2, silver: 0.06, breach: true },
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
    groups: [], pass: null, wait: 40, last: null,

    init(scene) {
      for (const g of GROUPS) {
        if (!DB.Fish.has(g.key)) continue;
        const f = DB.Fish.get(g.key), sp = DB.Species[g.key];
        const grp = Object.assign({}, g, { sp, list: [] });
        g.animals.forEach(([L, right, ahead], i) => {
          const uw = DB.UW.material({ map: f.tex, vertexColors: f.col, swim: true, swimV: sp.swimV, silver: g.silver, side: T.DoubleSide });
          const surf = DB.Fish.surfaceMaterial(g.key);
          const mesh = new T.Mesh(f.geo, uw); mesh.scale.setScalar(L); mesh.rotation.order = 'YZX'; mesh.frustumCulled = false; mesh.visible = false; scene.add(mesh);
          grp.list.push({ mesh, uw, surf, L, right, ahead, phase: i * 2.1, bt: i * 2.7, k: 0, pos: V3(), y: -g.depth, pitch: 0 });
        });
        this.groups.push(grp);
      }
    },

    // send a group past the camera now: a named one (DB.debug.wild('orca')), or any but the last
    start(key, camera, under) {
      const pool = this.groups.filter((x) => (key ? x.key === key : x !== this.last || this.groups.length === 1)), g = pool[Math.floor(Math.random() * pool.length)];
      if (!g) return null;
      this.last = g;
      const c = camera.position, W = DB.World, ui = under ? 1 : 0;
      // under water the line runs along the reef edge on the deep side of the diver; from the deck any heading will do
      let a = Math.random() * 6.283, side = Math.random() < 0.5 ? 1 : -1;
      if (under) { a = Math.atan2(W.deepDir.z, W.deepDir.x) + Math.PI / 2 + (Math.random() - 0.5) * 0.5; side = -1; }
      const dx = Math.cos(a), dz = Math.sin(a), near = g.near[ui] * (0.85 + Math.random() * 0.4), run = under ? 62 : 120;
      // (-dz, dx) is to the left of the heading; with side = -1 and the heading a quarter turn on from deepDir, the line lies on the deep side
      const px = c.x - dz * near * side, pz = c.z + dx * near * side;
      this.pass = { g, x: px - dx * run, z: pz - dz * run, dx, dz, t: 0, tNear: run / g.speed, len: run * 2 + 20, seen: false, first: true, br: null, breached: false, near: 1e9 };
      for (const o of this.groups) for (const an of o.list) { an.mesh.visible = o === g; an.k = 0; an.y = -g.depth; an.pitch = 0; }
      return this.pass;
    },

    update(dt, camera, under, playing) {
      const p = this.pass, O = DB.Ocean, W = DB.World;
      if (!p) {
        if (playing && this.groups.length && (this.wait -= dt) <= 0) this.start(null, camera, under);
        return;
      }
      const g = p.g, ui = under ? 1 : 0, c = camera.position;
      // the humpback's party piece, timed for the closest point of the pass
      if (g.breach && !p.br && !p.breached && p.t > p.tNear - 3) p.br = { t: 0, out: false, back: false };
      const br = p.br, spd = br && br.t > 1.3 ? 4 : g.speed;
      p.t += dt; p.x += p.dx * spd * dt; p.z += p.dz * spd * dt;
      const head = Math.atan2(p.dx, p.dz) - Math.PI / 2, fw = _a.set(0, 0, -1).applyQuaternion(camera.quaternion);
      let nearest = 1e9, up = false, inView = false;
      g.list.forEach((an, i) => {
        const x = p.x + p.dx * an.ahead + p.dz * an.right, z = p.z + p.dz * an.ahead - p.dx * an.right, wh = O.height(x, z), dc = Math.hypot(x - c.x, z - c.z);
        let y, roll = 0, k = 0;
        if (br && i === 0) {
          // it drops, drives up and out at a steep angle, hangs with two thirds of itself in the air, twists and falls on its side
          br.t += dt;
          if (br.t < 1.3) { y = M.lerp(an.y, -6.5, 1 - Math.exp(-3 * dt)); an.pitch = M.damp(an.pitch, -0.25, 3, dt); }
          else {
            const s = br.t - 1.3; y = -6.5 + 13.2 * s - 4.9 * s * s;
            an.pitch = M.lerp(1.15, 0.2, smooth(0.9, 2.3, s)); roll = smooth(0.7, 2.1, s) * 1.35; up = true;
            if (!br.out && y > wh - 1.5) { br.out = true; DB.FX.splash(x + p.dx * an.L * 0.3, wh, z + p.dz * an.L * 0.3, 1.6, p.dx, p.dz); O.addRipple(x, z, 2); DB.emit('breach', { d: dc, phase: 'out', under }); }
            if (br.out && !br.back && s > 1.4 && y < wh + 0.8) {      // the fall: a wall of white water
              br.back = true;
              if (!under) for (let n = -1; n <= 1; n++) DB.FX.splash(x + p.dx * n * an.L * 0.28, wh, z + p.dz * n * an.L * 0.28, 3.4, p.dz * 0.6, -p.dx * 0.6);
              for (let n = 0; n < 3; n++) O.addRipple(x + (Math.random() - 0.5) * 6, z + (Math.random() - 0.5) * 6, 3);
              DB.emit('breach', { d: dc, phase: 'in', under });
            }
            if (s > 2.9) { p.br = null; p.breached = true; }
          }
          an.y = y;
        } else {
          // the breath: over the last g.up seconds of each cycle the animal arcs up until its back is awash, then slides under again
          const cyc = (p.t + an.bt) % g.breath; k = Math.sin(Math.PI * M.sat((cyc - (g.breath - g.up)) / g.up));
          y = M.lerp(-g.depth, wh - (g.back * an.L - g.out), k);
          y = Math.max(y, W.height(x, z) + an.L * 0.14 + 0.8);      // clear of the seabed
          if (p.breached && i === 0) y = M.lerp(an.y, y, 1 - Math.exp(-1.5 * dt));      // ease back into the rhythm after the breach
          const vy = (y - an.y) / Math.max(dt, 1e-3); an.y = y;
          an.pitch = M.damp(an.pitch, M.clamp(Math.atan2(vy, g.speed) * g.tilt, -0.5, 0.5), 3, dt);
          if (k > 0.86 && an.k <= 0.86) {      // at the top of the arc: the blow
            if (!under) { blow(x + p.dx * an.L * 0.36, wh, z + p.dz * an.L * 0.36, g.blow * (0.6 + (an.L / g.animals[0][0]) * 0.4), p.dx, p.dz); O.addRipple(x, z, 1.5); }
            DB.emit('wildBlow', { key: g.key, d: dc, first: p.first && dc < 110, under }); if (dc < 110) p.first = false;
          }
          if (k > 0.25) up = true;
        }
        an.k = k; an.pos.set(x, y, z);
        an.phase += dt * g.beat * (br && i === 0 ? 2.5 : 1);
        const m = an.mesh; m.position.copy(an.pos); m.rotation.set(roll, head, an.pitch);
        if (under) { m.material = an.uw; an.uw.uniforms.uSwim.value.set(an.phase, g.amp, 0, 0); DB.Dive.bump(an.pos, head, an.L, an.L * 0.085); }
        else { m.material = an.surf; const u = an.surf.userData.u; u.uSwim.value.set(an.phase, g.amp, 0, 0); u.uWaterY.value = wh; }
        const ddx = x - c.x, ddy = y - c.y, ddz = z - c.z, d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
        nearest = Math.min(nearest, d);
        if ((ddx * fw.x + ddy * fw.y + ddz * fw.z) / (d || 1) > 0.5) inView = true;
      });
      p.near = Math.min(p.near, nearest);
      // a sighting: close enough, in front of you, and (from the deck) with something showing above the water
      if (!p.seen && nearest < g.see[ui] && inView && (under || up)) {
        p.seen = true; const L = g.animals[0][0];
        DB.emit('catch', { key: g.key, L, kg: g.sp.wK * L * L * L, method: 'watch' });
      }
      if (p.t * g.speed > p.len) { for (const an of g.list) an.mesh.visible = false; this.pass = null; this.wait = 70 + Math.random() * 60; }
    },
  });
})();
