'use strict';
/* Catch screen.
   The throw is simulated in a simple 3D space (depth d: 0 = your hand, 1 = the Blockmon;
   height h above the ground; lateral wx) with gravity, then projected with perspective.
   Swipe DIRECTION aims; swipe SPEED sets the arc, with a wide forgiving band that reaches
   the Blockmon (too slow falls short, far too fast sails over), like Pokémon GO.
   The capture plays out physically: impact bounce, lid opens, the Blockmon is pulled in as
   light, the block drops and bounces, rocks on its edge up to three times, then clicks shut
   or bursts open. */
const Encounter = (() => {
  let canvas, ctx, W = 0, H = 0, dpr = 1;
  let active = false, mon = null, spc = null, tile = 3, onEnd = null, mode = 'wild';
  let phase = 'ready', pt = 0, time = 0, ringT = 0, blockType = 'basic', berry = 0, curve = false;
  let drag = null, outcome = null, shakesShown = 0, popText = null, particles = [], flash = 0, camShake = 0, lastThrow = null;
  let unit, size, monX, monFeetY, nearY, restY, horizon, R;
  const G = 2600, BH = 30, SC_FAR = 0.5;
  // the capture block, in world space
  const blk = { d: 0, wx: 0, h: 0, vd: 0, vwx: 0, vh: 0, rot: 0, spin: 0, lid: 0, alpha: 1, sq: 1, tilt: 0, bounces: 0, passed: false, curveAmp: 0, trail: [], deflected: false };
  // the Blockmon's animation state
  const mm = { act: null, at: 0, next: 3, scale: 1, alpha: 1, tint: 0, seed: 0, popT: -1, fromX: 0, fromY: 0 };

  const $ = id => document.getElementById(id);
  const BG = {
    0: ['#5aa9e6', '#bfe3ff', '#2f78c0'], 1: ['#5aa9e6', '#bfe3ff', '#4aa3df'], 2: ['#7cc6ff', '#fff1d6', '#e8d5a0'],
    3: ['#7cc6ff', '#e2f6ff', '#84cc6a'], 4: ['#6fb8a5', '#d2f1e4', '#3f8a49'], 5: ['#9db4c8', '#e8eef3', '#a49b8e'],
    6: ['#b9d9f2', '#ffffff', '#dfe9f2'],
  };
  const Q_COLORS = { Nice: '#7ee0ff', Great: '#9bff7a', Excellent: '#ffd60a' };

  /* ---------- projection ---------- */
  const sc = d => 1 - (1 - SC_FAR) * Math.min(d, 1.7);
  const gy = d => nearY + (monFeetY - nearY) * d;
  const curveOff = () => blk.curveAmp ? Math.sin(Math.PI * clamp(blk.d, 0, 1)) * blk.curveAmp : 0;
  function project(wx, h, d) { const s = sc(d); return { x: W / 2 + wx * s, y: gy(d) - h * s, s }; }
  const blockScreen = () => project(blk.wx + curveOff(), blk.h, blk.d);

  function layout() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    if (!spc) return;
    unit = Math.min(W * 0.62, H * 0.42);
    size = Sprites.size(spc, false, unit);
    if (size > H * 0.34) { unit *= H * 0.34 / size; size = H * 0.34; }
    monX = W / 2; monFeetY = H * 0.4 + size / 2;
    horizon = H * 0.34; R = size * 0.55;
    nearY = H - 70; restY = nearY - 50;
    if (phase === 'ready') resetBlockPos();
  }

  /* ---------- the Blockmon ---------- */
  function monPose() {
    const id = Sprites.idle(time, mm.seed);
    let dx = 0, dy = 0, sx = id.sx, sy = id.sy, rot = 0, air = false, scale = 1;
    const a = mm.act;
    if (a) {
      const p = clamp(a.t / a.dur, 0, 1);
      if (a.kind === 'hop') {
        const hp = Sprites.hop(p); dy = -hp.dy * size * 0.45; sx = hp.sx; sy = hp.sy; air = hp.air;
      } else if (a.kind === 'attack') {
        // wind up (lean back + squat), then lunge at the camera, then settle back
        if (p < 0.35) { const k = Math.sin(p / 0.35 * Math.PI / 2); sy *= 1 - 0.12 * k; sx *= 1 + 0.08 * k; dy = -k * 6; }
        else if (p < 0.65) { const k = Math.sin((p - 0.35) / 0.3 * Math.PI); scale = 1 + 0.28 * k; dy = k * size * 0.12; air = k > 0.25; sy *= 1 + 0.06 * k; }
      } else if (a.kind === 'wiggle') {
        rot = Math.sin(p * Math.PI * 6) * 0.12 * (1 - p);
      }
    }
    return { x: monX + dx, feet: monFeetY + dy, sx, sy, rot, air, scale, blink: id.blink };
  }
  function monCenter() { const p = monPose(); return { x: p.x, y: p.feet - size * p.scale * 0.5 }; }
  function updateMonster(dt) {
    const calm = ['ready', 'dragging', 'flying', 'return', 'missed'].includes(phase);
    if (mm.act) { mm.act.t += dt; if (mm.act.t >= mm.act.dur) mm.act = null; }
    else if (calm && (mm.next -= dt) <= 0) {
      const kind = pickWeighted([['hop', 4], ['attack', 3], ['wiggle', 2]]);
      mm.act = { kind, t: 0, dur: kind === 'hop' ? 0.75 : kind === 'attack' ? 0.95 : 0.7 };
      mm.next = rand(2.2, 4.8);
      if (kind === 'hop') setTimeout(() => active && dust(monX, monFeetY, 6), 600);
    }
  }

  /* ---------- helpers ---------- */
  function ringR() { return R * (1 - 0.78 * ringT); }
  function ringColor() {
    const b = Game.baseCatch(mon);
    return b > 0.3 ? '#52d273' : b > 0.18 ? '#ffd60a' : b > 0.09 ? '#ff9f1c' : '#ff3b3b';
  }
  function order() { return mode === 'raid' ? ['premier'] : BLOCK_ORDER; }
  function firstAvailable() { return order().find(k => S.blocks[k] > 0) || order()[0]; }
  function blocksLeft() { return mode === 'raid' ? S.blocks.premier : Game.totalBlocks(); }
  function resetBlockPos() {
    Object.assign(blk, { d: 0, wx: 0, h: nearY - restY, vd: 0, vwx: 0, vh: 0, rot: 0, spin: 0, lid: 0, alpha: 1, sq: 1, tilt: 0, bounces: 0, passed: false, curveAmp: 0, trail: [], deflected: false });
  }
  function bringNextBlock() { resetBlockPos(); blk.h = -60; phase = 'return'; pt = 0; }
  function burst(x, y, n, colors, speed, opts) {
    opts = opts || {};
    for (let i = 0; i < n; i++) {
      const a = opts.up ? -Math.PI / 2 + rand(-1.2, 1.2) : Math.random() * Math.PI * 2, s = rand(0.3, 1) * speed;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: opts.g ?? 600, life: rand(0.5, 1.1), t: 0, c: colors[i % colors.length], sz: rand(opts.min || 4, opts.max || 9), rot: Math.random() * 6, vr: rand(-8, 8), kind: opts.kind || 'sq' });
    }
  }
  function dust(x, y, n) {
    for (let i = 0; i < n; i++) particles.push({ x: x + rand(-20, 20), y, vx: rand(-60, 60), vy: rand(-40, -10), g: -20, life: rand(0.4, 0.7), t: 0, c: 'rgba(255,255,255,0.7)', sz: rand(8, 16), rot: 0, vr: 0, kind: 'puff' });
  }

  /* ---------- DOM ---------- */
  function updateInfo() {
    const caught = S.dex[spc.id] === 2;
    const ty = TYPES[FAMILIES[spc.family].type];
    $('encInfo').innerHTML =
      `<div class="enc-cp">CP <b>${Game.cp(mon)}</b></div>
       <div class="enc-name">${spc.name}${caught ? ' <span class="caught-mark" title="Already caught">◆</span>' : ''}</div>
       <span class="type" style="background:${ty.color}">${ty.name}</span>${mon.shiny ? ' <span class="type shiny">✦ Shiny</span>' : ''}`;
    updateBerries();
  }
  function updateBerries() {
    const can = (phase === 'ready' || phase === 'return') && !berry;
    $('encBerries').innerHTML = berry
      ? `<div class="berry-on">${berry >= 2.5 ? 'Golden' : 'Razz'} Berry active</div>`
      : ['berry', 'golden'].map(k => `<button class="berry-btn ${k}" data-k="${k}" ${!can || !S.items[k] ? 'disabled' : ''}><i></i>${ITEMS[k].name.split(' ')[0]} ×${S.items[k]}</button>`).join('');
  }
  function feedBerry(k) {
    if (berry || !S.items[k] || !(phase === 'ready' || phase === 'return')) return;
    S.items[k]--; berry = k === 'golden' ? 2.5 : 1.5;
    const c = monCenter();
    burst(c.x, c.y, 16, k === 'golden' ? ['#ffd60a', '#fff3b0'] : ['#ff4d6d', '#ff8fa3'], 220, { up: true });
    mm.act = { kind: 'hop', t: 0, dur: 0.75 };
    updateBerries();
  }
  function updateBlockBtn() {
    const b = BLOCKS[blockType];
    $('blockSel').innerHTML = `${UI.cubeSVG(b.colors, 30)}<span>${b.name}</span><b>×${S.blocks[blockType]}</b>`;
  }
  function cycleBlock() {
    if (phase !== 'ready' && phase !== 'return') return;
    const o = order();
    for (let k = 1; k <= o.length; k++) {
      const n = o[(o.indexOf(blockType) + k) % o.length];
      if (S.blocks[n] > 0) { blockType = n; break; }
    }
    updateBlockBtn();
  }

  /* ---------- input ---------- */
  function pos(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function onDown(e) {
    if (phase !== 'ready') return;
    const p = pos(e), b = blockScreen();
    if (Math.hypot(p.x - b.x, p.y - b.y) > 90) return;
    if (!S.blocks[blockType]) { UI.toast('No blocks of this type left'); return; }
    drag = { pts: [{ x: p.x, y: p.y, t: performance.now() }], last: p, dir: null, turn: 0 };
    curve = false;
    phase = 'dragging';
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
    $('encHint').classList.add('hidden');
  }
  function onMove(e) {
    if (phase !== 'dragging') return;
    const p = pos(e), now = performance.now();
    blk.wx = p.x - W / 2; blk.h = nearY - p.y;
    // curveball: spin the block by circling it before the throw
    const dx = p.x - drag.last.x, dy = p.y - drag.last.y;
    if (Math.hypot(dx, dy) > 4) {
      const a = Math.atan2(dy, dx);
      if (drag.dir != null) { let d = a - drag.dir; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; drag.turn += d; }
      drag.dir = a; drag.last = p;
      if (!curve && Math.abs(drag.turn) > Math.PI * 2.2) { curve = true; burst(p.x, p.y, 12, ['#ffffff', '#b8f2ff'], 180, { g: 0 }); }
    }
    drag.pts.push({ x: p.x, y: p.y, t: now });
    while (drag.pts.length > 2 && now - drag.pts[0].t > 90) drag.pts.shift();
  }
  function onUp(e) {
    if (phase !== 'dragging') return;
    const pts = drag.pts, a = pts[0], b = pts[pts.length - 1];
    const dt = Math.max(12, b.t - a.t) / 1000;
    let vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
    if (performance.now() - b.t > 140) { vx = 0; vy = 0; } // finger stopped before letting go
    drag = null;
    if (vy < -250) throwBlock(vx, vy);
    else { phase = 'return'; pt = 0; }
  }

  /* ---------- the throw ---------- */
  function throwBlock(vx, vy) {
    S.blocks[blockType]--; S.trainer.thrown++;
    updateBlockBtn(); UI.refreshHUD();
    const rx = W / 2 + blk.wx, ry = nearY - blk.h;
    const speed = Math.min(Math.hypot(vx, vy), 7000);
    const T = clamp(0.62 - speed / 25000, 0.4, 0.62);         // flight time to the Blockmon
    const monHw = size / sc(1);                                  // Blockmon height in world units
    // where on its body the arc arrives: ~400 px/s = feet, ~1500 = middle, ~6000 = top of head
    const frac = Math.log(Math.max(1, speed) / 400) / Math.log(6000 / 400);
    const hTarget = BH + frac * monHw;
    const h0 = Math.max(BH, blk.h);
    // aim: where the swipe line crosses the Blockmon's mid-height on screen
    const midY = monFeetY - size / 2;
    const targetX = clamp(rx + (midY - ry) * (vx / vy), -W, 2 * W);
    Object.assign(blk, {
      d: 0, h: h0, vd: 1 / T, vh: (hTarget - h0 + 0.5 * G * T * T) / T,
      vwx: ((targetX - W / 2) / sc(1) - blk.wx) / T,
      spin: curve ? 22 * (vx >= 0 ? 1 : -1) : rand(7, 11) * (vx >= 0 ? 1 : -1),
      curveAmp: curve ? (vx >= 0 ? -1 : 1) * W * 0.35 : 0,
      bounces: 0, passed: false, trail: [], deflected: false, sq: 1,
    });
    lastThrow = { speed: Math.round(speed), frac: +frac.toFixed(2), result: 'flying' };
    phase = 'flying'; pt = 0;
    updateBerries();
  }
  function checkHit() {
    const b = blockScreen(), pose = monPose();
    const cy = pose.feet - size * pose.scale * 0.5, cx = pose.x;
    const dx = b.x - cx, dy = b.y - cy;
    const inside = Math.abs(dx) < size * 0.44 * pose.scale && Math.abs(dy) < size * 0.52 * pose.scale;
    if (!inside) { lastThrow.result = dy < 0 ? 'over' : Math.abs(dx) > size * 0.44 ? 'wide' : 'short'; return false; }
    if (pose.air) {
      // like GO: a jumping or attacking Blockmon knocks the block away
      blk.deflected = true; blk.vd = -0.7; blk.vh = 650; blk.vwx = (dx >= 0 ? 1 : -1) * 500; blk.spin *= -1.5;
      popText = { text: 'Bounced off!', color: '#ffffff', t: 0, x: cx, y: cy - size * 0.6 };
      lastThrow.result = 'deflected';
      return true;
    }
    lastThrow.result = 'hit';
    const r = ringR();
    let q = null;
    if (Math.hypot(dx, dy) <= r + size * 0.06) { const ratio = r / R; q = ratio < 0.42 ? 'Excellent' : ratio < 0.72 ? 'Great' : 'Nice'; }
    const p = Game.catchChance(mon, { block: BLOCKS[blockType].mult, q, curve, berry: berry || 1 });
    berry = 0;
    const per = Math.pow(p, 1 / 3);
    let passed = 0;
    while (passed < 3 && Math.random() < per) passed++;
    outcome = { caught: passed === 3, passed, q, curve };
    let label = q;
    if (curve) label = q ? q + ' Curveball' : 'Curveball';
    if (label) popText = { text: label + '!', color: Q_COLORS[q] || '#ffffff', t: 0, x: cx, y: cy - size * 0.62 };
    // impact: the block pops back up and away from the Blockmon
    blk.vh = 560; blk.vd = -0.22; blk.vwx = -dx * 0.6; blk.spin = 0; blk.curveAmp = 0; blk.wx = (b.x - W / 2) / sc(blk.d);
    flash = 0.5; camShake = 0.12;
    burst(b.x, b.y, 10, ['#ffffff', BLOCKS[blockType].colors[0]], 260, { g: 200 });
    mm.act = null; mm.fromX = cx; mm.fromY = cy;
    phase = 'impact'; pt = 0;
    return true;
  }
  function physics(dt) {
    blk.d += blk.vd * dt; blk.wx += blk.vwx * dt; blk.h += blk.vh * dt; blk.vh -= G * dt;
    blk.rot += blk.spin * dt;
  }
  function groundContact(bounceK) {
    if (blk.h > BH) return false;
    blk.h = BH;
    if (Math.abs(blk.vh) < 160) { blk.vh = 0; return 'rest'; }
    const b = blockScreen();
    dust(b.x, b.y + 30 * b.s, 4);
    blk.sq = 0.72;
    blk.vh = -blk.vh * bounceK; blk.vd *= 0.55; blk.vwx *= 0.55; blk.spin *= 0.5; blk.bounces++;
    return 'bounce';
  }
  function normRot() { blk.rot = Math.atan2(Math.sin(blk.rot), Math.cos(blk.rot)); }
  function afterThrow() {
    if (!S.blocks[blockType]) blockType = firstAvailable();
    updateBlockBtn();
    curve = false;
    if (blocksLeft() === 0) {
      phase = 'out'; pt = 0;
      popText = { text: mode === 'raid' ? `${spc.name} fled!` : 'Out of blocks!', color: '#ff8fa3', t: 0, x: W / 2, y: H * 0.7 };
      return;
    }
    bringNextBlock(); updateBerries();
  }

  /* ---------- update ---------- */
  function update(dt) {
    time += dt; pt += dt;
    if (flash > 0) flash -= dt * 2.5;
    if (camShake > 0) camShake -= dt;
    blk.sq += (1 - blk.sq) * Math.min(1, dt * 14);
    if (['ready', 'dragging', 'flying', 'return', 'missed'].includes(phase)) ringT = (ringT + dt / 1.8) % 1;
    updateMonster(dt);
    if (phase === 'flying' || phase === 'dragging') {
      const b = blockScreen();
      blk.trail.unshift({ x: b.x, y: b.y, s: b.s });
      if (blk.trail.length > 8) blk.trail.pop();
    } else if (blk.trail.length) blk.trail.pop();

    switch (phase) {
      case 'return': {
        // next block rises into the hand / snaps back after a cancelled swipe
        const tx = 0, th = nearY - restY, k = Math.min(1, dt * 14);
        blk.wx += (tx - blk.wx) * k; blk.h += (th - blk.h) * k; blk.rot *= 1 - k;
        if (Math.abs(blk.h - th) < 1 && Math.abs(blk.wx) < 1) { resetBlockPos(); phase = 'ready'; updateBerries(); }
        break;
      }
      case 'ready':
        blk.h = nearY - restY + Math.sin(time * 3) * 4;
        blk.rot = Math.sin(time * 1.6) * 0.06;
        break;
      case 'flying': {
        const prevD = blk.d;
        physics(dt);
        if (!blk.passed && !blk.deflected && blk.bounces === 0 && prevD < 1 && blk.d >= 1) {
          blk.passed = true;
          if (checkHit()) break;
        }
        const g = groundContact(0.38);
        if (g === 'rest' || blk.bounces > 3 || blk.d > 1.65 || blk.d < -0.3) { phase = 'missed'; pt = 0; if (lastThrow.result === 'flying') lastThrow.result = 'short'; }
        break;
      }
      case 'missed':
        physics(dt); groundContact(0.3);
        blk.vwx *= 1 - dt * 2; blk.vd *= 1 - dt * 2; blk.spin *= 1 - dt * 3;
        blk.alpha = Math.max(0, 1 - pt / 0.6);
        if (pt > 0.65) afterThrow();
        break;
      case 'impact':
        // brief bounce off the Blockmon; the block straightens and its lid starts to open
        physics(dt); normRot(); blk.rot *= 1 - Math.min(1, dt * 18);
        blk.lid = Math.min(1, pt / 0.2);
        if (pt > 0.22) { blk.vh = 0; blk.vd = 0; blk.vwx = 0; phase = 'absorb'; pt = 0; }
        break;
      case 'absorb': {
        // the Blockmon turns to light and is pulled into the open block
        const t = Math.min(1, pt / 0.7);
        blk.h += Math.sin(time * 20) * 0.3;
        mm.tint = Math.min(1, t * 2.2); mm.scale = 1 - Sprites.easeInOut(t);
        const b = blockScreen();
        if (Math.random() < 0.7 && t < 0.85) {
          const a = Math.random() * Math.PI * 2, r = size * rand(0.3, 0.6);
          particles.push({ x: b.x + Math.cos(a) * r, y: b.y + Math.sin(a) * r, tx: b.x, ty: b.y, t: 0, life: 0.3, c: Math.random() < 0.5 ? '#ffffff' : TYPES[FAMILIES[spc.family].type].color, sz: rand(3, 6), kind: 'suck' });
        }
        if (t > 0.78) blk.lid = Math.max(0, 1 - (t - 0.78) / 0.22);
        if (t >= 1) { blk.lid = 0; flash = 0.6; phase = 'drop'; pt = 0; blk.vh = 0; }
        break;
      }
      case 'drop': {
        physics(dt);
        const g = groundContact(0.32);
        if (g === 'rest' || (pt > 1.2)) { blk.h = BH; blk.vh = 0; phase = 'shake'; pt = 0; shakesShown = 0; }
        break;
      }
      case 'shake': {
        const target = outcome.caught ? 3 : outcome.passed;
        if (shakesShown >= target) {
          blk.tilt = 0;
          if (pt > 0.45) {
            pt = 0;
            const b = blockScreen();
            if (outcome.caught) {
              phase = 'caught'; flash = 0.4;
              burst(b.x, b.y - 20, 26, ['#ffd60a', '#ffffff', '#fff3b0'], 380, { up: true, kind: 'star', min: 8, max: 14 });
            } else {
              phase = 'break'; flash = 1; camShake = 0.2;
              burst(b.x, b.y, 22, BLOCKS[blockType].colors, 420, { kind: 'shard', min: 6, max: 13 });
              burst(b.x, b.y, 14, ['#ffffff'], 260, { g: 0, kind: 'puff', min: 10, max: 20 });
              blk.alpha = 0;
              popText = { text: 'Oh no! It broke free!', color: '#ffb3c1', t: 0, x: W / 2, y: H * 0.7 };
            }
          }
          break;
        }
        // rock up onto one edge and fall back, with a pause between shakes
        const u = pt / 0.62;
        blk.tilt = u < 1 ? Math.sin(u * Math.PI * 2) * 0.34 * (1 - u * 0.25) : 0;
        if (pt >= 1.05) { shakesShown++; pt = 0; dust(blockScreen().x, blockScreen().y + 26, 3); }
        break;
      }
      case 'break': {
        const t = Math.min(1, pt / 0.45);
        mm.scale = Sprites.easeOutBack(t); mm.tint = 1 - t;
        if (t >= 1) {
          mm.scale = 1; mm.tint = 0;
          if (mode !== 'raid' && Math.random() < spc.flee) {
            phase = 'fled'; pt = 0; mm.act = { kind: 'hop', t: 0, dur: 0.75 };
            popText = { text: `${spc.name} fled!`, color: '#ffffff', t: 0, x: W / 2, y: H * 0.7 };
          } else afterThrow();
        }
        break;
      }
      case 'fled':
        if (pt > 0.45 && mm.alpha === 1) { const c = monCenter(); burst(c.x, c.y, 24, ['#e9ecef', '#ced4da', '#ffffff'], 160, { g: -60, kind: 'puff', min: 14, max: 28 }); mm.alpha = 0.99; }
        if (mm.alpha < 1) mm.alpha = Math.max(0, mm.alpha - dt * 5);
        if (pt > 1.4) end('fled');
        break;
      case 'caught':
        if (pt > 1.4) {
          phase = 'done';
          const rewards = Game.catchMon(mon, outcome.q, outcome.curve);
          UI.caughtCard(mon, rewards, () => end('caught'));
        }
        break;
      case 'out':
        if (pt > 1.8) end(mode === 'raid' ? 'fled' : 'ran');
        break;
    }
    for (const p of particles) {
      p.t += dt;
      if (p.kind === 'suck') { const k = p.t / p.life; p.x += (p.tx - p.x) * Math.min(1, k * 0.5 + dt * 8); p.y += (p.ty - p.y) * Math.min(1, k * 0.5 + dt * 8); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; p.rot += p.vr * dt;
      if (p.kind === 'puff') { p.vx *= 1 - dt * 3; p.vy *= 1 - dt * 3; }
    }
    particles = particles.filter(p => p.t < p.life);
    if (popText) { popText.t += dt; if (popText.t > 1.4) popText = null; }
  }

  /* ---------- render ---------- */
  function drawBg() {
    const [s1, s2, gr] = BG[tile] || BG[3];
    let g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0, s1); g.addColorStop(1, s2);
    ctx.fillStyle = g; ctx.fillRect(-20, -20, W + 40, horizon + 21);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 4; i++) {
      const x = ((i * 347 + time * (8 + i * 3)) % (W + 240)) - 120, y = 30 + ((i * 53) % 110);
      ctx.fillRect(x, y, 96, 24); ctx.fillRect(x + 22, y - 14, 52, 16);
    }
    const hill = Sprites.mix(gr, '#000000', 0.18);
    ctx.fillStyle = hill;
    for (let i = 0; i < 9; i++) {
      const w = W / 7, h = 18 + ((i * 53) % 36);
      ctx.fillRect(i * w - 30, horizon - h, w + 12, h + 1);
    }
    // perspective ground: rows get taller toward the camera
    const rows = 18;
    for (let i = 0; i < rows; i++) {
      const y0 = horizon + (H - horizon) * Math.pow(i / rows, 1.6), y1 = horizon + (H - horizon) * Math.pow((i + 1) / rows, 1.6);
      ctx.fillStyle = i % 2 ? gr : Sprites.mix(gr, '#ffffff', 0.07);
      ctx.fillRect(-20, y0, W + 40, y1 - y0 + 1);
    }
    // grass tufts scattered with perspective
    ctx.fillStyle = Sprites.mix(gr, '#000000', 0.12);
    for (let i = 0; i < 26; i++) {
      const d = ((i * 0.37) % 1.3), s = sc(d), x = W / 2 + (((i * 911) % 1000) / 1000 - 0.5) * W * 1.6 * s, y = gy(d);
      if (y < horizon + 4) continue;
      ctx.fillRect(x, y - 8 * s, 4 * s, 8 * s); ctx.fillRect(x + 6 * s, y - 12 * s, 4 * s, 12 * s);
    }
    ctx.fillStyle = Sprites.mix(gr, '#ffffff', 0.25);
    ctx.beginPath(); ctx.ellipse(monX, monFeetY, size * 0.62, size * 0.13, 0, 0, Math.PI * 2); ctx.fill();
  }
  function drawMonster() {
    if (mm.alpha <= 0 || mm.scale <= 0.02) return;
    const pose = monPose();
    const airK = Math.max(0, (monFeetY - pose.feet) / (size * 0.45));
    ctx.fillStyle = `rgba(0,0,0,${0.22 * (1 - airK * 0.5) * mm.alpha})`;
    ctx.beginPath(); ctx.ellipse(monX, monFeetY, size * 0.36 * (1 - airK * 0.35) * mm.scale * pose.scale, size * 0.07 * mm.scale, 0, 0, Math.PI * 2); ctx.fill();
    let x = pose.x, feet = pose.feet, u = unit * pose.scale;
    if (phase === 'absorb' || phase === 'break') {
      // fly between its spot and the block
      const b = blockScreen(), k = 1 - mm.scale;
      x = mm.fromX + (b.x - mm.fromX) * k;
      const cy = mm.fromY + (b.y - mm.fromY) * k;
      u = unit * Math.max(0.01, mm.scale); feet = cy + Sprites.size(spc, false, u) / 2;
    }
    const s = Sprites.size(spc, false, u);
    ctx.save(); ctx.globalAlpha = mm.alpha;
    Sprites.draw(ctx, spc, false, x, feet - s / 2, u, {
      shiny: mon.shiny, blink: pose.blink, sx: pose.sx, sy: pose.sy, rot: pose.rot, tint: mm.tint > 0 ? { color: '#ffffff', amt: mm.tint } : null,
    });
    ctx.restore();
    if (mon.shiny && mm.tint === 0 && Math.sin(time * 3) > 0.6) {
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 4; i++) { const a = time + i * 1.57; star(x + Math.cos(a) * size * 0.5, feet - s / 2 + Math.sin(a) * size * 0.4, 7); }
    }
    if (berry) {
      ctx.fillStyle = berry >= 2.5 ? '#ffd60a' : '#ff4d6d';
      ctx.fillRect(x + size * 0.38, feet - s - 6 + Math.sin(time * 4) * 3, 12, 12);
    }
  }
  function drawRing() {
    if (!['ready', 'dragging', 'flying', 'return'].includes(phase)) return;
    const c = monCenter();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 6; ctx.strokeStyle = ringColor();
    ctx.beginPath(); ctx.arc(c.x, c.y, ringR(), 0, Math.PI * 2); ctx.stroke();
  }
  function drawBlock() {
    if (blk.alpha <= 0 || phase === 'done' || phase === 'out') return;
    const p = blockScreen(), s = 64 * p.s;
    const gp = project(blk.wx + curveOff(), 0, blk.d);
    const k = clamp(1 - (blk.h - BH) / 700, 0.3, 1);
    ctx.fillStyle = `rgba(0,0,0,${0.28 * k * blk.alpha})`;
    ctx.beginPath(); ctx.ellipse(gp.x, gp.y, s * 0.42 * k, s * 0.12 * k, 0, 0, Math.PI * 2); ctx.fill();
    if (phase === 'flying') {
      for (let i = 1; i < blk.trail.length; i++) {
        const t = blk.trail[i], a = (1 - i / blk.trail.length) * 0.35;
        ctx.fillStyle = curve ? `rgba(184,242,255,${a})` : `rgba(255,255,255,${a})`;
        const ts = 26 * t.s * (1 - i / blk.trail.length);
        ctx.fillRect(t.x - ts / 2, t.y - ts / 2, ts, ts);
      }
    }
    if (curve && (phase === 'dragging' || phase === 'flying')) {
      ctx.strokeStyle = 'rgba(184,242,255,0.8)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, 44 * p.s, time * 12, time * 12 + 4); ctx.stroke();
    }
    ctx.save();
    ctx.globalAlpha = blk.alpha;
    if (blk.tilt) { // rock on the bottom edge on the side it leans toward
      const px = p.x + Math.sign(blk.tilt) * s * 0.5, py = p.y + s * 0.5;
      ctx.translate(px, py); ctx.rotate(blk.tilt); ctx.translate(-px, -py);
    }
    if (blk.sq !== 1) { const py = p.y + s * 0.5; ctx.translate(p.x, py); ctx.scale(2 - blk.sq, blk.sq); ctx.translate(-p.x, -py); }
    const spinning = curve && phase === 'dragging' ? time * 14 : 0;
    const col = phase === 'caught' || phase === 'done' ? BLOCKS[blockType].colors.map(c => Sprites.mix(c, '#555555', Math.min(0.45, pt))) : BLOCKS[blockType].colors;
    Sprites.cube(ctx, p.x, p.y, s, col, blk.rot + spinning, blk.lid, 1);
    if (phase === 'absorb') {
      ctx.fillStyle = `rgba(255,255,255,${0.35 + Math.sin(time * 30) * 0.15})`;
      ctx.beginPath(); ctx.arc(p.x, p.y - s * 0.35, s * 0.45, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  function star(x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
  }
  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (camShake > 0) ctx.translate(rand(-6, 6) * camShake * 6, rand(-6, 6) * camShake * 6);
    drawBg();
    const behind = blk.d > 1.02;
    if (behind) drawBlock();
    drawMonster();
    drawRing();
    if (!behind) drawBlock();
    for (const p of particles) {
      const a = Math.max(0, 1 - p.t / p.life);
      ctx.save(); ctx.globalAlpha = p.kind === 'puff' ? a * 0.8 : a; ctx.fillStyle = p.c;
      if (p.kind === 'star') { star(p.x, p.y, p.sz * (0.6 + a * 0.4)); }
      else if (p.kind === 'puff') { ctx.beginPath(); ctx.arc(p.x, p.y, p.sz * (1.4 - a * 0.6), 0, Math.PI * 2); ctx.fill(); }
      else { ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0); ctx.fillRect(-p.sz / 2, -p.sz / 2, p.sz, p.sz); }
      ctx.restore();
    }
    if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.55, flash * 0.6)})`; ctx.fillRect(-20, -20, W + 40, H + 40); }
    if (phase === 'caught' || phase === 'done') {
      const b = blockScreen();
      ctx.fillStyle = '#ffd60a';
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i - 1) * 0.6, d = 46 + Sprites.easeOutBack(Math.min(1, pt * 2.5)) * 22;
        star(b.x + Math.cos(a) * d, b.y + Math.sin(a) * d, 11);
      }
    }
    if (popText) {
      const a = Math.max(0, 1 - Math.max(0, popText.t - 0.9) / 0.5);
      const sc2 = popText.t < 0.15 ? Sprites.easeOutBack(popText.t / 0.15) : 1;
      ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'center';
      ctx.translate(popText.x, popText.y - popText.t * 26); ctx.scale(sc2, sc2);
      ctx.font = '700 34px Fredoka, system-ui, sans-serif';
      ctx.lineWidth = 6; ctx.strokeStyle = '#121225'; ctx.strokeText(popText.text, 0, 0);
      ctx.fillStyle = popText.color; ctx.fillText(popText.text, 0, 0);
      ctx.restore();
    }
  }

  /* ---------- lifecycle ---------- */
  // s: { speciesId, level, shiny }; opts.mode 'raid' = premier blocks only, no fleeing
  function start(s, tileType, cbEnd, opts) {
    opts = opts || {};
    tile = tileType; onEnd = cbEnd; mode = opts.mode || 'wild';
    spc = SPECIES_BY_ID[s.speciesId];
    mon = Game.createMon(spc.id, s.level, { shiny: !!s.shiny, ivFloor: mode === 'raid' ? 10 : 0 });
    Game.markSeen(spc.id);
    berry = 0; curve = false; ringT = 0; flash = 0; camShake = 0;
    Object.assign(mm, { act: null, next: rand(1.5, 3.5), scale: 0, alpha: 1, tint: 0, seed: Math.random() * 10 });
    particles = []; popText = null; drag = null; outcome = null; lastThrow = null;
    if (!S.blocks[blockType] || !order().includes(blockType)) blockType = firstAvailable();
    $('encounter').classList.remove('hidden');
    $('encHint').classList.remove('hidden');
    $('runBtn').textContent = mode === 'raid' ? 'Give up' : 'Run';
    active = true;
    phase = 'appear'; pt = 0;
    layout(); resetBlockPos(); blk.h = -60;
    updateInfo(); updateBlockBtn();
    burst(monX, monFeetY - 10, 14, ['#7bd389', '#ffffff', '#b7e4c7'], 260, { up: true });
  }
  function end(result) {
    if (!active) return;
    active = false;
    $('encounter').classList.add('hidden');
    Game.save();
    const sp = spc;
    spc = null;
    if (mode === 'raid') S.blocks.premier = 0;
    onEnd && onEnd(result, mon, sp);
  }
  // entrance: the Blockmon pops out of the grass, then the first block rises into your hand
  const baseUpdate = update;
  function updateWithAppear(dt) {
    if (phase === 'appear') {
      time += dt; pt += dt;
      mm.scale = Sprites.easeOutBack(Math.min(1, pt / 0.45));
      for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; }
      particles = particles.filter(p => p.t < p.life);
      if (pt > 0.5) {
        mm.scale = 1;
        if (blocksLeft() === 0) { phase = 'out'; pt = 0; popText = { text: 'Out of blocks!', color: '#ff8fa3', t: 0, x: W / 2, y: H * 0.7 }; }
        else { phase = 'return'; pt = 0; }
      }
      return;
    }
    baseUpdate(dt);
  }
  function init(cv) {
    canvas = cv; ctx = cv.getContext('2d');
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', () => { if (active) layout(); });
    $('runBtn').addEventListener('click', () => {
      if (['ready', 'dragging', 'return', 'flying', 'missed', 'out', 'appear'].includes(phase)) end(mode === 'raid' ? 'fled' : 'ran');
    });
    $('blockSel').addEventListener('click', cycleBlock);
    $('encBerries').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) feedBerry(b.dataset.k); });
  }
  // test hooks
  function _autoThrow() {
    if (phase !== 'ready') return false;
    mm.act = null; mm.next = 99; // hold still for the scripted throw
    throwBlock(0, -2200);
    return true;
  }
  function _blockScreen() { const b = blockScreen(); return { x: b.x, y: b.y }; }
  return {
    init, start, update: updateWithAppear, render, isActive: () => active,
    _autoThrow, _phase: () => phase, _lastThrow: () => lastThrow, _blockScreen, _calm() { mm.act = null; mm.next = 99; },
  };
})();
