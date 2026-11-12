// Headless-Chrome driver over CDP (no deps) — how the game is checked without a person at the keyboard.
// It runs Chrome on the real GPU, so screenshots show what a player sees. Usage (steps run in order):
//   node shot.mjs "size=1600x900" "url=file:///F:/…/index.html?autostart" "w=15000" "e=DB.debug.drive(true)" "w=3000" "s=drive.jpg"
//   url= navigate · w= wait ms · e= evaluate JS (prints the value) · s= screenshot into ./shots/ · key=KeyF[:down|up] · mouse=down|up|click[:right]
// Game hooks: ?autostart, ?selftest (→ DB.selftestResult), DB.debug.{cam, key, mouse, drive, tp, dive, board, hook, dex, step, state, view}
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9400 + Math.floor(Math.random() * 400);
const steps = process.argv.slice(2);
let size = [1280, 720];
for (const s of steps) if (s.startsWith('size=')) size = s.slice(5).split('x').map(Number);
const headful = steps.includes('headful');
const shotsDir = path.join(HERE, 'shots');
fs.mkdirSync(shotsDir, { recursive: true });
const profile = path.join(os.tmpdir(), 'deepblue-headless-' + PORT);

const chrome = spawn(CHROME, [
  ...(headful ? [] : ['--headless=new']),
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${size[0]},${size[1]}`, '--hide-scrollbars', '--mute-audio',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-webgl',
  '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitPort() {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); return await r.json(); } catch (e) { await sleep(150); }
  }
  throw new Error('chrome did not start');
}

let exitCode = 0;
try {
  const list = await waitPort();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  const logs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.j(new Error(JSON.stringify(m.error))) : p.r(m.result); return; }
    if (m.method === 'Runtime.consoleAPICalled') {
      const txt = m.params.args.map((a) => a.value !== undefined ? (typeof a.value === 'object' ? JSON.stringify(a.value) : String(a.value)) : (a.description || a.type)).join(' ');
      logs.push(`[${m.params.type}] ${txt}`);
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push(`[EXCEPTION] ${d.text} ${d.exception ? (d.exception.description || '') : ''} @${d.url || ''}:${d.lineNumber}:${d.columnNumber}`);
    } else if (m.method === 'Log.entryAdded') {
      logs.push(`[log:${m.params.entry.level}] ${m.params.entry.text} ${m.params.entry.url || ''}`);
    }
  };
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pending.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false });
  const flush = () => { while (logs.length) console.log('   ' + logs.shift()); };

  for (const s of steps) {
    const eq = s.indexOf('='); const k = eq < 0 ? s : s.slice(0, eq); const v = eq < 0 ? '' : s.slice(eq + 1);
    if (k === 'url') { await send('Page.navigate', { url: v }); await sleep(300); }
    else if (k === 'w') { await sleep(Number(v)); }
    else if (k === 'e') {
      const r = await send('Runtime.evaluate', { expression: v, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) { console.log('EVAL ERROR:', r.exceptionDetails.text, r.exceptionDetails.exception && r.exceptionDetails.exception.description); exitCode = 2; }
      else console.log('=>', typeof r.result.value === 'object' ? JSON.stringify(r.result.value) : r.result.value);
    }
    else if (k === 's') {
      const jpg = /\.jpe?g$/i.test(v);
      const r = await send('Page.captureScreenshot', jpg ? { format: 'jpeg', quality: 86 } : { format: 'png' });
      const f = path.join(shotsDir, v); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('shot:', f);
    }
    else if (k === 'key') { // key=KeyF:down|up|press
      const [code, act = 'press'] = v.split(':');
      const key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code === 'Space' ? ' ' : code;
      if (act !== 'up') await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: code.startsWith('Key') ? code.charCodeAt(3) : 0 });
      if (act !== 'down') await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: code.startsWith('Key') ? code.charCodeAt(3) : 0 });
    }
    else if (k === 'mouse') { // mouse=down|up|click[:button]
      const [act, button = 'left'] = v.split(':');
      const base = { x: size[0] / 2, y: size[1] / 2, button, clickCount: 1 };
      if (act !== 'up') await send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
      if (act !== 'down') await send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
    }
    flush();
  }
  flush();
  ws.close();
} catch (e) { console.log('HARNESS ERROR', e); exitCode = 1; }
chrome.kill();
await sleep(400);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
process.exit(exitCode);
