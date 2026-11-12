// Project Deep Blue — packs models, textures and skinned characters into script-loadable JS
// (the game runs from file://, so there is no fetch at runtime). Dev-time only — the game never runs this.
//   cd tools && npm i && node build_assets.mjs [pack ...]
//   → ../assets/<pack>.js, ../assets/manifest.js, ../CREDITS.md
// What goes into which pack is declared in assets.config.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { MODELS, TEXTURES, CHARS, PACKS } from './assets.config.mjs';
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..').split(path.sep).join('/');
const THREE = require(PROJECT + '/lib/three.min.js');
const CACHE = path.join(HERE, '.cache');
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(PROJECT + '/assets', { recursive: true });

// ------------------------------------------------------------------ io helpers
async function get(url, key) {
  const f = path.join(CACHE, key.replace(/[^\w.-]/g, '_'));
  if (fs.existsSync(f)) return fs.readFileSync(f);
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(url); if (!r.ok) throw new Error(r.status); const b = Buffer.from(await r.arrayBuffer()); fs.writeFileSync(f, b); return b; }
    catch (e) { if (i === 3) throw new Error(`download failed ${url}: ${e.message}`); await new Promise((r) => setTimeout(r, 800)); }
  }
}
const info = async (n) => JSON.parse((await get(`https://api.polyhaven.com/files/${n}`, `info_${n}.json`)).toString());
const webp = async (buf, size, q, isNormal) => 'data:image/webp;base64,' + (await sharp(buf).resize(size, size, { fit: 'fill' }).webp({ quality: q, smartSubsample: !isNormal, effort: 5 }).toBuffer()).toString('base64');
// atlas painted on a pure-white background: grow the painted islands outward so UV seams do not pick the background up
async function bleedWhite(buf) {
  const { data, info: im } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true }), W = im.width, H = im.height, n = W * H;
  let bad = new Uint8Array(n);
  for (let i = 0; i < n; i++) bad[i] = data[i * 3] > 248 && data[i * 3 + 1] > 248 && data[i * 3 + 2] > 248 ? 1 : 0;
  for (let pass = 0; pass < 2; pass++) {      // the anti-aliased rim of each island is half background too
    const nb = bad.slice();
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (!bad[i] && (bad[i - 1] || bad[i + 1] || bad[i - W] || bad[i + W])) nb[i] = 1; }
    bad = nb;
  }
  for (let pass = 0; pass < 20; pass++) {
    const fill = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x; if (!bad[i]) continue;
      let r = 0, g = 0, b = 0, c = 0;
      for (const j of [i - 1, i + 1, i - W, i + W, i - W - 1, i - W + 1, i + W - 1, i + W + 1]) if (!bad[j]) { r += data[j * 3]; g += data[j * 3 + 1]; b += data[j * 3 + 2]; c++; }
      if (c) fill.push(i, r / c, g / c, b / c);
    }
    for (let k = 0; k < fill.length; k += 4) { const i = fill[k]; data[i * 3] = fill[k + 1]; data[i * 3 + 1] = fill[k + 2]; data[i * 3 + 2] = fill[k + 3]; bad[i] = 0; }
  }
  return sharp(data, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}
const b64 = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
const r4 = (a) => a.map((x) => +x.toFixed(5));

function readAccessor(gl, bin, idx) {
  const acc = gl.accessors[idx], bv = gl.bufferViews[acc.bufferView];
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type];
  const T = { 5120: ['getInt8', 1, 127], 5121: ['getUint8', 1, 255], 5122: ['getInt16', 2, 32767], 5123: ['getUint16', 2, 65535], 5125: ['getUint32', 4, 1], 5126: ['getFloat32', 4, 1] }[acc.componentType];
  const stride = bv.byteStride || T[1] * comps, off = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength), out = new Float64Array(acc.count * comps);
  for (let i = 0; i < acc.count; i++) for (let c = 0; c < comps; c++) {
    let v = dv[T[0]](off + i * stride + c * T[1], true);
    if (acc.normalized) v = Math.max(v / T[2], -1);
    out[i * comps + c] = v;
  }
  return out;
}

function readGlb(file) {
  const b = fs.readFileSync(file), jl = b.readUInt32LE(12), gl = JSON.parse(b.slice(20, 20 + jl).toString());
  const bo = 20 + jl, bl = b.readUInt32LE(bo);
  return { gl, bin: b.subarray(bo + 8, bo + 8 + bl) };
}

const localFile = (cfg) => (cfg.glb ? `${PROJECT}/raw/fab/${cfg.glb}` : cfg.prep ? `${PROJECT}/raw/prep/${cfg.prep}` : null);

async function loadSource(cfg) {
  const file = localFile(cfg);
  if (file) return readGlb(file);
  const id = cfg.ph || cfg.name, fi = await info(id), g = fi.gltf[cfg.res].gltf;
  const gl = JSON.parse((await get(g.url, `${id}_${cfg.res}.gltf`)).toString());
  const inc = g.include, binKey = Object.keys(inc).find((k) => k.endsWith('.bin'));
  return { gl, bin: await get(inc[binKey].url, `${id}.bin`), inc, id };
}

