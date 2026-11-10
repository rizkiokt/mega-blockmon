'use strict';
/* ---------- helpers ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rand(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function pickWeighted(entries) {
  let total = 0;
  for (const e of entries) total += e[1];
  let r = Math.random() * total;
  for (const e of entries) { r -= e[1]; if (r <= 0) return e[0]; }
  return entries[entries.length - 1][0];
}

/* ---------- types ---------- */
const TYPES = {
  fire:     { name: 'Fire',     color: '#ff6b35' },
  water:    { name: 'Water',    color: '#3a86ff' },
  grass:    { name: 'Grass',    color: '#40916c' },
  electric: { name: 'Electric', color: '#e9b106' },
  rock:     { name: 'Rock',     color: '#9c7b55' },
  air:      { name: 'Air',      color: '#5fa8d3' },
  shadow:   { name: 'Shadow',   color: '#6a4c93' },
  ice:      { name: 'Ice',      color: '#2fb3d1' },
  normal:   { name: 'Normal',   color: '#e07a9f' },
  cosmic:   { name: 'Cosmic',   color: '#9d4edd' },
  psychic:  { name: 'Psychic',  color: '#e0479e' },
};

/* ---------- families (evolution lines) ---------- */
// colors: [primary, secondary/belly, dark/outline]; split: attack/defense/stamina weighting
const FAMILIES = {
  ember:  { type: 'fire',     colors: ['#ff7b3a', '#ffd166', '#9d0208'], megaColor: '#ffe45e', split: [1.25, 0.85, 0.9], hasMega: true },
  aqua:   { type: 'water',    colors: ['#3a86ff', '#a9def9', '#023e8a'], megaColor: '#72efdd', split: [1.0, 1.1, 1.0],  hasMega: true },
  sprout: { type: 'grass',    colors: ['#57cc99', '#e9f5db', '#1b4332'], megaColor: '#f15bb5', split: [1.0, 1.0, 1.1],  hasMega: true },
  zap:    { type: 'electric', colors: ['#ffd60a', '#fff3b0', '#9a3c00'], megaColor: '#4cc9f0', split: [1.3, 0.8, 0.85], hasMega: true },
  pebble: { type: 'rock',     colors: ['#a68a64', '#e6ccb2', '#3e2a1a'], megaColor: '#ff9f1c', split: [1.0, 1.4, 0.9],  hasMega: true },
  gust:   { type: 'air',      colors: ['#9bd1f2', '#ffffff', '#3d3f9e'], megaColor: null,      split: [1.1, 0.85, 1.0], hasMega: false },
  shade:  { type: 'shadow',   colors: ['#7b4fb8', '#d0bfff', '#240046'], megaColor: '#ff0a54', split: [1.3, 0.9, 0.85], hasMega: true },
  frost:  { type: 'ice',      colors: ['#90e0ef', '#f1faff', '#0a5f99'], megaColor: null,      split: [1.0, 1.15, 1.05], hasMega: false },
  blob:   { type: 'normal',   colors: ['#f8a5c2', '#fff0f5', '#a4133c'], megaColor: null,      split: [0.8, 0.9, 1.4],  hasMega: false },
  mind:   { type: 'psychic',  colors: ['#d5dde9', '#2ec4c6', '#1f2a44'], megaColor: '#ff3fd2', split: [1.5, 0.85, 0.95], hasMega: true },
  prism:  { type: 'cosmic',   colors: ['#c77dff', '#ffffff', '#3c096c'], megaColor: '#00f5d4', split: [1.2, 1.1, 1.1],  hasMega: true },
};

