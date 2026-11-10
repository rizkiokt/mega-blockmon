'use strict';
/* DOM UI: HUD, panels (Blockmon, Blockdex, Bag, Eggs), detail sheets, gym/raid lobby, ceremonies. */
const UI = (() => {
  const $ = id => document.getElementById(id);
  let panel = null, sortMode = 'recent', modalOpen = false, modalAnim = null, modalLocked = false;

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function cubeSVG(c, size) {
    size = size || 22;
    return `<svg class="cube" width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true"><polygon points="10,1 19,5.5 10,10 1,5.5" fill="${c[0]}" stroke="#121225" stroke-width=".8"/><polygon points="1,5.5 10,10 10,19 1,14.5" fill="${c[1]}" stroke="#121225" stroke-width=".8"/><polygon points="10,10 19,5.5 19,14.5 10,19" fill="${c[2]}" stroke="#121225" stroke-width=".8"/><polyline points="1,10 10,14.5 19,10" stroke="rgba(0,0,0,.35)" fill="none"/><rect x="8.6" y="12.4" width="2.8" height="2.8" fill="#fff"/></svg>`;
  }
  const typeBadge = t => `<span class="type" style="background:${TYPES[t].color}">${TYPES[t].name}</span>`;
  function img(mon, cls) {
    const spc = SPECIES_BY_ID[mon.speciesId], mc = FAMILIES[spc.family].megaColor;
    return `<img class="${cls || ''}" src="${Sprites.monUrl(mon)}" alt="${esc(Game.name(mon))}" style="${mon.mega && mc ? `filter:drop-shadow(0 0 10px ${mc})` : ''}">`;
  }
  const spImg = (spc, mega, cls, shiny) => `<img class="${cls || ''}" src="${Sprites.url(spc, mega, shiny)}" alt="${esc(spc.name)}">`;

  /* ---------- HUD & toasts ---------- */
  function refreshHUD() {
    if (!S) return;
    const t = S.trainer;
    $('hudLevel').textContent = t.level;
    $('hudName').textContent = t.name;
    $('hudXp').style.width = Math.min(100, t.xp / Game.xpToNext(t.level) * 100) + '%';
    $('hudBlocks').textContent = Game.totalBlocks();
    $('hudDust').textContent = t.dust.toLocaleString();
    $('trainerBtn').style.setProperty('--team', TEAMS[S.team].color);
    const inc = S.incs.find(i => i.egg != null);
    const egg = inc && S.eggs.find(e => e.id === inc.egg);
    $('hudEgg').classList.toggle('hidden', !egg);
    if (egg) $('hudEggTxt').textContent = `${Math.min(egg.progress, egg.km).toFixed(1)}/${egg.km} km`;
  }
  function toast(html, cls) {
    const el = document.createElement('div');
    el.className = 'toast ' + (cls || '');
    el.innerHTML = html;
    $('toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3000);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  }
  function itemName(k, n) {
    const name = BLOCKS[k] ? BLOCKS[k].name : ITEMS[k].name;
    return `+${n} ${name}${n > 1 && !name.endsWith('s') ? 's' : ''}`;
  }
  function spinToast(got, egg) {
    const parts = Object.keys(got).map(k => itemName(k, got[k]));
    if (egg) parts.push(`${egg.km} km Egg`);
    toast(parts.join(' · ') + ' · +50 XP', 'good');
  }
  function levelUp(level, r) {
    toast(`<b>Level ${level}!</b> +${r.basic} Blocks${r.super ? `, +${r.super} Super` : ''}${r.ultra ? `, +${r.ultra} Ultra` : ''}, potions, revives & a Raid Pass`, 'level');
  }

  /* ---------- modal ---------- */
  function modal(html, opts) {
    stopAnim();
    $('modalCard').innerHTML = html;
    $('modalCard').className = 'modal-card ' + ((opts && opts.cls) || '');
    $('modal').classList.remove('hidden');
    modalOpen = true; modalLocked = !!(opts && opts.locked);
    $('modalCard').scrollTop = 0;
  }
  function closeModal() {
    stopAnim();
    $('modal').classList.add('hidden');
    $('modalCard').innerHTML = '';
    modalOpen = false; modalLocked = false;
  }
  function stopAnim() { if (modalAnim) { modalAnim.stop = true; modalAnim = null; } }

  /* ---------- panels ---------- */
  function openPanel(name) {
    panel = name;
    $('panel').classList.remove('hidden');
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.panel === name));
    renderPanel();
  }
  function closePanel() {
    panel = null;
    $('panel').classList.add('hidden');
    document.querySelectorAll('#nav button').forEach(b => b.classList.remove('on'));
  }
  function renderPanel() {
    if (!panel) return;
    ({ collection: renderCollection, dex: renderDex, bag: renderBag, eggs: renderEggs })[panel]();
  }

  function hpMini(mon) {
    const cur = Game.curHp(mon), max = Game.maxHp(mon), p = cur / max;
    if (p >= 1) return '';
    return `<span class="hpmini"><i style="width:${p * 100}%;background:${p > 0.5 ? '#52d273' : p > 0.2 ? '#ffd60a' : '#ff4d6d'}"></i></span>`;
  }
  function renderCollection() {
    $('panelTitle').textContent = `Blockmon ${S.mons.length}`;
    $('panelTools').innerHTML = `<select id="sortSel">
      ${[['recent', 'Recent'], ['cp', 'CP'], ['iv', 'IV %'], ['num', 'Number'], ['name', 'Name'], ['hp', 'HP']].map(([v, l]) => `<option value="${v}" ${v === sortMode ? 'selected' : ''}>${l}</option>`).join('')}
    </select>`;
    $('sortSel').onchange = e => { sortMode = e.target.value; renderCollection(); };
    const list = S.mons.slice();
    const sorters = {
      recent: (a, b) => b.caughtAt - a.caughtAt,
      cp: (a, b) => Game.cp(b) - Game.cp(a),
      iv: (a, b) => Game.ivPct(b) - Game.ivPct(a),
      num: (a, b) => SPECIES_BY_ID[a.speciesId].dex - SPECIES_BY_ID[b.speciesId].dex || Game.cp(b) - Game.cp(a),
      name: (a, b) => Game.name(a).localeCompare(Game.name(b)),
      hp: (a, b) => Game.curHp(a) / Game.maxHp(a) - Game.curHp(b) / Game.maxHp(b),
    };
    list.sort(sorters[sortMode]);
    $('panelBody').innerHTML = list.length ? `<div class="grid">${list.map(m => `
      <button class="card ${m.mega ? 'mega' : ''} ${Game.curHp(m) <= 0 ? 'fainted' : ''}" data-uid="${m.uid}">
        <div class="cp">CP <b>${Game.cp(m)}</b></div>
        ${m.shiny ? '<span class="shiny-mark" title="Shiny">✦</span>' : ''}
        ${img(m)}
        ${hpMini(m)}
        <div class="nm">${esc(Game.name(m))}</div>
      </button>`).join('')}</div>` : '<p class="empty">No Blockmon yet. Go catch some!</p>';
    $('panelBody').querySelectorAll('[data-uid]').forEach(el => el.onclick = () => showMon(+el.dataset.uid));
  }

  function dexEntries() {
    const out = [];
    for (const s of SPECIES) {
      out.push({ spc: s, mega: false });
      if (canMega(s)) out.push({ spc: s, mega: true });
    }
    return out;
  }
  function renderDex() {
    const all = dexEntries();
    const caught = all.filter(e => e.mega ? S.megaDex[e.spc.id] : S.dex[e.spc.id] === 2).length;
    $('panelTitle').textContent = `Blockdex ${caught}/${all.length}`;
    $('panelTools').innerHTML = '';
    $('panelBody').innerHTML = `<div class="grid dex">${all.map(e => {
      const st = e.mega ? (S.megaDex[e.spc.id] ? 2 : 0) : (S.dex[e.spc.id] || 0);
      const num = '#' + String(e.spc.dex).padStart(3, '0') + (e.mega ? 'M' : '');
      return `<button class="card ${e.mega ? 'mega' : ''} st${st}" data-id="${e.spc.id}" data-mega="${e.mega ? 1 : 0}" ${st ? '' : 'disabled'}>
        <div class="num">${num}</div>${S.shinyDex[e.spc.id] && !e.mega ? '<span class="shiny-mark">✦</span>' : ''}
        ${spImg(e.spc, e.mega, st === 2 ? '' : 'sil')}
        <div class="nm">${st ? (e.mega ? 'Mega ' : '') + e.spc.name : '???'}</div></button>`;
    }).join('')}</div>`;
    $('panelBody').querySelectorAll('[data-id]').forEach(el => el.onclick = () => showSpecies(SPECIES_BY_ID[el.dataset.id], el.dataset.mega === '1'));
  }
  function renderBag() {
    $('panelTitle').textContent = 'Bag';
    $('panelTools').innerHTML = '';
    const t = S.trainer;
    const fams = Object.keys(FAMILIES).filter(f => S.shards[f] || S.energy[f]);
    const itemRow = (icon, name, n, desc) => `<div class="row"><span class="ico">${icon}</span><div class="grow"><b>${name}</b><small>${desc}</small></div><b class="qty">×${n}</b></div>`;
    const dot = c => `<span class="dot" style="background:${c}"></span>`;
    $('panelBody').innerHTML = `
      <h3>Blocks</h3>
      ${[...BLOCK_ORDER, 'premier'].filter(k => k !== 'premier' || S.blocks.premier).map(k => itemRow(cubeSVG(BLOCKS[k].colors, 30), BLOCKS[k].name, S.blocks[k], BLOCKS[k].desc + (k !== 'premier' ? ` (×${BLOCKS[k].mult} catch bonus)` : ''))).join('')}
      <h3>Items</h3>
      ${itemRow(dot('#ff4d6d'), 'Razz Berry', S.items.berry, ITEMS.berry.desc)}
      ${itemRow(dot('#ffd60a'), 'Golden Berry', S.items.golden, ITEMS.golden.desc)}
      ${itemRow(dot('#c77dff'), 'Potion', S.items.potion, ITEMS.potion.desc)}
      ${itemRow(dot('#f15bb5'), 'Super Potion', S.items.superPotion, ITEMS.superPotion.desc)}
      ${itemRow(dot('#ffe066'), 'Revive', S.items.revive, ITEMS.revive.desc)}
      ${itemRow(dot('#4cc9f0'), 'Raid Pass', S.items.raidPass, ITEMS.raidPass.desc)}
      ${itemRow(dot('#ff9f1c'), 'Incubator', S.items.incubator, ITEMS.incubator.desc)}
      <h3>Shards &amp; Mega Energy</h3>
      ${fams.length ? fams.map(f => `<div class="row"><span class="ico">${spImg(FAMILY_BASE[f], false, 'tiny')}</span><div class="grow"><b>${Game.shardName(f)}</b>${FAMILIES[f].hasMega ? `<small>Mega Energy: ${S.energy[f] || 0} / ${MEGA_COST}</small>` : ''}</div><b class="qty">×${S.shards[f] || 0}</b></div>`).join('') : '<p class="empty">Catch Blockmon to earn shards.</p>'}
      <h3>Trainer</h3>
      <div class="stats">
        <div><b>${t.caught}</b><small>Caught</small></div><div><b>${t.km.toFixed(2)}</b><small>km walked</small></div>
        <div><b>${t.evolved}</b><small>Evolved</small></div><div><b>${t.megas}</b><small>Mega evolved</small></div>
        <div><b>${t.gymWins}</b><small>Gym wins</small></div><div><b>${t.raidWins}</b><small>Raid wins</small></div>
        <div><b>${t.hatched}</b><small>Hatched</small></div><div><b>${t.shinies}</b><small>Shinies</small></div>
      </div>
      <button class="btn danger" id="resetBtn">Reset save data</button>`;
    $('resetBtn').onclick = e => {
      if (e.target.dataset.armed) Game.reset();
      else { e.target.dataset.armed = 1; e.target.textContent = 'Tap again to erase everything'; }
    };
  }
  function renderEggs() {
    $('panelTitle').textContent = `Eggs ${S.eggs.length}/9`;
    $('panelTools').innerHTML = S.items.incubator ? `<button class="btn small" id="addInc">Use Incubator (${S.items.incubator})</button>` : '';
    if ($('addInc')) $('addInc').onclick = () => { Game.addIncubator(); renderEggs(); };
    const eggColor = km => km === 2 ? '#7bd389' : km === 5 ? '#ffb703' : '#c77dff';
    $('panelBody').innerHTML = `
      <h3>Incubators</h3>
      <div class="incs">${S.incs.map(inc => {
        const egg = inc.egg != null && S.eggs.find(e => e.id === inc.egg);
        return `<div class="inc">${inc.uses < 0 ? '<b>∞</b>' : `<b>${inc.uses} uses</b>`}
          ${egg ? `<div class="egg" style="--ec:${eggColor(egg.km)}"></div><small>${Math.min(egg.progress, egg.km).toFixed(2)} / ${egg.km} km</small>
          <span class="bar"><i style="width:${Math.min(100, egg.progress / egg.km * 100)}%"></i></span>` : '<small>Empty — pick an egg below</small>'}</div>`;
      }).join('')}</div>
      <h3>Eggs</h3>
      ${S.eggs.length ? `<div class="grid eggs">${S.eggs.map(e => {
        const inInc = S.incs.some(i => i.egg === e.id);
        return `<button class="card egg-card" data-egg="${e.id}" ${inInc ? 'disabled' : ''}><div class="egg" style="--ec:${eggColor(e.km)}"></div><div class="nm">${e.km} km</div><small>${inInc ? 'Incubating' : 'Tap to incubate'}</small></button>`;
      }).join('')}</div>` : '<p class="empty">Spin Block Towers to find eggs. Walk to hatch them!</p>'}`;
    $('panelBody').querySelectorAll('[data-egg]').forEach(el => el.onclick = () => {
      const free = S.incs.find(i => i.egg == null);
      if (!free) { toast('All incubators are busy'); return; }
      Game.incubate(+el.dataset.egg, free.id); renderEggs(); refreshHUD();
    });
  }

  /* ---------- Blockmon detail ---------- */
  function moveRow(id) {
    const m = MOVES[id];
    const extra = m.kind === 'fast' ? `${m.power} dmg · +${m.energy} energy · ${m.dur}s` : `${m.power} dmg · ${'▮'.repeat(Math.round(100 / m.cost))}`;
    return `<div class="move"><span class="type" style="background:${TYPES[m.type].color}">${TYPES[m.type].name}</span><b>${m.name}</b><small>${extra}</small></div>`;
  }
  function showMon(uid) {
    const mon = Game.get(uid);
    if (!mon) { closeModal(); return; }
    const spc = SPECIES_BY_ID[mon.speciesId], fam = FAMILIES[spc.family];
    const shards = S.shards[spc.family] || 0, energy = S.energy[spc.family] || 0;
    const pc = Game.powerCost(mon), maxL = Game.maxLevel();
    const canPower = mon.level < maxL && S.trainer.dust >= pc.dust && shards >= pc.shards;
    const evo = spc.evolvesTo ? SPECIES_BY_ID[spc.evolvesTo] : null;
    const megaOk = canMega(spc) && !mon.mega;
    const chain = familyChain(spc.family);
    const iv = (l, v) => `<div class="iv"><span>${l}</span><span class="bar"><i style="width:${v / 15 * 100}%;${v === 15 ? 'background:#ff6b6b' : ''}"></i></span><b>${v}</b></div>`;
    const hp = Game.curHp(mon), maxHp = Game.maxHp(mon);
    const needHeal = hp < maxHp;
    modal(`
      <div class="mon-detail ${mon.mega ? 'is-mega' : ''}" style="--mc:${fam.megaColor || '#fff'}">
        <button class="close" data-close>✕</button>
        <div class="cp-big">CP <b>${Game.cp(mon)}</b></div>
        <div class="stage">${img(mon, 'big')}</div>
        <h2>${esc(Game.name(mon))} ${mon.shiny ? '<span class="shiny-mark">✦</span>' : ''}</h2>
        <div class="meta">${typeBadge(fam.type)} <span>Lv ${mon.level}</span> <span>${spc.legendary ? 'Legendary' : 'Stage ' + spc.stage}</span></div>
        <div class="hpline"><span class="bar"><i style="width:${hp / maxHp * 100}%"></i></span><small>${hp} / ${maxHp} HP</small></div>
        ${needHeal ? `<div class="heal">${hp <= 0
          ? `<button class="btn small" data-heal="revive" ${S.items.revive ? '' : 'disabled'}>Revive (${S.items.revive})</button>`
          : `<button class="btn small" data-heal="potion" ${S.items.potion ? '' : 'disabled'}>Potion (${S.items.potion})</button><button class="btn small" data-heal="superPotion" ${S.items.superPotion ? '' : 'disabled'}>Super Potion (${S.items.superPotion})</button>`}</div>` : ''}
        <div class="res"><div><b>${S.trainer.dust.toLocaleString()}</b><small>Stardust</small></div><div><b>${shards}</b><small>${Game.shardName(spc.family)}</small></div>${fam.hasMega ? `<div><b>${energy}</b><small>Mega Energy</small></div>` : ''}</div>
        <div class="moves">${moveRow(mon.fast)}${moveRow(mon.charged)}</div>
        <div class="appraise"><div class="ivhead">Appraisal <b>${Game.ivPct(mon)}%</b></div>${iv('Attack', mon.iv.a)}${iv('Defense', mon.iv.d)}${iv('Stamina', mon.iv.s)}</div>
        <div class="actions">
          <button class="btn" data-act="power" ${canPower ? '' : 'disabled'}>Power Up<small>${mon.level >= maxL ? `Max Lv ${maxL} (raise trainer level)` : `✦ ${pc.dust} · ${pc.shards} shard${pc.shards > 1 ? 's' : ''}`}</small></button>
          ${evo ? `<button class="btn evolve" data-act="evolve" ${shards >= spc.evolveCost ? '' : 'disabled'}>Evolve → ${evo.name}<small>${spc.evolveCost} shards</small></button>` : ''}
          ${megaOk ? `<button class="btn mega" data-act="mega" ${energy >= MEGA_COST ? '' : 'disabled'}>Mega Evolve<small>${energy}/${MEGA_COST} Mega Energy · earn it in raids</small></button>` : ''}
          <button class="btn ghost" data-act="transfer">Transfer<small>+1 shard</small></button>
        </div>
        <h3>Evolution</h3>
        <div class="chain">${chain.map((c, i) => `${i ? '<span class="arr">→</span>' : ''}<div class="${c.id === spc.id && !mon.mega ? 'cur' : ''}">${spImg(c, false, S.dex[c.id] === 2 ? '' : 'sil')}<small>${S.dex[c.id] ? c.name : '???'}</small>${c.evolvesTo ? `<em>${c.evolveCost}</em>` : ''}</div>`).join('')}
          ${canMega(chain[chain.length - 1]) ? `<span class="arr mega">⇒</span><div class="${mon.mega ? 'cur' : ''}">${spImg(chain[chain.length - 1], true, S.megaDex[chain[chain.length - 1].id] ? '' : 'sil')}<small>Mega</small><em>${MEGA_COST}⚡</em></div>` : ''}</div>
        <p class="desc">${esc(spc.desc)}</p>
        <p class="caught-at">Caught ${new Date(mon.caughtAt).toLocaleDateString()}</p>
      </div>`);
    const card = $('modalCard');
    card.querySelector('[data-close]').onclick = closeModal;
    card.querySelectorAll('[data-heal]').forEach(b => b.onclick = () => { Game.heal(uid, b.dataset.heal); showMon(uid); renderPanel(); });
    card.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const a = b.dataset.act;
      if (a === 'power') { if (Game.powerUp(uid)) { refreshHUD(); showMon(uid); renderPanel(); $('modalCard').querySelector('.cp-big').classList.add('pop'); } }
      else if (a === 'evolve') { const r = Game.evolve(uid); if (r) evolutionScene(r.from, false, r.to, false, mon.shiny, () => { showMon(uid); renderPanel(); }); }
      else if (a === 'mega') { const r = Game.megaEvolve(uid); if (r) evolutionScene(r.spc, false, r.spc, true, mon.shiny, () => { showMon(uid); renderPanel(); }); }
      else if (a === 'transfer') {
        if (!b.dataset.armed) { b.dataset.armed = 1; b.innerHTML = 'Tap again to confirm<small>This cannot be undone</small>'; return; }
        const name = Game.name(mon);
        Game.transfer(uid); closeModal(); renderPanel(); toast(`${esc(name)} was transferred. +1 shard`);
      }
    });
  }
  function showSpecies(spc, mega) {
    const fam = FAMILIES[spc.family], st = Game.stats(spc, mega), pool = movePool(spc);
    modal(`<div class="mon-detail ${mega ? 'is-mega' : ''}" style="--mc:${fam.megaColor || '#fff'}">
      <button class="close" data-close>✕</button>
      <div class="num">#${String(spc.dex).padStart(3, '0')}</div>
      <div class="stage">${spImg(spc, mega, 'big')}</div>
      <h2>${mega ? 'Mega ' : ''}${spc.name}</h2>
      <div class="meta">${typeBadge(fam.type)} <span>${spc.legendary ? 'Legendary' : 'Stage ' + spc.stage}</span></div>
      <div class="appraise"><div class="ivhead">Base stats</div>
        ${[['Attack', st.a], ['Defense', st.d], ['Stamina', st.s]].map(([l, v]) => `<div class="iv"><span>${l}</span><span class="bar"><i style="width:${Math.min(100, v / 360 * 100)}%"></i></span><b>${Math.round(v)}</b></div>`).join('')}</div>
      <h3>Possible moves</h3><div class="moves">${pool.fast.concat(pool.charged).map(moveRow).join('')}</div>
      <p class="desc">${esc(spc.desc)}</p>
      ${S.shinyDex[spc.id] && !mega ? `<h3>Shiny form</h3><div class="stage">${spImg(spc, false, 'big', true)}</div>` : ''}
    </div>`);
    $('modalCard').querySelector('[data-close]').onclick = closeModal;
  }

  /* ---------- ceremonies ---------- */
  function sceneCanvas(draw, dur, onFinish) {
    const cv = $('sceneCanvas'), c = cv.getContext('2d');
    const anim = { stop: false };
    modalAnim = anim;
    let t0 = null, finished = false;
    function frame(ts) {
      if (anim.stop) return;
      if (t0 == null) t0 = ts;
      const t = (ts - t0) / 1000;
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height);
      draw(c, t, cv.width, cv.height);
      if (!finished && t > dur) { finished = true; onFinish && onFinish(); }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  function rays(c, t, W, H, color) {
    c.save(); c.translate(W / 2, H / 2); c.rotate(t * 0.4);
    for (let i = 0; i < 12; i++) {
      c.rotate(Math.PI / 6);
      c.fillStyle = color; c.globalAlpha = 0.15;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(W, -40); c.lineTo(W, 40); c.closePath(); c.fill();
    }
    c.restore(); c.globalAlpha = 1;
  }
  function evolutionScene(fromSp, fromMega, toSp, toMega, shiny, onDone) {
    const title = toMega ? 'Mega Evolution!' : 'Evolution';
    modal(`<div class="scene"><h2>${title}</h2><canvas id="sceneCanvas" width="320" height="320"></canvas>
      <p id="sceneText">What? ${fromSp.name} is ${toMega ? 'Mega Evolving' : 'evolving'}!</p><button class="btn hidden" id="sceneOk">Awesome!</button></div>`, { locked: true });
    const D = 3.2, col = toMega ? (FAMILIES[toSp.family].megaColor || '#fff') : '#ffffff';
    sceneCanvas((c, t, W, H) => {
      rays(c, t, W, H, col);
      if (t < D) {
        const showNew = t > 0.8 && Math.sin(t * t * 3.2) > 0;
        Sprites.drawTint(c, showNew ? toSp : fromSp, showNew ? toMega : fromMega, W / 2, H / 2, 240, '#ffffff', Math.min(1, t / 0.8), shiny);
      } else {
        const k = Math.min(1, (t - D) / 0.3);
        if (toMega) Sprites.aura(c, col, W / 2, H / 2, 200);
        Sprites.drawTint(c, toSp, toMega, W / 2, H / 2, 240 * (0.9 + 0.1 * k), '#ffffff', 1 - k, shiny);
      }
    }, D, () => {
      $('sceneText').textContent = `Congratulations! Your ${fromSp.name} ${toMega ? 'Mega Evolved into Mega ' + toSp.name : 'evolved into ' + toSp.name}!`;
      $('sceneOk').classList.remove('hidden');
      $('sceneOk').onclick = () => { closeModal(); onDone && onDone(); };
    });
  }
  function caughtCard(mon, r, onOk) {
    const spc = SPECIES_BY_ID[mon.speciesId];
    modal(`<div class="caught"><h2>Gotcha!</h2>${mon.shiny ? '<div class="shiny-banner">✦ Shiny! ✦</div>' : ''}${img(mon, 'big')}
      <h3>${esc(spc.name)} was caught!</h3><div class="meta">CP ${Game.cp(mon)} · Lv ${mon.level} · IV ${Game.ivPct(mon)}%</div>
      <ul class="rewards"><li>+${r.xp} XP</li><li>+${r.dust} Stardust</li><li>+${r.shards} ${Game.shardName(spc.family)}</li>
      ${r.energy ? `<li>+${r.energy} Mega Energy</li>` : ''}${r.isNew ? '<li class="new">New Blockdex entry!</li>' : ''}</ul>
      <button class="btn" id="okBtn">OK</button></div>`, { locked: true });
    $('okBtn').onclick = () => { closeModal(); refreshHUD(); onOk && onOk(); };
  }
  function hatchScene(mon, r) {
    const spc = SPECIES_BY_ID[mon.speciesId];
    modal(`<div class="scene"><h2>Oh?</h2><canvas id="sceneCanvas" width="320" height="320"></canvas>
      <p id="sceneText">Your egg is hatching…</p><button class="btn hidden" id="sceneOk">OK</button></div>`, { locked: true });
    const D = 2.6, ec = r.km === 2 ? '#7bd389' : r.km === 5 ? '#ffb703' : '#c77dff';
    sceneCanvas((c, t, W, H) => {
      if (t < D) {
        const wob = Math.sin(t * (6 + t * 8)) * 0.25 * Math.min(1, t);
        c.save(); c.translate(W / 2, H / 2 + 40); c.rotate(wob);
        c.fillStyle = ec; c.fillRect(-55, -120, 110, 130); c.fillStyle = '#ffffff'; c.fillRect(-55, -60, 110, 18);
        c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(25, -120, 30, 130);
        c.restore();
      } else {
        rays(c, t, W, H, ec);
        Sprites.draw(c, spc, false, W / 2, H / 2, 240, { shiny: mon.shiny });
      }
    }, D, () => {
      $('sceneText').innerHTML = `${mon.shiny ? '✦ Shiny! ' : ''}<b>${esc(spc.name)}</b> hatched! CP ${Game.cp(mon)} · IV ${Game.ivPct(mon)}%<br><small>+${r.dust} Stardust · +${r.shards} ${Game.shardName(spc.family)}</small>`;
      $('sceneOk').classList.remove('hidden');
      $('sceneOk').onclick = () => { closeModal(); refreshHUD(); };
    });
  }

  /* ---------- gym / raid lobby ---------- */
  let pickSel = [];
  function bestTeam(n) {
    return S.mons.filter(m => Game.curHp(m) > 0).sort((a, b) => Game.cp(b) - Game.cp(a)).slice(0, n).map(m => m.uid);
  }
  function showGym(tower, tile, handlers) {
    const g = Game.gymState(tower.key), team = TEAMS[g.team], mine = g.team === S.team;
    const raid = g.raid, rspc = raid && SPECIES_BY_ID[raid.speciesId];
    const left = raid ? Math.max(0, Math.ceil((raid.endsAt - Date.now()) / 60000)) : 0;
    const spinUntil = S.towers[tower.key] || 0;
    modal(`<div class="gym" style="--team:${team.color}">
      <button class="close" data-close>✕</button>
      <div class="gym-head"><span class="team-dot"></span><div><h2>Gym</h2><small>Controlled by <b>${team.name}</b>${mine ? ' (your team)' : ''}</small></div></div>
      ${raid ? `<div class="raid-box ${raid.mega ? 'mega' : ''}">
        <div class="raid-tier">${raid.mega ? 'MEGA RAID' : 'RAID ' + '★'.repeat(raid.tier)}</div>
        ${spImg(rspc, raid.mega, 'big')}
        <h3>${raid.mega ? 'Mega ' : ''}${rspc.name}</h3>
        <div class="meta">${typeBadge(typeOf(rspc))} <span>CP ${Game.raidBossCP(raid).toLocaleString()}</span> <span>${left} min left</span></div>
        <small>Rewards: XP, Stardust, ${canMega(rspc) || raid.mega ? '<b>Mega Energy</b>, ' : ''}Premier Blocks to catch ${rspc.name}</small>
        <button class="btn mega" data-act="raid" ${S.items.raidPass ? '' : 'disabled'}>Battle (uses 1 Raid Pass · have ${S.items.raidPass})</button>
      </div>` : '<p class="muted">No raid right now. Raids appear at gyms every so often.</p>'}
      ${!mine && g.defenders ? `<h3>Defenders</h3><div class="defs">${g.defenders.map(m => `<div>${img(m)}<small>CP ${Game.cp(m)}</small></div>`).join('')}</div>
        <button class="btn" data-act="gym">Battle the gym</button>` : mine ? '<p class="muted">Your team holds this gym. Rivals will take it back in time!</p>' : ''}
      <button class="btn ghost" data-act="spin" ${Date.now() < spinUntil ? 'disabled' : ''}>Spin gym disc${Date.now() < spinUntil ? ' (recharging)' : ''}</button>
    </div>`);
    const card = $('modalCard');
    card.querySelector('[data-close]').onclick = closeModal;
    card.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const a = b.dataset.act;
      if (a === 'spin') { World.spinGym(tower); showGym(tower, tile, handlers); }
      else if (a === 'gym') pickTeam(6, 'Choose your battle party', uids => handlers.gym(uids), () => showGym(tower, tile, handlers));
      else if (a === 'raid') pickTeam(6, 'Choose your raid party', uids => handlers.raid(uids), () => showGym(tower, tile, handlers));
    });
  }
  function pickTeam(n, title, onGo, onBack) {
    const healthy = S.mons.filter(m => Game.curHp(m) > 0);
    if (!healthy.length) { toast('All your Blockmon have fainted. Use Revives & Potions from your Bag!'); return; }
    pickSel = bestTeam(n);
    const draw = () => {
      const list = S.mons.slice().sort((a, b) => Game.cp(b) - Game.cp(a));
      modal(`<div class="picker"><button class="close" data-close>✕</button><h2>${title}</h2>
        <p class="muted">Tap to choose up to ${n}. Tip: pick types that are super effective against the opponent.</p>
        <div class="grid small">${list.map(m => {
          const i = pickSel.indexOf(m.uid), dead = Game.curHp(m) <= 0;
          return `<button class="card ${i >= 0 ? 'sel' : ''} ${dead ? 'fainted' : ''}" data-uid="${m.uid}" ${dead ? 'disabled' : ''}>
            ${i >= 0 ? `<span class="order">${i + 1}</span>` : ''}<div class="cp">CP <b>${Game.cp(m)}</b></div>${img(m)}${hpMini(m)}
            <div class="nm">${esc(Game.name(m))}</div><span class="type tiny" style="background:${TYPES[typeOf(SPECIES_BY_ID[m.speciesId])].color}">${TYPES[typeOf(SPECIES_BY_ID[m.speciesId])].name}</span></button>`;
        }).join('')}</div>
        <div class="row-btns"><button class="btn ghost" data-back>Back</button><button class="btn" data-go ${pickSel.length ? '' : 'disabled'}>Go! (${pickSel.length})</button></div></div>`);
      const card = $('modalCard');
      card.querySelector('[data-close]').onclick = closeModal;
      card.querySelector('[data-back]').onclick = onBack;
      card.querySelector('[data-go]').onclick = () => { closeModal(); onGo(pickSel.slice()); };
      card.querySelectorAll('[data-uid]').forEach(el => el.onclick = () => {
        const uid = +el.dataset.uid, i = pickSel.indexOf(uid);
        if (i >= 0) pickSel.splice(i, 1); else if (pickSel.length < n) pickSel.push(uid);
        const st = card.scrollTop; draw(); $('modalCard').scrollTop = st;
      });
    };
    draw();
  }
  function battleResult(title, lines, onOk) {
    modal(`<div class="caught"><h2>${title}</h2><ul class="rewards">${lines.map(l => `<li>${l}</li>`).join('')}</ul><button class="btn" id="okBtn">OK</button></div>`, { locked: true });
    $('okBtn').onclick = () => { closeModal(); refreshHUD(); onOk && onOk(); };
  }

  /* ---------- profile & onboarding ---------- */
  function showProfile() {
    const t = S.trainer;
    modal(`<div class="profile"><button class="close" data-close>✕</button>
      <h2>${esc(t.name)}</h2><div class="meta"><span class="type" style="background:${TEAMS[S.team].color}">${TEAMS[S.team].name}</span> <span>Level ${t.level}</span></div>
      <div class="hpline"><span class="bar"><i style="width:${t.xp / Game.xpToNext(t.level) * 100}%"></i></span><small>${t.xp.toLocaleString()} / ${Game.xpToNext(t.level).toLocaleString()} XP</small></div>
      <h3>How to play</h3>
      <ul class="howto">
        <li><b>Explore:</b> click/tap the map or use WASD / arrow keys. Walking hatches eggs.</li>
        <li><b>Catch:</b> tap a Blockmon inside your circle, then swipe the block up. Release when the coloured ring is small for Nice / Great / Excellent throws. Circle the block a few times before throwing for a <b>curveball</b> bonus. Berries make the next throw easier.</li>
        <li><b>Block Towers</b> (floating cubes) give blocks, berries, potions and eggs.</li>
        <li><b>Gyms</b> (tall towers): battle rival defenders, or join <b>raids</b> with a Raid Pass. Mega raids are the best source of <b>Mega Energy</b>.</li>
        <li><b>Battle:</b> tap = fast attack, Charged button when its bar is full, swipe sideways / Dodge when the enemy glows yellow.</li>
        <li><b>Grow:</b> use Stardust + Shards to power up, Shards to evolve, and Mega Energy to Mega Evolve your final-stage Blockmon.</li>
      </ul></div>`);
    $('modalCard').querySelector('[data-close]').onclick = closeModal;
  }
  function welcome(onStart) {
    const starters = ['flamlet', 'aquabit', 'sproutle'].map(id => SPECIES_BY_ID[id]);
    let pick = null, team = null;
    modal(`<div class="welcome">
      <div class="logo">MEGA<br><span>BLOCKMON</span></div>
      <p>Welcome, trainer! Explore the island, catch Blockmon with your capture blocks, battle at gyms and raids, and evolve your partners all the way to <b>Mega Evolution</b>.</p>
      <label class="name">Your name <input id="wName" maxlength="14" value="Trainer" autocomplete="off"></label>
      <h3>Pick a team</h3>
      <div class="teams">${TEAMS.map((t, i) => `<button class="team-btn" data-team="${i}" style="--team:${t.color}">${t.name}</button>`).join('')}</div>
      <h3>Choose your partner</h3>
      <div class="starters">${starters.map(s => `<button class="card" data-id="${s.id}">${spImg(s, false)}<div class="nm">${s.name}</div>${typeBadge(typeOf(s))}</button>`).join('')}</div>
      <button class="btn" id="wGo" disabled>Start adventure</button></div>`, { locked: true, cls: 'wide' });
    const card = $('modalCard');
    const upd = () => { $('wGo').disabled = !pick || team == null; };
    card.querySelectorAll('[data-id]').forEach(el => el.onclick = () => {
      pick = el.dataset.id; card.querySelectorAll('[data-id]').forEach(x => x.classList.toggle('sel', x === el)); upd();
    });
    card.querySelectorAll('[data-team]').forEach(el => el.onclick = () => {
      team = +el.dataset.team; card.querySelectorAll('[data-team]').forEach(x => x.classList.toggle('sel', x === el)); upd();
    });
    $('wGo').onclick = () => {
      Game.start($('wName').value.trim().slice(0, 14) || 'Trainer', pick, team);
      closeModal(); refreshHUD(); onStart && onStart();
      toast(`Welcome, ${esc(S.trainer.name)}! Your ${SPECIES_BY_ID[pick].name} is ready. A 2 km egg is incubating.`, 'good');
    };
  }

  function init() {
    document.querySelectorAll('#nav button').forEach(b => b.onclick = () => panel === b.dataset.panel ? closePanel() : openPanel(b.dataset.panel));
    $('panelClose').onclick = closePanel;
    $('trainerBtn').onclick = showProfile;
    $('hudEgg').onclick = () => openPanel('eggs');
    $('modal').addEventListener('click', e => { if (e.target === $('modal') && !modalLocked) closeModal(); });
    window.addEventListener('keydown', e => { if (e.key === 'Escape') { if (modalOpen && !modalLocked) closeModal(); else if (panel) closePanel(); } });
    $('hudBlockIco').innerHTML = cubeSVG(BLOCKS.basic.colors, 18);
    Game.hooks = { levelUp, hud: refreshHUD, hatch: (m, r) => setTimeout(() => hatchScene(m, r), 300) };
    refreshHUD();
  }

  return {
    init, refreshHUD, toast, spinToast, levelUp, cubeSVG, caughtCard, showMon, showGym, battleResult, welcome,
    closeModal, renderPanel, isBlocking: () => modalOpen || !!panel,
  };
})();