// texture index → resized WebP data URI
const texFn = (cfg, { gl, bin, inc, id }) => async (ti, kind) => {
  if (ti === undefined || !cfg.tex) return null;
  const im = gl.images[gl.textures[ti.index].source];
  let buf;
  if (im.bufferView !== undefined) { const bv = gl.bufferViews[im.bufferView]; buf = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength); }
  else {
    const uri = decodeURIComponent(im.uri), ent = inc && inc[uri];
    if (!ent) throw new Error('missing texture ' + uri);
    buf = await get(ent.url, `${id}_${cfg.res}_${path.basename(uri)}`);
  }
  if (cfg.bleed && kind === 'diff') buf = await bleedWhite(buf);
  if (cfg.grade && kind === 'diff') buf = await sharp(buf).modulate({ saturation: cfg.grade.sat, brightness: cfg.grade.bright || 1 }).png().toBuffer();
  return webp(buf, cfg.tex[kind], kind === 'nor' ? 86 : 80, kind === 'nor');
};

async function buildMats(cfg, gl, texOf, used) {
  const out = [];
  for (const [mi, m] of (gl.materials || []).entries()) {
    if (!used.has(mi)) { out.push(null); continue; }
    const p = m.pbrMetallicRoughness || {}, mf = p.metallicFactor === undefined ? 1 : p.metallicFactor;
    const o = { name: m.name, diff: await texOf(p.baseColorTexture, 'diff'), nor: await texOf(m.normalTexture, 'nor'), orm: await texOf(p.metallicRoughnessTexture, 'orm') };
    o.metal = cfg.metal !== undefined ? !!(cfg.metal && o.orm && mf > 0) : !localFile(cfg) && mf > 0 && /arm/i.test(JSON.stringify(gl.images));
    // factors matter only where a texture is missing
    if (p.baseColorFactor && p.baseColorFactor.slice(0, 3).some((v) => v < 0.999)) o.color = r4(p.baseColorFactor.slice(0, 3));
    if (!o.orm) { o.rough = +(p.roughnessFactor === undefined ? 1 : p.roughnessFactor).toFixed(3); o.metalF = +mf.toFixed(3); }
    if (m.alphaMode === 'MASK') o.cut = m.alphaCutoff === undefined ? 0.5 : m.alphaCutoff;
    if (m.alphaMode === 'BLEND' && !cfg.opaque) o.glass = true;
    out.push(o);
  }
  return out;
}

// quantise one part: Uint16 positions inside its bbox, Int8 normals, Uint16 UVs
function packPart(p, extra) {
  const cnt = p.P.length / 3, mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9], umn = [1e9, 1e9], umx = [-1e9, -1e9];
  for (let i = 0; i < cnt; i++) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], p.P[i * 3 + c]); mx[c] = Math.max(mx[c], p.P[i * 3 + c]); }
  if (extra && extra.split) {     // origin at the base centre of each rock
    const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2, by = mn[1];
    for (let i = 0; i < cnt; i++) { p.P[i * 3] -= cx; p.P[i * 3 + 1] -= by; p.P[i * 3 + 2] -= cz; }
    mn[0] -= cx; mx[0] -= cx; mn[2] -= cz; mx[2] -= cz; mx[1] -= by; mn[1] = 0;
  }
  for (let i = 0; i < cnt; i++) for (let c = 0; c < 2; c++) { umn[c] = Math.min(umn[c], p.U[i * 2 + c]); umx[c] = Math.max(umx[c], p.U[i * 2 + c]); }
  const pos = new Uint16Array(cnt * 3), nor = new Int8Array(cnt * 3), uv = new Uint16Array(cnt * 2);
  for (let i = 0; i < cnt; i++) {
    for (let c = 0; c < 3; c++) { pos[i * 3 + c] = Math.round(((p.P[i * 3 + c] - mn[c]) / (mx[c] - mn[c] || 1)) * 65535); nor[i * 3 + c] = Math.round(p.N[i * 3 + c] * 127); }
    for (let c = 0; c < 2; c++) uv[i * 2 + c] = Math.round(((p.U[i * 2 + c] - umn[c]) / (umx[c] - umn[c] || 1)) * 65535);
  }
  const i32 = cnt > 65535, idx = i32 ? Uint32Array.from(p.I) : Uint16Array.from(p.I);
  const o = { name: p.name, n: cnt, tris: p.I.length / 3, bmin: r4(mn), bmax: r4(mx), uvmin: r4(umn), uvmax: r4(umx), pos: b64(pos), nor: b64(nor), uv: b64(uv), idx: b64(idx), i32, mat: p.mat };
  if (p.C) o.col = b64(p.C);
  if (p.JI) { o.ji = b64(p.JI); o.jw = b64(p.JW); }
  return o;
}

// one glTF primitive → plain arrays (missing UVs / indices are filled in)
function readPrim(gl, bin, pr) {
  const P = readAccessor(gl, bin, pr.attributes.POSITION), cnt = P.length / 3;
  const N = pr.attributes.NORMAL !== undefined ? readAccessor(gl, bin, pr.attributes.NORMAL) : new Float64Array(cnt * 3).fill(0.577);
  const U = pr.attributes.TEXCOORD_0 !== undefined ? readAccessor(gl, bin, pr.attributes.TEXCOORD_0) : new Float64Array(cnt * 2);
  const I = pr.indices !== undefined ? readAccessor(gl, bin, pr.indices) : Float64Array.from({ length: cnt }, (_, i) => i);
  return { P, N, U, I, mat: pr.material || 0 };
}