/* ---------- species ---------- */
function sp(dex, id, name, family, stage, power, catchRate, flee, evolvesTo, evolveCost, desc, extra) {
  return Object.assign({ dex, id, name, family, stage, power, catchRate, flee, evolvesTo, evolveCost, desc }, extra || {});
}
const SPECIES = [
  sp(1,  'flamlet',   'Flamlet',   'ember', 1, 118, 0.45, 0.10, 'flamboar', 25, 'A warm little cube of embers. Its tail-flame flickers brighter when it is happy.'),
  sp(2,  'flamboar',  'Flamboar',  'ember', 2, 172, 0.22, 0.07, 'infernox', 75, 'Charges in straight lines, leaving scorched square tracks behind it.'),
  sp(3,  'infernox',  'Infernox',  'ember', 3, 238, 0.10, 0.05, null, 0, 'Its body is stacked from blazing blocks hotter than a forge.'),
  sp(4,  'aquabit',   'Aquabit',   'aqua',  1, 112, 0.45, 0.10, 'tidecube', 25, 'Blows perfectly square bubbles. It wobbles like jelly on land.'),
  sp(5,  'tidecube',  'Tidecube',  'aqua',  2, 168, 0.22, 0.07, 'leviablock', 75, 'Rides the waves standing perfectly upright on its flat base.'),
  sp(6,  'leviablock','Leviablock','aqua',  3, 240, 0.10, 0.05, null, 0, 'Ancient sailors mistook its back for a floating stone island.'),
  sp(7,  'sproutle',  'Sproutle',  'sprout',1, 115, 0.45, 0.10, 'thornbloc', 25, 'Soaks up sunlight through the leafy block on its head.'),
  sp(8,  'thornbloc', 'Thornbloc', 'sprout',2, 165, 0.22, 0.07, 'verdigon', 75, 'Its vines snap into place like building bricks.'),
  sp(9,  'verdigon',  'Verdigon',  'sprout',3, 235, 0.10, 0.05, null, 0, 'Forests regrow wherever this gentle giant takes a nap.'),
  sp(10, 'zappix',    'Zappix',    'zap',   1, 120, 0.42, 0.12, 'voltcube', 40, 'Stores static electricity by rubbing its corners together.'),
  sp(11, 'voltcube',  'Voltcube',  'zap',   2, 210, 0.15, 0.06, null, 0, 'Its crackling body could power a whole town for a day.'),
  sp(12, 'pebbit',    'Pebbit',    'pebble',1, 110, 0.45, 0.08, 'bouldra', 25, 'Often mistaken for an ordinary pebble, until it hops away.'),
  sp(13, 'bouldra',   'Bouldra',   'pebble',2, 160, 0.22, 0.06, 'monolith', 75, 'Rolls downhill on purpose. It finds this hilarious.'),
  sp(14, 'monolith',  'Monolith',  'pebble',3, 230, 0.10, 0.04, null, 0, 'Stands motionless for centuries, then suddenly wanders off.'),
  sp(15, 'gustling',  'Gustling',  'gust',  1, 105, 0.45, 0.14, 'galeon', 40, 'Light as a feather. A strong sneeze can blow it across a meadow.'),
  sp(16, 'galeon',    'Galeon',    'gust',  2, 190, 0.16, 0.08, null, 0, 'Its wingbeats whip up tiny square tornadoes.'),
  sp(17, 'shadeling', 'Shadeling', 'shade', 1, 114, 0.40, 0.12, 'umbrix', 25, 'Hides in the shadows of blocks. Only its eyes give it away.'),
  sp(18, 'umbrix',    'Umbrix',    'shade', 2, 170, 0.20, 0.08, 'noctyrant', 75, 'Swallows lantern light and grows a little darker each night.'),
  sp(19, 'noctyrant', 'Noctyrant', 'shade', 3, 245, 0.09, 0.05, null, 0, 'Rules the night. Even the moon seems to dim when it roars.'),
  sp(20, 'frostbit',  'Frostbit',  'frost', 1, 112, 0.45, 0.10, 'glacieron', 40, 'Freezes puddles into perfect ice cubes just for fun.'),
  sp(21, 'glacieron', 'Glacieron', 'frost', 2, 200, 0.16, 0.06, null, 0, 'Its breath can build an igloo in a single exhale.'),
  sp(22, 'blobby',    'Blobby',    'blob',  1, 100, 0.55, 0.05, null, 0, 'Squishy, friendly and everywhere. Nobody has ever seen it evolve.'),
  sp(23, 'prismax',   'Prismax',   'prism', 1, 270, 0.05, 0.12, null, 0, 'A legendary Blockmon said to be carved from a fallen star.', { legendary: true }),
  sp(24, 'mindrax',   'Mindrax',   'mind',  1, 300, 0.03, 0.10, null, 0, 'Engineered in a hidden lab from a single ancient block. Its mind is sharper than any blade, and it trusts no one.', { legendary: true }),
];
const SPECIES_BY_ID = {};
for (const s of SPECIES) SPECIES_BY_ID[s.id] = s;
const FAMILY_BASE = {}; // family id -> first-stage species
for (const s of SPECIES) if (s.stage === 1) FAMILY_BASE[s.family] = s;
function familyChain(fid) { return SPECIES.filter(s => s.family === fid).sort((a, b) => a.stage - b.stage); }
function canMega(spc) { return !spc.evolvesTo && FAMILIES[spc.family].hasMega; }

