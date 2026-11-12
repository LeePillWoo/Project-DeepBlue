// Project Deep Blue — world: seabed height field of the dive/fishing site (shared by sonar, chart, reef mesh, AI).
(function () {
  'use strict';
  const DB = window.DB, M = DB.M;
  const r = M.rng(4242);
  // coral bommies (pinnacles) scattered over the reef plateau
  const bommies = [];
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = 6 + Math.pow(r(), 1.25) * 56;
    bommies.push({ x: Math.cos(a) * d + 6, z: Math.sin(a) * d - 8, r: 2.2 + r() * 4.2, h: 1.6 + r() * 4.4 });
  }
  const World = (DB.World = {
    bommies,
    deepDir: { x: -0.8, z: 0.6 },                 // direction from the reef toward blue water
    island: { x: -150, z: 215 },                  // the pirate island (sea.js builds it); the seabed shoals toward it
    // seabed height (negative = below sea level)
    height(x, z) {
      const e = x * this.deepDir.x + z * this.deepDir.z;
      const edge = 36 + 26 * (M.noise2(x * 0.017 + 3.1, z * 0.017 + 8.4) - 0.5);
      let h = -11.2 + 6.0 * (M.fbm2(x * 0.028 + 11, z * 0.028 + 7, 4) - 0.5);
      const d1 = M.smooth(edge - 5, edge + 14, e), d2 = M.smooth(edge + 6, edge + 90, e);
      h -= d1 * 13 + d2 * 68;                      // reef wall, then the long slope into the blue
      // sandy channel cutting through the plateau
      const ch = Math.abs(x * 0.55 + z * 0.83 + 9 * (M.noise2(x * 0.03, z * 0.03 + 5) - 0.5) - 14);
      h -= (1 - M.smooth(2.5, 8.0, ch)) * 2.6 * (1 - d1);
      for (let i = 0; i < bommies.length; i++) {
        const b = bommies[i], dx = x - b.x, dz = z - b.z, q = (dx * dx + dz * dz) / (b.r * b.r);
        if (q < 4) {        // mesa-like pinnacle with a ragged outline rather than a smooth cone
          const ang = Math.atan2(dz, dx), rr = Math.sqrt(q) * (1 + 0.22 * Math.sin(ang * 3 + b.r * 7) + 0.12 * Math.sin(ang * 5 + b.h * 3));
          h += b.h * (1 - M.smooth(0.5, 1.3, rr)) * (0.8 + 0.4 * M.noise2(x * 0.45 + b.x, z * 0.45)) * (1 - d1 * 0.7);
        }
      }
      const di = Math.hypot(x - this.island.x, z - this.island.z);
      if (di < 250) h = Math.max(h, -3 - Math.max(di - 45, 0) * 0.42);
      return h + 0.5 * (M.fbm2(x * 0.31, z * 0.31, 3) - 0.5);
    },
    depth(x, z) { return -this.height(x, z); },
    // 0 = sand flat, 1 = rocky / coral ground (used for texturing + placement)
    rockiness(x, z) {
      const n = M.fbm2(x * 0.06 + 40, z * 0.06 + 19, 3);
      let v = M.smooth(0.42, 0.62, n);
      for (let i = 0; i < bommies.length; i++) { const b = bommies[i], dx = x - b.x, dz = z - b.z; if (dx * dx + dz * dz < b.r * b.r * 2.2) v = 1; }
      return v;
    },
  });
})();