// ------------------------------------------------------------------ vertex-colour painters for untextured sculpts
// Called after `fish` normalisation: +x head, +y up, length 1, centred on the bounding box. Colours are linear.
const sm = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const hash3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
function noise3(x, y, z) {      // value noise, 0..1
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), f = [x - xi, y - yi, z - zi].map((t) => t * t * (3 - 2 * t)), L = (a, b, t) => a + (b - a) * t;
  const h = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return L(L(L(h(0, 0, 0), h(1, 0, 0), f[0]), L(h(0, 1, 0), h(1, 1, 0), f[0]), f[1]), L(L(h(0, 0, 1), h(1, 0, 1), f[0]), L(h(0, 1, 1), h(1, 1, 1), f[0]), f[1]), f[2]);
}
const PAINT = {
  turtle(parts) {
    for (const p of parts) {
      const n = p.P.length / 3; p.C = new Uint8Array(n * 3);
      if (process.env.DEBUG_PAINT) {
        for (let s = 0; s < 20; s++) {
          const x0 = -0.5 + s / 20; let zs = [], ys = [];
          for (let i = 0; i < n; i++) if (p.P[i * 3] >= x0 && p.P[i * 3] < x0 + 0.05) { zs.push(Math.abs(p.P[i * 3 + 2])); ys.push(p.P[i * 3 + 1]); }
          zs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
          console.log(`  x ${x0.toFixed(2)} n=${zs.length} |z| p50 ${(zs[zs.length >> 1] || 0).toFixed(3)} max ${(zs[zs.length - 1] || 0).toFixed(3)}  y ${(ys[0] || 0).toFixed(3)}..${(ys[ys.length - 1] || 0).toFixed(3)}`);
        }
      }
      // cavity: how far a vertex sits below the average of its neighbours (the sculpted grooves between the scutes)
      const sum = new Float64Array(n * 3), deg = new Uint16Array(n), cav = new Float32Array(n);
      for (let t = 0; t < p.I.length; t += 3) for (let e = 0; e < 3; e++) {
        const a = p.I[t + e], b = p.I[t + ((e + 1) % 3)];
        for (let k = 0; k < 3; k++) { sum[a * 3 + k] += p.P[b * 3 + k]; sum[b * 3 + k] += p.P[a * 3 + k]; }
        deg[a]++; deg[b]++;
      }
      for (let i = 0; i < n; i++) {
        let d = 0, len = 0;
        for (let k = 0; k < 3; k++) { const v = sum[i * 3 + k] / (deg[i] || 1) - p.P[i * 3 + k]; d += v * p.N[i * 3 + k]; len += v * v; }
        cav[i] = d / (Math.sqrt(len) + 0.004);
      }
      // shell = an ellipse in plan view fitted by eye to this sculpt (DEBUG_PAINT=1 prints the slice table). Colours are linear.
      const S = PAINT.turtleShell;
      for (let i = 0; i < n; i++) {
        const x = p.P[i * 3], y = p.P[i * 3 + 1], z = p.P[i * 3 + 2], ny = p.N[i * 3 + 1];
        const ex = (x - S.cx) / S.rx, ez = z / S.rz, foot = Math.sqrt(ex * ex + ez * ez);      // 1 = shell rim
        const inShell = 1 - sm(0.97, 1.05, foot), top = sm(S.rim - 0.012, S.rim + 0.012, y), groove = sm(0.12, 0.6, cav[i]), ridge = sm(0.1, 0.6, -cav[i]);
        let plate = mixc([0.105, 0.062, 0.022], [0.012, 0.009, 0.006], groove);           // carapace: brown plates, near-black seams
        plate = mixc(plate, [0.2, 0.13, 0.05], ridge * 0.5);
        plate = mixc(plate, [0.17, 0.12, 0.045], sm(0.8, 1.0, foot) * 0.6);               // lighter marginal scutes
        const belly = mixc([0.5, 0.42, 0.2], [0.2, 0.16, 0.08], groove);
        let skin = mixc([0.035, 0.05, 0.035], [0.4, 0.37, 0.22], sm(0.15, -0.6, ny) * 0.8);  // dark above, pale below
        skin = mixc(skin, [0.012, 0.016, 0.012], groove * 0.7);
        const c = mixc(skin, mixc(belly, plate, top), inShell);
        for (let k = 0; k < 3; k++) p.C[i * 3 + k] = Math.round(Math.min(Math.max(c[k], 0), 1) * 255);
      }
    }
  },
  turtleShell: { cx: -0.035, rx: 0.378, rz: 0.347, rim: -0.04 },

  // sperm whale: slate grey, scuffed pale around the head, white lower jaw, lighter blotches under the belly
  spermWhale(parts) {
    for (const p of parts) {
      const n = p.P.length / 3; p.C = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) {
        const x = p.P[i * 3], y = p.P[i * 3 + 1], z = p.P[i * 3 + 2], ny = p.N[i * 3 + 1];
        const big = noise3(x * 9, y * 9, z * 9), fine = noise3(x * 70, y * 70, z * 70), streak = noise3(x * 14, y * 90, z * 90);
        let c = mixc([0.036, 0.04, 0.046], [0.075, 0.078, 0.082], big * 0.7 + fine * 0.3);
        c = mixc(c, [0.16, 0.16, 0.155], sm(0.62, 0.8, streak) * sm(0.1, 0.4, x) * 0.6);             // scars from squid and rivals, mostly on the head
        c = mixc(c, [0.3, 0.3, 0.28], sm(0.55, 0.75, big) * sm(0.1, -0.5, ny) * sm(0.3, -0.1, x) * 0.7);   // pale belly blotches
        c = mixc(c, [0.6, 0.6, 0.56], sm(0.22, 0.3, x) * sm(-0.045, -0.075, y) * sm(0.035, 0.02, Math.abs(z)));      // the narrow underslung jaw
        for (let k = 0; k < 3; k++) p.C[i * 3 + k] = Math.round(Math.min(Math.max(c[k], 0), 1) * 255);
      }
    }
  },

  // weedy seadragon: orange-red above, yellow below, violet bars on the neck, pale spots, dark leafy appendages
  seadragon(parts) {
    for (const p of parts) {
      const n = p.P.length / 3; p.C = new Uint8Array(n * 3);
      // the body's centreline: per slice along the length, the median of what is there (the trunk outnumbers the leaves)
      const B = 40, ys = Array.from({ length: B }, () => []), zs = Array.from({ length: B }, () => []), bin = (x) => Math.min(Math.max(Math.floor((x + 0.5) * B), 0), B - 1);
      for (let i = 0; i < n; i++) { const b = bin(p.P[i * 3]); ys[b].push(p.P[i * 3 + 1]); zs[b].push(p.P[i * 3 + 2]); }
      const med = (a) => (a.length ? a.sort((u, v) => u - v)[a.length >> 1] : 0), cy = ys.map(med), cz = zs.map(med);
      for (let i = 0; i < n; i++) {
        const x = p.P[i * 3], y = p.P[i * 3 + 1], z = p.P[i * 3 + 2], ny = p.N[i * 3 + 1], b = bin(x);
        const off = Math.hypot(y - cy[b], z - cz[b]), leaf = sm(0.035, 0.075, off);
        let c = mixc([0.5, 0.16, 0.045], [0.62, 0.42, 0.08], sm(0.3, -0.5, ny));
        c = mixc(c, [0.16, 0.05, 0.3], sm(0.55, 0.9, Math.sin(x * 95)) * sm(-0.05, 0.1, x) * sm(0.38, 0.3, x) * 0.85);      // violet bars behind the head
        c = mixc(c, [0.85, 0.75, 0.4], sm(0.7, 0.8, noise3(x * 150, y * 150, z * 150)) * 0.8);                                   // spots
        c = mixc(c, mixc([0.09, 0.05, 0.11], [0.22, 0.2, 0.05], noise3(x * 40, y * 40, z * 40)), leaf);
        for (let k = 0; k < 3; k++) p.C[i * 3 + k] = Math.round(Math.min(Math.max(c[k], 0), 1) * 255);
      }
    }
  },
};