/* ---------- blocks (catching items) ---------- */
const BLOCKS = {
  basic: { name: 'Block',       mult: 1.0, colors: ['#7ee0ff', '#3fa7d6', '#1d6fa3'], desc: 'A standard capture block.' },
  super: { name: 'Super Block', mult: 1.5, colors: ['#ff8fd0', '#e0479e', '#9c1a6e'], desc: 'Higher catch rate than a Block.' },
  ultra: { name: 'Ultra Block', mult: 2.0, colors: ['#ffe066', '#f2b705', '#3a3a3a'], desc: 'Very high catch rate.' },
  premier: { name: 'Premier Block', mult: 1.0, colors: ['#ffffff', '#e5e5e5', '#d62828'], desc: 'Earned in raids. Only usable on a defeated raid boss.' },
};
const BLOCK_ORDER = ['basic', 'super', 'ultra'];
const MEGA_COST = 150;

/* ---------- battle: type chart (Pokémon GO-style multipliers) ---------- */
const SE = 1.6, NVE = 0.625, IMM = 0.390625;
const TYPE_CHART = {
  fire:     { grass: SE, ice: SE, fire: NVE, water: NVE, rock: NVE },
  water:    { fire: SE, rock: SE, water: NVE, grass: NVE, ice: NVE },
  grass:    { water: SE, rock: SE, fire: NVE, grass: NVE, air: NVE },
  electric: { water: SE, air: SE, electric: NVE, grass: NVE, rock: IMM },
  rock:     { fire: SE, ice: SE, air: SE, rock: NVE },
  air:      { grass: SE, electric: NVE, rock: NVE },
  shadow:   { shadow: SE, cosmic: SE, psychic: SE, normal: NVE },
  ice:      { grass: SE, air: SE, fire: NVE, water: NVE, ice: NVE },
  normal:   { rock: NVE, shadow: IMM },
  cosmic:   { shadow: SE, cosmic: NVE },
  psychic:  { normal: SE, rock: SE, psychic: NVE, shadow: IMM },
};
function effectiveness(moveType, defType) { return (TYPE_CHART[moveType] || {})[defType] || 1; }

/* ---------- moves ----------
   fast: power, energy gained, duration (s).  charged: power, energy cost (33/50/100 = 3/2/1 bars) */
