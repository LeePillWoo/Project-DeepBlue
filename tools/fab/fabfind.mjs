// Search Fab for FREE 3D models through the Chrome you are logged in to, and build a numbered contact sheet to pick from.
// Chrome must be running with:  chrome.exe --remote-debugging-port=9333 --user-data-dir=%LOCALAPPDATA%\DeepBlue-FabProfile https://www.fab.com/
//   node fabfind.mjs <sheetName> "query one" "query two" ...   [env N=8 results per query, SELLER="Quixel Megascans"]
//   → out/fab_<sheet>.json + out/fab_<sheet>.jpg, and a listing with licence / formats / uid on stdout
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const HERE = path.dirname(fileURLToPath(import.meta.url)), OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });
const [sheet, ...queries] = process.argv.slice(2);
const N = +(process.env.N || 8), TYPE = process.env.TYPE || '3d-model', SELLER = process.env.SELLER ? '&seller=' + encodeURIComponent(process.env.SELLER) : '';
const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = list.find((t) => t.type === 'page' && /fab\.com/.test(t.url)) || list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pend = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.j(new Error(JSON.stringify(m.error))) : p.r(m.result); } };
const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pend.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
const expr = `(async () => { const out = []; for (const q of ${JSON.stringify(queries)}) {
  const r = await fetch('/i/listings/search?q=' + encodeURIComponent(q) + '&is_free=1&listing_types=${TYPE}&sort_by=-relevance${SELLER}', { headers: { accept: 'application/json' } });
  const j = await r.json();
  for (const x of (j.results || []).slice(0, ${N})) out.push({ q, t: x.title, uid: x.uid, by: x.user && x.user.sellerName,
    fmt: (x.assetFormats || []).map((f) => f.assetFormatType.code).join('/'), lic: (x.licenses || []).map((l) => l.name).join('/'),
    poly: (x.assetFormats || []).map((f) => f.technicalSpecs && f.technicalSpecs.polygonsCountRange && f.technicalSpecs.polygonsCountRange.upper).filter(Boolean)[0] || 0,
    size: Math.round(Math.min(...(x.assetFormats || []).map((f) => (f.fileSizesRange && f.fileSizesRange.lower) || 1e12)) / 1e6),
    th: x.thumbnails && x.thumbnails[0] && (x.thumbnails[0].mediaUrl || (x.thumbnails[0].images && x.thumbnails[0].images.slice(-1)[0] && x.thumbnails[0].images.slice(-1)[0].url)), n: x.ratings && x.ratings.total });
} return out; })()`;
const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
ws.close();
if (r.exceptionDetails) { console.log('ERR', r.exceptionDetails.text); process.exit(1); }
const seen = new Set(), items = r.result.value.filter((x) => !seen.has(x.uid) && seen.add(x.uid));
fs.writeFileSync(path.join(OUT, `fab_${sheet}.json`), JSON.stringify(items));
const cell = 190, cols = 8, rows = Math.ceil(items.length / cols), comps = [];
await Promise.all(items.map(async (it, i) => {
  try {
    const buf = Buffer.from(await (await fetch(it.th)).arrayBuffer());
    comps.push({ input: await sharp(buf).resize(cell, cell, { fit: 'cover' }).jpeg().toBuffer(), left: (i % cols) * cell, top: Math.floor(i / cols) * cell });
    comps.push({ input: Buffer.from(`<svg width="34" height="20"><rect width="100%" height="100%" fill="#000"/><text x="3" y="15" font-size="14" fill="#ff0" font-family="Arial" font-weight="bold">${i}</text></svg>`), left: (i % cols) * cell, top: Math.floor(i / cols) * cell });
  } catch (e) { /* no thumb */ }
}));
if (items.length) await sharp({ create: { width: cols * cell, height: rows * cell, channels: 3, background: '#222' } }).composite(comps).jpeg({ quality: 78 }).toFile(path.join(OUT, `fab_${sheet}.jpg`));
items.forEach((it, i) => console.log(`${String(i).padStart(2)} ${it.t.slice(0, 46).padEnd(46)} | ${(it.by || '').slice(0, 18).padEnd(18)} | ${it.lic.replace('Personal/Professional', 'Std').slice(0, 14).padEnd(14)} | ${it.fmt.replace(/converted-files/g, 'conv').replace(/additional-files/g, 'add').slice(0, 30).padEnd(30)} | ${it.size}MB p=${it.poly} | ${it.uid}`));