// ------------------------------------------------------------------ static models
async function buildModel(cfg) {
  const src = await loadSource(cfg), { gl, bin } = src, texOf = texFn(cfg, src);
  let parts = [];
  const pre = cfg.rot ? new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...cfg.rot)) : new THREE.Matrix4();
  const visit = (ni, parent, depth) => {
    const n = gl.nodes[ni], local = new THREE.Matrix4();
    if (n.matrix) local.fromArray(n.matrix);
    else {
      const t = n.translation || [0, 0, 0], r = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
      local.compose(new THREE.Vector3(...(cfg.split && depth === 0 ? [0, 0, 0] : t)), new THREE.Quaternion(...r), new THREE.Vector3(...s));
    }
    const world = parent.clone().multiply(local), nm = n.name || '';
    if (n.mesh !== undefined && !(cfg.skip && cfg.skip.test(nm)) && !(cfg.only && !cfg.only.test(nm))) {
      const nmat = new THREE.Matrix3().getNormalMatrix(world), flip = world.determinant() < 0;
      for (const pr of gl.meshes[n.mesh].primitives) {
        const p = readPrim(gl, bin, pr), cnt = p.P.length / 3, v = new THREE.Vector3();
        for (let i = 0; i < cnt; i++) {
          v.set(p.P[i * 3], p.P[i * 3 + 1], p.P[i * 3 + 2]).applyMatrix4(world); p.P[i * 3] = v.x; p.P[i * 3 + 1] = v.y; p.P[i * 3 + 2] = v.z;
          v.set(p.N[i * 3], p.N[i * 3 + 1], p.N[i * 3 + 2]).applyMatrix3(nmat).normalize(); p.N[i * 3] = v.x; p.N[i * 3 + 1] = v.y; p.N[i * 3 + 2] = v.z;
        }
        if (flip) for (let i = 0; i < p.I.length; i += 3) { const t = p.I[i + 1]; p.I[i + 1] = p.I[i + 2]; p.I[i + 2] = t; }
        p.name = nm; parts.push(p);
      }
    }
    for (const c of n.children || []) visit(c, world, depth + 1);
  };
  for (const r of gl.scenes[gl.scene || 0].nodes) visit(r, pre, 0);

  if (cfg.unit) for (const p of parts) for (let i = 0; i < p.P.length; i++) p.P[i] *= cfg.unit;
  if (cfg.crop) for (const p of parts) {      // keep only the triangles inside a box: [[x0, x1], [y0, y1], [z0, z1]], null = unbounded
    const inside = (v) => cfg.crop.every((r, c) => !r || (p.P[v * 3 + c] >= r[0] && p.P[v * 3 + c] <= r[1])), map = new Map(), P = [], N = [], U = [], I = [];
    for (let t = 0; t < p.I.length; t += 3) {
      if (!inside(p.I[t]) || !inside(p.I[t + 1]) || !inside(p.I[t + 2])) continue;
      for (let e = 0; e < 3; e++) { const v = p.I[t + e]; if (!map.has(v)) { map.set(v, P.length / 3); P.push(p.P[v * 3], p.P[v * 3 + 1], p.P[v * 3 + 2]); N.push(p.N[v * 3], p.N[v * 3 + 1], p.N[v * 3 + 2]); U.push(p.U[v * 2], p.U[v * 2 + 1]); } I.push(map.get(v)); }
    }
    p.P = Float64Array.from(P); p.N = Float64Array.from(N); p.U = Float64Array.from(U); p.I = Float64Array.from(I);
  }
  if (cfg.fish) {     // principal axis = longest bbox axis → +x; axes/signs fix the orientation per model
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const p of parts) for (let i = 0; i < p.P.length; i += 3) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], p.P[i + c]); mx[c] = Math.max(mx[c], p.P[i + c]); }
    const ext = [0, 1, 2].map((c) => mx[c] - mn[c]), ax = ext.indexOf(Math.max(...ext)), L = ext[ax], ctr = [0, 1, 2].map((c) => (mn[c] + mx[c]) / 2);
    const mp = cfg.axes || [ax, ...[0, 1, 2].filter((c) => c !== ax)];        // [length, up, side] source axes
    const sg = cfg.signs || [1, 1, 1];
    for (const p of parts) for (let i = 0; i < p.P.length; i += 3) {
      const q = [p.P[i] - ctr[0], p.P[i + 1] - ctr[1], p.P[i + 2] - ctr[2]], n = [p.N[i], p.N[i + 1], p.N[i + 2]];
      p.P[i] = (q[mp[0]] * sg[0]) / L; p.P[i + 1] = (q[mp[1]] * sg[1]) / L; p.P[i + 2] = (q[mp[2]] * sg[2]) / L;
      p.N[i] = n[mp[0]] * sg[0]; p.N[i + 1] = n[mp[1]] * sg[1]; p.N[i + 2] = n[mp[2]] * sg[2];
      if (sg[0] * sg[1] * sg[2] * (((mp[0] + 1) % 3 === mp[1]) ? 1 : -1) < 0 && i === 0) p.flip = true;
    }
    for (const p of parts) if (p.flip) for (let i = 0; i < p.I.length; i += 3) { const t = p.I[i + 1]; p.I[i + 1] = p.I[i + 2]; p.I[i + 2] = t; }
    console.log('  fish axes', cfg.name, 'len axis', ax, 'L', L.toFixed(2), 'ext', ext.map((e) => e.toFixed(2)).join('x'));
  }
  if (cfg.paint) PAINT[cfg.paint](parts);
  if (cfg.merge) {     // one draw call per material
    const by = new Map();
    for (const p of parts) {
      let m = by.get(p.mat);
      if (!m) by.set(p.mat, (m = { name: 'mat' + p.mat, P: [], N: [], U: [], I: [], mat: p.mat, n: 0 }));
      for (const v of p.P) m.P.push(v); for (const v of p.N) m.N.push(v); for (const v of p.U) m.U.push(v);
      for (const i of p.I) m.I.push(i + m.n);
      m.n += p.P.length / 3;
    }
    parts = [...by.values()];
  }
  const mats = await buildMats(cfg, gl, texOf, new Set(parts.map((p) => p.mat)));
  const outParts = parts.map((p) => packPart(p, cfg));
  console.log(`model ${cfg.name}: ${outParts.length} parts, ${outParts.reduce((a, p) => a + p.tris, 0)} tris, mats ${mats.filter(Boolean).length}  dims ${outParts.map((p) => p.bmax.map((v, i) => (v - p.bmin[i]).toFixed(2)).join('x')).slice(0, 4).join(' | ')}`);
  return { parts: outParts, mats };
}

