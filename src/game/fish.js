// Project Deep Blue — fish: species table, procedural bodies/fins, painted skins, swim deformation.
// Model space: unit length, +x = snout, +y = dorsal. Skin = side projection: u = 0.5 - x, v = (y + 0.25) / 0.5.
(function () {
  'use strict';
  const DB = window.DB, T = THREE, M = DB.M, G = DB.G;
  const TW = 1024, TH = 512;

  const forkTail = (x0, hb, tipY, notch) => [[x0, hb], [x0 - 0.06, tipY * 0.5], [-0.5, tipY], [-0.5 + 0.035, tipY * 0.5], [notch, 0], [-0.5 + 0.035, -tipY * 0.5], [-0.5, -tipY], [x0 - 0.06, -tipY * 0.5], [x0, -hb]];
  const dots = (c, h, n, col, r0, r1, u0 = 0.1, u1 = 0.95, s0 = 0.1, s1 = 0.95) => {
    c.fillStyle = col;
    for (let i = 0; i < n; i++) {
      const u = u0 + h.r() * (u1 - u0), [t, b] = h.prof(u), s = s0 + h.r() * (s1 - s0);
      c.beginPath(); c.arc(h.X(u), h.Y(-b + (t + b) * s), r0 + h.r() * (r1 - r0), 0, 7); c.fill();
    }
  };
  const lineAt = (c, h, u0, u1, s, col, lw) => {       // stroke a line following normalized body height s
    c.strokeStyle = col; c.lineWidth = lw; c.beginPath();
    for (let i = 0; i <= 24; i++) { const u = u0 + ((u1 - u0) * i) / 24, [t, b] = h.prof(u); const x = h.X(u), y = h.Y(-b + (t + b) * s); i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.stroke();
  };
  const gill = (c, h, u, col = 'rgba(0,0,0,0.38)') => {
    const [t, b] = h.prof(u); c.strokeStyle = col; c.lineWidth = 3; c.beginPath();
    c.moveTo(h.X(u), h.Y(t * 0.7)); c.quadraticCurveTo(h.X(u + 0.035), h.Y((t - b) * 0.2), h.X(u - 0.004), h.Y(-b * 0.8)); c.stroke();
  };

  const billProf = [[0, .003, .003, .003], [.1, .006, .005, .005], [.2, .011, .012, .010], [.255, .042, .040, .028], [.33, .076, .070, .046], [.48, .070, .066, .043], [.68, .043, .043, .029], [.87, .015, .015, .012], [1, .009, .009, .013]];
  const grouperProf = [[0, .02, .032, .022], [.05, .07, .075, .058], [.18, .125, .125, .088], [.38, .158, .15, .096], [.6, .145, .135, .082], [.8, .088, .082, .046], [.93, .056, .056, .028], [1, .056, .056, .02]];
  const grouperFins = [
    { p: [[.3, .13], [.33, .195], [.5, .2], [.62, .21], [.76, .17], [.82, .09], [.34, .12]] },
    { p: [[.62, -.12], [.66, -.19], [.76, -.16], [.82, -.08], [.66, -.1]] },
    { p: [[.33, -.13], [.36, -.2], [.44, -.17], [.42, -.12]] },
  ];
  const fanTail = [[-.29, .055], [-.36, .1], [-.44, .125], [-.49, .09], [-.5, 0], [-.49, -.09], [-.44, -.125], [-.36, -.1], [-.29, -.055]];
  const fanPec = { u: .27, y: -.045, sw: .75, dr: .25, vert: true, pts: [[0, .04], [.07, .065], [.13, .05], [.16, 0], [.13, -.05], [.07, -.065], [0, -.04]] };

  // L: length range (m); wK: kg = wK * L^3; power/stamina/jump: fight traits; score: points per kg
  const SP = (DB.Species = {
    marlin: {
      name: '청새치', en: 'Blue Marlin', L: [2.5, 3.8], wK: 9.5, body: .83, power: 1.0, stamina: 1.0, jump: 1.0, score: 3, rod: 'deep',
      prof: billProf,
      fins: [
        { p: [[.285, .05], [.30, .185], [.33, .16], [.37, .115], [.46, .085], [.6, .062], [.73, .048], [.74, .03], [.3, .04]] },
        { p: [[.80, .016], [.825, .05], [.87, .018]] }, { p: [[.60, -.045], [.63, -.115], [.66, -.085], [.71, -.035]] }, { p: [[.80, -.016], [.83, -.048], [.87, -.016]] },
      ],
      tail: [[-.325, .012], [-.39, .095], [-.5, .2], [-.468, .1], [-.41, 0], [-.468, -.1], [-.5, -.2], [-.39, -.095], [-.325, -.012]],
      pec: { u: .335, y: -.035, sw: .35, dr: .45, pts: [[0, .014], [.06, .022], [.15, .008], [.175, -.004], [.1, -.012], [0, -.012]] },
      eye: { u: .268, y: .012, r: .0105 },
      style: { back: '#0a1c46', flank: '#5d7ea9', belly: '#ccd6de', s: [.3, .58, .82], fin: '#0b1a3c', iris: '#c9d2da' },
      extra(c, h) {
        for (let i = 0; i < 15; i++) {
          const u = .3 + i * .039, [t, b] = h.prof(u);
          c.strokeStyle = 'rgba(150,205,255,0.34)'; c.lineWidth = 5; c.beginPath(); c.moveTo(h.X(u), h.Y(t * .85)); c.lineTo(h.X(u + .008), h.Y(-b * .25)); c.stroke();
        }
        lineAt(c, h, .29, .95, .55, 'rgba(20,40,80,0.35)', 2); gill(c, h, .3);
        c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 2; c.beginPath(); c.moveTo(h.X(.19), h.Y(-.006)); c.lineTo(h.X(.262), h.Y(-.02)); c.stroke();
      },
    },
    sailfish: {
      name: '돛새치', en: 'Sailfish', L: [1.9, 2.9], wK: 2.7, body: .83, power: .62, stamina: .7, jump: 1.2, score: 5, rod: 'deep',
      prof: [[0, .003, .003, .003], [.1, .005, .005, .004], [.2, .009, .01, .008], [.25, .035, .033, .022], [.33, .058, .055, .034], [.5, .055, .052, .032], [.7, .035, .035, .022], [.88, .013, .013, .01], [1, .008, .008, .011]],
      fins: [
        { p: [[.27, .04], [.285, .17], [.33, .215], [.42, .228], [.52, .215], [.62, .17], [.7, .1], [.74, .04], [.5, .03]], col: '#16379a', spots: true },
        { p: [[.80, .014], [.825, .045], [.87, .016]] }, { p: [[.60, -.04], [.63, -.1], [.66, -.075], [.71, -.03]] }, { p: [[.80, -.014], [.83, -.042], [.87, -.014]] },
      ],
      tail: [[-.325, .011], [-.39, .09], [-.5, .19], [-.468, .095], [-.41, 0], [-.468, -.095], [-.5, -.19], [-.39, -.09], [-.325, -.011]],
      pec: { u: .33, y: -.03, sw: .35, dr: .5, pts: [[0, .012], [.06, .018], [.14, .006], [.16, -.004], [.09, -.011], [0, -.011]] },
      eye: { u: .262, y: .01, r: .0105 },
      style: { back: '#11275c', flank: '#8794a6', belly: '#d6dbdf', s: [.32, .6, .84], fin: '#0c1a3a', iris: '#cdd4da' },
      extra(c, h) {
        for (let i = 0; i < 16; i++) { const u = .3 + i * .037, [t, b] = h.prof(u); c.fillStyle = 'rgba(140,200,255,0.4)'; for (let k = 0; k < 6; k++) { c.beginPath(); c.arc(h.X(u), h.Y(t * .8 - k * (t + b) * .13), 2.6, 0, 7); c.fill(); } }
        gill(c, h, .295);
      },
    },
    tuna: {
      name: '황다랑어', en: 'Yellowfin Tuna', L: [0.9, 1.8], wK: 21, body: .84, power: .85, stamina: 1.1, jump: 0.05, score: 6, rod: 'deep',
      prof: [[0, .004, .004, .004], [.05, .046, .04, .03], [.15, .095, .086, .06], [.34, .125, .122, .084], [.55, .106, .108, .074], [.75, .06, .06, .04], [.92, .016, .016, .014], [1, .009, .009, .017]],
      fins: [
        { p: [[.3, .1], [.315, .168], [.36, .13], [.45, .11], [.46, .09]], col: '#1a2638' },
        { p: [[.52, .09], [.55, .205], [.566, .195], [.578, .12], [.6, .095]], col: '#e2bd1c' }, { p: [[.56, -.09], [.6, -.205], [.612, -.195], [.618, -.12], [.64, -.09]], col: '#e2bd1c' },
        ...[.66, .71, .76, .81, .86].flatMap((u) => { const t = .125 - (u - .34) * .19; return [{ p: [[u, t - .012], [u + .022, t + .014], [u + .032, t - .014]], col: '#e8c61e' }, { p: [[u, -t + .012], [u + .022, -t - .014], [u + .032, -t + .014]], col: '#e8c61e' }]; }),
      ],
      tail: forkTail(-.335, .012, .19, -.42),
      pec: { u: .27, y: -.012, sw: .3, dr: .3, pts: [[0, .016], [.07, .02], [.16, .006], [.17, -.002], [.08, -.012], [0, -.014]] },
      eye: { u: .085, y: .012, r: .014 },
      style: { back: '#0b1830', flank: '#7b8da3', belly: '#e0e6ea', s: [.3, .52, .74], fin: '#1c2a3f', iris: '#d8d8c8' },
      extra(c, h) { c.shadowColor = 'rgba(235,195,40,0.9)'; c.shadowBlur = 10; lineAt(c, h, .1, .86, .56, 'rgba(235,196,44,0.55)', 9); c.shadowBlur = 0; gill(c, h, .2); },
    },
    mahi: {
      name: '만새기', en: 'Mahi-mahi', L: [0.8, 1.5], wK: 8.5, body: .8, power: .5, stamina: .55, jump: 0.9, score: 6, rod: 'deep',
      prof: [[0, .018, .02, .012], [.035, .09, .05, .028], [.11, .132, .085, .043], [.28, .118, .09, .044], [.55, .078, .066, .032], [.85, .026, .024, .014], [1, .013, .013, .01]],
      fins: [
        { p: [[.07, .1], [.1, .2], [.2, .19], [.4, .15], [.6, .1], [.85, .05], [.87, .02], [.1, .1]], col: '#1c5ab6' },
        { p: [[.5, -.06], [.52, -.1], [.7, -.07], [.86, -.04], [.86, -.02]], col: '#c9b820' },
      ],
      tail: forkTail(-.3, .013, .19, -.36),
      pec: { u: .2, y: -.01, sw: .5, dr: .4, pts: [[0, .014], [.05, .02], [.1, .01], [.11, 0], [.05, -.012], [0, -.014]] },
      eye: { u: .075, y: .012, r: .012 },
      style: { back: '#157a66', flank: '#c4c636', belly: '#e9e290', s: [.25, .5, .8], fin: '#c8b21e', iris: '#e8e0a0' },
      extra(c, h) { dots(c, h, 150, 'rgba(30,110,235,0.7)', 2, 4.5, .1, .92, .25, .98); dots(c, h, 60, 'rgba(10,60,50,0.4)', 2, 4, .05, .9, .5, .98); gill(c, h, .17); },
    },
    amberjack: {
      name: '부시리', en: 'Yellowtail Amberjack', L: [0.6, 1.35], wK: 15, body: .82, power: .6, stamina: .7, jump: 0, score: 8, rod: 'reef', spear: true,
      prof: [[0, .006, .006, .005], [.06, .05, .045, .03], [.2, .095, .09, .055], [.4, .11, .105, .06], [.62, .085, .085, .045], [.85, .03, .03, .018], [1, .014, .014, .014]],
      fins: [
        { p: [[.33, .1], [.36, .13], [.42, .1]] }, { p: [[.45, .1], [.48, .16], [.55, .125], [.85, .04], [.86, .02]] }, { p: [[.55, -.09], [.58, -.14], [.64, -.1], [.85, -.04], [.86, -.02]] },
      ],
      tail: forkTail(-.32, .014, .17, -.4),
      pec: { u: .27, y: -.02, sw: .45, dr: .4, pts: [[0, .014], [.05, .02], [.09, .008], [.1, -.002], [.05, -.012], [0, -.014]] },
      eye: { u: .09, y: .015, r: .012 },
      style: { back: '#35473c', flank: '#a7afa6', belly: '#e7e9e5', s: [.28, .5, .72], fin: '#8a7a2c', iris: '#d8d4b0' },
      extra(c, h) { lineAt(c, h, .08, .9, .56, 'rgba(225,190,40,0.6)', 8); gill(c, h, .2); },
    },
    seabream: {
      name: '참돔', en: 'Red Seabream', L: [0.35, 0.9], wK: 21, body: .78, power: .35, stamina: .4, jump: 0, score: 12, rod: 'reef', spear: true,
      prof: [[0, .015, .02, .012], [.07, .1, .07, .035], [.22, .185, .135, .058], [.42, .2, .155, .062], [.65, .135, .12, .045], [.88, .05, .048, .02], [1, .042, .042, .014]],
      fins: [
        { p: [[.26, .17], [.3, .235], [.45, .24], [.6, .2], [.75, .13], [.8, .08], [.3, .15]], col: '#c0503f' },
        { p: [[.55, -.13], [.58, -.19], [.7, -.14], [.8, -.07], [.6, -.1]], col: '#d8806a' }, { p: [[.3, -.13], [.32, -.2], [.4, -.14]], col: '#d8806a' },
      ],
      tail: forkTail(-.28, .04, .17, -.4),
      pec: { u: .25, y: -.03, sw: .6, dr: .5, pts: [[0, .02], [.07, .03], [.15, .012], [.16, 0], [.08, -.018], [0, -.02]] },
      eye: { u: .095, y: .04, r: .02 },
      style: { back: '#b03f36', flank: '#d97a6b', belly: '#f1ddd3', s: [.25, .55, .82], fin: '#b84a3c', iris: '#e8d090' },
      extra(c, h) { dots(c, h, 70, 'rgba(120,195,255,0.85)', 1.8, 3.2, .2, .85, .5, .95); gill(c, h, .21); },
    },
    grouper: {
      name: '자바리', en: 'Longtooth Grouper', L: [0.5, 1.2], wK: 23, body: .8, power: .7, stamina: .5, jump: 0, score: 14, rod: 'reef', spear: true,
      prof: grouperProf, fins: grouperFins, tail: fanTail, pec: fanPec, eye: { u: .105, y: .06, r: .017 },
      style: { back: '#8a7557', flank: '#a8946e', belly: '#d8cbae', s: [.3, .6, .9], fin: '#6a573f', iris: '#c8a850' },
      extra(c, h) {
        for (let i = 0; i < 6; i++) { const u = .2 + i * .12, [t, b] = h.prof(u); c.fillStyle = 'rgba(30,22,14,0.32)'; c.beginPath(); c.ellipse(h.X(u), h.Y((t - b) * .5), 26, (t + b) * h.H * .95, .12, 0, 7); c.fill(); }
        dots(c, h, 34, 'rgba(32,24,16,0.42)', 8, 26, .08, .95, .1, .95); dots(c, h, 160, 'rgba(214,198,160,0.5)', 2, 5, .05, .98, .05, .98);
        gill(c, h, .24); c.strokeStyle = 'rgba(20,14,10,0.6)'; c.lineWidth = 3; c.beginPath(); c.moveTo(h.X(0), h.Y(-.012)); c.quadraticCurveTo(h.X(.06), h.Y(-.03), h.X(.115), h.Y(-.05)); c.stroke();
      },
    },
    giantGrouper: {
      name: '대왕바리', en: 'Giant Grouper', L: [1.5, 2.3], wK: 26, body: .8, power: 1.0, stamina: .8, jump: 0, score: 5, spear: true,
      prof: grouperProf, fins: grouperFins, tail: fanTail, pec: fanPec, eye: { u: .105, y: .06, r: .013 },
      style: { back: '#5e6254', flank: '#7b7d68', belly: '#b3b295', s: [.3, .6, .9], fin: '#42453a', iris: '#b8a850' },
      extra(c, h) {
        dots(c, h, 60, 'rgba(18,20,14,0.45)', 10, 34, .05, .97, .05, .97); dots(c, h, 240, 'rgba(206,190,96,0.42)', 2, 6, .03, .99, .03, .99);
        gill(c, h, .24); c.strokeStyle = 'rgba(10,10,8,0.6)'; c.lineWidth = 3; c.beginPath(); c.moveTo(h.X(0), h.Y(-.012)); c.quadraticCurveTo(h.X(.06), h.Y(-.03), h.X(.115), h.Y(-.05)); c.stroke();
      },
    },
    parrotfish: {
      name: '파랑비늘돔', en: 'Parrotfish', L: [0.3, 0.62], wK: 28, body: .8, power: .2, stamina: .3, jump: 0, score: 18, spear: true,
      prof: [[0, .03, .035, .02], [.06, .09, .08, .045], [.2, .14, .125, .06], [.42, .15, .14, .062], [.65, .12, .11, .048], [.85, .06, .058, .026], [1, .05, .05, .016]],
      fins: [{ p: [[.2, .13], [.24, .172], [.5, .182], [.75, .15], [.8, .08], [.26, .12]], col: '#2f7fd0' }, { p: [[.58, -.11], [.62, -.152], [.76, -.12], [.8, -.07], [.62, -.09]], col: '#2f7fd0' }],
      tail: [[-.29, .05], [-.36, .09], [-.5, .14], [-.46, .06], [-.45, 0], [-.46, -.06], [-.5, -.14], [-.36, -.09], [-.29, -.05]],
      pec: { u: .27, y: -.03, sw: .7, dr: .3, vert: true, pts: [[0, .03], [.06, .05], [.12, .035], [.14, 0], [.1, -.03], [0, -.03]] },
      eye: { u: .12, y: .055, r: .017 },
      style: { back: '#1f8f96', flank: '#35b3a2', belly: '#86d6b2', s: [.3, .6, .9], fin: '#e58aa0', iris: '#f0c070' },
      extra(c, h) {
        c.strokeStyle = 'rgba(255,135,160,0.5)'; c.lineWidth = 2;
        for (let u = .2; u < .95; u += .035) { const [t, b] = h.prof(u); for (let k = 0; k < 7; k++) { c.beginPath(); c.arc(h.X(u + (k % 2) * .017), h.Y(-b + (t + b) * (k + .5) / 7), 11, -1.2, 1.2); c.stroke(); } }
        c.fillStyle = 'rgba(240,240,225,0.9)'; c.beginPath(); c.ellipse(h.X(.012), h.Y(-.004), 14, 16, 0, 0, 7); c.fill(); gill(c, h, .22, 'rgba(255,120,150,0.5)');
      },
    },
    jack: {
      name: '줄전갱이', en: 'Striped Jack', L: [0.24, 0.36], wK: 14, body: .8, power: .1, stamina: .1, jump: 0, score: 30, spear: true, school: true,
      prof: [[0, .008, .008, .006], [.07, .06, .055, .028], [.25, .11, .105, .042], [.45, .115, .11, .042], [.7, .075, .075, .028], [.9, .022, .022, .012], [1, .014, .014, .012]],
      fins: [{ p: [[.36, .1], [.4, .15], [.5, .12], [.85, .035], [.86, .02], [.4, .09]], col: '#8fa0aa' }, { p: [[.5, -.1], [.54, -.14], [.62, -.1], [.85, -.035], [.86, -.02]], col: '#c9c06a' }],
      tail: forkTail(-.3, .014, .17, -.4),
      pec: { u: .27, y: -.02, sw: .5, dr: .4, pts: [[0, .014], [.05, .02], [.09, .008], [.1, -.002], [.05, -.012], [0, -.014]] },
      eye: { u: .1, y: .02, r: .018 },
      style: { back: '#3a6686', flank: '#b8c7d2', belly: '#eff3f5', s: [.25, .45, .7], fin: '#dcc040', iris: '#e8e8d8' },
      extra(c, h) { lineAt(c, h, .1, .9, .6, 'rgba(230,200,50,0.75)', 9); gill(c, h, .21); },
    },
    shark: {
      name: '흉상어', en: 'Bull Shark', L: [2.3, 3.1], wK: 9, body: .76, power: 1, stamina: 1, jump: 0, score: 0,
      prof: [[0, .008, .012, .014], [.05, .034, .03, .042], [.14, .058, .052, .064], [.3, .076, .07, .07], [.5, .07, .07, .06], [.72, .042, .042, .034], [.9, .022, .02, .016], [1, .017, .015, .012]],
      fins: [
        { p: [[.33, .065], [.385, .2], [.41, .2], [.44, .085], [.46, .06]] }, { p: [[.73, .036], [.76, .075], [.79, .036]] },
        { p: [[.74, -.036], [.77, -.07], [.8, -.036]] }, { p: [[.6, -.05], [.64, -.095], [.67, -.045]] },
      ],
      tail: [[-.26, .016], [-.33, .07], [-.5, .23], [-.46, .11], [-.4, .03], [-.385, -.02], [-.44, -.1], [-.42, -.11], [-.33, -.05], [-.26, -.014]],
      pec: { u: .27, y: -.045, sw: .85, dr: .45, pts: [[0, .045], [.1, .05], [.2, .012], [.21, 0], [.12, -.02], [0, -.035]] },
      eye: { u: .066, y: .012, r: .0075 },
      style: { back: '#565f68', flank: '#717a82', belly: '#e8eaec', s: [.42, .52, .6], fin: '#4d555d', iris: '#20242a' },
      extra(c, h) { for (let i = 0; i < 5; i++) { const u = .2 + i * .012, [t, b] = h.prof(u); c.strokeStyle = 'rgba(15,18,22,0.55)'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(h.X(u), h.Y(t * .25)); c.lineTo(h.X(u + .004), h.Y(-b * .45)); c.stroke(); } },
    },
  });
  // not made by the fish builder: things you gather by hand, shoot, or simply meet underwater (dive.js owns their models)
  Object.assign(SP, {
    octopus: { name: '문어', en: 'Common Octopus', L: [0.45, 0.9], wK: 6.5, score: 60, spear: true, hand: true },
    urchin: { name: '보라성게', en: 'Purple Sea Urchin', L: [0.14, 0.21], wK: 40, score: 200, hand: true },
    conch: { name: '거미고둥', en: 'Spider Conch', L: [0.17, 0.28], wK: 45, score: 120, hand: true },
    starfish: { name: '불가사리', en: 'Sea Star', L: [0.16, 0.27], wK: 22, score: 150, hand: true },
    treasure: { name: '해적의 보물상자', en: 'Pirate Treasure', L: [0.7, 0.7], wK: 35, score: 100, hand: true },
    turtle: { name: '푸른바다거북', en: 'Green Sea Turtle', L: [0.9, 1.35], wK: 62, score: 2, watch: true },
  });
  SP.shark.watch = true; SP.shark.score = 1;
  for (const k in SP) SP[k].key = k;

  function profAt(sp, u) {
    const p = sp.prof; let i = 0;
    while (i < p.length - 2 && u > p[i + 1][0]) i++;
    const a = p[Math.max(i - 1, 0)], b = p[i], c = p[i + 1], d = p[Math.min(i + 2, p.length - 1)];
    const t = M.sat((u - b[0]) / (c[0] - b[0])), t2 = t * t, t3 = t2 * t, out = [0, 0, 0];
    for (let k = 1; k <= 3; k++) {
      const m1 = ((c[k] - a[k]) / (c[0] - a[0] || 1)) * (c[0] - b[0]), m2 = ((d[k] - b[k]) / (d[0] - b[0] || 1)) * (c[0] - b[0]);
      out[k - 1] = Math.max((2 * t3 - 3 * t2 + 1) * b[k] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * c[k] + (t3 - t2) * m2, 0.0015);
    }
    return out;
  }

  function projUV(g) {
    const p = g.attributes.position, uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uv[i * 2] = 0.5 - p.getX(i); uv[i * 2 + 1] = (p.getY(i) + 0.25) / 0.5; }
    g.setAttribute('uv', new T.BufferAttribute(uv, 2)); return g;
  }
  function constUV(g, u, v, dv = 0) {      // swatch mapping (eye uses its own v as a gradient)
    const a = g.attributes.uv; for (let i = 0; i < a.count; i++) a.setXY(i, u, v - a.getY(i) * dv); return g;
  }

  function buildGeo(sp, lod) {
    const N = lod ? 12 : 36, Mr = lod ? 8 : 18, parts = [];
    // body
    const pos = new Float32Array(N * Mr * 3), idx = [];
    for (let i = 0; i < N; i++) {
      const u = Math.pow(i / (N - 1), 1.08), [t, b, w] = profAt(sp, u), x = 0.5 - u * sp.body;
      for (let j = 0; j < Mr; j++) {
        const a = (j / Mr) * Math.PI * 2, s = Math.sin(a), c = Math.cos(a), o = (i * Mr + j) * 3;
        pos[o] = x; pos[o + 1] = (s >= 0 ? t : b) * s; pos[o + 2] = w * Math.sign(c) * Math.pow(Math.abs(c), 0.85);
      }
    }
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < Mr; j++) { const j2 = (j + 1) % Mr, a = i * Mr + j, b = i * Mr + j2, c = a + Mr, d = b + Mr; idx.push(a, b, c, b, d, c); }
    for (let j = 1; j < Mr - 1; j++) idx.push((N - 1) * Mr, (N - 1) * Mr + j, (N - 1) * Mr + j + 1);
    const body = new T.BufferGeometry();
    body.setAttribute('position', new T.BufferAttribute(pos, 3)); body.setIndex(idx); body.computeVertexNormals();
    parts.push(projUV(body));
    // median fins + tail (flat, in the XY plane)
    const flat = (pts) => projUV(new T.ShapeGeometry(new T.Shape(pts.map((p) => new T.Vector2(p[0], p[1])))));
    for (const f of sp.fins) parts.push(flat(f.p.map(([u, y]) => [0.5 - u * sp.body, y])));
    parts.push(flat(sp.tail));
    // pectoral fins
    const pc = sp.pec, [, , pw] = profAt(sp, pc.u);
    for (const side of [1, -1]) {
      const O = new T.Vector3(0.5 - pc.u * sp.body, pc.y, pw * 0.92 * side);
      const sAx = new T.Vector3(-Math.cos(pc.sw) * Math.cos(pc.dr), -Math.sin(pc.dr), Math.sin(pc.sw) * Math.cos(pc.dr) * side).normalize();
      const ref = pc.vert ? new T.Vector3(0, 1, 0) : new T.Vector3(1, 0, 0);
      const tAx = ref.clone().addScaledVector(sAx, -ref.dot(sAx)).normalize();
      const v = [];
      for (let i = 1; i < pc.pts.length - 1; i++) for (const k of [0, i, i + 1]) { const p = O.clone().addScaledVector(sAx, pc.pts[k][0]).addScaledVector(tAx, pc.pts[k][1]); v.push(p.x, p.y, p.z); }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(new Float32Array(v), 3)); g.computeVertexNormals();
      g.setAttribute('uv', new T.BufferAttribute(new Float32Array((v.length / 3) * 2), 2));
      parts.push(constUV(g, 80 / TW, 1 - 30 / TH));
    }
    // eyes
    if (!lod) {
      const e = sp.eye, [, , ew] = profAt(sp, e.u);
      for (const side of [1, -1]) {
        const g = G.xf(G.sph(e.r, 12, 8), [0.5 - e.u * sp.body, e.y, (ew * Math.sqrt(Math.max(1 - Math.pow(e.y / profAt(sp, e.u)[0], 2), 0.1)) - e.r * 0.45) * side], [side * Math.PI / 2, 0, 0]);
        parts.push(constUV(g, 6 / TW, 1 - 2 / TH, 60 / TH));
      }
    }
    const geo = G.merge(parts);
    geo.computeBoundingSphere(); geo.boundingSphere.radius *= 1.25;
    return geo;
  }

  function paint(sp) {
    return DB.canvasTex(TW, TH, (c, W, H) => {
      const st = sp.style, X = (u) => u * sp.body * W, XM = (x) => (0.5 - x) * W, Y = (y) => (0.5 - 2 * y) * H;
      const h = { X, XM, Y, W, H, r: M.rng(sp.key.length * 131 + sp.key.charCodeAt(0)), prof: (u) => profAt(sp, M.sat(u)) };
      c.fillStyle = st.fin; c.fillRect(0, 0, W, H);
      const fin = (pts, conv, col) => {
        c.beginPath(); pts.forEach((p, i) => { const q = conv(p); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); c.closePath();
        c.fillStyle = col; c.fill();
        const a = conv(pts[0]), b = conv(pts[pts.length - 1]), bx = (a[0] + b[0]) / 2, by = (a[1] + b[1]) / 2;
        c.save(); c.clip(); c.lineWidth = 1.5;
        for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < 5; k++) {
          const p = conv(pts[i]), q = conv(pts[i + 1]), t = k / 5;
          c.strokeStyle = (i * 5 + k) % 2 ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.1)';
          c.beginPath(); c.moveTo(bx, by); c.lineTo(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t); c.stroke();
        }
        c.restore();
      };
      for (const f of sp.fins) {
        fin(f.p, (p) => [X(p[0]), Y(p[1])], f.col || st.fin);
        if (f.spots) { c.fillStyle = 'rgba(6,10,30,0.7)'; for (let i = 0; i < 60; i++) { c.beginPath(); c.arc(X(.3 + h.r() * .4), Y(.07 + h.r() * .14), 3 + h.r() * 3, 0, 7); c.fill(); } }
      }
      fin(sp.tail, (p) => [XM(p[0]), Y(p[1])], st.tailCol || st.fin);
      // body: counter-shaded strips in normalised body height
      for (let px = 0; px < Math.ceil(X(1)) + 2; px++) {
        const [t, b] = h.prof(px / (W * sp.body)), y0 = Y(t), y1 = Y(-b), g = c.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, st.back); g.addColorStop(st.s[0], st.back); g.addColorStop(st.s[1], st.flank); g.addColorStop(st.s[2], st.belly); g.addColorStop(1, st.belly);
        c.fillStyle = g; c.fillRect(px, y0 - 3, 1, y1 - y0 + 6);
      }
      // scale speckle
      for (let i = 0; i < 2600; i++) {
        const u = h.r(), [t, b] = h.prof(u); c.fillStyle = h.r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
        c.fillRect(X(u), Y(-b + (t + b) * h.r()), 2 + h.r() * 3, 1.5);
      }
      if (sp.extra) sp.extra(c, h);
      // swatches (top-left corner is never covered by a body): eye gradient strip + paired-fin colour
      const eg = c.createLinearGradient(0, 2, 0, 62);
      eg.addColorStop(0, '#020203'); eg.addColorStop(0.3, '#050506'); eg.addColorStop(0.36, st.iris); eg.addColorStop(0.5, st.iris); eg.addColorStop(0.62, st.back); eg.addColorStop(1, st.back);
      c.fillStyle = eg; c.fillRect(0, 0, 14, 64);
      c.fillStyle = sp.pecCol || st.fin; c.fillRect(16, 0, 130, 64);
    }, { repeat: false, aniso: 8 });
  }

  // vertex deformation shared by every fish material (uSwim: phase, amplitude, bend, -)
  const SWIM = /* glsl */ `
uniform vec4 uSwim;
float swimOff(float x, float ph){ float t = clamp(0.5 - x, 0.0, 1.0); return sin(ph - t * 6.0) * uSwim.y * (0.012 + 0.11 * t * t) + uSwim.z * t * t * 0.3; }
float swimSlope(float x, float ph){ return (swimOff(x + 0.01, ph) - swimOff(x - 0.01, ph)) * 50.0; }
`;

  const cache = {};
  const REAL = { tuna: 'fab_tuna', shark: 'fab_shark' };      // species with a real model in assets/fab.js
  const Fish = (DB.Fish = {
    SWIM, profAt,
    get(key, lod = false) {
      const id = key + (lod ? '_lod' : '');
      const real = REAL[key], A = DB.Assets;
      if (!cache[id] && real && A.has(real)) {     // scanned/modelled asset from Fab, already in fish space (+x snout, length 1)
        const m = A.maps(real, A.parts(real)[0].mat), geo = A.geo(real, 0).clone();
        geo.computeBoundingSphere(); geo.boundingSphere.radius *= 1.25;
        cache[id] = { geo, tex: m.map, nor: m.normalMap };
      }
      if (!cache[id]) cache[id] = { geo: buildGeo(SP[key], lod), tex: (cache[key] && cache[key].tex) || paint(SP[key]) };
      return cache[id];
    },
    // random individual of a species (size skewed toward the small end)
    roll(key, rnd = Math.random, bias = 1.8) {
      const sp = SP[key], L = sp.L[0] + (sp.L[1] - sp.L[0]) * Math.pow(rnd(), bias);
      return { key, sp, L, kg: sp.wK * L * L * L };
    },
    // PBR material for fish seen from the boat. Submerged fragments write alpha < 1 so the ocean surface blends over them.
    surfaceMaterial(key) {
      const { tex } = this.get(key);
      const m = new T.MeshPhysicalMaterial({ map: tex, roughness: 0.3, metalness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12, side: T.DoubleSide });
      const u = (m.userData.u = { uSwim: { value: new T.Vector4(0, 1, 0, 0) }, uWaterY: { value: 0 }, uSeaCol: { value: DB.Env.seaColor } });
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, u);
        sh.vertexShader = SWIM + 'varying float vWorldY;\n' + sh.vertexShader
          .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(normal); objectNormal.x -= swimSlope(position.x, uSwim.x) * objectNormal.z; objectNormal = normalize(objectNormal);')
          .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position); transformed.z += swimOff(position.x, uSwim.x);')
          .replace('#include <project_vertex>', '#include <project_vertex>\n vWorldY = (modelMatrix * vec4(transformed, 1.0)).y;');
        sh.fragmentShader = 'uniform float uWaterY; uniform vec3 uSeaCol; varying float vWorldY;\n' + sh.fragmentShader
          .replace('#include <dithering_fragment>', `#include <dithering_fragment>
            float dz = uWaterY - vWorldY;
            if (dz > 0.0) { float k = exp(-dz * 0.55); gl_FragColor.rgb = mix(uSeaCol * 1.2, gl_FragColor.rgb * vec3(0.45, 0.8, 0.95), k); gl_FragColor.a = 1.0 - 0.8 * exp(-dz * 0.9); }`);
      };
      return m;
    },
  });
})();
