// Builds the page that is published as the playable web demo (a claude.ai Artifact) from index.html.
//   node tools/build_demo.mjs   →  demo/project-deep-blue.html  (the page)
//                                  demo/files.json              (what must be published beside it, same relative paths)
//                                  demo/preview.html            (the page inside a plain document, for a local look through tools/dev/serve.mjs)
// The Artifact host supplies <!doctype>, <head> and <body> itself, so the page is index.html without those wrappers,
// and three.js comes from cdnjs (the host only allows library scripts from a few CDNs). Nothing else differs from the local game.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(`${ROOT}/index.html`, 'utf8').replace(/\r\n/g, '\n');
const pick = (re, what) => { const m = html.match(re); if (!m) throw new Error(`index.html: ${what} not found`); return m[0]; };
const title = pick(/<title>[\s\S]*?<\/title>/, '<title>'), style = pick(/<style>[\s\S]*?<\/style>/, '<style>');
const THREE_LOCAL = '<script src="lib/three.min.js"></script>', THREE_CDN = '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.1/three.min.js"></script>';
let body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).trim();
if (!body.includes(THREE_LOCAL)) throw new Error('index.html: three.js script tag not found');
body = body.replace(THREE_LOCAL, THREE_CDN);
const page = `${title}\n${style}\n${body}\n`;
fs.mkdirSync(`${ROOT}/demo`, { recursive: true });
fs.writeFileSync(`${ROOT}/demo/project-deep-blue.html`, page);

// every own script the page loads, plus the asset packs main.js pulls in from the manifest
const scripts = [...body.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).filter((s) => !s.startsWith('https:'));
const packs = JSON.parse(fs.readFileSync(`${ROOT}/assets/manifest.js`, 'utf8').match(/DBA_PACKS=(\[.*\]);/)[1]).map((p) => `assets/${p.name}.js`);
const files = [...scripts, ...packs];
for (const f of files) if (!fs.existsSync(`${ROOT}/${f}`)) throw new Error('missing file: ' + f);
fs.writeFileSync(`${ROOT}/demo/files.json`, JSON.stringify(files, null, 1));
fs.writeFileSync(`${ROOT}/demo/preview.html`, `<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><base href="../"></head><body>\n${page}</body></html>\n`);
const mb = files.reduce((s, f) => s + fs.statSync(`${ROOT}/${f}`).size, 0) / 1e6;
console.log(`demo/project-deep-blue.html  ${(page.length / 1024).toFixed(1)} KB  +  ${files.length} files, ${mb.toFixed(1)} MB (largest ${Math.max(...files.map((f) => fs.statSync(`${ROOT}/${f}`).size / 1e6)).toFixed(1)} MB)`);