async function buildTexture(cfg) {
  const fi = await info(cfg.name), out = {};
  for (const [kind, key, q] of [['diff', 'Diffuse', 80], ['nor', 'nor_gl', 86], ['rough', 'Rough', 78]]) {
    const ent = fi[key] && fi[key][cfg.res] && fi[key][cfg.res].jpg;
    if (!ent) { console.log('  (no', key, 'for', cfg.name + ')'); continue; }
    out[kind] = await webp(await get(ent.url, `${cfg.name}_${cfg.res}_${key}.jpg`), cfg.size[kind], q, kind === 'nor');
  }
  console.log(`texture ${cfg.name}: ${Object.keys(out).join(',')}`);
  return out;
}

// ------------------------------------------------------------------ skinned characters
// "mixamorig:LeftArm_09" → "LeftArm": the same bone gets the same name in every export of the rig
const plain = (name) => String(name || '').replace(/^.*:/, '').replace(/_\d+$/, '').replace(/[^\w]/g, '_');

function makeTree(gl) {
  const nodes = gl.nodes.map((n) => {
    const o = new THREE.Object3D(); o.name = n.name || '';
    if (n.matrix) { o.matrix.fromArray(n.matrix); o.matrix.decompose(o.position, o.quaternion, o.scale); }
    else { if (n.translation) o.position.fromArray(n.translation); if (n.rotation) o.quaternion.fromArray(n.rotation); if (n.scale) o.scale.fromArray(n.scale); }
    return o;
  });
  gl.nodes.forEach((n, i) => (n.children || []).forEach((c) => nodes[i].add(nodes[c])));
  const root = new THREE.Object3D();
  for (const r of gl.scenes[gl.scene || 0].nodes) root.add(nodes[r]);
  root.updateMatrixWorld(true);
  const rest = nodes.map((o) => ({ p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }));
  const reset = () => { nodes.forEach((o, i) => { o.position.copy(rest[i].p); o.quaternion.copy(rest[i].q); o.scale.copy(rest[i].s); }); root.updateMatrixWorld(true); };
  return { root, nodes, reset };
}

