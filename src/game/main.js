// Project Deep Blue — boot, game state machine (title → boat: fishing ⇄ helm ⇄ dive), cameras, main loop.
(function () {
  'use strict';
  const DB = window.DB, T = THREE, M = DB.M, UI = DB.UI, Input = DB.Input, P = DB.params;
  const canvas = document.getElementById('view');
  // state: boot | title | boat | dive.  drive: at the helm (state stays 'boat').  dK: 0 = angler's eyes, 1 = chase camera
  const G = (DB.Game = {
    state: 'boot', time: 0, look: { yaw: 2.498, pitch: -0.17, dYaw: 0, dPitch: 0 }, under: false, trans: null, paused: false, noLock: false, flash: 0, wet: 0, damage: 0, fade: 1, chaseT: 0, fovT: 62, ms: 16, msAcc: 0, msN: 0,
    drive: false, dK: 0, dCam: { yaw: 0, pitch: 0.15, h: 0, idle: 0 }, shake: 0, ctl: { throttle: 0, steer: 0 },
  });
  let renderer, scene, camera, last = 0;
  const qH = new T.Quaternion(), qT = new T.Quaternion(), qL = new T.Quaternion(), qC = new T.Quaternion(), eu = new T.Euler(0, 0, 0, 'YXZ'), YAX = new T.Vector3(0, 1, 0), v1 = new T.Vector3(), v2 = new T.Vector3(), v3 = new T.Vector3(), m4 = new T.Matrix4();
  const TODS = ['day', 'golden', 'morning'];
  const NOINPUT = { down: () => false, pressed: () => false, mouse: () => false, mouseDown: () => false, mouseUp: () => false };

  const paint = () => new Promise((r) => requestAnimationFrame(() => r()));
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('파일을 불러오지 못했습니다: ' + src)); document.head.appendChild(s); });

  function resize() {
    const w = Math.max(2, Math.round(innerWidth * DB.Q.scale)), h = Math.max(2, Math.round(innerHeight * DB.Q.scale));
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    DB.Env.resize(w, h); DB.Post.resize(w, h);
  }

  // ------------------------------------------------------------------ boot
  async function boot() {
    UI.init();
    // heavy procedural setup is split into steps that yield to the browser so the progress bar keeps painting
    const step = async (p, text, fn) => { UI.loading(p, text); await paint(); await DB.yieldNow(); if (fn) await fn(); };
    try {
      renderer = new T.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    } catch (e) { UI.error('WebGL2를 초기화하지 못했습니다.<br>Chrome에서 하드웨어 가속이 켜져 있는지 확인해 주세요.'); return; }
    if (!renderer.capabilities.isWebGL2) { UI.error('이 게임은 WebGL2가 필요합니다. 최신 Chrome에서 실행해 주세요.'); return; }
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    DB.renderer = renderer;
    scene = DB.scene = new T.Scene();
    camera = DB.camera = new T.PerspectiveCamera(62, 1, 0.05, 30000);
    scene.add(camera);

    // asset packs listed by assets/manifest.js (written by tools/build_assets.mjs)
    const packs = window.DBA_PACKS || [{ name: 'props' }, { name: 'reef' }, { name: 'fab' }];
    for (let i = 0; i < packs.length; i++) await step(0.03 + (0.19 * i) / packs.length, `에셋 불러오는 중… (${i + 1}/${packs.length} ${packs[i].name})`, () => loadScript(`assets/${packs[i].name}.js`));
    await step(0.24, '하늘과 구름 생성 중…', () => { DB.Env.init(renderer); DB.Env.onEnvMap = (t) => { scene.environment = t; }; });
    await step(0.33, '바다 생성 중…', () => { DB.Ocean.init(renderer, DB.Env); DB.Post.init(renderer); scene.add(DB.Env.dome, DB.Ocean.group); });
    await step(0.43, '보트 건조 중…', () => { DB.Boat.init(scene, DB.Env); DB.FX.init(scene); });
    await step(0.5, '섬과 다른 배들 띄우는 중…', () => { DB.Sea.init(scene); DB.Boat.colliders = DB.Sea.colliders; DB.Crew.init(); });
    await step(0.58, '낚시 장비 준비 중…', () => { DB.Fishing.init(scene, camera); for (const k of ['marlin', 'sailfish', 'tuna', 'mahi', 'amberjack', 'seabream', 'grouper']) DB.Fish.get(k); });
    await step(0.68, '산호초와 난파선 배치 중…', () => DB.Reef.init(scene));
    await step(0.8, '수중 생물 풀어놓는 중…', () => DB.Dive.init(scene, camera));
    await step(0.87, '텍스처 디코딩 중…', () => DB.Assets.ready());
    await step(0.9, '도감 사진 촬영 중…', () => { DB.Dex.init(renderer); UI.stat(); });
    Input.init(canvas);
    addEventListener('resize', resize); resize();
    wire();
    // warm up both worlds behind the loading screen so the first dive / first fish doesn't hitch
    await step(0.94, '셰이더 컴파일 중…', async () => {
      camera.position.set(4, -8, 6); camera.quaternion.setFromEuler(eu.set(-0.2, 2, 0)); camera.updateMatrixWorld();
      setUnder(true); DB.Dive.rig.visible = true; tick(0.016); render(); await paint();
      setUnder(false); DB.Dive.rig.visible = false; tick(0.016); render();
    });
    await step(1, '준비 완료');
    G.state = 'title'; UI.setMode('title'); DB.Fishing.setActive(false); UI.loaded();
    document.getElementById('start').addEventListener('click', () => start(false));
    document.getElementById('pause').addEventListener('click', () => { DB.Audio.init(); Input.lock(); });
    canvas.addEventListener('click', () => { if ((G.state === 'boat' || G.state === 'dive') && !Input.locked && !G.noLock) Input.lock(); });
    Input.onLock = (locked) => {
      if (G.noLock) return;
      const playing = G.state === 'boat' || G.state === 'dive';
      G.paused = playing && !locked; UI.pause(G.paused); DB.Audio.suspend(G.paused);
      if (G.paused) DB.Dex.close();
    };
    document.addEventListener('visibilitychange', () => { if (document.hidden) DB.Audio.suspend(true); else if (!G.paused) DB.Audio.suspend(false); });
    last = performance.now();
    requestAnimationFrame(frame);
    if (P.has('autostart') || P.has('selftest')) start(true);
    if (P.has('selftest')) selftest().catch((e) => { console.error(e); DB.selftestResult = [{ name: 'selftest crashed', ok: false, info: String((e && e.stack) || e) }]; });
  }

  function start(noLock) {
    if (G.state !== 'title') return;
    G.noLock = !!noLock;
    DB.Audio.init(); DB.Audio.setScene('boat');
    if (!noLock) Input.lock();
    G.state = 'boat'; G.fade = 1; UI.setMode('boat'); DB.Fishing.setActive(true);
    G.look.yaw = 2.498; G.look.pitch = -0.17;
    UI.toast('좌클릭을 길게 눌렀다 놓아 캐스팅 · E 로 보트를 몰아 섬과 다른 배를 찾아가 보세요', '', 6);
  }

  function setUnder(on) {
    G.under = on; DB.Reef.setVisible(on); DB.Sea.setVisible(!on); DB.Fishing.setActive(!on && !G.drive && G.state !== 'title' && G.state !== 'boot');
    DB.Post.fx.under = on ? 1 : 0;
  }

  // ------------------------------------------------------------------ transitions
  // put the rod away unless a fish is on (true when it is safe to leave the fishing position)
  function stowRod() {
    const F = DB.Fishing;
    if (F.state === 'fight' || F.state === 'landing' || F.state === 'trophy' || F.state === 'bite') return false;
    if (F.state !== 'idle') { F.state = 'idle'; F.lurePos.copy(F.tip).y -= 0.6; F.lurePrev.copy(F.lurePos); }
    return true;
  }
  function setDrive(on) {
    const B = DB.Boat, F = DB.Fishing;
    if (G.trans || G.state !== 'boat' || on === G.drive) return;
    if (on) {
      if (!stowRod()) { UI.toast('물고기와 싸우는 중에는 자리를 뜰 수 없습니다', 'warn'); return; }
      G.drive = true; F.setActive(false); B.setMode('drive'); DB.Crew.setPost('helm'); UI.setMode('drive'); DB.Audio.play('engineStart');
      G.dCam.yaw = 0; G.dCam.pitch = 0.15; G.dCam.h = B.heading; G.dCam.idle = 0;
    } else {
      G.drive = false; B.setMode('anchor'); DB.Crew.setPost('deck'); UI.setMode('boat'); F.setActive(true);
      G.look.yaw = 2.498; G.look.pitch = -0.17;
      if (B.mode === 'coast') UI.toast('엔진을 끄고 닻을 내리는 중…', '', 2.5);
    }
  }
  function goDive() {
    const F = DB.Fishing, B = DB.Boat;
    if (G.trans || G.state !== 'boat' || G.drive) return;
    if (B.mode !== 'anchor') { UI.toast('보트가 멈춘 뒤에 다이빙할 수 있습니다', 'warn'); return; }
    if (!DB.Sea.inReef(B.group.position.x, B.group.position.z)) { UI.toast('여기는 다이빙 포인트가 아닙니다 — 미니맵의 REEF(부표)로 보트를 몰고 가세요', 'warn', 4.5); return; }
    if (!stowRod()) return;
    const chase = F.escaped && G.chaseT > 0 ? F.escaped : null; F.escaped = null; G.chaseT = 0;
    B.eyeWorld(v1);
    const over = new T.Vector3(-2.3, 1.25, 2.55).applyMatrix4(B.group.matrixWorld), into = new T.Vector3(-2.75, -0.75, 2.4).applyMatrix4(B.group.matrixWorld);
    into.y = DB.Ocean.height(into.x, into.z) + 0.2;
    G.trans = { kind: 'in', t: 0, dur: 1.0, p0: v1.clone(), p1: over, p2: into, yaw0: G.look.yaw, pitch0: G.look.pitch, chase };
    UI.prompt(''); UI.hint(''); F.setActive(false);      // put the rod down before going over the side
  }
  function enterWater(chase) {
    G.state = 'dive'; setUnder(true); DB.Dive.enter({ chase });
    G.look.yaw = G.look.yaw + DB.Boat.heading; G.look.pitch = -0.55;
    G.flash = 1; UI.setMode('dive'); DB.Audio.setScene('dive'); DB.Audio.play('dive');
    DB.Ocean.addRipple(DB.Dive.pos.x, DB.Dive.pos.z, 2);
    UI.toast(chase ? '놓친 대어를 추적하세요 — 지쳐 있을 때 작살로 마무리!' : '천천히 다가가면 물고기가 달아나지 않습니다 — 조준원이 초록색이면 발사', chase ? 'good' : '', 5);
  }
  function leaveWater(reason) {
    const n = DB.Dive.bag.length;
    DB.Dive.leave(); G.state = 'boat'; setUnder(false); DB.FX.clear();
    G.look.yaw = 2.498; G.look.pitch = -0.2; G.wet = 1; G.flash = 0.8; G.fade = reason === 'blackout' ? 1 : 0;
    UI.setMode('boat'); DB.Audio.setScene('boat'); DB.Audio.play('surface');
    if (reason === 'blackout') { UI.dropCatches(n); UI.toast(n ? `산소 고갈 — 구조되었지만 이번 다이빙의 수확 ${n}개를 잃었습니다` : '산소 고갈 — 가까스로 구조되었습니다', 'bad', 6); }
    else UI.toast(n ? `다이빙 종료 — 수확 ${n}` : '다이빙 종료', n ? 'good' : '', 4);
  }

  // ------------------------------------------------------------------ events → ui / audio
  function wire() {
    const A = DB.Audio, on = DB.on, SP = DB.Species, name = (k) => SP[k].name;
    on('cast', () => A.play('cast'));
    on('plop', () => A.play('plop', { delay: DB.Fishing.dist / 340 }));
    on('nibble', () => A.play('nibble'));
    on('bite', () => A.play('bite'));
    on('hook', () => { UI.toast('훅업! 파이팅 시작', 'good', 2.4); A.play('bite'); DB.Sea.excite(25); });
    on('splash', (d) => A.play('splash', { s: d.s, delay: Math.min(d.d / 340, 0.6) }));
    on('surge', () => UI.toast('보트를 보고 마지막으로 내달립니다!', 'warn', 2.5));
    on('missed', () => UI.toast('놓쳤습니다 — 입질이 오면 바로 챔질하세요', 'warn'));
    on('snap', () => { A.play('snap'); G.chaseT = 14; UI.toast('줄이 끊어졌습니다!', 'bad', 4); });
    on('lost', () => { A.play('lost'); UI.toast('바늘이 빠졌습니다 — 텐션을 유지하세요', 'warn', 4); });
    on('landing', () => { UI.hint(''); UI.toast('랜딩!', 'good', 2); });
    on('catch', (rec) => {
      const info = UI.addCatch(rec), sp = SP[rec.key], pts = `+${info.pts.toLocaleString()}`;
      if (rec.method === 'watch') { A.play('discover'); UI.toast(`${sp.name} 관찰 — 도감에 기록했습니다 (${pts})`, 'good', 4.5); }
      else if (rec.method === 'hand') { A.play(rec.key === 'treasure' ? 'treasure' : 'pickup'); UI.toast(rec.key === 'treasure' ? `해적의 보물상자를 열었습니다! (${pts})` : `${sp.name} ${rec.key === 'octopus' ? '포획' : '채집'}  ${rec.kg.toFixed(2)} kg (${pts})`, 'good', 3.6); }
      else {
        A.play(info.record ? 'record' : 'catch');
        if (rec.method === 'rod') { UI.showCard(rec, info); DB.Crew.cheer(7); DB.Sea.excite(14); }
        else UI.toast(`${rec.method === 'chase' ? '추적 성공! ' : ''}${sp.name} ${rec.L.toFixed(2)} m · ${rec.kg.toFixed(1)} kg  (${pts})`, 'good', 4.5);
      }
      if (info.first && rec.method !== 'rod') { UI.toast(`새로운 종 — 도감에 등록: ${sp.name}  (Tab)`, 'good', 5); if (rec.method !== 'watch') A.play('discover', { delay: 0.7 }); }
    });
    on('trophyDone', () => UI.hideCard());
    on('shoot', () => A.play('shoot')); on('thud', () => A.play('thud')); on('reload', () => A.play('reload')); on('exhale', () => A.play('exhale')); on('torch', () => A.play('click'));
    on('spearHit', (d) => { A.play('hit'); if (!d.kill) UI.toast(`${name(d.key)} 명중 — 아직 살아 있습니다`, 'warn', 2.5); });
    on('sting', () => { A.play('sting'); G.damage = 1; UI.toast('해파리에 쏘였습니다!', 'bad'); });
    on('sharkNear', () => { A.play('alarm'); UI.toast('상어가 다가옵니다 — 작살로 쫓아낼 수 있습니다', 'bad', 4.5); });
    on('sharkCharge', () => A.play('alarm'));
    on('sharkHit', (sh) => { A.play('hit'); const L = sh ? sh.L : 2.6, info = UI.addCatch({ key: 'shark', L, kg: SP.shark.wK * L * L * L, method: 'watch' }); UI.toast(`상어를 쫓아냈습니다 (+${info.pts})`, 'good'); });
    on('sharkBite', (d) => {
      A.play('bitten'); G.damage = 1; if (d.stolen) UI.dropCatches(1);
      UI.addCatch({ key: 'shark', L: d.L, kg: 0, method: 'watch' });      // you have certainly met one now
      UI.toast(d.stolen ? `상어에게 물렸습니다! ${name(d.stolen.key)}을(를) 빼앗겼습니다` : '상어에게 물렸습니다!', 'bad', 4.5);
    });
    on('blackoutStart', () => UI.toast('산소 고갈…', 'bad', 3));
    on('blackout', () => leaveWater('blackout'));
    on('escaped', () => UI.toast('놓친 대어가 깊은 바다로 사라졌습니다', 'warn'));
    on('ink', () => A.play('ink'));
    on('protected', () => UI.toast('바다거북은 보호종입니다 — 작살이 등딱지에 튕겨 나갔습니다', 'warn', 4));
    // under way
    on('slam', (k) => { A.play('slam', { s: Math.min(k, 1.3) }); G.shake = Math.max(G.shake, k); if (G.drive) G.wet = Math.max(G.wet, 0.35 + k * 0.4); });
    on('bowSplash', (k) => { A.play('spray', { s: k }); G.shake = Math.max(G.shake, k * 0.35); });
    on('bump', (k) => { A.play('bump'); G.shake = Math.max(G.shake, 0.5 + k); UI.toast('충돌! 속도를 줄이세요', 'warn', 2); });
    on('anchor', () => { if (G.state === 'boat') { A.play('anchor'); UI.toast(DB.Sea.inReef(DB.Boat.group.position.x, DB.Boat.group.position.z) ? '닻을 내렸습니다 — 다이빙 포인트입니다 (F)' : '닻을 내렸습니다', '', 3); } });
    on('landmark', (text) => { A.play('discover'); UI.toast(text, 'good', 6); });
    on('freeMouse', () => UI.toast('이 화면은 마우스 고정을 지원하지 않아 커서로 조작합니다 — 좌우 끝에 커서를 두면 계속 돌고, Esc 로 일시정지', '', 7));
  }

  // chase camera for the helm: orbits with the mouse, swings back astern when left alone, never dips into a wave
  function chaseCam(dt, pos, quat) {
    const B = DB.Boat, g = B.group.position, d = G.dCam, sp = Math.abs(B.u);
    d.idle += dt;
    if (d.idle > 2.2 && sp > 1.5) d.yaw = M.damp(d.yaw, 0, 1.6, dt);
    d.h = M.dampAngle(d.h, B.heading, 2.4, dt);
    const a = d.h + d.yaw, dist = 13 + sp * 0.3, cp = Math.cos(d.pitch), sh = G.shake + M.sat(sp / 14) * 0.12;
    v2.set(g.x - Math.sin(B.heading) * 2.2, g.y + 2.3, g.z - Math.cos(B.heading) * 2.2);      // look a little ahead of the wheel
    pos.set(v2.x + Math.sin(a) * cp * dist, v2.y + Math.sin(d.pitch) * dist + 1.0, v2.z + Math.cos(a) * cp * dist);
    pos.y = Math.max(pos.y, DB.Ocean.height(pos.x, pos.z) + 0.9);
    if (sh > 0.01) { pos.x += (Math.random() - 0.5) * sh * 0.22; pos.y += (Math.random() - 0.5) * sh * 0.3; pos.z += (Math.random() - 0.5) * sh * 0.22; }
    quat.setFromRotationMatrix(m4.lookAt(pos, v2, YAX));
  }

  // ------------------------------------------------------------------ simulation step
  function tick(dt) {
    const B = DB.Boat, F = DB.Fishing, D = DB.Dive, look = G.look, fx = DB.Post.fx;
    G.time += dt;
    look.dYaw = look.dPitch = 0;
    const playing = (Input.locked || G.noLock) && (G.state === 'boat' || G.state === 'dive') && !G.trans && dt > 0;
    // cursor play (no pointer lock): the view also keeps turning while the cursor rests near the left or right edge
    if (playing && Input.free) { const e = Math.max(Math.abs(Input.cx) - 0.8, 0) / 0.2; Input.mdx += Math.sign(Input.cx) * e * e * 700 * dt; }
    if (playing) {
      const sens = 0.0021 * (camera.fov / 62);
      if (G.drive) { G.dCam.yaw -= Input.mdx * sens; G.dCam.pitch = M.clamp(G.dCam.pitch + Input.mdy * sens, -0.04, 1.2); if (Input.mdx || Input.mdy) G.dCam.idle = 0; }
      else {
        look.dYaw = ((-Input.mdx * sens) / Math.max(dt, 0.004)) * 0.05; look.dPitch = ((-Input.mdy * sens) / Math.max(dt, 0.004)) * 0.05;
        look.yaw -= Input.mdx * sens; look.pitch = M.clamp(look.pitch - Input.mdy * sens, -1.45, 1.45);
      }
    }
    // helm
    const ctl = G.ctl; ctl.throttle = ctl.steer = 0;
    if (G.drive && playing) { ctl.throttle = (Input.down('KeyW') ? 1 : 0) - (Input.down('KeyS') ? 1 : 0); ctl.steer = (Input.down('KeyA') ? 1 : 0) - (Input.down('KeyD') ? 1 : 0); }
    B.update(dt, ctl);
    DB.Sea.update(dt, camera);
    DB.Crew.update(dt, camera, G.state === 'title');
    G.dK = M.clamp(G.dK + (G.drive ? dt : -dt) / 0.9, 0, 1);
    G.shake = Math.max(G.shake - dt * 2.2, 0);
    let zoom = false;
    if (G.state === 'title') {
      const a = G.time * 0.03 - 1.45, R = 15.5;      // start with the sun behind the camera
      camera.position.set(B.group.position.x + Math.cos(a) * R, 3.4 + Math.sin(G.time * 0.21) * 0.3, B.group.position.z + Math.sin(a) * R);
      camera.lookAt(B.group.position.x, 1.3, B.group.position.z);
      G.fade = M.damp(G.fade, 0, 1.5, dt);
    } else if (G.trans) {
      const tr = G.trans; tr.t += dt; const k = M.sat(tr.t / tr.dur);
      if (tr.kind === 'in') {       // step over the rail and drop into the sea
        const e = k * k * (3 - 2 * k), a = 1 - e;
        camera.position.set(a * a * tr.p0.x + 2 * a * e * tr.p1.x + e * e * tr.p2.x, a * a * tr.p0.y + 2 * a * e * tr.p1.y + e * e * tr.p2.y, a * a * tr.p0.z + 2 * a * e * tr.p1.z + e * e * tr.p2.z);
        qH.setFromAxisAngle(YAX, B.heading); qL.setFromEuler(eu.set(M.lerp(tr.pitch0, -1.15, e), M.lerp(tr.yaw0, tr.yaw0 + 0.5, e), 0));
        camera.quaternion.copy(qH).multiply(qL);
        if (k >= 1) { G.trans = null; enterWater(tr.chase); }
      } else if (tr.kind === 'out') {
        G.flash = Math.max(G.flash, k);
        if (k >= 1) { G.trans = null; leaveWater('board'); }
      }
    }
    if (G.state === 'boat' && !G.trans) {
      // angler's eyes on deck …
      B.eyeWorld(camera.position);
      qH.setFromAxisAngle(YAX, B.heading); qT.setFromEuler(eu.set(B.pitch * 0.25, 0, B.roll * 0.25)); qL.setFromEuler(eu.set(look.pitch, look.yaw, 0));
      camera.quaternion.copy(qH).multiply(qT).multiply(qL);
      // … blended into the chase camera while at the helm
      if (G.dK > 0) { const e = G.dK * G.dK * (3 - 2 * G.dK); chaseCam(dt, v3, qC); camera.position.lerp(v3, e); camera.quaternion.slerp(qC, e); }
      if (G.drive) {
        if (Input.pressed('KeyE')) setDrive(false);
      } else {
        zoom = Input.mouse(2);
        // the angler turns to keep facing a hooked fish that swings wide
        if ((F.state === 'fight' || F.state === 'landing') && Math.abs(F.fishOff || 0) > 0.5) look.yaw += Math.sign(F.fishOff) * Math.min(Math.abs(F.fishOff) - 0.5, 1) * 1.6 * dt;
        G.chaseT = Math.max(G.chaseT - dt, 0);
        if (Input.pressed('KeyF')) goDive();
        if (Input.pressed('KeyE')) setDrive(true);
      }
      G.fade = M.damp(G.fade, 0, 2.2, dt);
      if (Input.pressed('KeyT') && F.state !== 'trophy') {
        const n = TODS[(TODS.indexOf(DB.Env.tod) + 1) % TODS.length];
        DB.Env.setTimeOfDay(n); DB.Ocean.syncLight(); B.syncLight(); UI.toast('시간대: ' + DB.Env.TOD[n].label);
      }
    } else if (G.state === 'dive') {
      camera.position.copy(D.pos);
      camera.quaternion.setFromEuler(eu.set(look.pitch, look.yaw, M.clamp(-look.dYaw * 0.04, -0.12, 0.12)));
      zoom = Input.mouse(2);
      // F boards from anywhere: quick at the ladder, a longer ascent-and-swim fade elsewhere
      if (Input.pressed('KeyF') && !G.trans && D.blackout === 0) G.trans = { kind: 'out', t: 0, dur: D.prompt === 'board' ? 0.45 : 1.2 };
    }
    if (DB.debug.view) {      // headless inspection: DB.debug.view = { p: [x,y,z], t: [x,y,z], boat: true } looks from p to t (boat-local when boat is set)
      const dv = DB.debug.view; v1.fromArray(dv.p); v2.fromArray(dv.t);
      if (dv.boat) { v1.applyMatrix4(B.group.matrixWorld); v2.applyMatrix4(B.group.matrixWorld); }
      camera.position.copy(v1); camera.quaternion.setFromRotationMatrix(m4.lookAt(v1, v2, YAX));
    }
    camera.updateMatrixWorld();
    if (G.state === 'boat') F.update(dt, G.trans || G.drive || G.dK > 0 ? NOINPUT : Input, look);
    if (G.state === 'dive') D.update(dt, G.trans ? NOINPUT : Input, look);
    DB.FX.update(dt, camera, G.under);
    // camera optics
    const sp = Math.abs(B.u);
    G.fovT = zoom ? (G.under ? 46 : 30) : 62 + (G.under && D.sprint ? 5 : 0) + G.dK * M.sat(sp / 14) * 13;
    const fov = M.damp(camera.fov, G.fovT, 9, dt);
    if (Math.abs(fov - camera.fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    DB.Env.update(dt, camera);
    DB.Ocean.update(dt, camera, G.under);
    if (G.under) DB.Reef.update(dt, camera);
    // screen effects
    G.flash = M.damp(G.flash, 0, G.under ? 2.2 : 3.5, dt); G.wet = Math.max(G.wet - dt / 7, 0); G.damage = Math.max(G.damage - dt * 0.9, 0);
    fx.flash = G.flash; fx.wet = G.under ? 0 : G.wet; fx.damage = G.damage;
    if (G.under) {
      const low = D.o2 < 0.22 ? 1 - D.o2 / 0.22 : 0, narc = M.sat((D.depth - D.maxDepth) / 8);
      fx.exposure = 1.35 + Math.min(D.depth, 32) * 0.085;      // eyes adapt as the light fades with depth
      fx.vignette = 0.46; fx.bloom = 0.075; fx.ca = 0.007 + narc * 0.03;
      fx.dark = Math.min(low * 0.75 + (D.blackout > 0 ? D.blackout / 3 : 0), 1); fx.sat = 1.03 - narc * 0.6; fx.fade = D.blackout > 0 ? M.sat(D.blackout / 3) : 0;
    } else { fx.exposure = DB.Env.exposure; fx.vignette = 0.22; fx.bloom = 0.05; fx.ca = 0.004; fx.dark = 0; fx.sat = 1.04; fx.fade = G.fade; }
    // hud
    const bp = B.group.position;
    if (G.state === 'boat') {
      if (G.drive) UI.drive(B, B.air > 0.25 ? '점프!' : '');
      else UI.fishing(F, dt, G.chaseT > 0 && F.escaped ? `<kbd>F</kbd>다이빙해서 놓친 대어 추적! (${Math.ceil(G.chaseT)}초)` : B.mode === 'coast' ? '닻을 내리는 중…' : '', DB.Sea.inReef(bp.x, bp.z));
      UI.map({ mode: G.drive ? 'drive' : 'boat', cx: bp.x, cz: bp.z, rot: G.dK > 0.5 ? G.dCam.h + G.dCam.yaw : B.heading + look.yaw, range: G.dK > 0.5 ? 320 : 160, dt });
    } else if (G.state === 'dive') {
      UI.dive(D, camera, innerWidth, innerHeight);
      UI.map({ mode: 'dive', cx: D.pos.x, cz: D.pos.z, rot: look.yaw, range: 60, dt });
    }
    // audio
    const f = F.fish, boat = G.state === 'boat', buoy = B.buoy ? Math.hypot(B.buoy.position.x - bp.x, B.buoy.position.z - bp.z) : 1e9, Sea = DB.Sea;
    const dOf = (id) => { const p = Sea.pois.find((q) => q.id === id); return p && p.boat ? Math.hypot(p.boat.x - bp.x, p.boat.z - bp.z) : 1e9; };
    DB.Audio.update(dt, {
      reel: F.state === 'wait' && Input.mouse(0) ? 0.6 : F.state === 'fight' && Input.mouse(0) ? 1 : 0,
      out: f && f.mode === 'run' && F.state === 'fight' ? 3 + 5 * f.sp.power : F.state === 'cast' ? 6 : 0,
      tension: F.state === 'fight' ? F.tension : 0, shark: G.state === 'dive' ? D.sharkNear : 0, o2: G.state === 'dive' ? D.o2 : 1,
      engine: B.mode !== 'anchor' && G.state !== 'title' ? 1 : 0, thr: B.throttle, spd: boat ? B.speed * (B.mode === 'anchor' ? 0 : 1) : 0, air: B.air > 0.1,
      gull: boat ? Sea.nearestGull(camera.position.x, camera.position.y, camera.position.z) : 1e9, buoy, ship: dOf('ship'), trawler: dOf('trawler'), excited: Sea.excited > 0, swim: G.state === 'dive' ? D.vel.length() : 0,
    });
    Input.endFrame();
  }

  function render() {
    if (!G.under) DB.Env.renderSky();
    DB.Post.render(scene, camera, G.time);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const raw = (now - last) / 1000; last = now;
    // the field guide freezes the world while it is open (Tab toggles, arrows scroll)
    const Dex = DB.Dex, inGame = (G.state === 'boat' || G.state === 'dive') && !G.paused;
    if (inGame && !G.trans && Input.pressed('Tab') && !UI.cardOn) DB.Audio.play(Dex.toggle() ? 'dexOpen' : 'dexClose');
    if (Dex.isOpen) {
      if (Input.pressed('ArrowDown') || Input.pressed('PageDown')) Dex.scroll(320); else if (Input.pressed('ArrowUp') || Input.pressed('PageUp')) Dex.scroll(-320);
      if (Input.pressed('Escape')) Dex.close();
      Input.endFrame(); render(); return;
    }
    tick(G.paused ? 0 : Math.min(raw, 0.05)); render();
    // adaptive resolution: if the GPU can't hold ~40 fps, render fewer pixels
    G.msAcc += Math.min(raw, 0.1) * 1000; G.msN++;
    if (G.msN >= 90) {
      G.ms = G.msAcc / G.msN; G.msAcc = 0; G.msN = 0;
      G.slow = G.ms > 26 && !document.hidden && G.state !== 'title' ? (G.slow || 0) + 1 : 0;
      if (G.slow >= 2 && DB.Q.scale > 0.56) { G.slow = 0; DB.Q.scale = Math.max(DB.Q.scale * 0.86, 0.55); resize(); }
    }
  }

  // ------------------------------------------------------------------ debug hooks + self-check
  DB.debug = {
    start() { start(true); },
    cam(yawDeg, pitchDeg) { G.look.yaw = (yawDeg * Math.PI) / 180; G.look.pitch = (pitchDeg * Math.PI) / 180; },
    mouse(down, b = 0) { Input.locked = true; if (down) { Input.buttons |= 1 << b; Input.bDown |= 1 << b; } else { Input.buttons &= ~(1 << b); Input.bUp |= 1 << b; } },
    key(code, down = true) { if (down) { Input.keys.add(code); Input.hit.add(code); } else Input.keys.delete(code); },
    dive() { goDive(); },
    board() { if (G.state === 'dive') G.trans = { kind: 'out', t: 0, dur: 0.45 }; },
    drive(on = true) { setDrive(on); },
    // put the boat somewhere (anchored), optionally with a heading
    tp(x, z, h) { const B = DB.Boat; B.group.position.x = x; B.group.position.z = z; if (h !== undefined) B.heading = h; B.u = B.vs = B.yawRate = 0; if (B.mode !== 'drive') B.dropAnchor(); G.dCam.h = B.heading; },
    dex() { return DB.Dex.toggle(); },
    hook(key) { const F = DB.Fishing; if (F.state === 'idle') { F.lurePos.copy(F.tip).add(v1.set(-28, 0, 34)); F.lurePos.y = 0; } F.hook(key); },
    step(n, dt = 1 / 60) { for (let i = 0; i < n; i++) tick(dt); },
    state() { const F = DB.Fishing, D = DB.Dive, B = DB.Boat; return { state: G.state, drive: G.drive, boat: B.mode, kn: +(B.u * 1.944).toFixed(1), x: +B.group.position.x.toFixed(1), z: +B.group.position.z.toFixed(1), fish: F.state, T: +F.tension.toFixed(2), dist: +F.dist.toFixed(1), mode: F.fish && F.fish.mode, S: F.fish && +F.fish.S.toFixed(2), o2: +D.o2.toFixed(2), depth: +D.depth.toFixed(1), bag: D.bag.length, lock: D.lock && D.lock.name, pick: D.pick && D.pick.name, ms: +G.ms.toFixed(1), scale: DB.Q.scale }; },
  };

  // ?selftest — the fight under three reel policies, the spear's range, the boat under power, a speared fish, every sound
  async function selftest() {
    const F = DB.Fishing, B = DB.Boat, D = DB.Dive, res = [], check = (name, ok, info) => { res.push({ name, ok, info }); console.log(`[selftest] ${ok ? 'PASS' : 'FAIL'} ${name} — ${info}`); };
    const fight = (policy, maxT, setup) => {
      if (F.fish) F.endFight('lost'); F.state = 'idle'; UI.hideCard();
      let out = null; for (const e of ['snap', 'lost', 'landing']) DB.on(e, () => { if (!out) out = e; });
      DB.debug.hook('marlin'); if (setup) setup(F.fish);
      let t = 0;
      while (!out && t < maxT) { DB.debug.mouse(policy(F), 0); tick(1 / 60); t += 1 / 60; }
      DB.debug.mouse(false, 0);
      return { out: out || 'timeout', t: Math.round(t) };
    };
    const settle = () => { for (let i = 0; i < 900 && F.state !== 'idle'; i++) { DB.debug.mouse(i % 4 === 0, 0); tick(1 / 60); } };      // click through the trophy
    const a = fight((f) => !!f.fish && f.fish.mode !== 'run' && f.tension < 0.84, 400);
    check('smart reeling lands the marlin', a.out === 'landing', `${a.out} after ${a.t}s`);
    settle();
    // the rule itself, not a fish's mood: one long forced run with the reel held must part the line.
    // (Holding the reel through a whole real fight snaps most marlin, but roughly one in six never strings enough long runs together — measured, so not asserted.)
    const b = fight(() => true, 30, (f) => { f.mode = 'run'; f.modeT = 10; });
    check('reeling against a running fish snaps the line', b.out === 'snap', `${b.out} after ${b.t}s`); settle();
    const c = fight(() => false, 240); check('never reeling does not land the fish', c.out !== 'landing', `${c.out} after ${c.t}s`);
    let v = 27, x = 0; for (let i = 0; i < 60; i++) { v /= 1 + (0.115 * v) / 60; x += v / 60; }
    check('spear travels 9–14 m in its first second', x > 9 && x < 14, x.toFixed(1) + ' m');
    if (F.fish) F.endFight('lost'); F.state = 'idle'; UI.hideCard();
    UI.dropCatches(UI.session.length);      // test catches don't belong in the player's log

    // --- helm: top speed, steering, staying upright, stopping, not driving through rock
    const key = (code, down) => DB.debug.key(code, down), start0 = { x: B.group.position.x, z: B.group.position.z };
    setDrive(true); key('KeyW', true);
    let vmax = 0, tilt = 0, air = 0, bad = false;
    for (let i = 0; i < 60 * 25; i++) { tick(1 / 60); vmax = Math.max(vmax, B.u); tilt = Math.max(tilt, Math.abs(B.pitch), Math.abs(B.roll)); if (B.air > 0) air++; if (!isFinite(B.y + B.pitch + B.roll + B.u)) bad = true; }
    check('full throttle: 20–32 kn, hull stays upright', !bad && vmax * 1.944 > 20 && vmax * 1.944 < 32 && tilt < 0.55, `${(vmax * 1.944).toFixed(1)} kn, max tilt ${((tilt * 180) / Math.PI).toFixed(0)}°, airborne ${(air / 60).toFixed(1)} s of 25 s`);
    const h0 = B.heading; key('KeyA', true); for (let i = 0; i < 60 * 6; i++) tick(1 / 60); key('KeyA', false);
    check('helm answers: she turns to port', B.heading - h0 > 0.8, `${(((B.heading - h0) * 180) / Math.PI).toFixed(0)}° in 6 s`);
    // run straight at the island
    const I = DB.World.island; DB.debug.tp(I.x - 20, I.z - 130, Math.atan2(-20, -130)); B.u = 12;      // bows on to the rock
    let dmin = 1e9; for (let i = 0; i < 60 * 14; i++) { tick(1 / 60); for (const k of B.colliders) dmin = Math.min(dmin, Math.hypot(B.group.position.x - k.x, B.group.position.z - k.z) - k.r); }
    check('the island stops the boat', dmin > 2.9, `closest ${dmin.toFixed(1)} m outside a collider`);
    key('KeyW', false); setDrive(false);
    let ts = 0; while (B.mode !== 'anchor' && ts < 60) { tick(1 / 60); ts += 1 / 60; }
    check('engines off: she coasts to a stop and anchors', B.mode === 'anchor', `${ts.toFixed(1)} s`);
    DB.debug.tp(start0.x, start0.z, 0);
    for (let i = 0; i < 120; i++) tick(1 / 60);

    // --- spear: aim assist puts the shaft on a crossing fish 6 m away
    enterWater(null); tick(1 / 60);
    const tg = D.targets.find((t) => t.key === 'seabream');
    D.pos.set(6, -6, 6); D.vel.set(0, 0, 0); G.look.yaw = 0; G.look.pitch = 0;
    for (const t of D.targets) if (t !== tg) t.pos.set(200, -5, 200);      // nobody else in the way
    let hit = false; DB.on('spearHit', () => { hit = true; });
    for (let i = 0; i < 240 && !hit; i++) {
      if (D.spear.state === 'loaded') { tg.pos.set(6.25, -6.1, 0); tg.vel.set(0.8, 0, 0); tg.state = 'idle'; tg.timer = 9; tg.goal.set(20, -6.1, 0); tg.head = -Math.PI / 2; }
      D.vel.set(0, 0, 0); D.pos.set(6, -6, 6);
      DB.debug.mouse(i === 3, 0); if (i === 4) DB.debug.mouse(false, 0);
      tick(1 / 60);
    }
    check('spear with aim assist hits a crossing fish at 6 m', hit, hit ? 'hit' : `no hit (lock ${D.lock && D.lock.name})`);
    leaveWater('board'); UI.dropCatches(UI.session.length);
    for (const t of D.targets) t.pos.copy(t.home);

    // --- every sound renders (peak level only: nobody is listening)
    const pr = await DB.Audio.probe(), dead = pr.filter((p) => !p.ok);
    check(`all ${pr.length} sounds render non-silent`, pr.length > 30 && !dead.length, dead.length ? 'broken: ' + dead.map((p) => `${p.name}(${p.err || p.peak})`).join(', ') : `quietest ${pr.reduce((m, p) => (p.peak < m.peak ? p : m)).name}`);
    DB.selftestResult = res;
  }

  boot().catch((e) => { console.error(e); UI.error('초기화 중 오류가 발생했습니다:<br><code>' + (e && e.message ? e.message : e) + '</code>'); });
})();
