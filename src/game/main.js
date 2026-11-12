// Project Deep Blue — boot, game state machine (title → boat: fishing ⇄ helm ⇄ dive), cameras, main loop.
(function () {
  'use strict';
  const DB = window.DB, T = THREE, M = DB.M, UI = DB.UI, Input = DB.Input, P = DB.params;
  const canvas = document.getElementById('view');
  // state: boot | title | boat | dive.  drive: at the helm (state stays 'boat').  dK: 0 = angler's eyes, 1 = chase camera
  const G = (DB.Game = {
    state: 'boot', time: 0, look: { yaw: 2.498, pitch: -0.17, dYaw: 0, dPitch: 0 }, under: false, trans: null, paused: false, noLock: false, flash: 0, wet: 0, damage: 0, fade: 1, chaseT: 0, fovT: 62, ms: 16, msAcc: 0, msN: 0,
    drive: false, dK: 0, dCam: { yaw: 0, pitch: 0.15, h: 0, idle: 0 }, shake: 0, ctl: { throttle: 0, steer: 0 }, danger: 0,
    third: false, tK: 0,      // third-person view while fishing (V), and how far the camera has moved out to it
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
    await step(0.5, '섬과 다른 배들 띄우는 중…', () => { DB.Sea.init(scene); DB.Boat.colliders = DB.Sea.colliders; DB.Crew.init(); DB.Weather.init(scene); });
    await step(0.58, '낚시 장비 준비 중…', () => { DB.Fishing.init(scene, camera); for (const k of ['marlin', 'sailfish', 'tuna', 'mahi', 'amberjack', 'seabream', 'grouper']) DB.Fish.get(k); });
    await step(0.68, '산호초와 난파선 배치 중…', () => DB.Reef.init(scene));
    await step(0.8, '수중 생물 풀어놓는 중…', () => { DB.Dive.init(scene, camera); DB.Wild.init(scene); DB.Events.init(scene); });
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
      if (DB.Events.name === 'kraken') { UI.toast('촉수가 보트를 붙들고 있습니다 — 조명탄으로 쫓아내세요', 'warn'); return; }
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
    if (DB.Events.name === 'kraken') { UI.toast('지금 물에 들어가는 건 좋은 생각이 아닙니다', 'warn'); return; }
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
    const eun = (w) => w + ((w.charCodeAt(w.length - 1) - 0xac00) % 28 ? '은' : '는');      // topic particle after a Korean word
    on('cast', (kind) => {
      A.play('cast');
      if (kind === 'perfect') UI.toast('완벽한 타이밍 — 비거리 +10%', 'good', 2);
      else if (kind === 'backlash') { A.play('snap'); UI.toast('백래시! 낚싯대를 너무 오래 당겼습니다 — 줄이 엉켰습니다', 'warn', 3.5); }
    });
    on('plop', () => A.play('plop', { delay: DB.Fishing.dist / 340 }));
    on('nibble', () => A.play('nibble'));
    on('bite', () => A.play('bite'));
    on('hook', () => { UI.toast('훅업! 파이팅 시작', 'good', 2.4); A.play('bite'); DB.Sea.excite(25); });
    on('splash', (d) => A.play('splash', { s: d.s, delay: Math.min(d.d / 340, 0.6) }));
    on('surge', () => UI.toast('보트를 보고 마지막으로 내달립니다!', 'warn', 2.5));
    on('missed', () => UI.toast('놓쳤습니다 — 확 끌고 갈 때 바로 챔질하세요 (누르고 있던 버튼은 떼었다 다시)', 'warn'));
    on('early', () => { A.play('lost'); UI.toast('너무 일찍 챔질했습니다 — 물고기가 놀라 달아났습니다', 'warn'); });
    on('lostInterest', () => UI.toast('입질이 끊겼습니다… 루어를 살짝 움직여 보세요', '', 2.6));
    on('snap', () => { A.play('snap'); G.chaseT = 14; UI.toast('줄이 끊어졌습니다!', 'bad', 4); });
    on('lost', () => { A.play('lost'); UI.toast('바늘이 빠졌습니다 — 텐션을 유지하세요', 'warn', 4); });
    on('landing', () => { UI.hint(''); UI.toast('랜딩!', 'good', 2); });
    on('catch', (rec) => {
      const info = UI.addCatch(rec), sp = SP[rec.key], pts = `+${info.pts.toLocaleString()}`;
      if (rec.method === 'watch') { A.play('discover'); UI.toast(`${sp.name} 관찰 — 도감에 기록했습니다 (${pts})`, 'good', 4.5); }
      else if (rec.method === 'hand') { A.play(rec.key === 'treasure' ? 'treasure' : 'pickup'); UI.toast(rec.map ? `지도의 보물을 파냈습니다! (${pts})` : rec.key === 'treasure' ? `해적의 보물상자를 열었습니다! (${pts})` : `${sp.name} ${rec.key === 'octopus' ? '포획' : '채집'}  ${rec.kg.toFixed(2)} kg (${pts})`, 'good', 3.6); }
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
    on('sharkNear', (sh) => { A.play('alarm'); UI.toast(sh && sh.big ? '백상아리가 다가옵니다 — 작살 두 발을 맞혀야 물러납니다' : '상어가 다가옵니다 — 작살로 쫓아낼 수 있습니다', 'bad', 4.5); });
    on('sharkCharge', () => A.play('alarm'));
    on('sharkFlinch', () => { A.play('hit'); UI.toast('백상아리가 움찔했습니다 — 한 발 더!', 'warn', 3); });
    on('sharkHit', (sh) => { A.play('hit'); const key = sh ? sh.key : 'shark', L = sh ? sh.L : 2.6, info = UI.addCatch({ key, L, kg: SP[key].wK * L * L * L, method: 'watch' }); UI.toast(`${name(key)}를 쫓아냈습니다 (+${info.pts})`, 'good'); });
    on('sharkBite', (d) => {
      A.play('bitten'); G.damage = 1; if (d.stolen) UI.dropCatches(1);
      UI.addCatch({ key: d.key, L: d.L, kg: 0, method: 'watch' });      // you have certainly met one now
      UI.toast(d.stolen ? `${name(d.key)}에게 물렸습니다! ${name(d.stolen.key)}을(를) 빼앗겼습니다` : `${name(d.key)}에게 물렸습니다!`, 'bad', 4.5);
    });
    on('blackoutStart', () => UI.toast('산소 고갈…', 'bad', 3));
    on('blackout', () => leaveWater('blackout'));
    on('escaped', () => UI.toast('놓친 대어가 깊은 바다로 사라졌습니다', 'warn'));
    on('ink', () => A.play('ink'));
    on('protected', (key) => UI.toast(key === 'turtle' ? '바다거북은 보호종입니다 — 작살이 등딱지에 튕겨 나갔습니다' : `${eun(name(key))} 보호종입니다 — 작살을 거뒀습니다`, 'warn', 4));
    // events at sea
    on('event', (d) => {
      const k = d.name + ':' + d.phase;
      if (k === 'bottle:start') { A.play('discover'); UI.toast('물 위에 유리병이 떠다닙니다 — E 로 보트를 몰아 가까이 가 보세요 (미니맵의 "병")', '', 7); }
      else if (k === 'bottle:got') { A.play('treasure'); UI.toast('병 속에 보물 지도가 들어 있습니다! 미니맵의 ✕ 지점으로 가서 다이빙하세요', 'good', 8); }
      else if (k === 'bottle:lost') UI.toast('유리병이 파도에 떠내려갔습니다', '', 3);
      else if (k === 'ghost:start') { A.play('ghost'); UI.toast('갑자기 안개가 끼고 공기가 차가워집니다…', 'warn', 6); }
      else if (k === 'ghost:bell') { A.play('bell', { d: d.d * 0.5 }); A.play('creak', { d: d.d * 0.4 }); }
      else if (k === 'serpent:start') UI.toast('먼바다가 끓어오릅니다 — 무언가 올라옵니다', 'warn', 5);
      else if (k === 'serpent:roar') A.play('serpent', { d: d.d, delay: d.d / 340 });
      // pirates
      else if (k === 'raid:start') { A.play('horn', { d: 60 }); UI.toast('붉은 돛의 해적선이 쫓아옵니다! E 로 엔진을 켜고 달아나세요 — 320 m 이상 벌리면 포기합니다', 'bad', 8); }
      else if (k === 'raid:fire') A.play('cannon', { d: d.d, delay: d.d / 340 });
      else if (k === 'raid:fall') {
        const m = d.miss; A.play('splash', { s: M.clamp(1.6 - m / 40, 0.2, 1.5), delay: Math.min(m / 340, 0.3) });
        if (m < 4.5) { G.shake = 1.3; G.wet = 1; G.damage = 0.7; A.play('bump'); UI.bonus(-300); UI.toast('피격! 포탄이 선체를 스쳤습니다 (−300점)', 'bad', 3.5); }
        else if (m < 16) { G.shake = Math.max(G.shake, 0.6); G.wet = Math.max(G.wet, 0.6); UI.toast('포탄이 바로 옆에 떨어졌습니다!', 'warn', 2); }
      }
      else if (k === 'raid:escaped') { const pts = d.hits ? 800 : 1500; A.play('record'); UI.bonus(pts); UI.toast(`해적선을 따돌렸습니다! (+${pts.toLocaleString()}점${d.hits ? '' : ' · 무피격'})`, 'good', 6); }
      else if (k === 'raid:gaveup') { UI.bonus(500); UI.toast('해적선이 추격을 포기하고 돌아섭니다 (+500점)', 'good', 5); }
      // the kraken
      else if (k === 'kraken:start') { A.play('kraken'); UI.cross(true); UI.toast('보트 밑으로 거대한 그림자가 지나갑니다… 조명탄 권총을 꺼냈습니다 (좌클릭 발사)', 'bad', 7); }
      else if (k === 'kraken:windup') A.play('kraken');
      else if (k === 'kraken:fire') A.play('flare');
      else if (k === 'kraken:burn') { A.play('hit'); UI.toast(d.left ? `촉수가 불에 데어 가라앉습니다 — 남은 촉수 ${d.left}` : '마지막 촉수까지 쫓아냈습니다!', 'good', 2.5); }
      else if (k === 'kraken:slam') { G.shake = 1.4; G.wet = 1; G.damage = 0.6; A.play('slam', { s: 1.3 }); A.play('splash', { s: 1.2 }); UI.bonus(-200); UI.toast(`촉수가 보트를 내리쳤습니다! (${d.hits}/5 · −200점)`, 'bad', 3); }
      else if (k === 'kraken:beaten') { const pts = 2500 - d.hits * 300; A.play('record'); UI.bonus(pts); UI.toast(`크라켄을 물리쳤습니다! (+${pts.toLocaleString()}점)`, 'good', 7); }
      else if (k === 'kraken:robbed') { UI.bonus(-1000); UI.toast('보트가 버티지 못했습니다 — 크라켄이 전리품을 쓸어 가며 가라앉습니다 (−1,000점)', 'bad', 7); }
      else if (k === 'kraken:end') { UI.cross(G.state === 'dive'); if (G.state === 'boat' && !G.drive) DB.Fishing.setActive(true); }
    });
    // weather
    on('weather', (s) => {
      if (s === 'build') UI.toast('수평선에서 먹구름이 몰려옵니다 — 폭풍이 다가옵니다', 'warn', 6);
      else if (s === 'storm') UI.toast('폭풍 한가운데입니다 — 이런 날에만 무는 대물이 있습니다 (황새치 · GT · 돗돔)', 'bad', 7);
      else if (s === 'clearing') UI.toast('비가 잦아들고 구름이 걷히기 시작합니다', '', 5);
      else UI.toast('폭풍이 지나갔습니다', 'good', 4);
    });
    on('thunder', (d) => { A.play('thunder', { d: d.d, delay: d.d / 340 }); if (d.d < 420) G.shake = Math.max(G.shake, 0.25); });
    // the big ones passing through
    on('wildBlow', (d) => {
      if (d.under) { if (d.first) A.play('whale'); return; }
      A.play('spray', { s: M.clamp(1.1 - d.d / 110, 0.05, 0.8) });
      if (d.first) UI.toast(d.key === 'orca' ? '물 위로 검은 등지느러미가 솟습니다 — 범고래 무리!' : '멀리서 물기둥이 솟습니다 — 고래입니다!', 'good', 5);
    });
    on('breach', (d) => {
      if (d.under) { if (d.phase === 'in') A.play('thud'); return; }
      const k = M.clamp(1.25 - d.d / 90, 0.15, 1);
      if (d.phase === 'out') { A.play('splash', { s: 1.4 * k, delay: Math.min(d.d / 340, 0.6) }); UI.toast('혹등고래가 수면 위로 솟구칩니다!', 'good', 5); }
      else { A.play('slam', { s: 1.3 * k }); A.play('spray', { s: k }); G.shake = Math.max(G.shake, 0.5 * k); }
    });
    // under way
    on('slam', (k) => { A.play('slam', { s: Math.min(k, 1.3) }); G.shake = Math.max(G.shake, k); if (G.drive) G.wet = Math.max(G.wet, 0.35 + k * 0.4); });
    on('bowSplash', (k) => { A.play('spray', { s: k }); G.shake = Math.max(G.shake, k * 0.35); });
    on('bump', (k) => { A.play('bump'); G.shake = Math.max(G.shake, 0.5 + k); UI.toast('충돌! 속도를 줄이세요', 'warn', 2); });
    on('anchor', () => { if (G.state === 'boat') { A.play('anchor'); UI.toast(DB.Sea.inReef(DB.Boat.group.position.x, DB.Boat.group.position.z) ? '닻을 내렸습니다 — 다이빙 포인트입니다 (F)' : '닻을 내렸습니다', '', 3); } });
    on('landmark', (text) => { A.play('discover'); UI.toast(text, 'good', 6); });
    on('freeMouse', () => UI.toast('이 화면은 마우스 고정을 지원하지 않아 커서로 조작합니다 — 좌우 끝에 커서를 두면 계속 돌고, Esc 로 일시정지', '', 7));
  }

  const _crew = { show: false, yaw: 0, pitch: 0, rod: 0 };
  // keep the over-the-shoulder camera on the near side of the boat's structure: cast from her head toward where the camera wants to be
  let boatMeshes = null; const ray = new T.Raycaster();
  // (the allowed share of the way is eased: in quickly when something is in the way, out slowly, so a rocking boat does not make the camera hop)
  let clipK = 1;
  function shoulderClip(head, pos, dt) {
    if (!boatMeshes) { boatMeshes = []; DB.Boat.group.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh) boatMeshes.push(o); }); }
    const d = v1.subVectors(pos, head), len = d.length(); if (len < 0.1) return;
    ray.set(head, d.multiplyScalar(1 / len)); ray.far = len + 0.25; ray.near = 0.3;
    const hit = ray.intersectObjects(boatMeshes, false)[0], want = hit ? Math.max(hit.distance - 0.3, 0.35) / len : 1;
    clipK = Math.min(M.damp(clipK, want, want < clipK ? 14 : 2.5, dt), 1);
    pos.copy(head).addScaledVector(ray.ray.direction, len * clipK);
  }

  // what the events need to know about the moment (calm = no fish on the line, so nothing else is asking for attention)
  const _ev = {};
  function evCtx() {
    const F = DB.Fishing;
    _ev.camera = camera; _ev.boat = DB.Boat; _ev.under = G.under; _ev.drive = G.drive;
    _ev.inp = (Input.locked || G.noLock) && G.state === 'boat' && !G.trans ? Input : NOINPUT;
    _ev.playing = (G.state === 'boat' || G.state === 'dive') && !G.trans; _ev.calm = F.state === 'idle' || F.state === 'wait' || F.state === 'charge' || F.state === 'cast';
    return _ev;
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
        look.yaw -= Input.mdx * sens;
        // while a fish is on, moving the mouse up and down works the rod instead of the view (which settles on the horizon)
        if (G.state === 'boat' && F.state === 'fight') look.pitch = M.damp(look.pitch, -0.12, 2.5, dt); else look.pitch = M.clamp(look.pitch - Input.mdy * sens, -1.45, 1.45);
      }
    }
    // helm
    const ctl = G.ctl; ctl.throttle = ctl.steer = 0;
    if (G.drive && playing) { ctl.throttle = (Input.down('KeyW') ? 1 : 0) - (Input.down('KeyS') ? 1 : 0); ctl.steer = (Input.down('KeyA') ? 1 : 0) - (Input.down('KeyD') ? 1 : 0); }
    B.update(dt, ctl);
    DB.Sea.update(dt, camera);
    G.dK = M.clamp(G.dK + (G.drive ? dt : -dt) / 0.9, 0, 1);
    G.tK = M.clamp(G.tK + (G.third && G.state === 'boat' && !G.drive ? dt : -dt) / 0.35, 0, 1);
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
      F.eye.position.copy(camera.position); F.eye.quaternion.copy(camera.quaternion); F.eye.updateMatrixWorld(true);      // the rod hangs from here whatever the camera does next
      // … or over her shoulder (V): back and up to the right of where she stands, looking where she looks, and never through the cabin
      if (G.tK > 0) {
        const e = G.tK * G.tK * (3 - 2 * G.tK); v1.set(0, 0, -1).applyQuaternion(camera.quaternion);
        const hl = Math.hypot(v1.x, v1.z) || 1, fx = v1.x / hl, fz = v1.z / hl;
        v2.copy(camera.position).addScaledVector(v1, 7);      // what she is looking at
        v3.set(camera.position.x - fx * 2.7 - fz * 1.0, camera.position.y + 0.45 - v1.y * 0.8, camera.position.z - fz * 2.7 + fx * 1.0);
        v3.y = Math.max(v3.y, DB.Ocean.height(v3.x, v3.z) + 0.5);
        shoulderClip(camera.position, v3, dt);
        camera.position.lerp(v3, e); camera.quaternion.slerp(qC.setFromRotationMatrix(m4.lookAt(v3, v2, YAX)), e);
      }
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
        if (Input.pressed('KeyV')) { G.third = !G.third; UI.toast(G.third ? '3인칭 시점 — V 로 돌아가기' : '1인칭 시점', '', 2); }
      }
      G.fade = M.damp(G.fade, 0, 2.2, dt);
      if (Input.pressed('KeyR')) DB.Weather.toggle();
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
    DB.Wild.update(dt, camera, G.under, (G.state === 'boat' || G.state === 'dive') && !G.trans);
    DB.Events.update(dt, evCtx());
    if (G.state === 'boat') F.update(dt, G.trans || G.drive || G.dK > 0 ? NOINPUT : Input, look);
    if (G.state === 'dive') D.update(dt, G.trans ? NOINPUT : Input, look);
    // the skipper is the player: seen at the wheel, in the third-person view, and whenever a debug view looks at the boat from outside
    const out = G.tK > 0.02 || !!DB.debug.view;
    F.showArms(!out);
    _crew.show = G.state === 'boat' && (G.dK > 0.12 || out); _crew.yaw = look.yaw; _crew.pitch = look.pitch; _crew.rod = out && F.active && F.state !== 'trophy' ? 1 : 0;      // (with a fish aboard she lets go of the rod and dances)
    DB.Crew.update(dt, camera, G.state === 'title', _crew);
    DB.FX.update(dt, camera, G.under);
    // camera optics
    const sp = Math.abs(B.u);
    G.fovT = zoom ? (G.under ? 46 : 30) : 62 + (G.under && D.sprint ? 5 : 0) + G.dK * M.sat(sp / 14) * 13;
    const fov = M.damp(camera.fov, G.fovT, 9, dt);
    if (Math.abs(fov - camera.fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    const Wx = DB.Weather; Wx.update(dt, camera, G.under, (G.state === 'boat' || G.state === 'dive') && !G.trans && dt > 0);
    DB.Env.update(dt, camera);
    DB.Ocean.update(dt, camera, G.under);
    if (G.under) DB.Reef.update(dt, camera);
    // screen effects
    G.flash = M.damp(G.flash, 0, G.under ? 2.2 : 3.5, dt); G.wet = Math.max(G.wet - dt / 7, 0); G.damage = Math.max(G.damage - dt * 0.9, 0);
    if (G.state !== 'title') G.wet = Math.max(G.wet, Wx.rain * 0.5);      // rain keeps the lens beaded
    fx.flash = G.flash; fx.wet = G.under ? 0 : G.wet; fx.damage = G.damage;
    // red at the edges while something dangerous is close; it throbs, faster once a shark commits
    G.danger = M.damp(G.danger, G.state === 'dive' ? D.danger : 0, 3, dt);
    fx.danger = G.danger * (0.8 + 0.2 * Math.sin(G.time * (D.danger >= 1 ? 13 : 5)));
    if (G.under) {
      const low = D.o2 < 0.22 ? 1 - D.o2 / 0.22 : 0, narc = M.sat((D.depth - D.maxDepth) / 8);
      fx.exposure = (1.35 + Math.min(D.depth, 32) * 0.085) * (1 + 0.7 * Wx.k) * (1 + 1.3 * Wx.flash);      // eyes adapt as the light fades with depth (and under a storm)
      fx.vignette = 0.46; fx.bloom = 0.075; fx.ca = 0.007 + narc * 0.03;
      fx.dark = Math.min(low * 0.75 + (D.blackout > 0 ? D.blackout / 3 : 0), 1); fx.sat = 1.03 - narc * 0.6; fx.fade = D.blackout > 0 ? M.sat(D.blackout / 3) : 0;
    } else { fx.exposure = DB.Env.exposure * (1 + 0.7 * Wx.k) * (1 + 1.3 * Wx.flash); fx.vignette = 0.22 + 0.1 * Wx.k; fx.bloom = 0.05; fx.ca = 0.004; fx.dark = 0; fx.sat = 1.04 - 0.22 * Wx.k; fx.fade = G.fade; }
    // hud
    const bp = B.group.position;
    if (G.state === 'boat') {
      if (G.drive) UI.drive(B, B.air > 0.25 ? '점프!' : '');
      else UI.fishing(F, dt, DB.Events.name === 'kraken' ? '<kbd>좌클릭</kbd>조명탄 발사 — 몸을 젖히는 촉수를 내려치기 전에 맞히세요' : G.chaseT > 0 && F.escaped ? `<kbd>F</kbd>다이빙해서 놓친 대어 추적! (${Math.ceil(G.chaseT)}초)` : B.mode === 'coast' ? '닻을 내리는 중…' : '', DB.Sea.inReef(bp.x, bp.z));
      UI.map({ mode: G.drive ? 'drive' : 'boat', cx: bp.x, cz: bp.z, rot: G.dK > 0.5 ? G.dCam.h + G.dCam.yaw : B.heading + look.yaw, range: G.dK > 0.5 ? 320 : 160, dt });
    } else if (G.state === 'dive') {
      UI.dive(D, camera, innerWidth, innerHeight);
      UI.map({ mode: 'dive', cx: D.pos.x, cz: D.pos.z, rot: look.yaw, range: 60, dt });
    }
    UI.eventPin(G.state === 'boat' || G.state === 'dive' ? DB.Events.pin : null, camera, innerWidth, innerHeight);
    // audio
    const f = F.fish, boat = G.state === 'boat', buoy = B.buoy ? Math.hypot(B.buoy.position.x - bp.x, B.buoy.position.z - bp.z) : 1e9, Sea = DB.Sea;
    const dOf = (id) => { const p = Sea.pois.find((q) => q.id === id); return p && p.boat ? Math.hypot(p.boat.x - bp.x, p.boat.z - bp.z) : 1e9; };
    DB.Audio.update(dt, {
      reel: F.state === 'wait' && Input.mouse(0) ? 0.6 : F.state === 'fight' && Input.mouse(0) ? 1 : 0,
      out: f && f.mode === 'run' && F.state === 'fight' ? 3 + 5 * f.sp.power : F.state === 'cast' ? 6 : 0,
      tension: F.state === 'fight' ? F.tension : 0, shark: G.state === 'dive' ? D.sharkNear : 0, o2: G.state === 'dive' ? D.o2 : 1, rain: Wx.rain, storm: Wx.k,
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
    storm(k = 1) { DB.Weather.set(k); return DB.Weather.state; },
    event(name) { return DB.Events.start(name, evCtx()); },      // 'bottle' | 'ghost' | 'serpent' … right now      // weather straight to a strength: 1 = full storm, 0 = clear
    wild(key) { return !!DB.Wild.start(key, camera, G.under); },      // send the orcas ('orca') or the sperm whale ('spermWhale') past right now
    hook(key) { const F = DB.Fishing; if (F.state === 'idle') { F.lurePos.copy(F.tip).add(v1.set(-28, 0, 34)); F.lurePos.y = 0; } F.hook(key); },
    step(n, dt = 1 / 60) { for (let i = 0; i < n; i++) tick(dt); },
    state() { const F = DB.Fishing, D = DB.Dive, B = DB.Boat; return { state: G.state, drive: G.drive, boat: B.mode, kn: +(B.u * 1.944).toFixed(1), x: +B.group.position.x.toFixed(1), z: +B.group.position.z.toFixed(1), fish: F.state, T: +F.tension.toFixed(2), dist: +F.dist.toFixed(1), mode: F.fish && F.fish.mode, S: F.fish && +F.fish.S.toFixed(2), o2: +D.o2.toFixed(2), depth: +D.depth.toFixed(1), bag: D.bag.length, lock: D.lock && D.lock.name, pick: D.pick && D.pick.name, ms: +G.ms.toFixed(1), scale: DB.Q.scale }; },
  };

  // ?selftest — the cast, the bite, the fight and the rod work, the spear, the boat under power, the animals, a storm, every sound
  async function selftest() {
    DB.Weather.auto = false; DB.Events.auto = false;      // fair weather and a quiet sea for the checks: the storm and the events have their own, below
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
    // the scripted angler works the rod through F.rodT (headless, there is no mouse to move): haul it up, reel it back down, and stand firm through a run
    const pump = (f) => {
      const fsh = f.fish; if (!fsh) return false;
      if (fsh.mode === 'run' || fsh.jump) { f.rodT = 0.65; return false; }
      if (f.t % 1.5 < 0.6) { f.rodT = 0.92; return false; }
      f.rodT = 0.3; return f.tension < 0.84;
    };
    const crankOnly = (f) => !!f.fish && f.fish.mode !== 'run' && f.tension < 0.84;
    const a = fight(pump, 400);
    check('pumping lands the marlin', a.out === 'landing', `${a.out} after ${a.t}s`);
    settle();
    // rod work, measured on a fish held in one mood: line gained in 12 s by pumping against cranking with the rod still …
    const drill = (policy, mode, secs, each) => {
      if (F.fish) F.endFight('lost'); F.state = 'idle'; UI.hideCard(); DB.debug.hook('marlin');
      const f = F.fish; f.D = 60; let peak = 0;
      for (let i = 0; i < secs * 60 && F.fish === f && F.state === 'fight'; i++) { f.mode = mode; f.modeT = 9; f.S = 0.9; f.jumped = true; if (each) each(i / 60); DB.debug.mouse(policy(F), 0); tick(1 / 60); if (i > 150) peak = Math.max(peak, F.tension); }
      DB.debug.mouse(false, 0); return { gain: 60 - f.D, peak, f };
    };
    const gCrank = drill(crankOnly, 'fight', 12).gain, gPump = drill(pump, 'fight', 12).gain;
    check('pumping gains line much faster than cranking alone', gPump > 8 && gPump > gCrank * 1.6, `pumping ${gPump.toFixed(1)} m, cranking ${gCrank.toFixed(1)} m in 12 s`);
    // … and what one running fish puts on the line with the rod pointed at it, then with the rod raised
    let pkLow = 0, pkUp = 0;
    drill(() => false, 'run', 12, (t) => { F.rodT = t < 6 ? 0.04 : 0.65; if (t > 3 && t < 6) pkLow = Math.max(pkLow, F.tension); if (t > 9) pkUp = Math.max(pkUp, F.tension); });
    check('a raised rod cushions the run', pkLow > pkUp + 0.08, `tension ${pkLow.toFixed(2)} with the rod flat, ${pkUp.toFixed(2)} raised`);
    if (F.fish) F.endFight('lost'); F.state = 'idle'; UI.hideCard();
    // --- the cast: let go at full load for the longest throw, hold on too long for a backlash
    let castKind = ''; DB.on('cast', (k) => { castKind = k; });
    const cast = (release) => {
      F.state = 'idle'; DB.debug.mouse(true, 0);
      for (let i = 0; i < 300 && !(F.state === 'charge' && F.power >= release); i++) tick(1 / 60);
      DB.debug.mouse(false, 0);
      for (let i = 0; i < 600 && F.state !== 'wait' && F.state !== 'tangle'; i++) tick(1 / 60);
      const r = { kind: castKind, dist: F.dist, state: F.state, at: F.lurePos.clone() };
      F.state = 'idle'; F.lurePos.copy(F.tip).y -= 0.5; F.lurePrev.copy(F.lurePos); return r;
    };
    const cHalf = cast(0.5), cFull = cast(0.96), cOver = cast(1.1);
    check('cast: full load flies furthest, overload is a backlash', cHalf.kind === 'ok' && cFull.kind === 'perfect' && cFull.dist > cHalf.dist * 1.25 && cOver.kind === 'backlash' && cOver.state === 'tangle' && cOver.dist < cHalf.dist,
      `half ${cHalf.dist.toFixed(0)} m (${cHalf.kind}), full ${cFull.dist.toFixed(0)} m (${cFull.kind}), overloaded ${cOver.dist.toFixed(0)} m (${cOver.kind})`);
    // the rule itself, not a fish's mood: one long forced run with the reel held must part the line.
    // (Holding the reel through a whole real fight snaps most marlin, but roughly one in six never strings enough long runs together — measured, so not asserted.)
    const b = fight(() => true, 30, (f) => { f.mode = 'run'; f.modeT = 10; });
    check('reeling against a running fish snaps the line', b.out === 'snap', `${b.out} after ${b.t}s`); settle();
    const c = fight(() => false, 240); check('never reeling does not land the fish', c.out !== 'landing', `${c.out} after ${c.t}s`);
    let v = 27, x = 0; for (let i = 0; i < 60; i++) { v /= 1 + (0.115 * v) / 60; x += v / 60; }
    check('spear travels 9–14 m in its first second', x > 9 && x < 14, x.toFixed(1) + ' m');
    if (F.fish) F.endFight('lost'); F.state = 'idle'; UI.hideCard();
    UI.dropCatches(UI.session.length);      // test catches don't belong in the player's log

    // --- the third-person view (V): the camera stands back, she appears with her hands on the rod, and a cast still goes where she looks
    {
      const C = DB.Crew, gap = () => camera.position.distanceTo(F.eye.position);
      G.third = true; for (let i = 0; i < 60; i++) tick(1 / 60);
      const back = gap(), shown = C.ch.group.visible, armsOff = !F.armL.group.visible;
      let reachL = 9, reachR = 9;
      if (C.ch) { C.b.LeftHand.getWorldPosition(v1); reachL = v1.distanceTo(F.gripWorld(0, v2)); C.b.RightHand.getWorldPosition(v1); reachR = v1.distanceTo(F.gripWorld(1, v2)); }
      const c3 = cast(0.96); v1.set(0, 0, -1).applyQuaternion(F.eye.quaternion); v2.copy(F.lurePos);
      const land = Math.atan2(c3.at.x - F.eye.position.x, c3.at.z - F.eye.position.z), aimed = Math.atan2(v1.x, v1.z);
      G.third = false; for (let i = 0; i < 60; i++) tick(1 / 60);
      check('third-person view: camera behind her, hands on the rod, cast goes where she looks', back > 1.2 && shown && armsOff && reachL < 0.15 && reachR < 0.15 && Math.abs(M.wrapPi(land - aimed)) < 0.05 && gap() < 0.01 && !C.ch.group.visible && F.armL.group.visible,
        `camera ${back.toFixed(1)} m back, hands ${(reachL * 100).toFixed(0)} / ${(reachR * 100).toFixed(0)} cm off the grips, cast ${((M.wrapPi(land - aimed) * 180) / Math.PI).toFixed(1)}° off her line of sight; back in first person ${gap().toFixed(3)} m`);
    }
    // --- the bite: nibbles first, a fresh strike on the run hooks, holding the button or striking early does not
    const ev = {}; for (const e of ['nibble', 'bite', 'early', 'hook', 'lostInterest']) DB.on(e, () => { ev[e] = (ev[e] || 0) + 1; });
    const waitFor = (policy, maxT) => {
      for (const k in ev) ev[k] = 0;
      F.state = 'wait'; F.count = 5; F.tease = null; F.holdT = 0; F.biteT = 0.2; F.lurePos.copy(F.tip).add(v1.set(-40, 0, 50)); F.lurePos.y = 0;
      let t = 0, prev = false;
      while (t < maxT && F.state !== 'fight' && F.state !== 'idle') { const down = policy(t); if (down && !prev) DB.debug.mouse(true, 0); else if (!down && prev) DB.debug.mouse(false, 0); prev = down; tick(1 / 60); t += 1 / 60; }
      DB.debug.mouse(false, 0); const hooked = F.state === 'fight';
      if (F.fish) F.endFight('lost'); F.state = 'idle'; UI.hideCard(); return hooked;
    };
    let armed = false;      // strike once, a beat after the run starts
    const good = waitFor((t) => { if (ev.bite && !armed) armed = t; return armed && t - armed > 0.15 && t - armed < 0.25; }, 40);
    check('a quick strike on the run hooks the fish', good && ev.nibble > 0, `hooked ${good}, nibbles before it ${ev.nibble}`);
    const held = waitFor(() => true, 14);
    check('holding the reel down the whole time never hooks', !held, `hooked ${held}`);
    const early = waitFor(() => ev.nibble > 0 && !ev.early, 20);
    check('striking at a nibble spooks the fish', !early && ev.early > 0, `hooked ${early}, early strikes ${ev.early || 0}`);
    UI.dropCatches(UI.session.length);

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
    for (const t of D.targets) t.pos.copy(t.home);

    // --- danger: the mask edges redden as a shark closes, and clear again
    const sh = D.sharks[0], hold = (n, fn) => { for (let i = 0; i < n; i++) { D.pos.set(6, -6, 6); D.vel.set(0, 0, 0); D.o2 = 1; fn(); tick(1 / 60); } };
    for (const j of D.jellies) j.pos.x += 500;      // a jellyfish drifting by would redden the mask too
    hold(60, () => { sh.state = 'approach'; sh.timer = 20; sh.orbit = 6; sh.pos.set(12, -6, 6); });      // 6 m off
    const dApp = D.danger, fxApp = DB.Post.fx.danger;
    hold(5, () => { sh.state = 'charge'; sh.timer = 4; sh.pos.set(40, -6, 6); });
    const dChg = D.danger;
    hold(240, () => { for (const o of D.sharks) { o.state = 'patrol'; o.timer = 99; } });
    for (const j of D.jellies) j.pos.x -= 500;
    check('red vignette: rises with a circling shark, full on a charge, clears after', dApp > 0.3 && dApp < 1 && fxApp > 0.15 && dChg === 1 && DB.Post.fx.danger < 0.03, `circling ${dApp.toFixed(2)} (screen ${fxApp.toFixed(2)}), charge ${dChg}, after ${DB.Post.fx.danger.toFixed(3)}`);

    // --- crabs: still for a slow hand, off sideways when rushed
    const crab = D.crabs[0];
    if (crab) {
      const near = (vx) => { for (let i = 0; i < 20; i++) { D.pos.set(crab.pos.x - 1.5, crab.pos.y + 0.6, crab.pos.z); D.vel.set(vx, 0, 0); tick(1 / 60); } };
      near(0); const still = crab.run <= 0, x0 = crab.pos.x; near(2.4);
      check('crab holds for a slow approach and runs from a rush', still && crab.run > 0 && Math.abs(crab.pos.x - x0) + Math.abs(crab.pos.z - crab.home.z) > 0.1, `still ${still}, ran ${Math.hypot(crab.pos.x - x0, crab.pos.z - crab.home.z).toFixed(2)} m`);
    }
    // --- the whale shark is solid: you cannot swim through it
    const ws = D.meets.find((m) => m.key === 'whaleShark');
    if (ws) {
      D.pos.copy(ws.pos); D.vel.set(0, 0, 0); tick(1 / 60);
      const gap = D.pos.distanceTo(ws.pos);
      check('whale shark is solid', gap > ws.L * 0.05 && gap < 3, `pushed ${gap.toFixed(2)} m out of a ${ws.L.toFixed(1)} m body`);
    }
    leaveWater('board'); UI.dropCatches(UI.session.length);

    // --- the orca pod passes the boat: close but clear of the hull, blows, and is logged once it is looked at
    let blows = 0, logged = '', dWild = 1e9; DB.on('wildBlow', () => blows++); DB.on('catch', (r) => { if (r.method === 'watch') logged = r.key; });
    tick(1 / 60);      // back on deck first: the pass is laid out around the camera
    if (DB.debug.wild('orca')) {
      for (let i = 0; i < 60 * 90 && DB.Wild.pass; i++) {
        const an = DB.Wild.pass.g.list[0].pos; DB.debug.view = { p: [B.group.position.x, 2.2, B.group.position.z], t: [an.x, an.y, an.z] };
        tick(1 / 60); if (DB.Wild.pass) dWild = Math.min(dWild, DB.Wild.pass.near);
      }
      DB.debug.view = null;
      check('orca pod passes the boat and enters the field guide', logged === 'orca' && blows >= 3 && dWild > 12 && dWild < 60 && !DB.Wild.pass, `logged ${logged || 'nothing'}, ${blows} blows, closest ${dWild.toFixed(0)} m`);
    }
    // --- the humpback breaches at the closest point of its pass: clear of the water, and back in with a crash
    const brs = []; let apex = -9; DB.on('breach', (d) => brs.push(d.phase));
    if (DB.debug.wild('humpback')) {
      for (let i = 0; i < 60 * 130 && DB.Wild.pass; i++) {
        const an = DB.Wild.pass.g.list[0]; DB.debug.view = { p: [B.group.position.x, 2.2, B.group.position.z], t: [an.pos.x, an.pos.y, an.pos.z] };
        tick(1 / 60); apex = Math.max(apex, an.pos.y);
      }
      DB.debug.view = null;
      check('humpback breaches beside the boat', brs.join() === 'out,in' && apex > 1.8 && apex < 4 && logged === 'humpback', `events ${brs.join('→') || 'none'}, body centre peaked ${apex.toFixed(1)} m above the sea, logged ${logged}`);
    }
    // --- a storm: rough sea the boat rides out at anchor, rain, lightning with thunder, its own fish; and the light comes back afterwards
    {
      const Wx = DB.Weather, E = DB.Env, sun0 = E.sunColor.r, sea0 = DB.Ocean.sea; let thunder = 0, tiltS = 0; DB.on('thunder', () => thunder++);
      DB.debug.storm(1);
      for (let i = 0; i < 60 * 30; i++) { tick(1 / 60); tiltS = Math.max(tiltS, Math.abs(B.pitch), Math.abs(B.roll)); }
      const picks = new Set(); F.count = 5; for (let i = 0; i < 40; i++) picks.add(F.pickSpecies(0, 0)).add(F.pickSpecies(-400, 300));
      const stormOk = DB.Ocean.sea > sea0 * 1.5 && E.sunColor.r < sun0 * 0.1 && Wx.rainMesh.visible && thunder >= 2 && tiltS < 0.6 && ['swordfish', 'gt', 'jewfish'].every((k) => picks.has(k));
      const info = `sea ×${(DB.Ocean.sea / sea0).toFixed(2)}, sun ×${(E.sunColor.r / sun0).toFixed(2)}, rain ${Wx.rainMesh.visible}, ${thunder} strikes in 30 s, max tilt ${((tiltS * 180) / Math.PI).toFixed(0)}°, bites ${[...picks].join('/')}`;
      DB.debug.storm(0); tick(1 / 60);
      check('storm: rough sea, rain, lightning, its own fish — and the light returns', stormOk && Math.abs(E.sunColor.r - sun0) < 1e-6 && DB.Ocean.sea === sea0 && !Wx.rainMesh.visible, info);
      F.count = 5;
    }
    const blank = DB.Dex.list.filter((e) => e.img.length < 3000).map((e) => e.key);
    check(`all ${DB.Dex.list.length} field-guide entries have a portrait`, !blank.length, blank.length ? 'missing: ' + blank.join(', ') : 'ok');

    // --- every sound renders (peak level only: nobody is listening)
    const pr = await DB.Audio.probe(), dead = pr.filter((p) => !p.ok);
    check(`all ${pr.length} sounds render non-silent`, pr.length > 30 && !dead.length, dead.length ? 'broken: ' + dead.map((p) => `${p.name}(${p.err || p.peak})`).join(', ') : `quietest ${pr.reduce((m, p) => (p.peak < m.peak ? p : m)).name}`);
    // --- events at sea. The pirates: they open fire, the shot falls near an anchored boat, and running for it shakes them off
    {
      const E = DB.Events, evs = []; DB.on('event', (d) => evs.push(d));
      const count = (name, phase) => evs.filter((d) => d.name === name && d.phase === phase).length;
      DB.debug.tp(0, 0, 0); for (let i = 0; i < 60; i++) tick(1 / 60);
      const score0 = UI.log.score;
      DB.debug.event('raid');
      const rd = E.cur.ship; rd.x = B.group.position.x - 130; rd.z = B.group.position.z + 130;      // astern to the south-west; open water lies to the north-east
      for (let i = 0; i < 60 * 40; i++) tick(1 / 60);
      const falls = evs.filter((d) => d.name === 'raid' && d.phase === 'fall').map((d) => d.miss).sort((a, b) => a - b), dRaid = Math.hypot(rd.x - B.group.position.x, rd.z - B.group.position.z);
      DB.debug.tp(B.group.position.x, B.group.position.z, Math.atan2(-1, 1)); setDrive(true); key('KeyW', true);
      let tEsc = 0; while (E.name === 'raid' && !count('raid', 'escaped') && tEsc < 120) { tick(1 / 60); tEsc += 1 / 60; }
      key('KeyW', false); setDrive(false); if (E.cur) E.stop();
      check('pirates: open fire, hold their range, and are outrun', falls.length >= 6 && falls[Math.floor(falls.length / 2)] < 30 && dRaid > 30 && count('raid', 'escaped') === 1,
        `${falls.length} rounds in 40 s at anchor (median miss ${falls.length ? falls[Math.floor(falls.length / 2)].toFixed(0) : '-'} m), she stood off at ${dRaid.toFixed(0)} m, shaken off after ${tEsc.toFixed(0)} s`);
      let ta = 0; while (B.mode !== 'anchor' && ta < 60) { tick(1 / 60); ta += 1 / 60; }
      // the kraken: left alone it beats on the boat; a flare into each arm drives it off
      DB.debug.tp(0, 0, 0); for (let i = 0; i < 60; i++) tick(1 / 60);
      DB.debug.event('kraken'); const kr = E.cur;
      for (let i = 0; i < 60 * 16; i++) tick(1 / 60);
      const slams = count('kraken', 'slam'); let tk = 0;
      while (E.name === 'kraken' && !kr.over && tk < 60) {
        const arm = kr.arms.find((a) => a.st !== 'gone' && a.st !== 'sink' && a.st !== 'wait');
        if (arm && !kr.flare.live && kr.reload <= 0) {
          B.eyeWorld(v1); kr.armPoint(arm, 0.4, v2); DB.debug.view = { p: v1.toArray(), t: v2.toArray() };
          tick(1 / 60); DB.debug.mouse(true, 0); tick(1 / 60); DB.debug.mouse(false, 0); tk += 2 / 60;
        } else { tick(1 / 60); tk += 1 / 60; }
      }
      DB.debug.view = null; const beaten = count('kraken', 'beaten');
      for (let i = 0; i < 60 * 4; i++) tick(1 / 60);
      check('kraken: beats on the boat until flares drive it off', slams >= 1 && beaten === 1 && E.name === '' && F.active, `${slams} blows in 16 s unanswered, then six arms burnt in ${tk.toFixed(0)} s; rod back in hand ${F.active}`);
      // ghost ship and serpent run their course and are logged when looked at
      const seen = []; DB.on('catch', (r) => { if (r.method === 'watch') seen.push(r.key); });
      for (const name of ['ghost', 'serpent']) {
        DB.debug.event(name);
        for (let i = 0; i < 60 * 80 && E.name === name; i++) { const o = E.cur.obj.position; DB.debug.view = { p: [B.group.position.x, 2.5, B.group.position.z], t: [o.x, 6, o.z] }; tick(1 / 60); }
        DB.debug.view = null;
      }
      check('ghost ship and sea serpent pass and enter the field guide', seen.includes('ghostShip') && seen.includes('serpent') && E.name === '' && DB.Weather.mist === 0, `logged ${seen.join(', ') || 'nothing'}; mist back to ${DB.Weather.mist}`);
      for (let i = 0; i < 120; i++) tick(1 / 60);
      // the bottle: come alongside for the map, then dig the chest up where it says
      DB.debug.event('bottle'); const bt = E.cur;
      DB.debug.tp(bt.x - 3, bt.z - 3, 0); for (let i = 0; i < 30; i++) tick(1 / 60);
      const map = E.map && { x: E.map.x, z: E.map.z };
      let dug = null; DB.on('catch', (r) => { if (r.map) dug = r; });
      if (map) {
        DB.debug.tp(0, 0, 0); for (let i = 0; i < 60; i++) tick(1 / 60);
        enterWater(null); tick(1 / 60);
        for (let i = 0; i < 20; i++) { D.pos.copy(D.dig.pos); D.pos.y += 1.1; D.vel.set(0, 0, 0); G.look.pitch = -1.4; if (i === 10) key('KeyE', true); tick(1 / 60); key('KeyE', false); }
        leaveWater('board');
      }
      check('treasure map: the bottle gives a place, the chest is dug up there', !!map && !!dug && dug.key === 'treasure' && !E.map, map ? `map at ${map.x.toFixed(0)}, ${map.z.toFixed(0)}; dug ${dug ? 'yes' : 'no'}` : 'no map');
      UI.dropCatches(UI.session.length); UI.bonus(score0 - UI.log.score);      // leave the player's score as it was
      DB.Events.auto = !P.has('noevents');
    }
    DB.Weather.auto = !P.has('noweather');
    DB.selftestResult = res;
  }

  boot().catch((e) => { console.error(e); UI.error('초기화 중 오류가 발생했습니다:<br><code>' + (e && e.message ? e.message : e) + '</code>'); });
})();