function makeClip(gl, bin, nodes, anim) {
  const tracks = [];
  for (const ch of anim.channels) {
    const s = anim.samplers[ch.sampler], kind = ch.target.path, node = nodes[ch.target.node];
    if (!node || kind === 'weights') continue;
    const times = Float32Array.from(readAccessor(gl, bin, s.input)), size = kind === 'rotation' ? 4 : 3;
    let vals = readAccessor(gl, bin, s.output);
    if (s.interpolation === 'CUBICSPLINE') {     // keep the values, drop the tangents
      const v = new Float64Array(times.length * size);
      for (let i = 0; i < times.length; i++) for (let c = 0; c < size; c++) v[i * size + c] = vals[(i * 3 + 1) * size + c];
      vals = v;
    }
    const Track = kind === 'rotation' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    tracks.push(new Track(node.uuid + '.' + { rotation: 'quaternion', translation: 'position', scale: 'scale' }[kind], times, Float32Array.from(vals)));
  }
  return new THREE.AnimationClip(anim.name, -1, tracks);
}

// steps the clip at a fixed rate; onFrame sees the posed tree
function playClip(tree, clip, fps, onFrame) {
  const mixer = new THREE.AnimationMixer(tree.root);
  mixer.clipAction(clip).play();
  const n = Math.max(2, Math.round(clip.duration * fps) + 1);
  for (let f = 0; f < n; f++) { mixer.setTime(Math.min(f / fps, clip.duration - 1e-4)); tree.root.updateMatrixWorld(true); onFrame(f, n); }
  mixer.stopAllAction(); tree.reset();
  return n;
}

const findAnim = (gl, want) => gl.animations.find((a) => (want instanceof RegExp ? want.test(a.name) : a.name === want));

