'use strict';
/* The overworld: a procedurally generated island the trainer walks around,
   with wild Blockmon spawns and Block Towers that hand out blocks. */
const World = (() => {
  const TILE = 32, MW = 160, MH = 160, RANGE = 3.6;
  const T = { DEEP: 0, SHALLOW: 1, SAND: 2, GRASS: 3, FOREST: 4, ROCKY: 5, SNOW: 6 };
  const TILE_NAMES = ['Deep Water', 'Shallows', 'Beach', 'Meadow', 'Forest', 'Highlands', 'Snowfield'];
  const BASE = ['#1d5a96', '#3d93d6', '#e8d5a0', '#84cc6a', '#4b9a55', '#a49b8e', '#eef3f7'];
  const BIOME_TYPES = {
    1: { water: 4, ice: 1 },
    2: { fire: 2.5, rock: 2, electric: 1.5, water: 1 },
    3: { grass: 3, normal: 2, electric: 1.5, air: 1.5, fire: 1 },
    4: { grass: 3, shadow: 2, normal: 1, air: 1 },
    5: { rock: 3, fire: 1.5, shadow: 1.2, electric: 1 },
    6: { ice: 4, water: 1, air: 1.5 },
  };
  let canvas, ctx, dpr = 1, vw = 0, vh = 0, map, shade, shades;
  let towers = [], spawns = [], floaters = [], puffs = [], dustT = 0, camInit = false, smX = 0, smY = 0, spawnTimer = 0, nextId = 1, time = 0, camX = 0, camY = 0;
  const player = { x: 0, y: 0, tx: null, ty: null, pending: null, dir: 1, walkT: 0, moving: false };
  const keys = {};
  let cb = {};

  /* ---------- generation ---------- */
  function makeNoise(seed) {
    const r = mulberry32(seed), N = 64, g = new Float32Array(N * N);
    for (let i = 0; i < g.length; i++) g[i] = r();
    const at = (x, y) => g[(((y % N) + N) % N) * N + (((x % N) + N) % N)];
    return (x, y) => {
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
  }
  function fbm(n, x, y) {
    let s = 0, a = 1, f = 1, t = 0;
    for (let o = 0; o < 4; o++) { s += n(x * f, y * f) * a; t += a; a *= 0.5; f *= 2.03; }
    return s / t;
  }
  function tileAt(x, y) {
    if (x < 0 || y < 0 || x >= MW || y >= MH) return T.DEEP;
    return map[y * MW + x];
  }
  function walkable(x, y) { return tileAt(Math.floor(x), Math.floor(y)) !== T.DEEP; }

  function generate(seed) {
    const n1 = makeNoise(seed), n2 = makeNoise((seed ^ 0x5bd1e995) >>> 0), r = mulberry32(seed + 7);
    map = new Uint8Array(MW * MH); shade = new Uint8Array(MW * MH);
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const dx = (x - MW / 2) / (MW / 2), dy = (y - MH / 2) / (MH / 2), d = Math.sqrt(dx * dx + dy * dy);
      const e = fbm(n1, x / 18, y / 18) + 0.16 - d * d * 0.6;
      const m = fbm(n2, x / 14 + 40, y / 14 + 40);
      let t;
      if (e < 0.27) t = T.DEEP; else if (e < 0.33) t = T.SHALLOW; else if (e < 0.37) t = T.SAND;
      else if (e > 0.7) t = T.SNOW; else if (e > 0.61) t = T.ROCKY; else if (m > 0.55) t = T.FOREST; else t = T.GRASS;
      map[y * MW + x] = t; shade[y * MW + x] = (r() * 4) | 0;
    }
    towers = [];
    for (let cy = 2; cy < MH - 2; cy += 7) for (let cx = 2; cx < MW - 2; cx += 7) {
      const x = cx + ((r() * 5) | 0), y = cy + ((r() * 5) | 0), t = tileAt(x, y);
      if ((t === T.GRASS || t === T.SAND || t === T.ROCKY || t === T.SNOW) && r() < 0.38) towers.push({ x: x + 0.5, y: y + 0.5, key: x + ',' + y, gym: r() < 0.22 });
    }
  }
  function findStart() {
    for (let rad = 0; rad < 60; rad++) for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      const x = MW / 2 + dx, y = MH / 2 + dy;
      if (tileAt(x, y) === T.GRASS) return { x: x + 0.5, y: y + 0.5 };
    }
    return { x: MW / 2 + 0.5, y: MH / 2 + 0.5 };
  }

  /* ---------- spawning ---------- */
  function chooseSpecies(t) {
    const lvl = S.trainer.level;
    if (lvl >= 5 && Math.random() < 0.006) return SPECIES_BY_ID.prismax;
    const type = pickWeighted(Object.entries(BIOME_TYPES[t] || BIOME_TYPES[3]));
    const cands = SPECIES.filter(s => FAMILIES[s.family].type === type && !s.legendary);
    return pickWeighted(cands.map(s => [s, s.stage === 1 ? 10 : s.stage === 2 ? (lvl >= 3 ? 1.4 : 0.4) : (lvl >= 8 ? 0.25 : 0.04)]));
  }
  function trySpawn() {
    for (let k = 0; k < 8; k++) {
      const ang = Math.random() * Math.PI * 2, dist = rand(2.5, 12);
      const tx = Math.floor(player.x + Math.cos(ang) * dist), ty = Math.floor(player.y + Math.sin(ang) * dist);
      const t = tileAt(tx, ty);
      if (t === T.DEEP) continue;
      if (spawns.some(s => Math.abs(s.x - tx - 0.5) < 1 && Math.abs(s.y - ty - 0.5) < 1)) continue;
      const spc = chooseSpecies(t);
      const maxL = Math.min(S.trainer.level + 3, 30);
      spawns.push({ id: nextId++, speciesId: spc.id, level: randInt(1, maxL), shiny: Math.random() < SHINY_RATE, x: tx + 0.5, y: ty + 0.5, born: time, ttl: rand(70, 140), phase: Math.random() * 6, engaged: false });
      return;
    }
  }

  /* ---------- interaction ---------- */
  function interact(p) {
    player.moving = false; clearKeys();
    if (p.kind === 'spawn') {
      if (!spawns.includes(p.obj)) return;
      p.obj.engaged = true;
      cb.onEncounter(p.obj, tileAt(Math.floor(p.obj.x), Math.floor(p.obj.y)));
    } else if (p.obj.gym) {
      cb.onGym(p.obj, tileAt(Math.floor(p.obj.x), Math.floor(p.obj.y)));
    } else {
      const n = spinStop(p.obj, S.towers);
      if (n) floaters.push({ x: p.obj.x, y: p.obj.y - 2.2, text: '+' + n + ' items', t: 0, color: '#7ee0ff' });
    }
  }
  function onPointer(e) {
    if (UI.isBlocking()) return;
    const rect = canvas.getBoundingClientRect();
    const wx = (e.clientX - rect.left + camX) / TILE, wy = (e.clientY - rect.top + camY) / TILE;
    let best = null, bd = 0.95;
    for (const s of spawns) {
      const d = Math.hypot(wx - s.x, wy - (s.y - 0.9));
      if (d < bd) { bd = d; best = { kind: 'spawn', obj: s }; }
    }
    for (const t of towers) {
      const d = Math.hypot(wx - t.x, wy - (t.y - (t.gym ? 1.6 : 1))) * (t.gym ? 0.7 : 1);
      if (d < bd) { bd = d; best = { kind: 'tower', obj: t }; }
    }
    if (best) {
      if (Math.hypot(best.obj.x - player.x, best.obj.y - player.y) <= RANGE) { player.tx = null; player.pending = null; interact(best); }
      else { player.tx = best.obj.x; player.ty = best.obj.y; player.pending = best; }
      return;
    }
    player.tx = wx; player.ty = wy; player.pending = null;
    floaters.push({ x: wx, y: wy, text: '', t: 0, marker: true });
  }

  // shared by Block Towers and gyms (gyms are spinnable too, like in GO)
  function spinStop(obj, store) {
    const until = store[obj.key] || 0;
    if (Date.now() < until) { UI.toast(`Recharging… ${Math.ceil((until - Date.now()) / 1000)}s`); return 0; }
    const { got, egg } = Game.spinTower();
    store[obj.key] = Date.now() + 90000;
    UI.spinToast(got, egg);
    let n = 0; for (const k in got) n += got[k];
    return n + (egg ? 1 : 0);
  }

  /* ---------- update ---------- */
  function update(dt) {
    time += dt;
    let mx = 0, my = 0;
    if (keys.arrowleft || keys.a) mx--;
    if (keys.arrowright || keys.d) mx++;
    if (keys.arrowup || keys.w) my--;
    if (keys.arrowdown || keys.s) my++;
    if (mx || my) { player.tx = null; player.pending = null; }
    else if (player.tx !== null) {
      const dx = player.tx - player.x, dy = player.ty - player.y, d = Math.hypot(dx, dy);
      if (d < 0.06) { player.tx = null; } else { mx = dx / d; my = dy / d; }
    }
    if (player.pending) {
      const o = player.pending.obj;
      if (Math.hypot(o.x - player.x, o.y - player.y) <= RANGE - 0.4) {
        const p = player.pending; player.pending = null; player.tx = null; mx = my = 0;
        interact(p);
      }
    }
    if (mx || my) {
      const l = Math.hypot(mx, my); mx /= l; my /= l;
      const step = 4.6 * dt, ox = player.x, oy = player.y;
      if (walkable(player.x + mx * step, player.y)) player.x += mx * step;
      if (walkable(player.x, player.y + my * step)) player.y += my * step;
      const moved = Math.hypot(player.x - ox, player.y - oy);
      if (moved < step * 0.2) { player.tx = null; player.pending = null; }
      if (moved > 0) Game.walk(moved * 0.005); // 1 tile = 5 m
      if (Math.abs(mx) > 0.2) player.dir = mx > 0 ? 1 : -1;
      player.walkT += dt; player.moving = moved > 0;
      if (player.moving && (dustT -= dt) <= 0) {
        dustT = 0.16;
        puffs.push({ x: player.x - mx * 0.25 + rand(-0.1, 0.1), y: player.y + 0.05, vx: -mx * 0.6, vy: rand(-0.5, -0.2), t: 0, life: 0.45, c: 'rgba(255,255,255,0.7)', sz: rand(3, 5) });
      }
    } else player.moving = false;

    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawnTimer = 1.2; if (spawns.length < 12) trySpawn(); }
    spawns = spawns.filter(s => s.engaged || (time - s.born < s.ttl && Math.hypot(s.x - player.x, s.y - player.y) < 22));
    for (const p of puffs) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    puffs = puffs.filter(p => p.t < p.life);
    for (const f of floaters) f.t += dt;
    floaters = floaters.filter(f => f.t < (f.marker ? 0.6 : 1.6));
  }

  /* ---------- drawing ---------- */
  function blk(x, y, w, h, c) {
    ctx.fillStyle = c; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x, y, w, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x, y + h - 2, w, 2);
  }
  function shadowAt(x, y, rx, ry) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  }
  const TREE_COLS = ['#2f7d3a', '#3b8f45', '#27692f'];
  function drawTree(x, y, v) {
    shadowAt(x, y, 12, 4);
    blk(x - 3, y - 10, 6, 10, '#6b4226');
    const g = TREE_COLS[v % 3];
    const sw = Math.round(Math.sin(time * 1.3 + v * 1.7) * 1.5);
    blk(x - 13 + sw * 0.5, y - 26, 26, 16, g);
    blk(x - 9 + sw, y - 36, 18, 12, Sprites.mix(g, '#ffffff', 0.12));
  }
  function drawTower(t, x, y) {
    const ready = (S.towers[t.key] || 0) < Date.now();
    shadowAt(x, y, 14, 5);
    blk(x - 11, y - 8, 22, 8, '#5c677d');
    blk(x - 5, y - 34, 10, 26, '#7d8597');
    blk(x - 12, y - 40, 24, 6, '#979dac');
    const by = y - 58 + Math.sin(time * 2.5 + t.x) * 3;
    if (ready) {
      ctx.fillStyle = 'rgba(126,224,255,0.3)';
      ctx.beginPath(); ctx.arc(x, by, 17 + Math.sin(time * 4) * 2, 0, Math.PI * 2); ctx.fill();
    }
    Sprites.cube(ctx, x, by, 22, ready ? BLOCKS.basic.colors : ['#a99bbd', '#7a6e8f', '#4a4359']);
  }
  function drawGym(t, x, y) {
    const g = Game.gymState(t.key), col = TEAM_COLORS[g.team];
    shadowAt(x, y, 24, 8);
    blk(x - 22, y - 10, 44, 10, '#4a4e69');
    blk(x - 17, y - 22, 34, 12, '#5c677d');
    blk(x - 12, y - 52, 24, 30, '#e9ecef');
    ctx.fillStyle = col; ctx.fillRect(x - 12, y - 46, 24, 6); ctx.fillRect(x - 12, y - 34, 24, 4);
    blk(x - 16, y - 58, 32, 6, col);
    const by = y - 76 + Math.sin(time * 2 + t.x) * 2;
    if (g.raid) {
      const spc = SPECIES_BY_ID[g.raid.speciesId];
      ctx.fillStyle = g.raid.mega ? 'rgba(255,90,200,0.35)' : 'rgba(255,214,10,0.3)';
      ctx.beginPath(); ctx.arc(x, by, 22 + Math.sin(time * 4) * 2, 0, Math.PI * 2); ctx.fill();
      Sprites.draw(ctx, spc, g.raid.mega, x, by, 46, { fit: true, aura: false });
      ctx.font = '700 11px Fredoka, system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = '#121225';
      const lbl = g.raid.mega ? 'MEGA RAID' : 'RAID ' + '★'.repeat(g.raid.tier);
      ctx.strokeText(lbl, x, by - 28); ctx.fillStyle = '#fff'; ctx.fillText(lbl, x, by - 28);
    } else {
      Sprites.cube(ctx, x, by, 18, [Sprites.mix(col, '#ffffff', 0.4), col, Sprites.mix(col, '#000000', 0.35)]);
    }
  }
  function drawSpawn(s, x, y) {
    const spc = SPECIES_BY_ID[s.speciesId];
    const age = time - s.born, left = s.ttl - age;
    const inRange = Math.hypot(s.x - player.x, s.y - player.y) <= RANGE;
    // pop out of the ground with an overshoot, shrink away when despawning
    let pop = Math.min(1, age / 0.45);
    pop = pop < 1 ? Sprites.easeOutBack(pop) : 1;
    const out = Math.max(0, Math.min(1, left / 0.4));
    const k = pop * out;
    if (k <= 0.01) return;
    const pose = Sprites.idle(time, s.phase);
    // every few seconds: a little hop in place
    const hp = ((time + s.phase * 3) % 4.2) / 0.7;
    let dy = 0, sx = pose.sx, sy = pose.sy;
    if (hp < 1) { const h = Sprites.hop(hp); dy = -h.dy * 12; sx = h.sx; sy = h.sy; }
    ctx.save(); ctx.globalAlpha = s.engaged ? 0.35 : 1;
    if (inRange) {
      ctx.strokeStyle = `rgba(255,255,255,${0.55 + Math.sin(time * 5) * 0.25})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y + 6, 20, 7, 0, 0, Math.PI * 2); ctx.stroke();
    }
    shadowAt(x, y + 6, 15 * k * (1 + dy / 40), 5 * k);
    const U = 54, sz = Sprites.size(spc, false, U) * k;
    Sprites.draw(ctx, spc, false, x, y + 8 - sz / 2 + dy, U * k, { blink: pose.blink, sx, sy });
    if (spc.legendary) {
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 3; i++) {
        const a = time * 2 + i * 2.1;
        ctx.fillRect(x + Math.cos(a) * 26 - 2, y - 26 + Math.sin(a) * 16 - 2, 4, 4);
      }
    }
    ctx.restore();
    if (age < 0.5 && !s.puffed) { s.puffed = true; for (let i = 0; i < 8; i++) puffs.push({ x: s.x + rand(-0.4, 0.4), y: s.y + 0.1, vx: rand(-1, 1), vy: rand(-1.4, -0.4), t: 0, life: rand(0.4, 0.7), c: '#9fdc7f', sz: rand(3, 6) }); }
  }
  function drawPlayer(x, y) {
    const ph = player.walkT * 11, st = player.moving ? Math.sin(ph) : 0;
    const bob = player.moving ? Math.abs(Math.sin(ph)) * 2.5 : Math.sin(time * 2.2) * 0.6;
    const by = y - bob, f = player.dir;
    shadowAt(x, y, 11 - bob * 0.6, 4);
    // legs swing forward/back
    ctx.fillStyle = '#2b2d42';
    ctx.fillRect(x - 6 + st * 2.5 * f, by - 10, 5, 10 + (st > 0 ? 0 : -1));
    ctx.fillRect(x + 1 - st * 2.5 * f, by - 10, 5, 10 + (st < 0 ? 0 : -1));
    // back arm, backpack, body, front arm
    ctx.fillStyle = '#e0688f'; ctx.fillRect(x - 2 - st * 3 * f, by - 22, 4, 10);
    blk(x - (f > 0 ? 12 : -6), by - 23, 6, 11, '#ffb703');
    blk(x - 8, by - 24, 16, 15, '#f72585');
    ctx.fillStyle = '#ffd6a5'; ctx.fillRect(x - 2 + st * 3 * f, by - 21, 4, 10);
    blk(x - 7, by - 36, 14, 12, '#ffd6a5');
    const blinkNow = (time % 3.3) < 0.12;
    ctx.fillStyle = '#222'; ctx.fillRect(x + (f > 0 ? 2 : -4), by - 31 + (blinkNow ? 1 : 0), 2, blinkNow ? 1 : 3);
    blk(x - 8, by - 40, 16, 6, '#3a0ca3');
    ctx.fillStyle = '#3a0ca3'; ctx.fillRect(x + (f > 0 ? 4 : -12), by - 36, 8, 3);
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // camera eases after the trainer instead of being rigidly locked
    if (!camInit) { smX = player.x; smY = player.y; camInit = true; }
    smX += (player.x - smX) * 0.12; smY += (player.y - smY) * 0.12;
    camX = Math.round(smX * TILE - vw / 2); camY = Math.round(smY * TILE - vh / 2);
    const x0 = Math.floor(camX / TILE) - 1, y0 = Math.floor(camY / TILE) - 1;
    const x1 = Math.ceil((camX + vw) / TILE) + 1, y1 = Math.ceil((camY + vh) / TILE) + 2;
    const objs = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = tileAt(x, y), inb = x >= 0 && y >= 0 && x < MW && y < MH;
      const sv = inb ? shade[y * MW + x] : (x * 7 + y * 3) & 3;
      const sx = x * TILE - camX, sy = y * TILE - camY;
      ctx.fillStyle = shades[t][sv]; ctx.fillRect(sx, sy, TILE, TILE);
      if (t <= T.SHALLOW) {
        if (((x * 3 + y * 7) & 7) === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.25)';
          ctx.fillRect(sx + 8 + Math.sin(time * 1.5 + x) * 4, sy + 14, 12, 3);
        }
      } else if (t === T.GRASS && sv === 0) {
        ctx.fillStyle = '#5fae4c'; ctx.fillRect(sx + 7, sy + 12, 3, 6); ctx.fillRect(sx + 20, sy + 20, 3, 6);
      } else if (t === T.SAND && sv === 0) {
        ctx.fillStyle = '#d4bd82'; ctx.fillRect(sx + 6, sy + 8, 3, 3); ctx.fillRect(sx + 20, sy + 22, 3, 3);
      } else if (t === T.ROCKY && sv === 0) {
        blk(sx + 9, sy + 12, 14, 10, '#7f776c');
      } else if (t === T.SNOW && sv === 0) {
        ctx.fillStyle = '#d5e4ef'; ctx.fillRect(sx + 10, sy + 10, 4, 4);
      } else if (t === T.FOREST && sv !== 3 && inb) {
        objs.push({ y: y + 0.85, draw: () => drawTree(sx + TILE / 2, sy + TILE * 0.85, sv + x) });
      }
    }
    const px = player.x * TILE - camX, py = player.y * TILE - camY;
    // catch range circle
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.arc(px, py, RANGE * TILE, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
    if (player.tx !== null) {
      const mx = player.tx * TILE - camX, my = player.ty * TILE - camY;
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(mx, my, 8, 4, 0, 0, Math.PI * 2); ctx.stroke();
    }
    for (const t of towers) {
      const sx = t.x * TILE - camX, sy = t.y * TILE - camY;
      if (sx > -60 && sx < vw + 60 && sy > -20 && sy < vh + 110) objs.push({ y: t.y, draw: () => t.gym ? drawGym(t, sx, sy) : drawTower(t, sx, sy) });
    }
    for (const s of spawns) {
      const sx = s.x * TILE - camX, sy = s.y * TILE - camY;
      if (sx > -60 && sx < vw + 60 && sy > -20 && sy < vh + 90) objs.push({ y: s.y, draw: () => drawSpawn(s, sx, sy) });
    }
    objs.push({ y: player.y, draw: () => drawPlayer(px, py) });
    objs.sort((a, b) => a.y - b.y);
    for (const o of objs) o.draw();
    for (const p of puffs) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life); ctx.fillStyle = p.c;
      const r = p.sz * (1 + p.t / p.life);
      ctx.beginPath(); ctx.arc(p.x * TILE - camX, p.y * TILE - camY, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // floating texts
    ctx.textAlign = 'center'; ctx.font = '700 16px Fredoka, system-ui, sans-serif';
    for (const f of floaters) {
      const sx = f.x * TILE - camX, sy = f.y * TILE - camY;
      if (f.marker) {
        ctx.strokeStyle = `rgba(255,255,255,${1 - f.t / 0.6})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sx, sy, 6 + f.t * 30, 0, Math.PI * 2); ctx.stroke();
        continue;
      }
      ctx.globalAlpha = Math.max(0, 1 - f.t / 1.6);
      ctx.lineWidth = 4; ctx.strokeStyle = '#121225'; ctx.strokeText(f.text, sx, sy - f.t * 30);
      ctx.fillStyle = f.color; ctx.fillText(f.text, sx, sy - f.t * 30);
      ctx.globalAlpha = 1;
    }
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    vw = window.innerWidth; vh = window.innerHeight;
    canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
  }

  function init(cv, callbacks) {
    canvas = cv; ctx = cv.getContext('2d'); cb = callbacks;
    shades = BASE.map(c => [0, 1, 2, 3].map(k => Sprites.mix(c, k % 2 ? '#000000' : '#ffffff', 0.03 + k * 0.012)));
    generate(S.seed);
    const st = S.player && walkable(S.player.x, S.player.y) ? S.player : findStart();
    player.x = st.x; player.y = st.y;
    if (!towers.some(t => !t.gym && Math.hypot(t.x - player.x, t.y - player.y) < 5)) {
      const tx = Math.floor(player.x) + 2, ty = Math.floor(player.y) - 1;
      if (tileAt(tx, ty) !== T.DEEP) towers.push({ x: tx + 0.5, y: ty + 0.5, key: tx + ',' + ty, gym: false });
    }
    if (!towers.some(t => t.gym && Math.hypot(t.x - player.x, t.y - player.y) < 14)) {
      const tx = Math.floor(player.x) - 5, ty = Math.floor(player.y) + 4;
      if (tileAt(tx, ty) !== T.DEEP) towers.push({ x: tx + 0.5, y: ty + 0.5, key: tx + ',' + ty, gym: true });
    }
    for (let i = 0; i < 5; i++) trySpawn();
    resize();
    window.addEventListener('resize', resize);
    canvas.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const k = e.key.toLowerCase();
      keys[k] = true;
      if (k.startsWith('arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  }

  function endEncounter(s, result) {
    s.engaged = false;
    if (result === 'caught' || result === 'fled') spawns = spawns.filter(x => x !== s);
  }
  function savePos() { if (S) S.player = { x: player.x, y: player.y }; }
  function biomeName() { return TILE_NAMES[tileAt(Math.floor(player.x), Math.floor(player.y))]; }
  function clearKeys() { for (const k in keys) keys[k] = false; }

  function spinGym(t) { return spinStop(t, S.towers); }
  // dev/test hooks
  function _debug() { return { player, spawns, towers, tileAt, RANGE }; }
  function teleport(x, y) { player.x = x; player.y = y; player.tx = null; player.pending = null; }
  return { init, update, render, endEncounter, savePos, biomeName, clearKeys, interact, spinGym, _debug, teleport, T };
})();
