// Batch-download FREE Fab listings through the Chrome you are logged in to (see fabfind.mjs for how to start it).
//   node fabget.mjs ../../raw/fab uid[=regex] uid[=regex] ...
// Picks the converted .glb (Megascans: *_mid.glb) unless a regex is given, and records title / author / licence in <dest>/credits.json
// (tools/build_assets.mjs turns that into CREDITS.md). It only presses "Download". Listings sold in tiers ("Select a License")
// are left alone unless PERSONAL=1 is set: then the Personal tier is chosen, and only when the menu shows it as Free —
// that tier is for individuals / teams under $100k a year. Nothing is ever bought.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const [dest, ...items] = process.argv.slice(2);
const DL = path.join(os.homedir(), 'Downloads'), PERSONAL = process.env.PERSONAL === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = list.find((t) => t.type === 'page' && /fab\.com/.test(t.url)) || list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pend = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.j(new Error(JSON.stringify(m.error))) : p.r(m.result); } };
const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pend.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
await send('Page.enable'); await send('Runtime.enable');
const credFile = path.join(dest, 'credits.json');
const credits = fs.existsSync(credFile) ? JSON.parse(fs.readFileSync(credFile, 'utf8')) : {};
for (const it of items) {
  const [uid, rx] = it.split('=');
  try {
    await send('Page.navigate', { url: 'https://www.fab.com/listings/' + uid });
    const hasDl = `!![...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Download')`;
    let ok = false, personal = false;
    for (let i = 0; i < 40 && !ok; i++) {
      await sleep(500); ok = await ev(hasDl).catch(() => false);
      // tiered listing: open the licence menu and take the Personal tier, but only where the menu itself says it is free
      if (!ok && i > 6 && !personal && PERSONAL) {
        const picked = await ev(`(async()=>{const b=[...document.querySelectorAll('button')].find(b=>/Select a License/.test(b.innerText));if(!b)return'';b.click();await new Promise(r=>setTimeout(r,900));
          const o=[...document.querySelectorAll('[role=option]')].find(e=>/^Personal/.test(e.innerText.trim()));if(!o)return'';const t=o.innerText.trim().replace(/\\s+/g,' ');if(!/ Free$/.test(t))return'PAID '+t.slice(-40);o.click();return'ok'})()`).catch(() => '');
        if (/^PAID/.test(picked)) { console.log('SKIP personal tier is not free', uid, picked); break; }
        personal = picked === 'ok';
      }
    }
    if (!ok) { console.log('FAIL no Download button', uid); continue; }
    const meta = await ev(`fetch('/i/listings/${uid}',{headers:{accept:'application/json'}}).then(r=>r.json()).then(j=>({title:j.title,by:j.user&&j.user.sellerName,lic:(j.licenses||[]).map(l=>l.name).join('/'),free:j.isFree,price:j.startingPrice&&j.startingPrice.price}))`);
    if (meta.free === false || (meta.price && meta.price > 0)) { console.log('SKIP not free', uid, JSON.stringify(meta)); continue; }
    if (personal) meta.lic = 'Fab Standard License — Personal (free tier)';
    await ev(`[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Download').click()`);
    let names = [];
    for (let i = 0; i < 30 && !names.length; i++) {
      await sleep(500);
      names = await ev(String.raw`(()=>{const dlg=document.querySelector('[role=dialog]');if(!dlg)return[];const rows=[...dlg.querySelectorAll('div')].filter(d=>/\.(glb|zip|fbx|blend|obj)\b/.test(d.innerText)&&d.querySelector('button')&&d.innerText.length<200);const leaf=rows.filter(r=>!rows.some(o=>o!==r&&r.contains(o)));window.__leaf=leaf;return leaf.map(r=>(r.innerText.match(/[^\n]+\.(glb|zip|fbx|blend|obj)/)||[''])[0].trim()+'|'+(r.innerText.match(/[\d.]+ ?[KMG]B/)||[''])[0]);})()`);
    }
    const pats = rx ? [new RegExp(rx)] : [/_mid\.glb$/, /_low\.glb$/, /\.glb$/];
    let pick = -1; for (const p of pats) { pick = names.findIndex((n) => p.test(n.split('|')[0])); if (pick >= 0) break; }
    if (pick < 0) { console.log('NOFILE', uid, meta.title, '::', names.join(' ; ')); continue; }
    const fname = names[pick].split('|')[0];
    const before = new Set(fs.readdirSync(DL));
    await ev(`(()=>{const bs=window.__leaf[${pick}].querySelectorAll('button');bs[bs.length-1].click();})()`);
    let got = null;
    for (let i = 0; i < 600 && !got; i++) {
      await sleep(500);
      const now = fs.readdirSync(DL).filter((f) => !before.has(f));
      const done = now.filter((f) => !/\.(crdownload|tmp)$/.test(f));
      if (done.length && !now.some((f) => /\.crdownload$/.test(f))) got = done[0];
    }
    if (!got) { console.log('TIMEOUT', uid, meta.title, fname); continue; }
    await sleep(400);
    let out = path.join(dest, got.replace(/ \(\d+\)(?=\.)/, ''));
    const prev = credits[path.basename(out)];      // two listings can ship the same file name
    if (prev && prev.uid !== uid) out = out.replace(/(\.\w+)$/, '_' + String(meta.by || uid).toLowerCase().replace(/[^a-z0-9]+/g, '') + '$1');
    fs.copyFileSync(path.join(DL, got), out); fs.unlinkSync(path.join(DL, got));
    credits[path.basename(out)] = { uid, title: meta.title, by: meta.by, license: meta.lic };
    fs.writeFileSync(credFile, JSON.stringify(credits, null, 1));
    console.log('OK', path.basename(out), (fs.statSync(out).size / 1e6).toFixed(1) + 'MB', '|', meta.title, '|', meta.by, '|', meta.lic, '| options:', names.join(' ; '));
  } catch (e) { console.log('ERR', uid, e.message); }
}
ws.close();
