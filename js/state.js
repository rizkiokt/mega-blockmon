'use strict';
/* Save data + game rules (catching, evolution, mega evolution, power-ups, items, eggs, gyms, raids). */
let S = null;
const SAVE_KEY = 'megaBlockmon.save.v2';
const TEAMS = [
  { name: 'Team Blaze', color: TEAM_COLORS[0] },
  { name: 'Team Tide', color: TEAM_COLORS[1] },
  { name: 'Team Spark', color: TEAM_COLORS[2] },
];

const Game = {
  resetting: false,
  hooks: { levelUp() {}, hud() {}, hatch() {} }, // UI wires these up

  fresh() {
    return {
      v: 2, started: false, team: 0,
      trainer: { name: 'Trainer', level: 1, xp: 0, dust: 500, km: 0, caught: 0, thrown: 0, evolved: 0, megas: 0, hatched: 0, gymWins: 0, raidWins: 0, shinies: 0 },
      blocks: { basic: 30, super: 5, ultra: 0, premier: 0 },
      items: { berry: 5, golden: 0, potion: 5, superPotion: 0, revive: 3, raidPass: 2, incubator: 0 },
      eggs: [], incs: [{ id: 'inf', uses: -1, egg: null }],
      shards: {}, energy: {}, mons: [], dex: {}, megaDex: {}, shinyDex: {}, towers: {}, gyms: {},
      nextUid: 1, nextEgg: 1, player: null, seed: (Math.random() * 1e9) | 0,
    };
  },
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.v === 2) {
          const f = this.fresh();
          S = Object.assign(f, d);
          for (const k of ['trainer', 'blocks', 'items']) S[k] = Object.assign(f[k], d[k]);
        }
      }
    } catch (e) { /* corrupted or blocked storage: start fresh */ }
    if (!S) S = this.fresh();
  },
  save() {
    if (this.resetting || !S) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ }
  },
  reset() {
    this.resetting = true;
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    location.reload();
  },

  /* ----- stats (Pokémon GO-style formulas) ----- */
  cpm(l) { return 0.094 + (l - 1) * 0.0205; },
  stats(spc, mega) {
    const f = FAMILIES[spc.family].split, p = spc.power * (mega ? 1.3 : 1);
    return { a: p * f[0], d: p * f[1], s: p * f[2] };
  },
  cp(mon) {
    const spc = SPECIES_BY_ID[mon.speciesId], st = this.stats(spc, mon.mega), m = this.cpm(mon.level);
    return Math.max(10, Math.floor((st.a + mon.iv.a) * Math.sqrt(st.d + mon.iv.d) * Math.sqrt(st.s + mon.iv.s) * m * m / 10));
  },
  maxHp(mon) {
    const spc = SPECIES_BY_ID[mon.speciesId], st = this.stats(spc, mon.mega);
    return Math.max(10, Math.floor((st.s + mon.iv.s) * this.cpm(mon.level)));
  },
  curHp(mon) { return mon.hpCur == null ? this.maxHp(mon) : Math.min(mon.hpCur, this.maxHp(mon)); },
  ivPct(mon) { return Math.round((mon.iv.a + mon.iv.d + mon.iv.s) / 45 * 100); },
  name(mon) { return (mon.mega ? 'Mega ' : '') + SPECIES_BY_ID[mon.speciesId].name; },
  createMon(id, level, opts) {
    opts = opts || {};
    const spc = SPECIES_BY_ID[id], pool = movePool(spc), floor = opts.ivFloor || 0;
    return {
      uid: 0, speciesId: id, level,
      iv: { a: randInt(floor, 15), d: randInt(floor, 15), s: randInt(floor, 15) },
      mega: !!opts.mega, shiny: opts.shiny != null ? opts.shiny : Math.random() < SHINY_RATE,
      fast: pool.fast[randInt(0, pool.fast.length - 1)], charged: pool.charged[randInt(0, pool.charged.length - 1)],
      hpCur: null, caughtAt: 0,
    };
  },
  get(uid) { return S.mons.find(m => m.uid === uid); },
  markSeen(id) { if (!S.dex[id]) S.dex[id] = 1; },
  shardName(fid) { return FAMILY_BASE[fid].name + ' Shards'; },
  xpToNext(l) { return 500 + l * 500; },
  maxLevel() { return Math.min(40, S.trainer.level + 2); },
  totalBlocks() { return S.blocks.basic + S.blocks.super + S.blocks.ultra; },
  addMon(mon) {
    mon.uid = S.nextUid++; mon.caughtAt = Date.now();
    S.mons.push(mon);
    S.dex[mon.speciesId] = 2;
    if (mon.shiny) { S.shinyDex[mon.speciesId] = true; S.trainer.shinies++; }
    return mon;
  },

  /* ----- catching ----- */
  baseCatch(mon) { return SPECIES_BY_ID[mon.speciesId].catchRate * (1 - (mon.level - 1) / 80); },
  throwMult(q) { return { Nice: 1.3, Great: 1.65, Excellent: 2.0 }[q] || 1; },
  // GO-style: P = 1 - (1 - base) ^ (block * throw * curve * berry)
  catchChance(mon, mods) {
    const m = mods.block * this.throwMult(mods.q) * (mods.curve ? 1.7 : 1) * (mods.berry || 1);
    return clamp(1 - Math.pow(1 - this.baseCatch(mon), m), 0, 1);
  },
  catchMon(mon, q, curve) {
    const spc = SPECIES_BY_ID[mon.speciesId], fam = FAMILIES[spc.family];
    const isNew = S.dex[spc.id] !== 2;
    this.addMon(mon); S.trainer.caught++;
    const xp = 100 + ({ Nice: 10, Great: 50, Excellent: 100 }[q] || 0) + (curve ? 10 : 0) + (isNew ? 500 : 0);
    const shards = (3 + (spc.stage - 1) * 2) * (spc.legendary ? 3 : 1);
    const dust = 100 + mon.level * 10;
    let energy = 0;
    if (fam.hasMega) {
      energy = 5 + (q === 'Excellent' ? 5 : 0);
      S.energy[spc.family] = (S.energy[spc.family] || 0) + energy;
    }
    S.shards[spc.family] = (S.shards[spc.family] || 0) + shards;
    S.trainer.dust += dust;
    this.addXP(xp);
    this.save();
    return { xp, shards, dust, energy, isNew };
  },

  /* ----- progression ----- */
  addXP(n) {
    const t = S.trainer;
    t.xp += n;
    while (t.level < 40 && t.xp >= this.xpToNext(t.level)) {
      t.xp -= this.xpToNext(t.level);
      t.level++;
      const r = { basic: 10, super: t.level >= 5 ? 5 : 0, ultra: t.level >= 10 ? 3 : 0, potion: 5, revive: 2, raidPass: 1 };
      for (const k of ['basic', 'super', 'ultra']) S.blocks[k] += r[k];
      for (const k of ['potion', 'revive', 'raidPass']) S.items[k] += r[k];
      if (t.level % 5 === 0) S.items.incubator++;
      this.hooks.levelUp(t.level, r);
    }
    if (t.level >= 40) t.xp = Math.min(t.xp, this.xpToNext(40));
    this.hooks.hud();
  },
  powerCost(mon) { return { dust: 100 + mon.level * 25, shards: mon.level < 10 ? 1 : mon.level < 25 ? 2 : 3 }; },
  powerUp(uid) {
    const mon = this.get(uid); if (!mon) return false;
    const spc = SPECIES_BY_ID[mon.speciesId], c = this.powerCost(mon);
    if (mon.level >= this.maxLevel() || S.trainer.dust < c.dust || (S.shards[spc.family] || 0) < c.shards) return false;
    const hadFull = mon.hpCur == null;
    S.trainer.dust -= c.dust; S.shards[spc.family] -= c.shards; mon.level++;
    if (!hadFull && mon.hpCur > 0) mon.hpCur += 2;
    this.save(); return true;
  },
  evolve(uid) {
    const mon = this.get(uid); if (!mon) return null;
    const from = SPECIES_BY_ID[mon.speciesId];
    if (!from.evolvesTo || (S.shards[from.family] || 0) < from.evolveCost) return null;
    const to = SPECIES_BY_ID[from.evolvesTo];
    const isNew = S.dex[to.id] !== 2;
    S.shards[from.family] -= from.evolveCost;
    mon.speciesId = to.id; S.dex[to.id] = 2; S.trainer.evolved++;
    if (mon.shiny) S.shinyDex[to.id] = true;
    // like GO, evolving re-rolls moves from the new species' pool and fully heals
    const pool = movePool(to);
    mon.fast = pool.fast[randInt(0, pool.fast.length - 1)]; mon.charged = pool.charged[randInt(0, pool.charged.length - 1)];
    mon.hpCur = null;
    this.addXP(500 + (isNew ? 500 : 0));
    this.save();
    return { from, to };
  },
  megaEvolve(uid) {
    const mon = this.get(uid); if (!mon) return null;
    const spc = SPECIES_BY_ID[mon.speciesId];
    if (mon.mega || !canMega(spc) || (S.energy[spc.family] || 0) < MEGA_COST) return null;
    const isNew = !S.megaDex[spc.id];
    S.energy[spc.family] -= MEGA_COST;
    mon.mega = true; mon.hpCur = null; S.megaDex[spc.id] = true; S.trainer.megas++;
    this.addXP(1000 + (isNew ? 1000 : 0));
    this.save();
    return { spc };
  },
  transfer(uid) {
    const i = S.mons.findIndex(m => m.uid === uid); if (i < 0) return false;
    const spc = SPECIES_BY_ID[S.mons[i].speciesId];
    S.mons.splice(i, 1);
    S.shards[spc.family] = (S.shards[spc.family] || 0) + 1;
    this.save(); return true;
  },
  heal(uid, item) {
    const mon = this.get(uid); if (!mon || !S.items[item]) return false;
    const max = this.maxHp(mon), cur = this.curHp(mon);
    if (item === 'revive') { if (cur > 0) return false; mon.hpCur = Math.ceil(max / 2); }
    else {
      if (cur <= 0 || cur >= max) return false;
      mon.hpCur = Math.min(max, cur + (item === 'superPotion' ? 60 : 20));
      if (mon.hpCur >= max) mon.hpCur = null;
    }
    S.items[item]--; this.save(); return true;
  },
  spinTower() {
    const L = S.trainer.level;
    const got = { basic: randInt(2, 4) };
    if (L >= 3 && Math.random() < 0.35) got.super = randInt(1, 2);
    if (L >= 8 && Math.random() < 0.2) got.ultra = 1;
    if (Math.random() < 0.35) got.berry = 1;
    if (L >= 6 && Math.random() < 0.05) got.golden = 1;
    if (Math.random() < 0.3) got[L >= 8 && Math.random() < 0.5 ? 'superPotion' : 'potion'] = 1;
    if (Math.random() < 0.12) got.revive = 1;
    if (Math.random() < 0.05) got.raidPass = 1;
    for (const k in got) { if (k in S.blocks) S.blocks[k] += got[k]; else S.items[k] += got[k]; }
    let egg = null;
    if (S.eggs.length < 9 && Math.random() < 0.15) {
      const km = pickWeighted([[2, 5], [5, 4], [10, 1]]);
      egg = { id: S.nextEgg++, km, progress: 0 };
      S.eggs.push(egg);
    }
    this.addXP(50);
    this.save();
    return { got, egg };
  },

  /* ----- eggs ----- */
  incubate(eggId, incId) {
    const egg = S.eggs.find(e => e.id === eggId), inc = S.incs.find(i => i.id === incId);
    if (!egg || !inc || inc.egg != null || S.incs.some(i => i.egg === eggId)) return false;
    inc.egg = eggId; this.save(); return true;
  },
  addIncubator() {
    if (S.items.incubator <= 0) return false;
    S.items.incubator--;
    S.incs.push({ id: 'i' + Date.now().toString(36), uses: 3, egg: null });
    this.save(); return true;
  },
  walk(km) {
    S.trainer.km += km;
    for (const inc of S.incs) {
      if (inc.egg == null) continue;
      const egg = S.eggs.find(e => e.id === inc.egg);
      if (!egg) { inc.egg = null; continue; }
      egg.progress += km;
      if (egg.progress >= egg.km) {
        inc.egg = null;
        if (inc.uses > 0 && --inc.uses === 0) S.incs = S.incs.filter(i => i !== inc);
        S.eggs = S.eggs.filter(e => e !== egg);
        const id = EGG_POOLS[egg.km][randInt(0, EGG_POOLS[egg.km].length - 1)];
        const mon = this.createMon(id, Math.min(20, S.trainer.level), { ivFloor: 10 });
        const isNew = S.dex[id] !== 2;
        this.addMon(mon); S.trainer.hatched++;
        const fam = SPECIES_BY_ID[id].family;
        const shards = egg.km * 2 + 5, dust = egg.km * 300;
        S.shards[fam] = (S.shards[fam] || 0) + shards; S.trainer.dust += dust;
        this.addXP(egg.km * 100 + (isNew ? 500 : 0));
        this.save();
        this.hooks.hatch(mon, { shards, dust, km: egg.km });
      }
    }
  },

  /* ----- battle math ----- */
  fighter(mon, opts) {
    opts = opts || {};
    const spc = SPECIES_BY_ID[mon.speciesId], st = this.stats(spc, mon.mega), m = opts.cpm || this.cpm(mon.level);
    const maxHp = opts.hp || this.maxHp(mon);
    return {
      mon, spc, type: typeOf(spc), mega: mon.mega,
      atk: (st.a + mon.iv.a) * m, def: (st.d + mon.iv.d) * m,
      maxHp, hp: opts.hp ? maxHp : this.curHp(mon), energy: 0,
      fast: MOVES[mon.fast], charged: MOVES[mon.charged],
    };
  },
  // GO damage formula: floor(0.5 * Power * Atk/Def * STAB * Effectiveness * bonus) + 1
  damage(att, def, move, bonus) {
    const stab = move.type === att.type ? 1.2 : 1;
    return Math.floor(0.5 * move.power * (att.atk / def.def) * stab * effectiveness(move.type, def.type) * (bonus || 1)) + 1;
  },

  /* ----- gyms & raids ----- */
  gymState(key) {
    let g = S.gyms[key];
    const now = Date.now();
    if (!g) {
      const r = mulberry32(hashStr(key + S.seed));
      g = S.gyms[key] = { team: Math.floor(r() * 3), defenders: null, ownedUntil: 0, raid: null, nextRaidCheck: 0, spinUntil: 0 };
    }
    if (g.team === S.team && g.ownedUntil && now > g.ownedUntil) {
      g.team = (S.team + 1 + randInt(0, 1)) % 3; g.defenders = null; g.ownedUntil = 0;
    }
    if (!g.defenders && g.team !== S.team) g.defenders = this.makeDefenders();
    if (g.raid && now > g.raid.endsAt) g.raid = null;
    if (!g.raid && now > g.nextRaidCheck) {
      g.nextRaidCheck = now + 10 * 60000;
      if (Math.random() < 0.45) g.raid = this.makeRaid();
    }
    return g;
  },
  makeDefenders() {
    const L = S.trainer.level, out = [];
    // defenders grow with the trainer: basic forms early, evolved ones later
    const maxStage = L < 6 ? 1 : L < 12 ? 2 : 3;
    const pool = SPECIES.filter(s => !s.legendary && s.stage <= maxStage);
    for (let i = 0; i < 3; i++) {
      const sp = pool[randInt(0, pool.length - 1)];
      const m = this.createMon(sp.id, clamp(L - 1 + randInt(-2, 1), 1, 40), { shiny: false, ivFloor: 5 });
      out.push(m);
    }
    return out;
  },
  makeRaid() {
    const L = S.trainer.level;
    const tiers = [[1, 6]];
    if (L >= 4) tiers.push([3, 4]);
    if (L >= 7) tiers.push(['mega', 3]);
    if (L >= 10) tiers.push([5, 1.2]);
    const tier = pickWeighted(tiers);
    let spc, mega = false;
    if (tier === 1) { const p = SPECIES.filter(s => s.stage === 1 && !s.legendary); spc = p[randInt(0, p.length - 1)]; }
    else if (tier === 3) { const p = SPECIES.filter(s => s.stage >= 2 && !s.legendary); spc = p[randInt(0, p.length - 1)]; }
    else if (tier === 'mega') {
      // legendary megas (e.g. Mega Mindrax) are rare and only for experienced trainers
      if (L >= 12 && Math.random() < 0.2) spc = SPECIES_BY_ID.mindrax;
      else { const p = SPECIES.filter(s => canMega(s) && !s.legendary); spc = p[randInt(0, p.length - 1)]; }
      mega = true;
    } else { const p = SPECIES.filter(s => s.legendary); spc = p[randInt(0, p.length - 1)]; }
    const pool = movePool(spc);
    return {
      tier, speciesId: spc.id, mega, endsAt: Date.now() + 20 * 60000,
      fast: pool.fast[0], charged: pool.charged[randInt(0, pool.charged.length - 1)],
    };
  },
  raidInfo(raid) {
    const T = { 1: { hp: 600, cpm: 0.5, time: 180, blocks: 6 }, 3: { hp: 1600, cpm: 0.6, time: 180, blocks: 8 }, mega: { hp: 2600, cpm: 0.66, time: 240, blocks: 9 }, 5: { hp: 3600, cpm: 0.7, time: 300, blocks: 10 } };
    const info = Object.assign({}, T[raid.tier]);
    if (raid.mega && SPECIES_BY_ID[raid.speciesId].legendary) Object.assign(info, { hp: 5000, cpm: 0.72, time: 300, blocks: 12 });
    return info;
  },
  raidBossCP(raid) {
    const spc = SPECIES_BY_ID[raid.speciesId], info = this.raidInfo(raid), st = this.stats(spc, raid.mega);
    return Math.floor((st.a + 15) * Math.sqrt(st.d + 15) * Math.sqrt(info.hp) * info.cpm / 10);
  },
  winGym(key) {
    const g = S.gyms[key];
    g.team = S.team; g.defenders = null; g.ownedUntil = Date.now() + 15 * 60000;
    S.trainer.gymWins++;
    const rw = { xp: 300, dust: 500, basic: 5, potion: 2 };
    S.trainer.dust += rw.dust; S.blocks.basic += rw.basic; S.items.potion += rw.potion;
    this.addXP(rw.xp); this.save();
    return rw;
  },
  winRaid(key, raid) {
    const spc = SPECIES_BY_ID[raid.speciesId], info = this.raidInfo(raid);
    S.trainer.raidWins++;
    const rw = { xp: raid.tier === 5 ? 10000 : raid.tier === 'mega' ? 5000 : raid.tier === 3 ? 3000 : 2000, dust: 1000, premier: info.blocks, golden: raid.tier === 1 ? 0 : 1, energy: 0, shards: 0 };
    if (raid.mega || canMega(spc)) {
      rw.energy = raid.mega ? (spc.legendary ? randInt(100, 150) : randInt(60, 90)) : raid.tier === 5 ? 50 : 20;
      S.energy[spc.family] = (S.energy[spc.family] || 0) + rw.energy;
    }
    rw.shards = raid.tier === 1 ? 3 : 10;
    S.shards[spc.family] = (S.shards[spc.family] || 0) + rw.shards;
    S.trainer.dust += rw.dust; S.blocks.premier = info.blocks; S.items.golden += rw.golden;
    if (S.gyms[key]) S.gyms[key].raid = null;
    this.addXP(rw.xp); this.save();
    return rw;
  },
  start(name, starterId, team) {
    S.trainer.name = name || 'Trainer';
    S.team = team;
    const m = this.createMon(starterId, 5, { ivFloor: 8, shiny: false });
    this.addMon(m);
    const fam = SPECIES_BY_ID[starterId].family;
    S.shards[fam] = (S.shards[fam] || 0) + 10;
    S.eggs.push({ id: S.nextEgg++, km: 2, progress: 0 });
    S.incs[0].egg = S.eggs[0].id;
    S.started = true;
    this.save();
  },
};