async function buildChar(cfg) {
  const src = await loadSource(cfg), { gl, bin } = src, texOf = texFn(cfg, src);
  const tree = makeTree(gl), skin = gl.skins[cfg.skin || 0], J = skin.joints, jn = J.length;
  const ibm = readAccessor(gl, bin, skin.inverseBindMatrices);
  const jIdx = new Map(J.map((ni, k) => [ni, k])), parentNode = new Map();
  gl.nodes.forEach((n, i) => (n.children || []).forEach((c) => parentNode.set(c, i)));
  const used = new Set();
  const bones = J.map((ni) => {
    const o = tree.nodes[ni], pi = parentNode.get(ni);
    let name = plain(o.name); while (used.has(name)) name += '_'; used.add(name);
    return { n: name, p: jIdx.has(pi) ? jIdx.get(pi) : -1, t: r4(o.position.toArray()), r: r4(o.quaternion.toArray()), s: r4(o.scale.toArray()) };
  });
  const depth = (k) => (bones[k].p < 0 ? 0 : 1 + depth(bones[k].p)), order = [...bones.keys()].sort((a, b) => depth(a) - depth(b));
  const rootJ = bones.findIndex((b) => b.p < 0), armature = tree.nodes[J[rootJ]].parent;
  if (bones.some((b, k) => b.p < 0 && tree.nodes[J[k]].parent !== armature)) console.log('  WARNING: root joints under different parents in', cfg.name);

  // skinned primitives, kept in mesh space (the bind matrices place them)
  const parts = [];
  gl.nodes.forEach((n) => {
    if (n.mesh === undefined || n.skin !== (cfg.skin || 0)) return;
    for (const pr of gl.meshes[n.mesh].primitives) {
      const p = readPrim(gl, bin, pr), cnt = p.P.length / 3;
      const ji = readAccessor(gl, bin, pr.attributes.JOINTS_0), jw = readAccessor(gl, bin, pr.attributes.WEIGHTS_0);
      p.JI = new Uint8Array(cnt * 4); p.JW = new Uint8Array(cnt * 4);
      for (let i = 0; i < cnt; i++) {
        const sum = jw[i * 4] + jw[i * 4 + 1] + jw[i * 4 + 2] + jw[i * 4 + 3] || 1; let acc = 0, big = 0;
        for (let c = 0; c < 4; c++) { const w = Math.round((jw[i * 4 + c] / sum) * 255); p.JI[i * 4 + c] = ji[i * 4 + c]; p.JW[i * 4 + c] = w; acc += w; if (w > p.JW[i * 4 + big]) big = c; }
        p.JW[i * 4 + big] += 255 - acc;      // weights sum to exactly 1 after quantisation
      }
      p.name = n.name || ''; parts.push(p);
    }
  });
  if (jn > 255) throw new Error('more than 255 joints: ' + cfg.name);

  // bind-pose bounds in scene space → scale to the requested height, feet on y = 0
  const BM = J.map((ni, k) => tree.nodes[ni].matrixWorld.clone().multiply(new THREE.Matrix4().fromArray(ibm, k * 16)));
  const mn = new THREE.Vector3(1e9, 1e9, 1e9), mx = new THREE.Vector3(-1e9, -1e9, -1e9), v = new THREE.Vector3(), a = new THREE.Vector3();
  for (const p of parts) for (let i = 0; i < p.P.length / 3; i++) {
    a.set(0, 0, 0);
    for (let c = 0; c < 4; c++) { const w = p.JW[i * 4 + c] / 255; if (w > 0) a.addScaledVector(v.set(p.P[i * 3], p.P[i * 3 + 1], p.P[i * 3 + 2]).applyMatrix4(BM[p.JI[i * 4 + c]]), w); }
    mn.min(a); mx.max(a);
  }
  const scale = cfg.height / (mx.y - mn.y);
  const rootM = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-(mn.x + mx.x) / 2, -mn.y, -(mn.z + mx.z) / 2)).multiply(armature.matrixWorld);

  // ---- clips: joint rotations (+ root joint position) sampled at a fixed rate
  const clips = {}, Q = () => new THREE.Quaternion();
  const rootPos = () => tree.nodes[J[rootJ]].position;
  for (const c of cfg.clips) {
    let nF = 0; const qs = [], ps = [];
    if (!c.from) {
      const anim = findAnim(gl, c.anim); if (!anim) throw new Error(`clip ${c.anim} not found in ${cfg.name}: ${gl.animations.map((x) => x.name)}`);
      nF = playClip(tree, makeClip(gl, bin, tree.nodes, anim), c.fps, () => {
        for (const ni of J) { const q = tree.nodes[ni].quaternion; qs.push(q.x, q.y, q.z, q.w); }
        ps.push(...rootPos().toArray());
      });
    } else {
      // world-space retarget from another rig: both rest poses are the same T-pose, so
      //   targetWorld(t) = sourceWorld(t) · sourceRestWorld⁻¹ · targetRestWorld
      const s = readGlb(`${PROJECT}/raw/fab/${c.from}`), st = makeTree(s.gl), anim = findAnim(s.gl, c.anim);
      if (!anim) throw new Error(`clip ${c.anim} not found in ${c.from}`);
      const byName = new Map(); st.nodes.forEach((o) => { const k = plain(o.name); if (!byName.has(k)) byName.set(k, o); });
      const map = J.map((ni) => byName.get(plain(tree.nodes[ni].name)) || null);
      const Rt = J.map((ni) => tree.nodes[ni].getWorldQuaternion(Q())), Rs = map.map((o) => (o ? o.getWorldQuaternion(Q()).invert() : null));
      const restLocal = J.map((ni) => tree.nodes[ni].quaternion.clone()), armQ = armature.getWorldQuaternion(Q());
      const tHip = tree.nodes[J[rootJ]].getWorldPosition(new THREE.Vector3()), sHipNode = map[rootJ], sHip = sHipNode.getWorldPosition(new THREE.Vector3());
      const k = (tHip.y - mn.y) / sHip.y;      // leg-length ratio (source rig stands on y = 0)
      const armInv = armature.matrixWorld.clone().invert(), W = [], tmp = Q(), d = new THREE.Vector3(), drift = [];
      console.log(`  retarget ${c.name}: ${map.filter(Boolean).length}/${jn} bones mapped, hip scale ${k.toFixed(2)}`);
      nF = playClip(st, makeClip(s.gl, s.bin, st.nodes, anim), c.fps, () => {
        for (const j of order) {
          const Wp = bones[j].p < 0 ? armQ : W[bones[j].p];
          W[j] = map[j] ? map[j].getWorldQuaternion(Q()).multiply(Rs[j]).multiply(Rt[j]) : Wp.clone().multiply(restLocal[j]);
        }
        for (let j = 0; j < jn; j++) { tmp.copy(bones[j].p < 0 ? armQ : W[bones[j].p]).invert().multiply(W[j]); qs.push(tmp.x, tmp.y, tmp.z, tmp.w); }
        drift.push(sHipNode.getWorldPosition(d).sub(sHip).clone());
      });
      const net = drift[drift.length - 1].clone().sub(drift[0]);
      for (let f = 0; f < nF; f++) {
        const dd = drift[f].clone();
        if (c.inPlace) { dd.x -= drift[0].x + (net.x * f) / (nF - 1); dd.z -= drift[0].z + (net.z * f) / (nF - 1); }      // treadmill: drop the travel, keep the sway
        ps.push(...tHip.clone().addScaledVector(dd, k).applyMatrix4(armInv).toArray());
      }
    }
    const q16 = new Int16Array(qs.length); for (let i = 0; i < qs.length; i++) q16[i] = Math.round(Math.max(-1, Math.min(1, qs[i])) * 32767);
    clips[c.name] = { fps: c.fps, n: nF, q: b64(q16), p: b64(Float32Array.from(ps)) };
    console.log(`  clip ${c.name}: ${nF} frames @${c.fps} (${((nF - 1) / c.fps).toFixed(1)} s)`);
  }

  const mats = await buildMats(cfg, gl, texOf, new Set(parts.map((p) => p.mat)));
  const outParts = parts.map((p) => packPart(p));
  console.log(`char ${cfg.name}: ${jn} bones, ${outParts.reduce((s, p) => s + p.tris, 0)} tris, scale ${scale.toFixed(4)}, clips ${Object.keys(clips).join(',')}`);
  return { root: r4(rootM.toArray()), rootJoint: rootJ, bones, ibm: b64(Float32Array.from(ibm)), parts: outParts, mats, clips };
}

