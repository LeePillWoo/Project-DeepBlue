// Project Deep Blue — the skipper: a skinned, animated character (assets/chars.js) who keeps you company on deck,
// dances when a fish comes aboard and takes the wheel — hands on the rim — when the boat is under way.
(function () {
  'use strict';
  const DB = window.DB, T = THREE, M = DB.M;
  const V3 = (x, y, z) => new T.Vector3(x, y, z), Q = () => new T.Quaternion();
  const S = V3(), E0 = V3(), H0 = V3(), E = V3(), dT = V3(), P = V3(), a0 = V3(), a1 = V3(), tg = V3(), q = Q(), pq = Q(), dq = Q(), UP = V3(0, 1, 0);
  // boat-local posts. yaw: 0 faces aft (toward the angler in the cockpit), PI faces the bow
  const POST = { deck: { x: 0.22, z: 0.72, yaw: -0.3 }, helm: { x: 0.92, z: -0.33, yaw: Math.PI }, roof: { x: 0, y: 2.17, z: -2.85, yaw: Math.PI - 0.5 } };      // roof: on the cabin top, for the title screen

  // turn `bone` (in world space) so the direction `from` becomes `to`, blended by k
  function aim(bone, from, to, k) {
    q.setFromUnitVectors(from.normalize(), to.normalize());
    bone.parent.getWorldQuaternion(pq);
    dq.copy(pq).invert().multiply(q).multiply(pq).multiply(bone.quaternion);
    bone.quaternion.slerp(dq, k); bone.updateMatrixWorld(true);
  }
  // two-bone IK: put the hand on `target`, elbow toward `pole`
  function reach(arm, fore, hand, target, pole, k) {
    arm.getWorldPosition(S); fore.getWorldPosition(E0); hand.getWorldPosition(H0);
    const a = S.distanceTo(E0), b = E0.distanceTo(H0), d = M.clamp(dT.subVectors(target, S).length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
    dT.normalize();
    const x = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(a * a - x * x, 0));
    P.copy(pole).addScaledVector(dT, -pole.dot(dT)).normalize();
    E.copy(S).addScaledVector(dT, x).addScaledVector(P, h);
    aim(arm, a0.subVectors(E0, S), a1.subVectors(E, S), k);
    fore.getWorldPosition(E0); hand.getWorldPosition(H0);
    aim(fore, a0.subVectors(H0, E0), a1.copy(S).addScaledVector(dT, d).sub(E0), k);
  }

  const Crew = (DB.Crew = {
    ch: null, post: 'deck', k: 0, cheerT: 0, look: 0, w: { idle: 1, walk: 0, dance: 0 },

    init() {
      const ch = (this.ch = DB.Assets.character('crew')); if (!ch) return;
      ch.group.position.set(POST.deck.x, 0, POST.deck.z); ch.group.rotation.y = POST.deck.yaw;
      DB.Boat.group.add(ch.group);
      for (const k of ['idle', 'walk', 'dance']) { ch.actions[k].play(); ch.actions[k].setEffectiveWeight(this.w[k]); }
      this.b = ch.bones;
    },
    setPost(p) { this.post = p; },
    cheer(sec = 5) { this.cheerT = Math.max(this.cheerT, sec); },

    // party: dance regardless (title screen)
    update(dt, camera, party) {
      const ch = this.ch; if (!ch || !ch.group.visible || dt <= 0) return;
      const B = DB.Boat, b = this.b, target = this.post === 'helm' ? 1 : 0, moving = Math.abs(target - this.k) > 0.02;
      this.k = M.clamp(this.k + Math.sign(target - this.k) * dt / 1.1, 0, 1);
      const e = this.k * this.k * (3 - 2 * this.k), A = POST.deck, H = POST.helm;
      ch.group.position.set(M.lerp(A.x, H.x, e), 0, M.lerp(A.z, H.z, e));
      ch.group.rotation.y = moving ? M.lerp(A.yaw, H.yaw, e) : target ? H.yaw : A.yaw;
      if (party) { ch.group.position.set(POST.roof.x, POST.roof.y, POST.roof.z); ch.group.rotation.y = POST.roof.yaw; }      // dancing on the cabin top while the title is up
      // blend the three clips
      this.cheerT = Math.max(this.cheerT - dt, 0);
      const dance = !moving && !target && (party || this.cheerT > 0) ? 1 : 0, want = { walk: moving ? 1 : 0, dance, idle: moving || dance ? 0 : 1 };
      for (const k in want) { this.w[k] = M.damp(this.w[k], want[k], 7, dt); ch.actions[k].setEffectiveWeight(this.w[k]); }
      ch.mixer.update(dt);
      ch.group.updateMatrixWorld(true);
      // at the helm: hands on the wheel, which turns with the rudder
      const hk = M.sat((this.k - 0.75) * 4);
      if (hk > 0 && B.wheel) {
        const turn = M.clamp(B.wheel.rotation.z * 0.3, -0.5, 0.5);
        for (const [side, arm, fore, hand] of [[1, b.RightArm, b.RightForeArm, b.RightHand], [-1, b.LeftArm, b.LeftForeArm, b.LeftHand]]) {      // facing the bow, her right hand is to starboard (+x)
          const ang = side * 1.05 + turn;      // ten-to-two on the rim
          B.wheel.localToWorld(tg.set(Math.sin(ang) * 0.185, Math.cos(ang) * 0.185, 0.035));
          P.set(side * 0.9, -1, 0.25).transformDirection(B.group.matrixWorld);
          reach(arm, fore, hand, tg, a0.copy(P), hk);
        }
      }
      // eyes on the angler when on deck, into the turn when driving
      let want2 = 0;
      if (target) want2 = B.rudder * 0.45;
      else if (!dance && camera) { tg.copy(camera.position); ch.group.worldToLocal(tg); if (tg.lengthSq() < 60) want2 = M.clamp(Math.atan2(tg.x, tg.z), -1.15, 1.15); }
      this.look = M.damp(this.look, want2, 3, dt);
      if (Math.abs(this.look) > 0.01) for (const [bone, part] of [[b.Neck, 0.4], [b.Head, 0.6]]) {
        a0.copy(UP).transformDirection(B.group.matrixWorld);
        q.setFromAxisAngle(a0, this.look * part); bone.parent.getWorldQuaternion(pq);
        bone.quaternion.premultiply(dq.copy(pq).invert().multiply(q).multiply(pq)); bone.updateMatrixWorld(true);
      }
    },
  });
})();
