// Project Deep Blue — what goes into each asset pack (assets/<pack>.js).
// Edit this file, then:  cd tools && node build_assets.mjs [pack ...]      (no argument = every pack)
//
// Model sources
//   ph:   Poly Haven asset id (CC0) — downloaded through their API and cached in tools/.cache (defaults to `name`)
//   glb:  file in raw/fab/   (downloaded from Fab with tools/fab/fabget.mjs — licence info in raw/fab/credits.json)
//   prep: file in raw/prep/  (a raw/fab model decimated with tools/blender_prep.py; `from` names the original for the credits)
// Model options
//   tex {diff,nor,orm}  texture sizes        split   every node becomes its own part with the origin at its base centre
//   merge  one part per material             skip / only   regex on node names
//   unit   scale factor to metres            rot [x,y,z]   euler applied before packing
//   fish   normalise to the game's creature space (+x snout, +y dorsal, length 1); axes/signs pick the source axes
//   opaque ignore alpha blending in the source material     bleed   the atlas background is pure white: pad the painted islands over it
//   grade {sat, bright}  tone a stylised colour texture down     crop [[x0,x1],[y0,y1],[z0,z1]]  keep what is inside (metres, after unit)
//   metal  use the metalness channel         paint   name of a vertex-colour painter in build_assets.mjs (untextured sculpts)
const T2 = { diff: 1024, nor: 1024, orm: 512 }, T1 = { diff: 512, nor: 512, orm: 256 }, TS = { diff: 512, nor: 256, orm: 256 }, TB = { diff: 1024, nor: 512, orm: 256 };

export const PACKS = {
  props: 'Poly Haven (CC0) — 선상 소품',
  reef: 'Poly Haven (CC0) — 수중 바위·난파선·해저 텍스처',
  fab: 'Fab — Quixel Megascans(Standard License) 산호·바위 + CC-BY 어류·거북·보물상자',
  sea: 'Fab(Megascans·CC-BY) + Poly Haven — 해상 섬·등대·다른 배',
  life: 'Fab — 바다 생물: 상어·고래·게·갯민숭달팽이 등 (CC-BY, Fab Standard License 무료 등급)',
  chars: 'Fab CC-BY — 스키닝 캐릭터와 애니메이션',
};

