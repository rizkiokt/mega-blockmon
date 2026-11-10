/**
 * Headless end-to-end playtest.
 *
 * Boots the real game in headless Chrome and plays through the core loop the
 * way a player would: pick a starter, catch a wild Blockmon with a real throw,
 * spin a Block Tower, beat a gym, win a raid and catch the boss with Premier
 * Blocks, then evolve and Mega Evolve. It asserts each step and fails on any
 * uncaught page exception.
 *
 * Catch odds are forced to 100% for the throws (the throw itself still runs
 * through the real physics/hit-test), and the battle party is boosted, so the
 * test checks that the flow works rather than how lucky the dice are.
 *
 * Usage: node scripts/playtest.mjs [url] [screenshot]
 *   With no URL, a static server for the repo root is started automatically.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let url = process.argv[2];
const shotPath = process.argv[3] ?? 'playtest.png';
const PORT = 9335;
let server;

if (!url) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
  server = createServer(async (req, res) => {
    try {
      let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
      if (!p || p.endsWith('/')) p += 'index.html';
      const body = await readFile(join(ROOT, p));
      res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/`;
}

const chrome = spawn(process.env.CHROME ?? 'google-chrome', [
  '--headless=new', '--no-sandbox', '--hide-scrollbars', '--window-size=1024,768',
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling',
  `--remote-debugging-port=${PORT}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] });

let ws, nextId = 1;
const pending = new Map(), errors = [];
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(`evaluate failed: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`);
  return res.result.value;
}
async function waitFor(label, expr, timeoutMs = 45000, tick) {
  const start = Date.now();
  for (;;) {
    if (tick) await evaluate(tick);
    const v = await evaluate(expr);
    if (v) return v;
    if (errors.length) throw new Error(`page exception while waiting for ${label}:\n  ${errors.join('\n  ')}`);
    if (Date.now() - start > timeoutMs) throw new Error(`TIMEOUT waiting for: ${label}\n  debug: ` + await evaluate(`JSON.stringify({ enc: __mb.Encounter.isActive(), phase: __mb.Encounter._phase(), battle: __mb.Battle.isActive(), mons: __mb.state().mons.length, premier: __mb.state().blocks.premier, modal: document.querySelector('#modal').className + ' ' + document.querySelector('#modalCard').innerText.slice(0, 200) })`));
    await sleep(150);
  }
}
const step = msg => console.log('✓ ' + msg);
// a real mouse swipe (trusted pointer events), like a player flicking the block
async function swipe(x, y, dx, dy, ms, steps = 6) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= steps; i++) {
    await sleep(ms / steps);
    const k = i / steps;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + dx * k, y: y + dy * k, button: 'left', buttons: 1 });
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', buttons: 1, clickCount: 1 });
}
// SHOTS=<dir> saves a screenshot of each key screen (handy for README/review)
async function shot(name) {
  if (!process.env.SHOTS) return;
  await sleep(450);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(process.env.SHOTS, name + '.png'), Buffer.from(s.data, 'base64'));
}

async function main() {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find(t => t.type === 'page');
    } catch { /* chrome still starting */ }
    if (!target) await sleep(200);
  }
  if (!target) throw new Error('could not connect to headless Chrome');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id).resolve(msg.result ?? {}); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  };
  await send('Runtime.enable');
  await send('Page.enable');
  if (process.env.MOBILE) await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url });
  await waitFor('game boot', 'typeof window.__mb === "object" && !!document.querySelector("#wGo")');
  step('game booted and shows the welcome screen');
  await shot('01-welcome');

  // --- onboarding
  await evaluate(`document.querySelector('[data-team="1"]').click(); document.querySelector('[data-id="flamlet"]').click(); document.querySelector('#wGo').click(); true`);
  await waitFor('starter', '__mb.state().started && __mb.state().mons.length === 1');
  step('picked a team and starter (Flamlet)');

  // --- walking moves the trainer and counts distance
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' })); true`);
  await sleep(700);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd' })); true`);
  await waitFor('walked', '__mb.state().trainer.km > 0');
  step('walked with the keyboard (km counter advanced)');

  // --- real swipes at slow, medium and fast speeds must all reach the Blockmon,
  //     a swipe aimed far to the side must miss, and a hit must catch it
  await evaluate('__mb.Game.catchChance = () => 0; __mb.state().blocks.basic = 50; window.__flee = SPECIES.map(s => s.flee); for (const s of SPECIES) s.flee = 0; true'); // break-outs keep the encounter going
  await waitFor('a spawn', '__mb.World._debug().spawns.length > 0');
  await evaluate(`(() => { const s = __mb.World._debug().spawns[0]; __mb.World.interact({ kind: 'spawn', obj: s }); return true; })()`);
  await waitFor('encounter', '__mb.Encounter.isActive()');
  const results = {};
  for (const [label, dx, dy, ms] of [['slow', 0, -260, 320], ['medium', 0, -240, 110], ['fast', 20, -300, 60], ['wide', -420, -200, 110]]) {
    await waitFor('block ready', '__mb.Encounter._phase() === "ready"', 20000);
    await evaluate('__mb.Encounter._calm(); true');
    const b = await evaluate('__mb.Encounter._blockScreen()');
    await swipe(b.x, b.y, dx, dy, ms);
    await waitFor(`${label} throw resolves`, '__mb.Encounter._lastThrow() && __mb.Encounter._lastThrow().result !== "flying"', 10000);
    results[label] = await evaluate('__mb.Encounter._lastThrow()');
    if (label === 'medium') await shot('02-encounter');
  }
  for (const k of ['slow', 'medium', 'fast']) if (results[k].result !== 'hit') throw new Error(`${k} swipe should hit, got ${JSON.stringify(results[k])}`);
  if (results.wide.result === 'hit') throw new Error('a swipe aimed off to the side should miss');
  step(`real swipes reach the Blockmon at ${['slow', 'medium', 'fast'].map(k => results[k].speed + ' px/s').join(', ')}; a wide swipe misses`);

  await evaluate('__mb.Game.catchChance = () => 1; SPECIES.forEach((s, i) => { s.flee = __flee[i]; }); true');
  await waitFor('block ready', '__mb.Encounter._phase() === "ready"', 20000);
  await evaluate('__mb.Encounter._calm(); true');
  const b2 = await evaluate('__mb.Encounter._blockScreen()');
  await swipe(b2.x, b2.y, 10, -250, 140);
  await waitFor('caught card', '!!document.querySelector("#okBtn")', 20000);
  await shot('02b-caught');
  await evaluate(`document.querySelector('#okBtn').click(); true`);
  await waitFor('back on map', '!__mb.Encounter.isActive() && __mb.state().mons.length === 2');
  step('caught a wild Blockmon with a real swipe; rewards granted');

  // --- spin a Block Tower
  const before = await evaluate('__mb.Game.totalBlocks()');
  await evaluate(`(() => { const t = __mb.World._debug().towers.find(t => !t.gym); __mb.World.interact({ kind: 'tower', obj: t }); return true; })()`);
  const after = await evaluate('__mb.Game.totalBlocks()');
  if (!(after > before)) throw new Error('tower spin gave no blocks');
  step(`spun a Block Tower (${before} → ${after} blocks)`);

  // --- boost the party so the battle outcome is deterministic
  await evaluate(`(() => { const S = __mb.state(); for (const m of S.mons) { m.level = 40; m.iv = { a: 15, d: 15, s: 15 }; m.hpCur = null; } S.trainer.level = 40; return true; })()`);

  // --- gym battle
  await evaluate(`(() => {
    const S = __mb.state(), d = __mb.World._debug();
    const gym = d.towers.find(t => t.gym);
    window.__gym = gym;
    const g = __mb.Game.gymState(gym.key);
    if (g.team === S.team) { g.team = (S.team + 1) % 3; g.ownedUntil = 0; }
    g.defenders = ['pebbit', 'aquabit', 'zappix'].map(id => __mb.Game.createMon(id, 15, { shiny: false }));
    g.raid = null; g.nextRaidCheck = Date.now() + 1e9;
    __mb.World.interact({ kind: 'tower', obj: gym });
    return true; })()`);
  await waitFor('gym lobby', '!!document.querySelector(\'[data-act="gym"]\')');
  await shot('03-gym-lobby');
  await evaluate(`document.querySelector('[data-act="gym"]').click(); true`);
  await waitFor('party picker', '!!document.querySelector("[data-go]")');
  await evaluate(`document.querySelector('[data-go]').click(); true`);
  await waitFor('battle', '__mb.Battle.isActive()');
  await sleep(2200); await evaluate('__mb.Battle._fast(); true'); await shot('04-gym-battle');
  await waitFor('gym won', '!__mb.Battle.isActive() && !!document.querySelector("#okBtn")', 90000, '__mb.Battle._charged(); __mb.Battle._fast(); true');
  const gymText = await evaluate('document.querySelector("#modalCard h2").textContent');
  if (gymText !== 'Gym defeated!') throw new Error('expected gym victory, got: ' + gymText + ' | ' + await evaluate('document.querySelector("#modalCard").innerText') + ' | ' + await evaluate('JSON.stringify(__mb.state().mons.map(m => [m.speciesId, m.level, m.hpCur, __mb.Game.maxHp(m)]))') + ' | defenders ' + await evaluate('JSON.stringify(__mb.Game.gymState(__gym.key).defenders.map(m => [m.speciesId, m.level]))'));
  await evaluate(`document.querySelector('#okBtn').click(); true`);
  if (!(await evaluate('__mb.Game.gymState(__gym.key).team === __mb.state().team'))) throw new Error('gym did not change team');
  step('beat a gym; it now belongs to the player\'s team');

  // --- mega raid, then catch the boss with Premier Blocks
  await evaluate(`(() => {
    const g = __mb.Game.gymState(__gym.key);
    g.raid = { tier: 'mega', speciesId: 'infernox', mega: true, endsAt: Date.now() + 600000, fast: 'ember', charged: 'inferno' };
    __mb.state().items.raidPass = 1;
    // a player would heal up and bring super-effective counters (water beats fire)
    for (const m of __mb.state().mons) m.hpCur = null;
    for (let i = 0; i < 4; i++) { const m = __mb.Game.createMon('leviablock', 40, { shiny: false }); m.iv = { a: 15, d: 15, s: 15 }; m.fast = 'water_gun'; m.charged = 'aqua_jet'; __mb.Game.addMon(m); }
    __mb.World.interact({ kind: 'tower', obj: __gym });
    return true; })()`);
  await waitFor('raid lobby', '!!document.querySelector(\'[data-act="raid"]\')');
  await evaluate(`document.querySelector('[data-act="raid"]').click(); true`);
  await waitFor('raid picker', '!!document.querySelector("[data-go]")');
  await evaluate(`document.querySelector('[data-go]').click(); true`);
  await waitFor('raid battle', '__mb.Battle.isActive()');
  await sleep(2200); await evaluate('__mb.Battle._fast(); true'); await shot('05-raid-battle');
  const energyBefore = await evaluate('__mb.state().energy.ember || 0');
  await waitFor('raid won', '!__mb.Battle.isActive() && !!document.querySelector("#okBtn")', 260000, '__mb.Battle._charged(); __mb.Battle._fast(); true');
  const raidText = await evaluate('document.querySelector("#modalCard h2").textContent');
  if (raidText !== 'Raid boss defeated!') throw new Error('expected raid victory, got: ' + raidText);
  const energyAfter = await evaluate('__mb.state().energy.ember || 0');
  if (!(energyAfter > energyBefore)) throw new Error('mega raid gave no Mega Energy');
  await evaluate(`document.querySelector('#okBtn').click(); true`);
  await waitFor('raid catch encounter', '__mb.Encounter.isActive()');
  const premier = await evaluate('__mb.state().blocks.premier');
  if (!(premier > 0)) throw new Error('no premier blocks for raid catch');
  const monsBefore = await evaluate('__mb.state().mons.length');
  await waitFor('raid boss caught', '!!document.querySelector("#okBtn")', 45000, '__mb.Encounter._autoThrow(); true');
  await evaluate(`document.querySelector('#okBtn').click(); true`);
  await waitFor('raid catch done', `!__mb.Encounter.isActive() && __mb.state().mons.length === ${monsBefore + 1}`);
  if (await evaluate('__mb.state().blocks.premier') !== 0) throw new Error('leftover premier blocks should be cleared');
  step(`won a Mega Raid (+${energyAfter - energyBefore} Mega Energy) and caught Infernox with Premier Blocks`);

  // --- evolve the starter, then Mega Evolve it
  await evaluate(`(() => { const S = __mb.state(); S.shards.ember = 500; S.energy.ember = 500; S.trainer.dust = 1e6;
    const m = S.mons.find(m => m.speciesId === 'flamlet'); window.__uid = m.uid; __mb.UI.showMon(m.uid); return true; })()`);
  for (const expect of ['flamboar', 'infernox']) {
    await waitFor('evolve button', '!!document.querySelector(\'[data-act="evolve"]:not([disabled])\')');
    await evaluate(`document.querySelector('[data-act="evolve"]').click(); true`);
    await waitFor('evolution done', '!!document.querySelector("#sceneOk:not(.hidden)")');
    await evaluate(`document.querySelector('#sceneOk').click(); true`);
    const sp = await evaluate('__mb.Game.get(__uid).speciesId');
    if (sp !== expect) throw new Error(`expected ${expect}, got ${sp}`);
  }
  await waitFor('mega button', '!!document.querySelector(\'[data-act="mega"]:not([disabled])\')');
  await evaluate(`document.querySelector('[data-act="mega"]').click(); true`);
  await waitFor('mega evolution done', '!!document.querySelector("#sceneOk:not(.hidden)")');
  await sleep(300);
  await evaluate(`document.querySelector('#sceneOk').click(); true`);
  if (!(await evaluate('__mb.Game.get(__uid).mega === true'))) throw new Error('mega evolution did not apply');
  await evaluate('__mb.UI.showMon(__uid); true'); await shot('06-mega-detail'); await evaluate('__mb.UI.closeModal(); true');
  step('evolved Flamlet → Flamboar → Infernox, then Mega Evolved it');

  // --- panels render and the save persists
  for (const p of ['collection', 'dex', 'eggs', 'bag']) {
    await evaluate(`document.querySelector('#nav [data-panel="${p}"]').click(); true`);
    await waitFor(`${p} panel`, `document.querySelector('#panelBody').children.length > 0`);
    await shot('07-panel-' + p);
  }
  await evaluate(`document.querySelector('#nav [data-panel="collection"]').click(); true`);
  await evaluate(`__mb.UI.closeModal(); __mb.Game.save(); true`);
  const saved = await evaluate(`JSON.parse(localStorage.getItem('megaBlockmon.save.v2')).mons.length`);
  if (saved < 7) throw new Error('save did not persist');
  step('all panels render; progress saved to localStorage');

  await evaluate(`document.querySelector('#panelClose').click(); true`);
  await sleep(500);
  const finalShot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(shotPath, Buffer.from(finalShot.data, 'base64'));
  if (errors.length) throw new Error('page exceptions:\n  ' + errors.join('\n  '));
  console.log(`\nPLAYTEST PASSED — screenshot: ${shotPath}`);
}

try {
  await main();
} catch (e) {
  console.error('\nPLAYTEST FAILED\n' + (e.stack ?? e));
  process.exitCode = 1;
} finally {
  ws?.close();
  chrome.kill();
  server?.close();
}
