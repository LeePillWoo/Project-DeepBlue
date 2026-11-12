// Project Deep Blue — HUD / overlays (DOM), the minimap, and the persistent catch log.
(function () {
  'use strict';
  const DB = window.DB, M = DB.M, $ = (id) => document.getElementById(id);
  const KEY = 'deepblue.log.v1';
  const set = (el, prop, v) => { if (el['_' + prop] !== v) { el['_' + prop] = v; if (prop === 'text') el.textContent = v; else if (prop === 'html') el.innerHTML = v; else el.style[prop] = v; } };
  const HINTS = {
    tease: ['톡… 톡…', '아직입니다 — 확 끌고 갈 때 챔질', '#cfe3ff'],
    bite: ['입질!', '지금 좌클릭으로 챔질', '#ffe9a8'], run: ['질주!', '릴을 놓고 낚싯대는 세운 채로 버티세요', '#ffb37a'], fight: ['버티는 중', '마우스를 당겨 낚싯대를 세우고 → 밀어 내리면서 감기', '#e8f6ff'],
    jump: ['점프!', '감아서 텐션을 유지하세요 · 우클릭 줌', '#a8f0ff'], tired: ['지쳤습니다', '당겨 올리고 내리며 감아 끌어오세요', '#c9ffd9'], high: ['텐션 과다!', '릴을 놓으세요 — 줄이 끊어집니다', '#ff8a7a'], low: ['줄이 느슨합니다', '감으세요 — 바늘이 빠집니다', '#ffd27a'],
  };
  const MODE = { boat: 'Boat Fishing', drive: 'At the Helm', dive: 'Undersea Spearfishing' };
  const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

  const UI = (DB.UI = {
    log: { best: {}, count: 0, score: 0 }, session: [], hintKey: '', hintT: 0, cardOn: false, mode: 'none', _v: new THREE.Vector3(), mapT: 0,

    init() {
      try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.best) this.log = s; } catch (e) { /* first run */ }
      this.stat();
      $('qInfo').textContent = `품질: ${DB.Q.name} (?q=low|medium|high|ultra)`;
    },
    save() { try { localStorage.setItem(KEY, JSON.stringify(this.log)); } catch (e) { /* private mode */ } },
    stat() {
      set($('sCount'), 'text', String(this.log.count)); set($('sScore'), 'text', this.log.score.toLocaleString());
      if (DB.Dex) { const [got, all] = DB.Dex.count(); set($('sDex'), 'text', `${got}/${all}`); }
    },

    loading(p, text) { $('loadBar').style.width = Math.round(p * 100) + '%'; if (text) $('loadText').textContent = text; },
    loaded() { const l = $('loading'); l.style.opacity = 0; setTimeout(() => { l.style.display = 'none'; }, 750); },
    error(msg) { const e = $('err'); e.style.display = 'block'; e.innerHTML = msg; $('loading').style.display = 'none'; },

    // mode: 'title' | 'boat' (fishing) | 'drive' | 'dive'
    setMode(mode) {
      this.mode = mode;
      $('title').style.display = mode === 'title' ? 'flex' : 'none';
      $('hud').classList.toggle('on', mode !== 'title');
      $('mode').textContent = MODE[mode] || '';
      $('diveHud').style.display = mode === 'dive' ? 'block' : 'none';
      $('driveHud').style.display = mode === 'drive' ? 'block' : 'none';
      $('cross').style.display = mode === 'dive' ? 'block' : 'none';
      if (mode !== 'boat') $('fishHud').style.display = 'none';
      if (mode !== 'dive') { for (const id of ['alert', 'marker', 'boatMk', 'lockLab']) set($(id), 'display', 'none'); }
      this.hint(''); this.prompt(''); this.mapT = 0;
    },
    pause(on) { $('pause').style.display = on ? 'flex' : 'none'; },

    toast(text, kind = '', dur = 3.4) {
      const box = $('toasts'), t = document.createElement('div');
      t.className = 'toast glass ' + kind; t.textContent = text; box.appendChild(t);
      while (box.children.length > 4) box.removeChild(box.firstChild);
      setTimeout(() => { t.style.opacity = 0; setTimeout(() => t.remove(), 520); }, dur * 1000);
    },
    hint(key) {
      const el = $('hint');
      if (!key) { el.classList.remove('on'); this.hintKey = ''; return; }
      if (key !== this.hintKey) { const h = HINTS[key]; this.hintKey = key; el.innerHTML = `${h[0]}<small>${h[1]}</small>`; el.style.color = h[2]; this.hintT = 0; }
      el.classList.add('on');
    },
    prompt(html) { const el = $('prompt'); if (!html) { set(el, 'display', 'none'); return; } set(el, 'html', html); set(el, 'display', 'block'); },

    // boat fishing HUD — called every frame
    fishing(F, dt, extraPrompt, canDive) {
      const st = F.state, on = st === 'wait' || st === 'bite' || st === 'fight' || st === 'landing';
      set($('fishHud'), 'display', on ? 'block' : 'none');
      if (on) {
        const T = st === 'fight' || st === 'landing' ? F.tension : st === 'bite' ? 0.55 : 0.06 + (F.nibble || 0) * 0.2;
        set($('tBar'), 'width', Math.round(M.sat(T) * 100) + '%');
        set($('tBar'), 'background', T > 0.86 ? 'var(--bad)' : T > 0.74 ? 'var(--warn)' : T < 0.17 && st === 'fight' ? '#ffd27a' : 'var(--hl)');
        set($('tDist'), 'text', F.dist.toFixed(1) + ' m');
      }
      // the rod: where it is, whether it is cushioning (inside the marked band), and side pressure
      set($('rodRow'), 'display', st === 'fight' ? 'flex' : 'none');
      if (st === 'fight') {
        set($('rBar'), 'width', Math.round(F.rodA * 100) + '%'); set($('rBar'), 'background', F.cush > 0.8 ? 'var(--hl)' : 'var(--warn)');
        set($('rSide'), 'text', F.side > 0.5 ? '측면 압박' : F.cush < 0.5 ? (F.rodA < 0.3 ? '너무 눕힘' : '너무 세움') : '');
      }
      // guidance: mode changes flash briefly, mistakes stay up
      this.hintT += dt;
      let key = '';
      if (st === 'bite') key = 'bite';
      else if (st === 'wait' && F.hint === 'tease') key = 'tease';
      else if (st === 'fight') { key = F.zone === 'high' ? 'high' : F.zone === 'low' && F.hint !== 'jump' && F.slack > 0.6 ? 'low' : F.hint; if (key === this.hintKey && key !== 'high' && key !== 'low' && this.hintT > 2.4) { $('hint').classList.remove('on'); key = null; } }
      if (key !== null) this.hint(key);
      let p = extraPrompt || '';
      if (!p && !this.cardOn) {
        if (st === 'idle') p = `<kbd>좌클릭</kbd>길게 눌러 캐스팅 &nbsp; <kbd>E</kbd>운전 &nbsp; ${canDive ? '<kbd>F</kbd>다이빙' : '<span style="opacity:.6">다이빙은 REEF 부표 근처에서</span>'}`;
        else if (st === 'charge') {      // 12 cells over 0 … 1.2: white while loading, green where a release is perfect, red once overloaded
          let g = ''; for (let i = 0; i < 12; i++) { const on = F.power > i * 0.1, col = i >= 10 ? '#ff8a7a' : i === 9 ? '#a8ff5a' : '#fff'; g += `<span style="color:${col};opacity:${on ? 1 : 0.28}">▮</span>`; }
          p = `캐스팅 ${g} &nbsp;<span style="opacity:.75">초록에서 놓기 · 빨강은 백래시</span>`;
        } else if (st === 'tangle') p = '백래시 — 엉킨 줄을 푸는 중…';
        else if (st === 'wait') p = '입질을 기다리는 중 — <kbd>좌클릭</kbd>을 짧게 끊어 치면 루어가 춤춥니다';
      }
      this.prompt(p);
    },

    // helm HUD — called every frame
    drive(B, note) {
      set($('dSpd'), 'text', (Math.abs(B.u) * 1.944).toFixed(1));
      const deg = (((-B.heading * 180) / Math.PI) % 360 + 360) % 360;      // heading 0 = north (-z), clockwise positive
      set($('dHead'), 'text', `${COMPASS[Math.round(deg / 45) % 8]} ${String(Math.round(deg) % 360).padStart(3, '0')}°`);
      set($('dThr'), 'width', Math.round(Math.abs(B.throttle) * 100) + '%');
      set($('dThr'), 'background', B.throttle < -0.02 ? 'var(--warn)' : 'var(--hl)');
      this.prompt(note || '<kbd>W</kbd><kbd>S</kbd>스로틀 &nbsp; <kbd>A</kbd><kbd>D</kbd>조타 &nbsp; <kbd>E</kbd>닻 내리고 낚시');
    },

    // spearfishing HUD — called every frame
    dive(D, camera, w, h) {
      set($('oBar'), 'width', Math.round(D.o2 * 100) + '%');
      set($('oBar'), 'background', D.o2 < 0.2 ? 'var(--bad)' : D.o2 < 0.4 ? 'var(--warn)' : 'var(--hl)');
      set($('dBar'), 'width', Math.round(M.sat(D.depth / D.maxDepth) * 100) + '%');
      set($('dBar'), 'background', D.depth > D.maxDepth * 0.85 ? 'var(--warn)' : '#6aa8ff');
      set($('dVal'), 'text', D.depth.toFixed(1) + ' m');
      const cr = $('cross'); cr.classList.toggle('empty', !D.loaded); cr.classList.toggle('lock', !!D.lock && D.loaded);
      const ll = $('lockLab');
      if (D.lock && D.loaded) { set(ll, 'text', `${D.lock.name} · ${D.lock.dist.toFixed(1)} m`); set(ll, 'display', 'block'); } else set(ll, 'display', 'none');
      set($('alert'), 'display', D.sharkNear > 0 ? 'block' : 'none');
      const pin = (mk, pos, text) => this.pinMark(mk, pos, text, camera, w, h);
      if (D.marker && D.marker.alive) pin($('marker'), D.marker.pos, `◆ 도주 중인 ${D.marker.sp.name}  ${D.marker.pos.distanceTo(D.pos).toFixed(0)} m`);
      else set($('marker'), 'display', 'none');
      // where the boat is — the thing you could not find before
      const lad = D.ladder(this._l || (this._l = new THREE.Vector3())), far = Math.hypot(lad.x - D.pos.x, lad.z - D.pos.z);
      if (far > 6 || D.depth > 6) pin($('boatMk'), lad, `▲ 보트  ${Math.hypot(far, D.pos.y).toFixed(0)} m`); else set($('boatMk'), 'display', 'none');
      let p = '';
      if (D.pick) p = `<kbd>E</kbd>${D.pick.verb} — ${D.pick.name}`;
      else if (D.prompt === 'board') p = `<kbd>F</kbd>보트에 승선${D.bag.length ? ` (어획 ${D.bag.length})` : ''}`;
      else if (D.warn === 'far') p = '조류가 강합니다 — 리프 쪽으로 돌아가세요 (미니맵 참고)';
      else if (D.warn === 'deep') p = '한계 수심 초과 — 공기 소모가 급증합니다';
      else if (D.o2 < 0.22) p = '산소 부족! <kbd>F</kbd>를 눌러 보트로 복귀하세요';
      else p = `<kbd>F</kbd>보트로 복귀${D.bag.length ? ` (어획 ${D.bag.length})` : ''}`;
      this.prompt(p);
    },

    // label pinned to a world position, clamped to the screen edge when it is out of view
    pinMark(mk, pos, text, camera, w, h) {
      const v = this._v.copy(pos).project(camera), behind = v.z > 1;
      let x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      if (behind) { x = w - x; y = h; }
      x = M.clamp(x, 90, w - 290); y = M.clamp(y, 104, h - 150);      // clear of the mode label (top) and the prompt (bottom)
      set(mk, 'display', 'block'); mk.style.transform = `translate(${Math.round(x - 60)}px, ${Math.round(y - 34)}px)`; set(mk, 'text', text);
    },
    // the one label an event may show: a drifting bottle, the spot on the treasure map … (pin = { pos, text } or null)
    eventPin(pin, camera, w, h) { if (pin) this.pinMark($('evMk'), pin.pos, pin.text, camera, w, h); else set($('evMk'), 'display', 'none'); },

    // minimap. st: { mode, cx, cz (centre, world), rot (direction that points up: heading / view yaw), range (m), dt }
    map(st) {
      this.mapT -= st.dt; if (this.mapT > 0) return; this.mapT = 0.07;
      const cv = $('mini'), c = this._mc || (this._mc = cv.getContext('2d')), W = cv.width, R = W / 2 - 3, k = R / st.range, co = Math.cos(st.rot), si = Math.sin(st.rot);
      const B = DB.Boat, Sea = DB.Sea, D = DB.Dive, to = (x, z, o) => { const dx = (x - st.cx) * k, dz = (z - st.cz) * k; o[0] = dx * co - dz * si; o[1] = dx * si + dz * co; return o; }, p = this._mp || (this._mp = [0, 0]);
      const rim = (o, pad = 10) => { const d = Math.hypot(o[0], o[1]); if (d > R - pad) { o[0] *= (R - pad) / d; o[1] *= (R - pad) / d; return true; } return false; };
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, W);
      c.save(); c.beginPath(); c.arc(W / 2, W / 2, R, 0, 7); c.clip();
      c.fillStyle = st.mode === 'dive' ? 'rgba(6,34,58,0.9)' : 'rgba(10,44,72,0.86)'; c.fillRect(0, 0, W, W);
      c.translate(W / 2, W / 2);
      // depth chart of the reef site (the fish finder's chart, 1 px = chartScale m, centred on the world origin)
      const F = B.Finder, s = F.chartScale * k;
      c.save(); c.rotate(st.rot); c.globalAlpha = st.mode === 'dive' ? 0.6 : 0.42; c.imageSmoothingEnabled = true;
      c.drawImage(F.chart, (-F.chart.width / 2) * s - st.cx * k, (-F.chart.height / 2) * s - st.cz * k, F.chart.width * s, F.chart.height * s);
      c.restore();
      // range rings
      c.strokeStyle = 'rgba(255,255,255,0.14)'; c.lineWidth = 2;
      for (const f of [0.5, 1]) { c.beginPath(); c.arc(0, 0, (R - 1) * f, 0, 7); c.stroke(); }
      const dot = (x, z, r, col) => { to(x, z, p); c.fillStyle = col; c.beginPath(); c.arc(p[0], p[1], r, 0, 7); c.fill(); };
      const label = (txt, col = '#fff') => { c.font = '600 19px "Malgun Gothic", sans-serif'; c.textAlign = 'center'; c.lineWidth = 5; c.strokeStyle = 'rgba(0,0,0,0.6)'; c.strokeText(txt, p[0], p[1] - 13); c.fillStyle = col; c.fillText(txt, p[0], p[1] - 13); };
      const arrow = (x, z, h, sz, col, clamp) => {      // boat glyph pointing along its heading
        to(x, z, p); const out = clamp ? rim(p) : false;
        c.save(); c.translate(p[0], p[1]); c.rotate(st.rot - h); c.fillStyle = col; c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 2.5;
        c.beginPath(); c.moveTo(0, -sz); c.lineTo(sz * 0.62, sz * 0.8); c.lineTo(0, sz * 0.45); c.lineTo(-sz * 0.62, sz * 0.8); c.closePath(); c.stroke(); c.fill(); c.restore();
        return out;
      };
      // dive zone
      to(0, 0, p); c.setLineDash([9, 7]); c.strokeStyle = 'rgba(91,192,190,0.9)'; c.lineWidth = 2.5; c.beginPath(); c.arc(p[0], p[1], Sea.REEF_R * k, 0, 7); c.stroke(); c.setLineDash([]);
      if (st.mode !== 'dive' && Math.hypot(p[0], p[1]) + Sea.REEF_R * k * 0.4 < R) { p[1] += Sea.REEF_R * k + 26; label('REEF', '#8fe6e2'); }
      // island rocks + beach, lighthouse
      for (const col of Sea.colliders) if (!col.boat && col.r) { dot(col.x, col.z, Math.max(col.r * k, 2), '#7d7462'); }
      for (const poi of Sea.pois) {
        if (poi.id === 'light') { dot(poi.x, poi.z, 6, '#ffe08a'); }
        else if (poi.id === 'island') { to(poi.x, poi.z, p); if (rim(p, 16)) { c.fillStyle = '#c9b88e'; c.beginPath(); c.arc(p[0], p[1], 8, 0, 7); c.fill(); } label(poi.label, '#f1e4c4'); }
        else if (poi.boat) { const b = poi.boat, out = arrow(b.x, b.z, b.h, poi.id === 'ship' ? 15 : 10, poi.id === 'ship' ? '#1d1d22' : '#c8d2dc', poi.id === 'ship'); if (poi.id === 'ship' && (out || st.range > 150)) { to(b.x, b.z, p); rim(p); label(poi.label, '#ddd'); } }
      }
      if (B.buoy) dot(B.buoy.position.x, B.buoy.position.z, 5, '#ff5a3a');
      // whatever the events have out there: a bottle, the cross on the treasure map, something chasing you
      for (const m of DB.Events.marks) {
        if (m.h !== undefined) { arrow(m.x, m.z, m.h, 14, m.col, true); to(m.x, m.z, p); rim(p); label(m.label, m.col); continue; }
        to(m.x, m.z, p); rim(p, 14);
        if (m.cross) { c.strokeStyle = m.col; c.lineWidth = 4; c.beginPath(); c.moveTo(p[0] - 8, p[1] - 8); c.lineTo(p[0] + 8, p[1] + 8); c.moveTo(p[0] + 8, p[1] - 8); c.lineTo(p[0] - 8, p[1] + 8); c.stroke(); }
        else { c.fillStyle = m.col; c.beginPath(); c.arc(p[0], p[1], 6, 0, 7); c.fill(); }
        label(m.label, m.col);
      }
      if (st.mode === 'dive') {
        const wk = DB.Reef.wreck; to(wk.x, wk.z, p); c.strokeStyle = '#d8b27a'; c.lineWidth = 4; c.beginPath(); c.moveTo(p[0] - 9, p[1] - 9); c.lineTo(p[0] + 9, p[1] + 9); c.moveTo(p[0] + 9, p[1] - 9); c.lineTo(p[0] - 9, p[1] + 9); c.stroke(); label('난파선', '#e8cfa0');
        for (const sh of D.sharks) if (sh.state === 'approach' || sh.state === 'charge') dot(sh.pos.x, sh.pos.z, 7, '#ff4a3a');
        if (D.marker && D.marker.alive) dot(D.marker.pos.x, D.marker.pos.z, 7, '#5bc0be');
      }
      // the boat — clamped to the rim when it is out of range, so it can always be found
      const off = arrow(B.group.position.x, B.group.position.z, B.heading, 17, '#ffffff', true);
      if (st.mode === 'dive') {
        if (off) { to(B.group.position.x, B.group.position.z, p); rim(p); label('보트'); }
        c.fillStyle = 'rgba(255,255,255,0.16)'; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, R * 0.42, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); c.closePath(); c.fill();      // view cone
        c.fillStyle = '#5bc0be'; c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, 8, 0, 7); c.fill(); c.stroke();
      }
      c.restore();
      // north tick on the rim
      c.setTransform(1, 0, 0, 1, W / 2, W / 2);
      const nx = -Math.sin(-st.rot) * (R - 13), ny = -Math.cos(-st.rot) * (R - 13);
      c.font = '700 22px Bahnschrift, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 5; c.strokeStyle = 'rgba(0,0,0,0.6)'; c.strokeText('N', nx, ny); c.fillStyle = '#ff7a5a'; c.fillText('N', nx, ny); c.textBaseline = 'alphabetic';
      c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, R, 0, 7); c.stroke();
      // caption: range + what matters right now
      let cap = `반경 ${st.range} m`;
      if (st.mode === 'dive') cap = `보트까지 ${Math.hypot(B.group.position.x - st.cx, B.group.position.z - st.cz).toFixed(0)} m · 수심 ${D.depth.toFixed(0)} m`;
      else { const d0 = Math.hypot(st.cx, st.cz); cap += d0 > Sea.REEF_R ? ` · REEF ${d0.toFixed(0)} m` : ' · 다이빙 포인트'; }
      set($('miniLab'), 'text', cap);
    },

    // records a catch / find / sighting. method: rod | spear | chase | hand | watch. returns { pts, record, first }
    addCatch(rec) {
      const sp = DB.Species[rec.key], pts = sp.pts || Math.round(rec.kg * sp.score * (rec.method === 'chase' ? 1.5 : 1));
      const b = this.log.best[rec.key] || (this.log.best[rec.key] = { n: 0, L: 0, kg: 0 });
      const first = b.n === 0, record = rec.kg > b.kg && b.n > 0, prev = JSON.parse(JSON.stringify(b)), wasNew = DB.Dex ? DB.Dex.fresh.has(rec.key) : false;
      b.n++; b.L = Math.max(b.L, rec.L); b.kg = Math.max(b.kg, rec.kg);
      (b.by || (b.by = {}))[rec.method] = (b.by[rec.method] || 0) + 1;
      if (rec.method !== 'watch') this.log.count++;
      this.log.score += pts;
      if (rec.method !== 'watch') this.session.push({ rec, pts, prev, wasNew });      // sightings are not part of the bag: they cannot be lost or stolen
      if (first && DB.Dex) DB.Dex.fresh.add(rec.key);
      this.stat(); this.save();
      return { pts, record: record || first, first };
    },
    // points won or lost outside the catch log (outrunning pirates, a kraken's blows)
    bonus(pts) { this.log.score = Math.max(this.log.score + pts, 0); this.stat(); this.save(); },
    cross(on) { $('cross').style.display = on ? 'block' : 'none'; },      // the aiming ring, for the flare pistol on deck
    // undo the last n catches (bag lost on blackout / stolen by a shark)
    dropCatches(n) {
      for (let i = 0; i < n; i++) {
        const e = this.session.pop(); if (!e) break;
        this.log.best[e.rec.key] = e.prev; if (e.rec.method !== 'watch') this.log.count--; this.log.score -= e.pts;
        if (!e.wasNew && DB.Dex) DB.Dex.fresh.delete(e.rec.key);
      }
      this.stat(); this.save();
    },
    showCard(rec, info) {
      const sp = DB.Species[rec.key];
      $('cName').textContent = sp.name; $('cEn').textContent = sp.en;
      $('cLen').textContent = rec.L.toFixed(2) + ' m'; $('cKg').textContent = rec.kg.toFixed(rec.kg < 10 ? 2 : 1) + ' kg'; $('cPts').textContent = '+' + info.pts.toLocaleString();
      $('cBadge').style.display = info.record ? 'block' : 'none';
      $('cBadge').textContent = info.first ? 'NEW SPECIES' : 'NEW RECORD';
      $('card').style.display = 'block'; this.cardOn = true;
    },
    hideCard() { $('card').style.display = 'none'; this.cardOn = false; },
  });
})();
