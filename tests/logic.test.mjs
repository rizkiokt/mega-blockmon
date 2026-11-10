// Unit tests for the game rules. The game ships as plain browser scripts, so we
// load them into a VM context with a tiny DOM stub instead of a bundler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function load() {
  const store = new Map();
  const ctx = {
    console, Math, Date, JSON, performance,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { createElement: () => ({ getContext: () => ({}) }) },
    location: { reload() {} },
  };
  vm.createContext(ctx);
  // top-level const/let don't leak to the context object, so re-export what tests need
  const src = ['data', 'sprites', 'state'].map(f => readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8')).join('\n')
    + '\n;globalThis.__t = { SPECIES, SPECIES_BY_ID, FAMILIES, MOVES, TYPE_CHART, effectiveness, movePool, canMega, MEGA_COST, Game, Sprites, getS: () => S };';
  vm.runInContext(src, ctx);
  const t = ctx.__t;
  t.Game.load();
  return t;
}

test('every species has a valid family, evolution target and move pool', () => {
  const { SPECIES, SPECIES_BY_ID, FAMILIES, MOVES, movePool } = load();
  for (const s of SPECIES) {
    assert.ok(FAMILIES[s.family], s.id);
    if (s.evolvesTo) {
      const to = SPECIES_BY_ID[s.evolvesTo];
      assert.ok(to, `${s.id} -> ${s.evolvesTo}`);
      assert.equal(to.stage, s.stage + 1);
      assert.equal(to.family, s.family);
      assert.ok(s.evolveCost > 0);
    }
    const p = movePool(s);
    for (const m of p.fast) assert.equal(MOVES[m].kind, 'fast', m);
    for (const m of p.charged) assert.equal(MOVES[m].kind, 'charged', m);
  }
});

test('type chart uses GO multipliers', () => {
  const { effectiveness } = load();
  assert.equal(effectiveness('fire', 'grass'), 1.6);
  assert.equal(effectiveness('fire', 'water'), 0.625);
  assert.equal(effectiveness('electric', 'rock'), 0.390625);
  assert.equal(effectiveness('normal', 'fire'), 1);
});

test('CP grows with level and mega evolution', () => {
  const { Game } = load();
  const m = Game.createMon('infernox', 10, { shiny: false });
  const cp10 = Game.cp(m);
  m.level = 20;
  const cp20 = Game.cp(m);
  m.mega = true;
  assert.ok(cp20 > cp10);
  assert.ok(Game.cp(m) > cp20);
});

test('catch chance improves with better blocks, throws, curveballs and berries', () => {
  const { Game } = load();
  const m = Game.createMon('flamboar', 10);
  const base = Game.catchChance(m, { block: 1 });
  assert.ok(Game.catchChance(m, { block: 2 }) > base);
  assert.ok(Game.catchChance(m, { block: 1, q: 'Excellent' }) > Game.catchChance(m, { block: 1, q: 'Nice' }));
  assert.ok(Game.catchChance(m, { block: 1, curve: true }) > base);
  assert.ok(Game.catchChance(m, { block: 1, berry: 2.5 }) > Game.catchChance(m, { block: 1, berry: 1.5 }));
  assert.ok(Game.catchChance(m, { block: 2, q: 'Excellent', curve: true, berry: 2.5 }) <= 1);
});

test('catching grants shards, dust, XP and a Blockdex entry', () => {
  const { Game, getS } = load();
  const S = getS();
  const m = Game.createMon('aquabit', 5);
  const r = Game.catchMon(m, 'Great', false);
  assert.ok(r.isNew);
  assert.equal(S.dex.aquabit, 2);
  assert.equal(S.shards.aqua, r.shards);
  assert.ok(m.uid > 0);
});

test('evolution spends shards and changes species; mega needs final stage and energy', () => {
  const { Game, getS, MEGA_COST } = load();
  const S = getS();
  const m = Game.addMon(Game.createMon('flamlet', 10));
  assert.equal(Game.evolve(m.uid), null, 'cannot evolve without shards');
  S.shards.ember = 200;
  assert.equal(Game.evolve(m.uid).to.id, 'flamboar');
  assert.equal(S.shards.ember, 175);
  assert.equal(Game.megaEvolve(m.uid), null, 'stage 2 cannot mega evolve');
  Game.evolve(m.uid);
  assert.equal(m.speciesId, 'infernox');
  assert.equal(Game.megaEvolve(m.uid), null, 'needs mega energy');
  S.energy.ember = MEGA_COST;
  assert.ok(Game.megaEvolve(m.uid));
  assert.equal(m.mega, true);
  assert.equal(S.megaDex.infernox, true);
  assert.equal(S.energy.ember, 0);
});

test('non-mega families cannot mega evolve', () => {
  const { Game, getS } = load();
  const S = getS();
  const m = Game.addMon(Game.createMon('galeon', 10));
  S.energy.gust = 999;
  assert.equal(Game.megaEvolve(m.uid), null);
});

test('power up respects trainer level cap and costs', () => {
  const { Game, getS } = load();
  const S = getS();
  const m = Game.addMon(Game.createMon('pebbit', 2));
  S.shards.pebble = 50; S.trainer.dust = 100000;
  assert.ok(Game.powerUp(m.uid));
  assert.equal(m.level, 3);
  m.level = Game.maxLevel();
  assert.equal(Game.powerUp(m.uid), false);
});