export const MODELS = [
  // ---- props: on the player boat
  { name: 'lifebuoy', out: 'props', res: '1k', tex: T2 },
  { name: 'life_jacket', out: 'props', res: '1k', tex: T2 },
  { name: 'plastic_crate_02', out: 'props', res: '1k', tex: { diff: 1024, nor: 512, orm: 512 } },
  { name: 'fish_knife', out: 'props', res: '1k', tex: { diff: 512, nor: 512, orm: 512 } },
  { name: 'plastic_thermos', out: 'props', res: '1k', tex: { diff: 512, nor: 512, orm: 512 } },
  { name: 'fishermans_hat', out: 'props', res: '1k', tex: T1 },
  { name: 'ocean_buoy', out: 'props', res: '1k', tex: T2 },
  // ---- reef: underwater set
  { name: 'rock_moss_set_01', out: 'reef', res: '2k', split: true, tex: { diff: 2048, nor: 2048, orm: 1024 } },
  { name: 'rock_moss_set_02', out: 'reef', res: '2k', split: true, tex: { diff: 2048, nor: 2048, orm: 1024 } },
  { name: 'dutch_ship_medium', out: 'reef', res: '2k', skip: /sails/i, tex: { diff: 2048, nor: 1024, orm: 1024 } },
  { name: 'lambis_shell', out: 'reef', res: '1k', tex: T1 },
  // ---- fab: Megascans reef dressing + real fish
  { name: 'fab_corals_a', out: 'fab', glb: 'thai_beach_corals_pack_ufzkbcjfa_mid.glb', split: true, tex: T2 },
  { name: 'fab_corals_b', out: 'fab', glb: 'thai_beach_corals_pack_uf3kbggfa_mid.glb', split: true, tex: T2 },
  { name: 'fab_coral_c', out: 'fab', glb: 'thai_beach_coral_ufilajjfa_mid.glb', split: true, tex: T2 },
  { name: 'fab_coral_d', out: 'fab', glb: 'thai_beach_coral_ufnwacrfa_mid.glb', split: true, tex: T2 },
  { name: 'fab_coral_set', out: 'fab', glb: 'coast_african_coral_set_02_yltqbfv_mid.glb', split: true, tex: T2 },
  { name: 'fab_coral_stone', out: 'fab', glb: 'coral_stone_wfdrdbbr_mid.glb', split: true, tex: T2 },
  { name: 'fab_starfish', out: 'fab', glb: 'starfish_ue3lfejhw_mid.glb', split: true, tex: T1 },
  { name: 'fab_shells', out: 'fab', glb: 'coast_japanese_shell_sea_mixed_small_xdlafe0_mid.glb', split: true, tex: T1 },
  { name: 'fab_beach_rocks', out: 'fab', glb: 'thai_beach_rocks_ueukcjega_mid.glb', split: true, tex: T2 },
  { name: 'fab_boulder', out: 'fab', glb: 'beach_boulder_wepodfl_mid.glb', split: true, tex: T2 },
  { name: 'fab_rock_formation', out: 'fab', glb: 'beach_rock_formation_wgggfcb_mid.glb', split: true, tex: T2 },
  { name: 'fab_tuna', out: 'fab', glb: 'tuna_fish.glb', fish: true, axes: [2, 1, 0], signs: [1, 1, -1], tex: T2 },
  { name: 'fab_shark', out: 'fab', glb: 'shark.glb', fish: true, axes: [0, 1, 2], signs: [-1, 1, -1], tex: T2 },
  { name: 'fab_turtle', out: 'fab', prep: 'turtle.glb', from: 'turtle.glb', fish: true, axes: [0, 1, 2], signs: [1, 1, 1], paint: 'turtle' },
  { name: 'fab_chest', out: 'fab', glb: 'treasure_chest.glb', merge: true, metal: true, tex: TS },
  // ---- life: more animals. Rigged models are used in their bind pose; the swim comes from the vertex shader.
  { name: 'fab_orca', out: 'life', glb: 'orca4.glb', fish: true, axes: [1, 2, 0], signs: [-1, 1, -1], bleed: true, tex: TB },
  { name: 'fab_spermwhale', out: 'life', prep: 'sperm_whale.glb', from: 'sperm_whale_007.blend', fish: true, axes: [1, 2, 0], signs: [-1, 1, -1], paint: 'spermWhale' },
  { name: 'fab_greatwhite', out: 'life', prep: 'great_white.glb', from: 'shark_low_poly.glb', fish: true, skip: /EYES/, merge: true, tex: T2 },
  { name: 'fab_pyjama', out: 'life', glb: 'pyjama_shark_endangered_free.glb', fish: true, axes: [1, 2, 0], signs: [1, -1, -1], tex: T1 },
  { name: 'fab_mullet', out: 'life', glb: 'animated_low_poly_fish.glb', fish: true, axes: [1, 2, 0], signs: [1, 1, 1], tex: TS },
  { name: 'fab_crab', out: 'life', glb: 'blue_crab.glb', fish: true, tex: T1 },
  { name: 'fab_seaslug', out: 'life', prep: 'sea_slug.glb', from: 'sea_slug_chromodoris_annae.glb', fish: true, axes: [1, 2, 0], signs: [1, 1, 1], merge: true, opaque: true, tex: TS },
  { name: 'fab_seadragon', out: 'life', prep: 'seadragon.glb', from: 'day67_weedy_seadragon.glb', fish: true, axes: [2, 1, 0], signs: [1, 1, 1], paint: 'seadragon' },
  { name: 'fab_humpback', out: 'life', prep: 'humpback.glb', from: 'free_stylized_whales.zip', fish: true, axes: [2, 1, 0], signs: [1, 1, 1], grade: { sat: 0.3, bright: 0.8 }, tex: T2 },
  { name: 'fab_skeleton', out: 'life', prep: 'skeleton.glb', from: 'sm_human_skeleton.glb', unit: 0.78, crop: [[-0.45, 0.45], null, null], merge: true },      // the file also holds every bone laid out beside the assembled figure      // the ghost ship's crew (drawn in ghost light: no textures needed)
  // ---- sea: what you see from the deck
  { name: 'cliff_a', out: 'sea', glb: 'massive_nordic_coastal_cliff_vdssailfa_mid.glb', tex: { diff: 2048, nor: 1024, orm: 512 } },
  { name: 'cliff_b', out: 'sea', glb: 'huge_nordic_coastal_cliff_venrdcgga_mid.glb', tex: TB },
  { name: 'cliff_c', out: 'sea', glb: 'huge_nordic_coastal_cliff_vefkehbva_mid.glb', tex: TB },
  { name: 'cliff_d', out: 'sea', glb: 'massive_nordic_coastal_cliff_vfmjadufa_mid.glb', tex: TB },
  { name: 'lighthouse', out: 'sea', prep: 'lighthouse.glb', from: 'lighthouse.glb', merge: true, rot: [Math.PI, 0, 0], tex: TS },
  { name: 'palm', out: 'sea', glb: 'free_game_ready_palm.glb', merge: true, unit: 0.23, tex: { diff: 1024, nor: 256, orm: 256 } },
  { name: 'rowboat', out: 'sea', glb: 'wooden_boat_vemgdcmbw_mid.glb', tex: TB },
  { name: 'barrel', out: 'sea', glb: 'wooden_barrel_tmgpcg2fa_mid.glb', tex: TS },
  { name: 'npc_boat_wood', out: 'sea', glb: 'fishing_boat.glb', tex: TB },
  { name: 'npc_boat_aberdeen', out: 'sea', prep: 'fishing_boat_catling.glb', from: 'fishing_boat_charliecatling.glb', merge: true, metal: true, tex: TB },
  { name: 'npc_trawler', out: 'sea', prep: 'trawler.glb', from: 'trawler.glb', merge: true, metal: true, tex: TS },
  { name: 'dutch_ship_sails', out: 'sea', ph: 'dutch_ship_medium', res: '2k', only: /sails/i, tex: { diff: 1024, nor: 512, orm: 256 } },
];