const MOVES = {
  ember:        { name: 'Ember',         type: 'fire',     kind: 'fast', power: 10, energy: 10, dur: 1.0 },
  fire_fang:    { name: 'Fire Fang',     type: 'fire',     kind: 'fast', power: 12, energy: 8,  dur: 0.9 },
  flame_charge: { name: 'Flame Charge',  type: 'fire',     kind: 'charged', power: 70,  cost: 33 },
  inferno:      { name: 'Inferno Blast', type: 'fire',     kind: 'charged', power: 140, cost: 100 },
  water_gun:    { name: 'Water Gun',     type: 'water',    kind: 'fast', power: 5,  energy: 6,  dur: 0.5 },
  bubble:       { name: 'Bubble',        type: 'water',    kind: 'fast', power: 12, energy: 14, dur: 1.2 },
  aqua_jet:     { name: 'Aqua Jet',      type: 'water',    kind: 'charged', power: 45,  cost: 33 },
  hydro_burst:  { name: 'Hydro Burst',   type: 'water',    kind: 'charged', power: 130, cost: 100 },
  vine_whip:    { name: 'Vine Whip',     type: 'grass',    kind: 'fast', power: 7,  energy: 7,  dur: 0.6 },
  razor_leaf:   { name: 'Razor Leaf',    type: 'grass',    kind: 'fast', power: 13, energy: 7,  dur: 1.0 },
  seed_bomb:    { name: 'Seed Bomb',     type: 'grass',    kind: 'charged', power: 55,  cost: 33 },
  solar_beam:   { name: 'Solar Beam',    type: 'grass',    kind: 'charged', power: 180, cost: 100 },
  spark:        { name: 'Spark',         type: 'electric', kind: 'fast', power: 6,  energy: 9,  dur: 0.7 },
  thunder_shock:{ name: 'Thunder Shock', type: 'electric', kind: 'fast', power: 5,  energy: 8,  dur: 0.6 },
  discharge:    { name: 'Discharge',     type: 'electric', kind: 'charged', power: 65,  cost: 33 },
  thunderbolt:  { name: 'Thunderbolt',   type: 'electric', kind: 'charged', power: 80,  cost: 50 },
  rock_throw:   { name: 'Rock Throw',    type: 'rock',     kind: 'fast', power: 12, energy: 7,  dur: 0.9 },
  pebble_shot:  { name: 'Pebble Shot',   type: 'rock',     kind: 'fast', power: 8,  energy: 9,  dur: 0.8 },
  rock_slide:   { name: 'Rock Slide',    type: 'rock',     kind: 'charged', power: 80,  cost: 50 },
  stone_edge:   { name: 'Stone Edge',    type: 'rock',     kind: 'charged', power: 100, cost: 100 },
  gust_move:    { name: 'Gust',          type: 'air',      kind: 'fast', power: 16, energy: 12, dur: 1.4 },
  wing_attack:  { name: 'Wing Attack',   type: 'air',      kind: 'fast', power: 8,  energy: 9,  dur: 0.8 },
  air_cutter:   { name: 'Air Cutter',    type: 'air',      kind: 'charged', power: 60,  cost: 50 },
  hurricane:    { name: 'Hurricane',     type: 'air',      kind: 'charged', power: 110, cost: 100 },
  shadow_claw:  { name: 'Shadow Claw',   type: 'shadow',   kind: 'fast', power: 9,  energy: 6,  dur: 0.7 },
  lick:         { name: 'Lick',          type: 'shadow',   kind: 'fast', power: 5,  energy: 6,  dur: 0.5 },
  shadow_ball:  { name: 'Shadow Ball',   type: 'shadow',   kind: 'charged', power: 100, cost: 50 },
  night_fall:   { name: 'Nightfall',     type: 'shadow',   kind: 'charged', power: 150, cost: 100 },
  frost_breath: { name: 'Frost Breath',  type: 'ice',      kind: 'fast', power: 10, energy: 8,  dur: 0.9 },
  ice_shard:    { name: 'Ice Shard',     type: 'ice',      kind: 'fast', power: 12, energy: 12, dur: 1.2 },
  ice_beam:     { name: 'Ice Beam',      type: 'ice',      kind: 'charged', power: 90,  cost: 50 },
  blizzard:     { name: 'Blizzard',      type: 'ice',      kind: 'charged', power: 130, cost: 100 },
  tackle:       { name: 'Tackle',        type: 'normal',   kind: 'fast', power: 5,  energy: 5,  dur: 0.5 },
  quick_hit:    { name: 'Quick Hit',     type: 'normal',   kind: 'fast', power: 8,  energy: 10, dur: 0.8 },
  body_slam:    { name: 'Body Slam',     type: 'normal',   kind: 'charged', power: 50,  cost: 33 },
  hyper_smash:  { name: 'Hyper Smash',   type: 'normal',   kind: 'charged', power: 150, cost: 100 },
  star_shard:   { name: 'Star Shard',    type: 'cosmic',   kind: 'fast', power: 12, energy: 12, dur: 1.0 },
  prism_beam:   { name: 'Prism Beam',    type: 'cosmic',   kind: 'charged', power: 120, cost: 50 },
  confusion:    { name: 'Confusion',     type: 'psychic',  kind: 'fast', power: 16, energy: 12, dur: 1.4 },
  psycho_cut:   { name: 'Psycho Cut',    type: 'psychic',  kind: 'fast', power: 5,  energy: 8,  dur: 0.6 },
  psy_burst:    { name: 'Psy Burst',     type: 'psychic',  kind: 'charged', power: 90,  cost: 50 },
  mind_storm:   { name: 'Mind Storm',    type: 'psychic',  kind: 'charged', power: 160, cost: 100 },
};
const TYPE_MOVES = {
  fire:     { fast: ['ember', 'fire_fang'],        charged: ['flame_charge', 'inferno'] },
  water:    { fast: ['water_gun', 'bubble'],       charged: ['aqua_jet', 'hydro_burst'] },
  grass:    { fast: ['vine_whip', 'razor_leaf'],   charged: ['seed_bomb', 'solar_beam'] },
  electric: { fast: ['spark', 'thunder_shock'],    charged: ['discharge', 'thunderbolt'] },
  rock:     { fast: ['rock_throw', 'pebble_shot'], charged: ['rock_slide', 'stone_edge'] },
  air:      { fast: ['gust_move', 'wing_attack'],  charged: ['air_cutter', 'hurricane'] },
  shadow:   { fast: ['shadow_claw', 'lick'],       charged: ['shadow_ball', 'night_fall'] },
  ice:      { fast: ['frost_breath', 'ice_shard'], charged: ['ice_beam', 'blizzard'] },
  normal:   { fast: ['tackle', 'quick_hit'],       charged: ['body_slam', 'hyper_smash'] },
  cosmic:   { fast: ['star_shard', 'shadow_claw'], charged: ['prism_beam', 'night_fall'] },
  psychic:  { fast: ['confusion', 'psycho_cut'],   charged: ['psy_burst', 'mind_storm'] },
};
function typeOf(spc) { return FAMILIES[spc.family].type; }
function movePool(spc) {
  const tm = TYPE_MOVES[typeOf(spc)];
  return { fast: tm.fast.concat(typeOf(spc) === 'normal' ? [] : ['tackle']), charged: tm.charged.concat(typeOf(spc) === 'normal' ? [] : ['body_slam']) };
}