test('walking hatches an incubated egg', () => {
  const { Game, getS } = load();
  const S = getS();
  let hatched = null;
  Game.hooks.hatch = m => { hatched = m; };
  Game.start('Ash', 'sproutle', 1);
  const before = S.mons.length;
  Game.walk(1.0);
  assert.equal(hatched, null);
  Game.walk(1.01);
  assert.ok(hatched);
  assert.equal(S.mons.length, before + 1);
  assert.equal(S.eggs.length, 0);
  assert.ok(hatched.iv.a >= 10 && hatched.iv.d >= 10 && hatched.iv.s >= 10);
});

test('healing items behave like potions and revives', () => {
  const { Game, getS } = load();
  const S = getS();
  const m = Game.addMon(Game.createMon('blobby', 20));
  m.hpCur = 0;
  assert.equal(Game.heal(m.uid, 'potion'), false, 'potion cannot revive');
  assert.ok(Game.heal(m.uid, 'revive'));
  assert.equal(Game.curHp(m), Math.ceil(Game.maxHp(m) / 2));
  S.items.superPotion = 1;
  assert.ok(Game.heal(m.uid, 'superPotion'));
});

test('super-effective attacks deal more damage', () => {
  const { Game, MOVES } = load();
  const att = Game.fighter(Game.createMon('flamboar', 20));
  const grass = Game.fighter(Game.createMon('thornbloc', 20));
  const water = Game.fighter(Game.createMon('tidecube', 20));
  assert.ok(Game.damage(att, grass, MOVES.ember) > Game.damage(att, water, MOVES.ember));
});

// Crude raid simulation: a solo party of six level-25 stage-2s should beat a tier-1 raid
// in time, and a level-10 party should not beat a tier-5 raid (raids must stay a challenge).
function simulateRaid(t, raid, level) {
  const { Game, SPECIES } = t;
  const info = Game.raidInfo(raid);
  const boss = Game.fighter({ speciesId: raid.speciesId, level: 20, iv: { a: 15, d: 15, s: 15 }, mega: raid.mega, fast: 'tackle', charged: 'body_slam' }, { cpm: info.cpm, hp: info.hp });
  const picks = SPECIES.filter(s => s.stage === 2).slice(0, 6);
  let dealt = 0, time = 0;
  for (const s of picks) {
    const f = Game.fighter(Game.createMon(s.id, level));
    let hp = f.hp, energy = 0;
    while (hp > 0 && time < info.time) {
      let dmg;
      if (energy >= f.charged.cost) { energy -= f.charged.cost; dmg = Game.damage(f, boss, f.charged); time += 0.9; }
      else { dmg = Game.damage(f, boss, f.fast); energy += f.fast.energy; time += f.fast.dur; }
      dealt += dmg;
      hp -= Game.damage(boss, f, boss.fast) * (f.fast.dur / 2.0); // boss attacks ~every 2s
    }
  }
  return dealt >= info.hp;
}
test('raids are winnable solo at tier 1 but tier 5 needs a strong team', () => {
  const t = load();
  assert.ok(simulateRaid(t, { tier: 1, speciesId: 'flamlet', mega: false }, 25));
  assert.equal(simulateRaid(t, { tier: 5, speciesId: 'prismax', mega: false }, 10), false);
});

test('creature art: every family has a body plan, stages grow, and figures fit the frame', () => {
  const { SPECIES, FAMILIES, canMega, Sprites } = load();
  for (const f of Object.keys(FAMILIES)) assert.ok(Sprites.LOOKS[f], `look for ${f}`);
  for (const s of SPECIES) {
    for (const mega of [false].concat(canMega(s) ? [true] : [])) {
      const g = Sprites.layout(s, mega);
      assert.ok(g.fit > 0.5 && g.fit <= 1, `${s.id} fit ${g.fit}`);
      assert.ok(g.eye.rx > 0 && g.face.r > 0, `${s.id} has eyes`);
      assert.ok(g.bodyCy + g.bodyRy <= g.gnd, `${s.id} body above ground`);
    }
    if (s.evolvesTo) assert.ok(Sprites.scaleFor({ ...s, stage: s.stage + 1 }, false) > Sprites.scaleFor(s, false));
    if (canMega(s)) assert.ok(Sprites.scaleFor(s, true) > Sprites.scaleFor(s, false));
  }
});

test('Mindrax is a raid-only legendary psychic that can Mega Evolve', () => {
  const { SPECIES_BY_ID, canMega, effectiveness, Game, getS, MEGA_COST } = load();
  const m = SPECIES_BY_ID.mindrax;
  assert.ok(m.legendary && canMega(m));
  assert.equal(effectiveness('shadow', 'psychic'), 1.6);
  assert.equal(effectiveness('psychic', 'shadow'), 0.390625);
  const S = getS();
  const mon = Game.addMon(Game.createMon('mindrax', 20));
  S.energy.mind = MEGA_COST;
  assert.ok(Game.megaEvolve(mon.uid));
  assert.equal(Game.name(mon), 'Mega Mindrax');
  assert.ok(Game.raidInfo({ tier: 'mega', speciesId: 'mindrax', mega: true }).hp > Game.raidInfo({ tier: 'mega', speciesId: 'infernox', mega: true }).hp);
});

test('save round-trips through localStorage', () => {
  const t = load();
  t.Game.start('Misty', 'aquabit', 1);
  t.Game.save();
  const S1 = t.getS();
  assert.equal(S1.trainer.name, 'Misty');
  assert.equal(S1.mons.length, 1);
});
