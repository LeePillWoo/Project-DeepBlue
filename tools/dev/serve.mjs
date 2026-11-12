// tiny static server for the dev pages: / → project root, /_s/ → tools/dev.   node serve.mjs [port]   (the game itself needs no server)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.css': 'text/css', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  const f = p.startsWith('/_s/') ? path.join(HERE, p.slice(4)) : path.join(ROOT, p);
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end('nf'); } else { r.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' }); r.end(d); } });
}).listen(+process.argv[2] || 8765, '127.0.0.1');