/* ---------- items ---------- */
const ITEMS = {
  berry:    { name: 'Razz Berry',   desc: 'Feed to a wild Blockmon: next throw is 1.5× easier to catch.' },
  golden:   { name: 'Golden Berry', desc: 'Feed to a wild Blockmon: next throw is 2.5× easier to catch.' },
  potion:   { name: 'Potion',       desc: 'Restores 20 HP to a Blockmon.' },
  superPotion: { name: 'Super Potion', desc: 'Restores 60 HP to a Blockmon.' },
  revive:   { name: 'Revive',       desc: 'Revives a fainted Blockmon to half HP.' },
  raidPass: { name: 'Raid Pass',    desc: 'Lets you join a raid battle at a gym.' },
  incubator:{ name: 'Incubator',    desc: 'Single-use incubator (3 uses). Your infinite incubator never runs out.' },
};
const EGG_POOLS = {
  2:  ['flamlet', 'aquabit', 'sproutle', 'blobby', 'pebbit', 'gustling'],
  5:  ['zappix', 'shadeling', 'frostbit', 'flamlet', 'aquabit', 'sproutle'],
  10: ['shadeling', 'zappix', 'frostbit', 'pebbit'],
};
const SHINY_RATE = 1 / 64;
const TEAM_COLORS = ['#ff4d6d', '#3a86ff', '#ffd60a'];
