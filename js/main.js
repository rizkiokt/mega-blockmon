'use strict';
(function () {
  Game.load();
  UI.init();

  function onEncounter(s, tile) {
    Encounter.start(s, tile, (result, mon, spc) => {
      World.endEncounter(s, result);
      UI.refreshHUD();
      if (result === 'fled') UI.toast(`${spc.name} fled…`);
    });
  }

  function onGym(tower, tile) {
    const handlers = {
      gym(uids) {
        const g = Game.gymState(tower.key);
        if (!g.defenders) return;
        Battle.start({
          kind: 'gym', title: 'Gym Battle', tile, gymTeam: g.team, timeLimit: 100,
          team: uids.map(u => Game.get(u)).filter(Boolean),
          enemies: g.defenders.map(m => Game.fighter(m)),
          onEnd(r) {
            if (r.won) {
              const rw = Game.winGym(tower.key);
              UI.battleResult('Gym defeated!', [`+${rw.xp} XP`, `+${rw.dust} Stardust`, `+${rw.basic} Blocks`, `+${rw.potion} Potions`, `${TEAMS[S.team].name} now holds this gym!`]);
            } else {
              UI.battleResult(r.timeout ? "Time's up!" : 'Defeated', [`You dealt ${r.stats.dealt} damage.`, 'Heal your team with Potions & Revives (open a Blockmon from the Blockmon list).', 'Tip: use types that are super effective against the defenders.']);
            }
          },
        });
      },
      raid(uids) {
        const g = Game.gymState(tower.key), raid = g.raid;
        if (!raid || !S.items.raidPass) return;
        S.items.raidPass--;
        const info = Game.raidInfo(raid);
        const boss = { uid: -1, speciesId: raid.speciesId, level: 20, iv: { a: 15, d: 15, s: 15 }, mega: raid.mega, shiny: false, fast: raid.fast, charged: raid.charged, hpCur: null };
        const spc = SPECIES_BY_ID[raid.speciesId];
        Battle.start({
          kind: 'raid', title: (raid.mega ? 'Mega ' : '') + 'Raid', tile, timeLimit: info.time, bossCP: Game.raidBossCP(raid),
          team: uids.map(u => Game.get(u)).filter(Boolean),
          enemies: [Game.fighter(boss, { cpm: info.cpm, hp: info.hp })],
          onEnd(r) {
            if (!r.won) {
              UI.battleResult(r.timeout ? "Time's up!" : 'Raid failed', [`You dealt ${r.stats.dealt} / ${info.hp} damage.`, 'Power up your Blockmon, pick super-effective types, and dodge charged attacks!']);
              return;
            }
            const rw = Game.winRaid(tower.key, raid);
            UI.battleResult('Raid boss defeated!', [
              `+${rw.xp} XP`, `+${rw.dust} Stardust`, `+${rw.shards} ${Game.shardName(spc.family)}`,
              rw.energy ? `<b>+${rw.energy} ${FAMILY_BASE[spc.family].name} Mega Energy</b>` : '',
              rw.golden ? '+1 Golden Berry' : '', `${rw.premier} Premier Blocks to catch ${spc.name}!`,
            ].filter(Boolean), () => {
              Encounter.start({ speciesId: spc.id, level: 20, shiny: Math.random() < 1 / 20 }, tile, (res) => {
                UI.refreshHUD();
                if (res !== 'caught') UI.toast(`${spc.name} got away…`);
              }, { mode: 'raid' });
            });
          },
        });
      },
    };
    UI.showGym(tower, tile, handlers);
  }

  World.init(document.getElementById('world'), { onEncounter, onGym });
  Encounter.init(document.getElementById('encCanvas'));
  Battle.init(document.getElementById('battleCanvas'));
  if (!S.started) UI.welcome();

  let last = performance.now(), saveT = 0, biomeT = 0;
  function loop(ts) {
    const dt = Math.min(0.05, Math.max(0, (ts - last) / 1000));
    last = ts;
    if (Battle.isActive()) { Battle.update(dt); Battle.render(); }
    else if (Encounter.isActive()) { Encounter.update(dt); Encounter.render(); }
    else {
      if (!UI.isBlocking() && S.started) World.update(dt);
      World.render();
      if ((biomeT += dt) > 0.5) { biomeT = 0; document.getElementById('biomeTag').textContent = World.biomeName(); UI.refreshHUD(); }
    }
    if ((saveT += dt) > 5) { saveT = 0; World.savePos(); Game.save(); }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  const persist = () => { World.savePos(); Game.save(); };
  window.addEventListener('beforeunload', persist);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });

  // automation hooks for the headless playtest (scripts/playtest.mjs)
  window.__mb = { Game, World, Encounter, Battle, UI, state: () => S };
})();