export const TEXTURES = [
  { name: 'coast_sand_01', out: 'reef', res: '1k', size: { diff: 1024, nor: 1024, rough: 512 } },
  { name: 'coral_fort_wall_02', out: 'reef', res: '1k', size: { diff: 1024, nor: 1024, rough: 512 } },
  { name: 'coral_ground_02', out: 'reef', res: '1k', size: { diff: 1024, nor: 1024, rough: 512 } },
  { name: 'jersey_melange', out: 'props', res: '1k', size: { diff: 512, nor: 512, rough: 256 } },
  { name: 'knitted_fleece', out: 'props', res: '1k', size: { diff: 512, nor: 512, rough: 256 } },
];

// Skinned characters. height: metres the bind pose is scaled to. clips: own animation (anim = its glTF name or a regex),
// or one retargeted from another rig with the same bone names (from = file in raw/fab).
export const CHARS = [
  {
    name: 'crew', out: 'chars', glb: 'rumba_dancing_female_character.glb', height: 1.68, tex: { diff: 2048, nor: 512, orm: 256 },
    clips: [
      { name: 'dance', anim: 'mixamo.com', fps: 30 },
      { name: 'idle', from: 'thailand_girl_animated.glb', anim: 'idle', fps: 20 },
      { name: 'walk', from: 'thailand_girl_animated.glb', anim: 'walking', fps: 30, inPlace: true },
    ],
  },
  { name: 'fisherman', out: 'chars', prep: 'fisherman.glb', from: 'fisherman.glb', height: 1.74, tex: TB, clips: [{ name: 'idle', anim: /idol/i, fps: 15 }] },
];
