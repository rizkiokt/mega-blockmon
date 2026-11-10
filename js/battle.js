'use strict';
/* Real-time gym/raid battles modelled on Pokémon GO:
   tap = fast move (builds energy), charged-move button when the bar fills,
   swipe sideways (or Dodge) while the enemy telegraphs a charged move to take 75% less damage. */
const Battle = (() => {
  let canvas, ctx, W = 0, H = 0, dpr = 1;
  let active = false, cfg = null, team = [], enemies = [], mi = 0, ei = 0;
  let timeLeft = 0, time = 0, state = 'fight', stateT = 0;
  let myCd = 0, myAction = null, enemyCd = 0, enemyAction = null, dodgeT = 0, dodgeDir = 0;
  let floats = [], parts = [], shakeMe = 0, shakeEn = 0, teamBonus = 1, swapCd = 0, shots = [], camShake = 0, flashScreen = 0, ghosts = [];
  let down = null, stats = { dealt: 0, taken: 0 };
  const $ = id => document.getElementById(id);
  const BG = { 0: '#2f78c0', 1: '#4aa3df', 2: '#e8d5a0', 3: '#84cc6a', 4: '#3f8a49', 5: '#a49b8e', 6: '#dfe9f2' };

  const me = () => team[mi], en = () => enemies[ei];

  function layout() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  function pos(kind) {
    const u = Math.min(W * 0.44, H * 0.34);
    if (kind === 'en') return { x: W * 0.66, y: H * 0.33, unit: u * (cfg.kind === 'raid' ? 1.25 : 1) };
    return { x: W * 0.3, y: H * 0.66, unit: u * 0.95 };
  }
  function typeColor(t) { return TYPES[t].color; }

  /* ---------- combat ---------- */
  function hit(att, def, move, toEnemy) {
    let dmg = Game.damage(att, def, move, toEnemy ? teamBonus : 1);
    if (!toEnemy && dodgeT > 0) dmg = Math.max(1, Math.floor(dmg * 0.25));
    def.hp = Math.max(0, def.hp - dmg);
    def.energy = Math.min(100, def.energy + Math.ceil(dmg / 2));
    const p = pos(toEnemy ? 'en' : 'me');
    const eff = effectiveness(move.type, def.type);
    floats.push({ x: p.x + rand(-30, 30), y: p.y - p.unit * 0.3, text: '-' + dmg, color: eff > 1 ? '#ffd60a' : '#ffffff', t: 0, big: move.kind === 'charged' });
    if (move.kind === 'charged' || eff !== 1) {
      const msg = eff > 1 ? "It's super effective!" : eff < 1 ? 'Not very effective…' : move.name + '!';
      floats.push({ x: W / 2, y: H * 0.5, text: msg, color: eff > 1 ? '#ffd60a' : '#cfd6ff', t: 0, banner: true });
    }
    for (let i = 0; i < (move.kind === 'charged' ? 30 : 8); i++) {
      const a = Math.random() * Math.PI * 2, s = rand(60, move.kind === 'charged' ? 420 : 200);
      parts.push({ x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rand(0.3, 0.7), c: typeColor(move.type), sz: rand(4, 9) });
    }
    if (toEnemy) { shakeEn = 0.25; stats.dealt += dmg; } else { shakeMe = 0.25; stats.taken += dmg; }
    def.flash = 1; def.knock = move.kind === 'charged' ? 1 : 0.45;
    if (move.kind === 'charged') { camShake = 0.35; flashScreen = 0.5; }
    if (def.hp <= 0) def.faintT = 0;
  }
  // a projectile in the move's type colour that arrives exactly when the hit lands
  function launch(fromKind, move, travel) {
    const a = pos(fromKind), b = pos(fromKind === 'me' ? 'en' : 'me');
    const ay = a.y - a.unit * 0.25, by = b.y - b.unit * 0.2;
    shots.push({ x0: a.x, y0: ay, x1: b.x, y1: by, t: 0, dur: travel, c: typeColor(move.type), big: move.kind === 'charged', trail: [] });
  }
  function myFast() {
    if (state !== 'fight' || myAction || dodgeT > 0 || me().hp <= 0) return;
    myAction = { move: me().fast, t: 0, dur: me().fast.dur, hitAt: Math.max(0.3, me().fast.dur * 0.5), done: false };
  }
  function myCharged() {
    const f = me();
    if (state !== 'fight' || myAction || f.hp <= 0 || f.energy < f.charged.cost) return;
    f.energy -= f.charged.cost;
    myAction = { move: f.charged, t: 0, dur: 0.9, hitAt: 0.55, done: false };
    floats.push({ x: W / 2, y: H * 0.5, text: f.charged.name + '!', color: typeColor(f.charged.type), t: 0, banner: true });
  }
  function dodge(dir) {
    if (state !== 'fight' || dodgeT > 0 || myAction) return;
    dodgeT = 0.55; dodgeDir = dir || (Math.random() < 0.5 ? -1 : 1);
  }
  function swap() {
    if (state !== 'fight' || swapCd > 0 || myAction) return;
    for (let k = 1; k < team.length; k++) {
      const j = (mi + k) % team.length;
      if (team[j].hp > 0) { mi = j; swapCd = 1.5; team[j].enter = 0; updateDom(); return; }
    }
  }
  function enemyThink() {
    const e = en();
    if (e.energy >= e.charged.cost && Math.random() < 0.6) {
      e.energy -= e.charged.cost;
      enemyAction = { move: e.charged, t: 0, dur: 1.4, hitAt: 1.15, done: false, warn: true };
    } else {
      enemyAction = { move: e.fast, t: 0, dur: e.fast.dur, hitAt: e.fast.dur * 0.5, done: false };
    }
  }

  function animate(dt) {
    for (const f of team.concat(enemies)) {
      if (f.dispHp == null) { f.dispHp = f.hp; f.lagHp = f.hp; f.enter = 0; f.seed = Math.random() * 10; }
      f.dispHp += (f.hp - f.dispHp) * Math.min(1, dt * 10);
      if (f.lagHp > f.dispHp) { f.lagDelay = (f.lagDelay ?? 0.4) - dt; if (f.lagDelay <= 0) f.lagHp = Math.max(f.dispHp, f.lagHp - f.maxHp * dt * 0.6); } else { f.lagHp = f.dispHp; f.lagDelay = 0.4; }
      if (f.flash > 0) f.flash = Math.max(0, f.flash - dt * 5);
      if (f.knock > 0) f.knock = Math.max(0, f.knock - dt * 4);
      if (f.faintT != null && f.faintT < 1) f.faintT = Math.min(1, f.faintT + dt * 1.3);
    }
    const m = me(), e = en();
    if (m) m.enter = Math.min(1, (m.enter || 0) + dt * 2.5);
    if (e) e.enter = Math.min(1, (e.enter || 0) + dt * 2.5);
    for (const sh of shots) {
      sh.t += dt;
      const k = Math.min(1, sh.t / sh.dur);
      sh.trail.unshift({ x: sh.x0 + (sh.x1 - sh.x0) * k, y: sh.y0 + (sh.y1 - sh.y0) * k - Math.sin(k * Math.PI) * 40 });
      if (sh.trail.length > 10) sh.trail.pop();
    }
    shots = shots.filter(sh => sh.t < sh.dur + 0.05);
    for (const g of ghosts) g.t += dt;
    ghosts = ghosts.filter(g => g.t < 0.3);
    if (camShake > 0) camShake -= dt;
    if (flashScreen > 0) flashScreen -= dt * 2;
  }

  function update(dt) {
    time += dt;
    animate(dt);
    if (shakeMe > 0) shakeMe -= dt;
    if (shakeEn > 0) shakeEn -= dt;
    for (const f of floats) f.t += dt;
    floats = floats.filter(f => f.t < (f.banner ? 1.1 : 0.9));
    for (const p of parts) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    parts = parts.filter(p => p.t < p.life);
    stateT += dt;
    if (state === 'next' && stateT >= 0.8 && stateT - dt < 0.8) en().enter = 0;

    if (state === 'intro') { if (stateT > 1.6) { state = 'fight'; stateT = 0; } return; }
    if (state === 'next') {
      if (stateT > 1.2) { state = 'fight'; stateT = 0; enemyCd = 1.5; updateDom(); }
      return;
    }
    if (state === 'over') return;

    timeLeft -= dt;
    if (swapCd > 0) swapCd -= dt;
    if (dodgeT > 0) {
      dodgeT -= dt;
      const p = pos('me'), off = Math.sin((0.55 - dodgeT) / 0.55 * Math.PI) * 90 * dodgeDir;
      if (Math.random() < 0.6) ghosts.push({ x: p.x + off, y: p.y, t: 0 });
    }
    if (myAction) {
      const prevT = myAction.t;
      myAction.t += dt;
      const travel = myAction.move.kind === 'charged' ? 0.32 : 0.2, la = myAction.hitAt - travel;
      if (prevT < la && myAction.t >= la) launch('me', myAction.move, travel);
      if (!myAction.done && myAction.t >= myAction.hitAt) {
        myAction.done = true;
        hit(me(), en(), myAction.move, true);
        if (myAction.move.kind === 'fast') me().energy = Math.min(100, me().energy + myAction.move.energy);
      }
      if (myAction.t >= myAction.dur) myAction = null;
    }
    if (enemyAction) {
      const prevE = enemyAction.t;
      enemyAction.t += dt;
      const travelE = enemyAction.move.kind === 'charged' ? 0.32 : 0.2, laE = enemyAction.hitAt - travelE;
      if (prevE < laE && enemyAction.t >= laE) launch('en', enemyAction.move, travelE);
      if (!enemyAction.done && enemyAction.t >= enemyAction.hitAt) {
        enemyAction.done = true;
        if (me().hp > 0) hit(en(), me(), enemyAction.move, false);
        if (enemyAction.move.kind === 'fast') en().energy = Math.min(100, en().energy + enemyAction.move.energy);
      }
      if (enemyAction.t >= enemyAction.dur) { enemyAction = null; enemyCd = rand(0.8, 1.8) * (cfg.kind === 'raid' ? 0.85 : 1); }
    } else if ((enemyCd -= dt) <= 0) enemyThink();

    if (en().hp <= 0) {
      if (ei + 1 < enemies.length) {
        ei++; state = 'next'; stateT = 0; enemyAction = null; myAction = null;
        floats.push({ x: W / 2, y: H * 0.45, text: 'Defender defeated!', color: '#9bff7a', t: 0, banner: true });
      } else finish(true);
      updateDom(); return;
    }
    if (me().hp <= 0) {
      myAction = null;
      if ((me().faintT ?? 1) < 1) { updateDom(); return; } // let the faint play out first
      const nxt = team.findIndex(f => f.hp > 0);
      if (nxt < 0) { finish(false); return; }
      mi = nxt; swapCd = 0.5; team[nxt].enter = 0; updateDom();
    }
    if (timeLeft <= 0) { finish(false, true); return; }
    updateDom();
  }

  function finish(won, timeout) {
    state = 'over'; stateT = 0;
    for (const f of team) f.mon.hpCur = f.hp >= f.maxHp ? null : f.hp;
    Game.save();
    $('battleUi').classList.add('hidden');
    setTimeout(() => {
      active = false;
      $('battle').classList.add('hidden');
      cfg.onEnd({ won, timeout, stats });
    }, 1400);
    floats.push({ x: W / 2, y: H * 0.45, text: won ? 'Victory!' : timeout ? "Time's up!" : 'Defeated…', color: won ? '#ffd60a' : '#ff8fa3', t: -0.5, banner: true });
  }

  /* ---------- drawing ---------- */
  function hpBar(x, y, w, f, label, alignRight) {
    ctx.save();
    ctx.textAlign = alignRight ? 'right' : 'left';
    ctx.font = '700 16px Fredoka, system-ui, sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = '#121225';
    ctx.strokeText(label, alignRight ? x + w : x, y - 8); ctx.fillStyle = '#fff'; ctx.fillText(label, alignRight ? x + w : x, y - 8);
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x, y, w, 12);
    const pct = (f.dispHp ?? f.hp) / f.maxHp, lag = (f.lagHp ?? f.hp) / f.maxHp;
    ctx.fillStyle = '#ffe8a3'; ctx.fillRect(x + 2, y + 2, (w - 4) * lag, 8);
    ctx.fillStyle = pct > 0.5 ? '#52d273' : pct > 0.2 ? '#ffd60a' : '#ff4d6d';
    ctx.fillRect(x + 2, y + 2, (w - 4) * pct, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x + 2, y + 2, (w - 4) * pct, 3);
    ctx.font = '600 12px Fredoka, system-ui, sans-serif'; ctx.fillStyle = '#fff';
    ctx.fillText(`${Math.ceil(f.hp)} / ${f.maxHp} HP`, alignRight ? x + w : x, y + 28);
    ctx.restore();
  }
  function drawFighter(f, kind) {
    const p = pos(kind), dir = kind === 'me' ? 1 : -1;
    let x = p.x, y = p.y, sx = 1, sy = 1, rot = 0;
    const pose = Sprites.idle(time, f.seed || 0);
    sx = pose.sx; sy = pose.sy;
    const act = kind === 'me' ? myAction : enemyAction;
    if (act) {
      // wind up (pull back + squash), then lunge toward the target and recover
      const u = act.t / act.hitAt, big = act.move.kind === 'charged' ? 1.6 : 1;
      if (u < 0.6) { const k = Math.sin(u / 0.6 * Math.PI / 2); x -= dir * 14 * k * big; sy *= 1 - 0.08 * k; sx *= 1 + 0.06 * k; }
      else if (u < 1.25) { const k = Math.sin((u - 0.6) / 0.65 * Math.PI); x += dir * 46 * k * big; y -= dir * 26 * k * big; sx *= 1 - 0.05 * k; sy *= 1 + 0.08 * k; }
    }
    if (kind === 'me' && dodgeT > 0) x += Math.sin((0.55 - dodgeT) / 0.55 * Math.PI) * 90 * dodgeDir;
    if (f.knock > 0) { x -= dir * f.knock * 22; rot = -dir * f.knock * 0.12; }
    if ((kind === 'me' ? shakeMe : shakeEn) > 0) x += Math.sin(time * 90) * 5;
    let alpha = 1, scale = 1;
    if (f.faintT != null) { const k = f.faintT; rot = -dir * k * 0.9; y += k * 30; alpha = 1 - k; sy *= 1 - k * 0.3; }
    const ent = f.enter == null ? 1 : f.enter;
    if (ent < 1) { scale = Sprites.easeOutBack(ent); y -= (1 - ent) * 60; }
    const sz = Sprites.size(f.spc, f.mega, p.unit);
    ctx.fillStyle = `rgba(0,0,0,${0.22 * alpha})`;
    ctx.beginPath(); ctx.ellipse(p.x, p.y + sz * 0.48, sz * 0.4 * scale, sz * 0.08 * scale, 0, 0, Math.PI * 2); ctx.fill();
    if (alpha <= 0.02) return;
    ctx.save(); ctx.globalAlpha = alpha * (f.hp <= 0 && f.faintT == null ? 0.25 : 1);
    Sprites.draw(ctx, f.spc, f.mega, x, y, p.unit * scale, {
      shiny: f.mon.shiny, flip: kind === 'me', blink: pose.blink, sx, sy, rot,
      tint: f.flash > 0 ? { color: '#ffffff', amt: f.flash * 0.85 } : null,
    });
    ctx.restore();
    if (kind === 'en' && enemyAction && enemyAction.warn && !enemyAction.done) {
      const a = 0.4 + Math.sin(time * 25) * 0.3;
      ctx.strokeStyle = `rgba(255,214,10,${a})`; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(p.x, p.y, sz * 0.6, 0, Math.PI * 2); ctx.stroke();
    }
  }
  function drawShots() {
    for (const sh of shots) {
      for (let i = sh.trail.length - 1; i >= 0; i--) {
        const t = sh.trail[i], a = 1 - i / sh.trail.length, r = (sh.big ? 26 : 9) * a;
        ctx.globalAlpha = a * 0.8; ctx.fillStyle = sh.c;
        ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI * 2); ctx.fill();
      }
      const h = sh.trail[0];
      if (h) {
        ctx.globalAlpha = 1;
        ctx.save(); ctx.shadowColor = sh.c; ctx.shadowBlur = sh.big ? 30 : 12; ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(h.x, h.y, sh.big ? 14 : 5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }
  function drawGhosts() {
    const f = me();
    for (const g of ghosts) {
      ctx.save(); ctx.globalAlpha = (1 - g.t / 0.3) * 0.3;
      Sprites.draw(ctx, f.spc, f.mega, g.x, g.y, pos('me').unit, { shiny: f.mon.shiny, flip: true, aura: false, tint: { color: '#b8f2ff', amt: 0.7 } });
      ctx.restore();
    }
  }
  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (camShake > 0) ctx.translate(rand(-1, 1) * camShake * 30, rand(-1, 1) * camShake * 30);
    const gr = BG[cfg.tile] || BG[3];
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, cfg.kind === 'raid' ? '#2b1846' : '#1d3557'); g.addColorStop(0.55, cfg.kind === 'raid' ? '#6a3f8f' : '#457b9d'); g.addColorStop(0.551, gr); g.addColorStop(1, Sprites.mix(gr, '#000000', 0.3));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 12; i++) ctx.fillRect(((i * 211 + time * 20) % (W + 100)) - 50, 40 + (i * 67) % (H * 0.4), 40, 40);
    const pe = pos('en'), pm = pos('me');
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.ellipse(pe.x, pe.y + pe.unit * 0.3, pe.unit * 0.45, pe.unit * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(pm.x, pm.y + pm.unit * 0.3, pm.unit * 0.45, pm.unit * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    // between defenders: the beaten one faints, then the next one pops in
    if (state === 'next' && stateT < 0.8) drawFighter(enemies[ei - 1], 'en');
    else drawFighter(en(), 'en');
    drawGhosts();
    drawFighter(me(), 'me');
    drawShots();
    for (const p of parts) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life); ctx.fillStyle = p.c;
      ctx.fillRect(p.x - p.sz / 2, p.y - p.sz / 2, p.sz, p.sz);
    }
    ctx.globalAlpha = 1;
    const bw = Math.min(260, W * 0.42);
    const e = en(), m = me();
    hpBar(W - bw - 16, 96, bw, e, `${Game.name(e.mon)}  CP ${cfg.kind === 'raid' ? cfg.bossCP : Game.cp(e.mon)}`, true);
    hpBar(16, H - 190, bw, m, `${Game.name(m.mon)}  CP ${Game.cp(m.mon)}`, false);
    if (cfg.kind === 'gym') {
      for (let i = 0; i < enemies.length; i++) {
        ctx.fillStyle = enemies[i].hp > 0 ? TEAM_COLORS[cfg.gymTeam] : '#555';
        ctx.fillRect(W - 16 - (enemies.length - i) * 18, 140, 14, 14);
      }
    }
    for (let i = 0; i < team.length; i++) {
      ctx.fillStyle = team[i].hp > 0 ? (i === mi ? '#ffffff' : '#7ee0ff') : '#555';
      ctx.fillRect(16 + i * 18, H - 132, 14, 14);
    }
    ctx.textAlign = 'center';
    for (const f of floats) {
      if (f.t < 0) continue;
      const a = Math.max(0, 1 - f.t / (f.banner ? 1.1 : 0.9));
      ctx.globalAlpha = a;
      ctx.font = `700 ${f.banner ? 30 : f.big ? 34 : 24}px Fredoka, system-ui, sans-serif`;
      const y = f.y - (f.banner ? 0 : f.t * 50);
      ctx.lineWidth = 6; ctx.strokeStyle = '#121225'; ctx.strokeText(f.text, f.x, y);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, y);
    }
    ctx.globalAlpha = 1;
    if (flashScreen > 0) { ctx.fillStyle = `rgba(255,255,255,${flashScreen * 0.5})`; ctx.fillRect(-40, -40, W + 80, H + 80); }
    if (state === 'intro') {
      ctx.fillStyle = `rgba(0,0,0,${Math.max(0, 0.6 - stateT * 0.4)})`; ctx.fillRect(0, 0, W, H);
      ctx.font = '700 44px Fredoka, system-ui, sans-serif'; ctx.lineWidth = 8; ctx.strokeStyle = '#121225';
      const t = stateT < 0.8 ? (cfg.kind === 'raid' ? 'RAID BATTLE' : 'GYM BATTLE') : 'GO!';
      ctx.strokeText(t, W / 2, H / 2); ctx.fillStyle = '#ffd60a'; ctx.fillText(t, W / 2, H / 2);
    }
  }

  /* ---------- DOM ---------- */
  function updateDom() {
    const f = me();
    const t = Math.max(0, Math.ceil(timeLeft));
    $('battleTimer').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    const c = f.charged, bars = Math.round(100 / c.cost), full = Math.floor(f.energy / c.cost);
    let segs = '';
    for (let i = 0; i < bars; i++) {
      const fill = i < full ? 100 : i === full ? ((f.energy - full * c.cost) / c.cost) * 100 : 0;
      segs += `<span class="seg"><i style="width:${fill}%;background:${typeColor(c.type)}"></i></span>`;
    }
    const ready = f.energy >= c.cost && !myAction && f.hp > 0;
    const btn = $('chargedBtn');
    btn.classList.toggle('ready', ready);
    btn.style.setProperty('--tc', typeColor(c.type));
    const html = `<b>${c.name}</b><span class="segs">${segs}</span>`;
    if (btn.innerHTML !== html) btn.innerHTML = html;
    $('swapBtn').disabled = swapCd > 0 || team.filter(x => x.hp > 0).length < 2;
    const warn = enemyAction && enemyAction.warn && !enemyAction.done;
    $('dodgeBtn').classList.toggle('warn', !!warn);
  }
  function onDown(e) { if (!active) return; down = { x: e.clientX, y: e.clientY, t: performance.now() }; }
  function onUp(e) {
    if (!active || !down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) dodge(Math.sign(dx));
    else myFast();
    down = null;
  }

  function start(o) {
    cfg = o;
    team = o.team.map(m => Game.fighter(m));
    enemies = o.enemies;
    mi = team.findIndex(f => f.hp > 0); ei = 0;
    teamBonus = team.some(f => f.mega) ? 1.1 : 1;
    timeLeft = o.timeLimit; time = 0; state = 'intro'; stateT = 0;
    myAction = null; enemyAction = null; enemyCd = 1.8; dodgeT = 0; swapCd = 0;
    floats = []; parts = []; shots = []; ghosts = []; camShake = 0; flashScreen = 0; stats = { dealt: 0, taken: 0 };
    active = true;
    $('battle').classList.remove('hidden');
    $('battleUi').classList.remove('hidden');
    $('battleTitle').textContent = o.title;
    layout(); updateDom();
  }
  function quit() {
    if (!active || state === 'over') return;
    finish(false);
  }
  function init(cv) {
    canvas = cv; ctx = cv.getContext('2d');
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    window.addEventListener('resize', () => { if (active) layout(); });
    window.addEventListener('keydown', e => {
      if (!active) return;
      if (e.key === ' ') { e.preventDefault(); myFast(); }
      else if (e.key === 'Enter' || e.key.toLowerCase() === 'c') myCharged();
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') dodge(e.key === 'ArrowLeft' ? -1 : 1);
    });
    $('chargedBtn').addEventListener('click', myCharged);
    $('dodgeBtn').addEventListener('click', () => dodge());
    $('swapBtn').addEventListener('click', swap);
    $('quitBtn').addEventListener('click', quit);
  }
  return { init, start, update, render, isActive: () => active, _fast: myFast, _charged: myCharged };
})();