// ------------------------------------------------------------------ credits (README links to this)
function writeCredits() {
  const cf = `${PROJECT}/raw/fab/credits.json`, cred = fs.existsSync(cf) ? JSON.parse(fs.readFileSync(cf, 'utf8')) : {};
  const used = new Map();      // source file → what it is used for
  const use = (file, name) => { if (file) used.set(file, [...(used.get(file) || []), name]); };
  for (const m of [...MODELS, ...CHARS]) { use(m.from || m.glb, m.name); for (const c of m.clips || []) if (c.from) use(c.from, `${m.name}:${c.name} 애니메이션`); }
  const rows = [...used.entries()].map(([file, names]) => ({ file, names, c: cred[file] }));
  const line = (r) => `- **${r.c ? r.c.title : r.file}** — ${r.c ? r.c.by : '?'}${r.c && r.c.uid ? ` · [Fab](https://www.fab.com/listings/${r.c.uid})` : ''}${r.c && /Personal/.test(r.c.license) ? ' · Personal 등급(무료)' : ''} · \`${r.names.join('`, `')}\``;
  const isMega = (r) => r.c && /megascans/i.test(r.c.by), isBy = (r) => r.c && /CC-BY/i.test(r.c.license) && !isMega(r);
  const ph = [...new Set(MODELS.filter((m) => !localFile(m)).map((m) => m.ph || m.name).concat(TEXTURES.map((t) => t.name)))];
  const md = `# 에셋 출처 (Credits)

\`tools/build_assets.mjs\` 가 \`tools/assets.config.mjs\` 와 \`raw/fab/credits.json\` 으로부터 생성합니다. 직접 고치지 마세요.

## Fab — CC-BY 4.0 (출처 표기 필수)

${rows.filter(isBy).map(line).join('\n')}

## Fab — Quixel Megascans (Fab Standard License)

${rows.filter(isMega).map(line).join('\n')}

## Fab — 그 외 무료 (Fab Standard License)

Personal 등급으로 받은 것은 개인·연 매출 10만 달러 이하 팀의 사용 조건입니다.

${rows.filter((r) => !isBy(r) && !isMega(r)).map(line).join('\n') || '- 없음'}

## Poly Haven — CC0

${ph.map((n) => `- [${n}](https://polyhaven.com/a/${n})`).join('\n')}

## 코드

- three.js r160 — MIT
`;
  fs.writeFileSync(`${PROJECT}/CREDITS.md`, md);
  const missing = rows.filter((r) => !r.c).map((r) => r.file);
  console.log(`wrote CREDITS.md (${rows.length} Fab sources${missing.length ? ', NO CREDIT ENTRY: ' + missing.join(', ') : ''})`);
}

// ------------------------------------------------------------------ main
const only = process.argv.slice(2);
const want = (pack) => !only.length || only.includes(pack);
const files = {};
const slot = (pack) => (files[pack] = files[pack] || { models: {}, tex: {}, chars: {} });
for (const m of MODELS) if (want(m.out)) slot(m.out).models[m.name] = await buildModel(m);
for (const t of TEXTURES) if (want(t.out)) slot(t.out).tex[t.name] = await buildTexture(t);
for (const c of CHARS) if (want(c.out)) slot(c.out).chars[c.name] = await buildChar(c);
for (const [name, data] of Object.entries(files)) {
  const emit = (key, obj) => Object.entries(obj).map(([k, v]) => `A.${key}[${JSON.stringify(k)}]=${JSON.stringify(v)};`).join('\n');
  const js = `// Project Deep Blue — packed assets: ${PACKS[name]}. See CREDITS.md. Generated by tools/build_assets.mjs; do not edit.\n(function(){var A=(window.DBA=window.DBA||{models:{},tex:{},chars:{}});A.chars=A.chars||{};\n${emit('models', data.models)}\n${emit('tex', data.tex)}\n${emit('chars', data.chars)}\n})();\n`;
  const f = `${PROJECT}/assets/${name}.js`;
  fs.writeFileSync(f, js);
  console.log(`wrote ${f}  ${(js.length / 1e6).toFixed(2)} MB`);
}
// the game loads whatever the manifest lists, in this order
const packs = Object.keys(PACKS).filter((p) => fs.existsSync(`${PROJECT}/assets/${p}.js`));
fs.writeFileSync(`${PROJECT}/assets/manifest.js`, `// Generated by tools/build_assets.mjs — asset packs the game loads at boot.\nwindow.DBA_PACKS=${JSON.stringify(packs.map((p) => ({ name: p, mb: +(fs.statSync(`${PROJECT}/assets/${p}.js`).size / 1e6).toFixed(1) })))};\n`);
console.log('wrote assets/manifest.js:', packs.join(', '));
writeCredits();
