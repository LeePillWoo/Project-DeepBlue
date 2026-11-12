// Project Deep Blue — runtime access to the packed assets (assets/*.js → window.DBA): static models, textures, skinned characters.
(function () {
  'use strict';
  const DB = window.DB, T = THREE;
  const A = (window.DBA = window.DBA || { models: {}, tex: {}, chars: {} });
  A.chars = A.chars || {};
  const geoCache = new Map(), texCache = new Map(), pending = [];

  function bytes(b64) { const s = atob(b64), n = s.length, u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = s.charCodeAt(i); return u; }

  // de-quantised BufferGeometry of one packed part (+ vertex colours / skin weights when the part has them)
  function partGeo(p) {
    const q = new Uint16Array(bytes(p.pos).buffer), nq = new Int8Array(bytes(p.nor).buffer), uq = new Uint16Array(bytes(p.uv).buffer);
    const pos = new Float32Array(p.n * 3), nor = new Float32Array(p.n * 3), uv = new Float32Array(p.n * 2);
    for (let i = 0; i < p.n; i++) {
      for (let c = 0; c < 3; c++) { pos[i * 3 + c] = p.bmin[c] + (q[i * 3 + c] / 65535) * (p.bmax[c] - p.bmin[c]); nor[i * 3 + c] = nq[i * 3 + c] / 127; }
      for (let c = 0; c < 2; c++) uv[i * 2 + c] = p.uvmin[c] + (uq[i * 2 + c] / 65535) * (p.uvmax[c] - p.uvmin[c]);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.BufferAttribute(nor, 3));
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    if (p.col) g.setAttribute('color', new T.BufferAttribute(bytes(p.col), 3, true));
    if (p.ji) { g.setAttribute('skinIndex', new T.BufferAttribute(new Uint16Array(bytes(p.ji)), 4)); g.setAttribute('skinWeight', new T.BufferAttribute(bytes(p.jw), 4, true)); }
    const ib = bytes(p.idx);
    g.setIndex(new T.BufferAttribute(p.i32 ? new Uint32Array(ib.buffer) : new Uint16Array(ib.buffer), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }

  const Assets = (DB.Assets = {
    has(model) { return !!A.models[model]; },
    hasChar(name) { return !!A.chars[name]; },
    parts(model) { return A.models[model] ? A.models[model].parts : []; },
    geo(model, part = 0) {
      const key = model + '#' + part;
      if (!geoCache.has(key)) geoCache.set(key, partGeo(A.models[model].parts[part]));
      return geoCache.get(key);
    },
    // texture from a packed data URI (glTF convention: flipY = false)
    texture(uri, srgb, repeat = true) {
      if (!uri) return null;
      if (texCache.has(uri)) return texCache.get(uri);
      const img = new Image(), t = new T.Texture(img);
      t.flipY = false; t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace; t.anisotropy = 8;
      if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping;
      img.src = uri;
      pending.push(img.decode().then(() => { t.needsUpdate = true; }, () => console.warn('texture decode failed')));
      texCache.set(uri, t);
      return t;
    },
    maps(model, mat = 0) {
      const m = A.models[model].mats[mat];
      return { map: this.texture(m.diff, true), normalMap: this.texture(m.nor, false), orm: this.texture(m.orm, false), metal: m.metal };
    },
    texSet(name) {
      const t = A.tex[name];
      return t ? { map: this.texture(t.diff, true), normalMap: this.texture(t.nor, false), roughnessMap: this.texture(t.rough, false) } : null;
    },
    // PBR material from a packed material record (textures where present, glTF factors where not)
    material(m, extra = {}) {
      const map = this.texture(m.diff, true), nor = this.texture(m.nor, false), orm = this.texture(m.orm, false);
      const o = { map, normalMap: nor, roughnessMap: orm, aoMap: orm, normalScale: new T.Vector2(1, -1), roughness: orm ? 1 : Math.max(m.rough === undefined ? 1 : m.rough, 0.3), metalness: m.metal ? 1 : orm ? 0 : m.metalF || 0 };
      if (m.metal) o.metalnessMap = orm;
      if (m.color) o.color = new T.Color().setRGB(m.color[0], m.color[1], m.color[2]);
      if (m.cut) { o.alphaTest = m.cut; o.side = T.DoubleSide; }
      if (m.glass) { o.color = new T.Color(0x0a1016); o.roughness = 0.08; o.metalness = 0.3; o.map = null; }      // kept opaque: the ocean pass owns the alpha channel
      return new T.MeshStandardMaterial(Object.assign(o, extra));
    },
    stdMaterial(model, mat = 0, extra) { return this.material(A.models[model].mats[mat], extra); },
    // whole model as a group of shadow-casting meshes
    // origin: 'base' (centre x/z, bottom at y=0) | 'center' | undefined (as authored)
    object(model, origin, extra) {
      const g = new T.Group(), bb = new T.Box3();
      this.parts(model).forEach((p, i) => {
        const mesh = new T.Mesh(this.geo(model, i), this.stdMaterial(model, p.mat, extra));
        mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); bb.union(mesh.geometry.boundingBox);
      });
      if (origin) {
        const c = bb.getCenter(new T.Vector3());
        for (const m of g.children) m.position.set(-c.x, origin === 'base' ? -bb.min.y : -c.y, -c.z);
      }
      g.userData.size = bb.getSize(new T.Vector3()); g.userData.box = bb;
      return g;
    },
    // skinned character: { group (feet at the origin, metres), bones{name}, mixer, actions{clip} }. Every call is a new, independently posed instance.
    character(name, extra) {
      const c = A.chars[name]; if (!c) return null;
      const group = new T.Group(), arm = new T.Group();
      new T.Matrix4().fromArray(c.root).decompose(arm.position, arm.quaternion, arm.scale);
      group.add(arm);
      const bones = c.bones.map((b) => { const o = new T.Bone(); o.name = b.n; o.position.fromArray(b.t); o.quaternion.fromArray(b.r); o.scale.fromArray(b.s); return o; });
      c.bones.forEach((b, i) => (b.p < 0 ? arm : bones[b.p]).add(bones[i]));
      const ib = new Float32Array(bytes(c.ibm).buffer), skeleton = new T.Skeleton(bones, bones.map((_, i) => new T.Matrix4().fromArray(ib, i * 16)));
      c.parts.forEach((p, i) => {
        const key = '@' + name + '#' + i;
        if (!geoCache.has(key)) geoCache.set(key, partGeo(p));
        const mesh = new T.SkinnedMesh(geoCache.get(key), this.material(c.mats[p.mat], extra));
        mesh.bind(skeleton, new T.Matrix4());      // glTF convention: the bind matrices already place the mesh
        mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
      });
      const mixer = new T.AnimationMixer(group), actions = {}, jn = bones.length;
      for (const [k, cl] of Object.entries(c.clips)) {
        if (!cl._clip) {      // decode once, share between instances
          const q = new Int16Array(bytes(cl.q).buffer), pp = new Float32Array(bytes(cl.p).buffer), times = Float32Array.from({ length: cl.n }, (_, f) => f / cl.fps), tracks = [];
          for (let j = 0; j < jn; j++) {
            const v = new Float32Array(cl.n * 4);
            for (let f = 0; f < cl.n; f++) for (let e = 0; e < 4; e++) v[f * 4 + e] = q[(f * jn + j) * 4 + e] / 32767;
            tracks.push(new T.QuaternionKeyframeTrack(c.bones[j].n + '.quaternion', times, v));
          }
          tracks.push(new T.VectorKeyframeTrack(c.bones[c.rootJoint].n + '.position', times, pp));
          cl._clip = new T.AnimationClip(k, (cl.n - 1) / cl.fps, tracks);
        }
        actions[k] = mixer.clipAction(cl._clip);
      }
      return { group, bones: Object.fromEntries(bones.map((b) => [b.name, b])), skeleton, mixer, actions };
    },
    ready() { return Promise.all(pending); },
  });
})();
