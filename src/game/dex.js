// Project Deep Blue — 도감 (field guide): every catch, find and sighting with a rendered portrait, records and a hint on where to look.
(function () {
  'use strict';
  const DB = window.DB, T = THREE, $ = (id) => document.getElementById(id);
  // [species key, where to look]. The order is the order of the cards.
  const ENTRIES = [
    ['marlin', '수심 30 m보다 깊은 블루워터로 캐스팅 — 가장 강한 상대'], ['sailfish', '깊은 수심 표층 — 점프가 잦습니다'], ['tuna', '깊은 수심 — 지구력이 강합니다'], ['mahi', '깊은 수심 표층, 가끔 리프에서도'],
    ['swordfish', '폭풍이 칠 때만 — 깊은 수심의 가장 질긴 상대'], ['gt', '폭풍이 칠 때만 — 리프 위에서 힘으로 버팁니다'], ['jewfish', '폭풍이 칠 때만 — 수심을 가리지 않고 묵직하게 뭅니다'],
    ['amberjack', '리프 가장자리를 회유 — 낚시·작살'], ['seabream', '리프 위 모래 지대 — 낚시·작살'], ['grouper', '산호 바위 틈 — 낚시·작살'], ['giantGrouper', '난파선 주변 — 작살 여러 발'],
    ['parrotfish', '산호 바위 주변 — 작살'], ['jack', '떼 지어 다니는 은빛 무리 — 작살'], ['mullet', '수면 바로 아래를 떼 지어 다닙니다 — 작살'],
    ['octopus', '바위 위에 숨어 있다가 먹물을 뿜고 달아납니다 — 작살 또는 손'], ['crab', '모래 바닥 — 서두르면 옆걸음으로 달아납니다. 천천히 다가가서 E'],
    ['urchin', '바위 지대 바닥 — 가까이에서 E'], ['conch', '모래 바닥 — 가까이에서 E'], ['starfish', '모래와 바위 위 — 가까이에서 E'], ['treasure', '난파선 옆 해저'],
    ['turtle', '리프 위를 유영 — 다가가서 관찰 (보호종)'], ['pyjama', '바닥을 훑고 다니는 줄무늬 상어 — 다가가서 관찰 (보호종)'], ['seadragon', '바위 곁에 떠 있는 작은 해룡 — 다가가서 관찰'],
    ['nudibranch', '바위 위의 손가락만 한 파란 점 — 가까이에서 E'], ['orca', '무리가 가끔 지나갑니다 — 보트에서는 등지느러미와 물기둥을, 물속에서는 리프 바깥쪽을 보세요'],
    ['spermWhale', '가끔 깊은 쪽을 지나가는 거대한 그림자 — 보트에서는 물기둥'], ['humpback', '보트 가까이를 지나다 수면 위로 솟구칩니다'], ['blueWhale', '지구에서 가장 큰 동물. 가끔 지나갑니다 — 보트에서는 높은 물기둥'],
    ['whaleShark', '리프 위를 느릿느릿 도는 점박이 거인 — 다가가서 관찰'], ['manta', '리프 위를 날갯짓하며 활공합니다 — 다가가서 관찰'],
    ['shark', '피 냄새를 맡고 다가옵니다 — 작살로 쫓아내기'], ['hammerhead', '난파선 주위를 떼 지어 돕니다 — 곁에 오래 머물면 한 마리가 덤벼듭니다'], ['greatWhite', '오래 잠수하거나 피를 많이 흘리면 나타납니다 — 작살 두 발'],
  ];
  const CHIP = { rod: '낚시', spear: '작살', hand: '채집', watch: '관찰' };

  const Dex = (DB.Dex = {
    list: ENTRIES.map(([key, how]) => ({ key, how, img: '' })), fresh: new Set(), isOpen: false,

    // discovered / total
    count() { const b = DB.UI.log.best; return [this.list.filter((e) => b[e.key] && b[e.key].n > 0).length, this.list.length]; },
    methods(key) { const sp = DB.Species[key], m = []; if (sp.rod) m.push('rod'); if (sp.spear) m.push('spear'); if (sp.hand) m.push('hand'); if (sp.watch) m.push('watch'); return m; },

    // object to photograph for a species: fish come from the fish builder, everything else from the dive module
    portrait(key) {
      const sp = DB.Species[key];
      if (sp.prof || sp.real) {
        const f = DB.Fish.get(key), m = new T.Mesh(f.geo, new T.MeshStandardMaterial({ map: f.tex, vertexColors: !!f.col, normalMap: f.nor || null, normalScale: new T.Vector2(1, -1), roughness: 0.5, metalness: 0, side: T.DoubleSide }));
        return m;
      }
      return DB.Dive.model ? DB.Dive.model(key) : null;
    },

    // renders every portrait once (boot), into data-URL images
    init(renderer) {
      const W = 352, H = 220, rt = new T.WebGLRenderTarget(W, H, { samples: 4 }), scene = new T.Scene(), cam = new T.PerspectiveCamera(22, W / H, 0.02, 60);
      scene.add(new T.HemisphereLight(0xdcefff, 0x3a566e, 1.9));
      const sun = new T.DirectionalLight(0xfff4e2, 2.3); sun.position.set(-1.6, 3, 2.6); scene.add(sun);
      const buf = new Uint8Array(W * H * 4), cv = document.createElement('canvas'), lut = Uint8Array.from({ length: 256 }, (_, i) => Math.round(Math.pow(i / 255, 1 / 2.2) * 255));
      cv.width = W; cv.height = H;
      const c2 = cv.getContext('2d'), img = c2.createImageData(W, H), prevT = renderer.getRenderTarget(), prevC = renderer.getClearColor(new T.Color()), prevA = renderer.getClearAlpha(), prevAuto = renderer.autoClear;
      renderer.autoClear = true; renderer.setClearColor(0x000000, 0);
      const box = new T.Box3(), size = new T.Vector3(), ctr = new T.Vector3(), dir = new T.Vector3();
      for (const e of this.list) {
        let obj = null;
        try { obj = this.portrait(e.key); } catch (err) { console.warn('dex portrait failed', e.key, err); }
        if (!obj) continue;
        scene.add(obj); obj.updateMatrixWorld(true);
        box.setFromObject(obj); box.getSize(size); box.getCenter(ctr);
        const fish = !!(DB.Species[e.key].prof || DB.Species[e.key].real);
        dir.set(fish ? 0.28 : 0.55, fish ? 0.16 : 0.5, 1).normalize();
        // frame it: fish are long and seen side-on (width decides); everything else is roughly round and seen from above
        const th = (cam.fov * Math.PI) / 360, r = Math.max(size.x, size.y, size.z) * 0.5;
        const need = fish ? Math.max(size.y * 0.5 + 0.3 * size.z, (size.x * 0.5) / cam.aspect) / Math.tan(th) * 1.18 + size.z * 0.5 : (r * 1.12) / Math.tan(th);
        cam.position.copy(ctr).addScaledVector(dir, need); cam.lookAt(ctr);
        renderer.setRenderTarget(rt); renderer.render(scene, cam);
        renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {      // flip, linear → sRGB
          const s = ((H - 1 - y) * W + x) * 4, d = (y * W + x) * 4;
          img.data[d] = lut[buf[s]]; img.data[d + 1] = lut[buf[s + 1]]; img.data[d + 2] = lut[buf[s + 2]]; img.data[d + 3] = buf[s + 3];
        }
        c2.putImageData(img, 0, 0); e.img = cv.toDataURL('image/png');
        scene.remove(obj);
      }
      renderer.setRenderTarget(prevT); renderer.setClearColor(prevC, prevA); renderer.autoClear = prevAuto; rt.dispose();
    },

    render() {
      const best = DB.UI.log.best, [got, all] = this.count();
      $('dexSub').textContent = `${got} / ${all} 종 발견 · 총 ${DB.UI.log.count}마리 · ${DB.UI.log.score.toLocaleString()}점`;
      $('dexGrid').innerHTML = this.list.map((e) => {
        const sp = DB.Species[e.key], b = best[e.key], have = b && b.n > 0, chips = this.methods(e.key).map((m) => `<span class="chip">${CHIP[m]}</span>`).join('');
        const rec = !have ? '미발견' : sp.watch ? `${b.n}회 조우` : `×${b.n} · ${b.L.toFixed(2)} m · ${b.kg.toFixed(b.kg < 10 ? 2 : 1)} kg`;
        return `<article class="dexcard${have ? '' : ' none'}${this.fresh.has(e.key) ? ' new' : ''}"><img src="${e.img}" alt=""><hgroup><h3>${have ? sp.name : '???'}</h3><p>${have ? sp.en : '&nbsp;'}</p></hgroup><div><p>${chips}</p><p>${rec}</p><p class="how">${e.how}</p></div></article>`;
      }).join('');
    },
    open() { if (this.isOpen) return; this.isOpen = true; this.render(); $('dex').show(); $('dexGrid').parentElement.scrollTop = 0; },
    close() { if (!this.isOpen) return; this.isOpen = false; $('dex').close(); this.fresh.clear(); },
    toggle() { this.isOpen ? this.close() : this.open(); return this.isOpen; },
    scroll(dy) { $('dex').scrollBy({ top: dy, behavior: 'smooth' }); },
  });
})();
