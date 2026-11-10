# Mega Blockmon

A browser monster-catching game inspired by Pokémon GO's mechanics, without GPS. You explore a procedurally generated island on foot, catch Blockmon with capture blocks, battle at gyms and raids, hatch eggs, and evolve your partners all the way to **Mega Evolution**.

All monsters, names and art are original. Every Blockmon is drawn at 512 px as shaded vector art from a per-family "look" (ears, tail, markings, face), so each evolution is a bigger, more detailed version of the previous stage. Mega forms gain armour, glowing markings and an aura. Creatures idle, blink and hop on the map, and the catch screen uses real throw physics.

The legendary **Mindrax** (Psychic) appears only in ★★★★★ raids and, from trainer level 12, as **Mega Mindrax** in Mega Raids.

## How to play

| | |
|---|---|
| **Explore** | Click/tap the map, or use WASD / arrow keys. Biomes (meadow, forest, beach, shallows, highlands, snow) spawn different types. |
| **Catch** | Tap a Blockmon inside your circle, then swipe the block upward. Hitting inside the shrinking coloured ring gives a **Nice / Great / Excellent** bonus, and a smaller ring means a bigger bonus. Circle the block before throwing for a **curveball**. **Razz / Golden Berries** boost the next throw. Ring colour shows difficulty. Blockmon can break free and flee. |
| **Block Towers** | Floating cubes. Spin them for Blocks, Super/Ultra Blocks, berries, potions, revives, Raid Passes and eggs (90 s cooldown). |
| **Gyms** | Tall towers in team colours. Beat 3 rival defenders to claim the gym for your team. Gyms can also be spun. |
| **Raids** | Gyms periodically host raid bosses (★, ★★★, **Mega**, ★★★★★). Use a Raid Pass, beat the boss before the timer runs out, then catch it with Premier Blocks. **Mega raids are the main source of Mega Energy.** |
| **Battle** | Tap = fast move (builds energy). When a charged-move bar fills, press the button. When the enemy glows yellow it's charging a big attack, so swipe sideways (or hit Dodge) to take 75% less damage. Damage persists after battle; heal with Potions/Revives. |
| **Eggs** | 2 / 5 / 10 km eggs hatch as you walk (1 tile = 5 m). Hatched Blockmon have high IVs. |
| **Grow** | Stardust + Shards → **Power Up**. Shards → **Evolve**. Mega Energy → **Mega Evolve** a final-stage Blockmon (+30% stats, and a +10% team attack boost in battle). |

### Mechanics modelled on Pokémon GO
- **CP** from base stats × IVs (0–15 Attack/Defense/Stamina) × CP multiplier per level; level capped at trainer level + 2. Appraisal shows IV %.
- **Catch odds:** `1 − (1 − baseRate)^(block × throw × curveball × berry)`, with up to 3 wobbles.
- **Damage:** `floor(0.5 × Power × Atk/Def × STAB(1.2) × Effectiveness) + 1`, with GO's 1.6 / 0.625 / 0.39 type multipliers.
- Fast moves have power, energy gain and duration. Charged moves cost 1, 2 or 3 bars of energy. Taking damage also builds energy.
- Shinies (1/64 wild, 1/20 from raids), Blockdex with Mega and shiny tracking, eggs and incubators, trainer levels with level-up rewards.

## Run locally

No dependencies or build step. Just serve the folder:

```bash
npm run dev            # python3 -m http.server 5180 → http://localhost:5180
```

Progress is saved in `localStorage`. The Bag has a reset button.

## Tests

```bash
npm test               # rules: CP, catch odds, evolution/mega, eggs, damage, raid balance, sprite DNA
npm run playtest       # headless Chrome plays the real game end to end
SHOTS=out/ npm run playtest      # also save a screenshot of each key screen
MOBILE=1 npm run playtest        # same, at phone size (390×844)
```

The playtest catches a wild Blockmon with a real throw, spins a tower, beats a gym, wins a Mega Raid and catches the boss with Premier Blocks, then evolves Flamlet → Flamboar → Infernox → Mega Infernox. It fails on any page exception. It needs `google-chrome` (override with `CHROME=/path/to/chrome`).

## Deploy to GitHub Pages

This uses the same setup as `transport-sim-game`: `.github/workflows/deploy.yml` runs the unit tests and the headless playtest on every push to `main`, and deploys only if both pass. `npm run build` copies `index.html`, `css/` and `js/` into `_site/`, which is what gets published. All asset URLs are relative, so the game works under `https://<user>.github.io/<repo>/` with no base-path config.

One-time setup:
1. Create the GitHub repo and push this folder to `main`.
2. In the repo go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Push (or run the workflow manually from the Actions tab). The playtest screenshot is attached to each run as an artifact.

## Project layout

```
index.html          page shell + HUD / overlays
css/style.css       all styling (mobile-first, safe-area aware)
js/data.js          species, families, types, type chart, moves, items
js/sprites.js       high-res creature renderer, animation helpers, capture-block renderer
js/state.js         save data and game rules (catching, evolution, mega, eggs, gyms, raids, damage)
js/world.js         island generation, movement, spawns, Block Towers, gyms
js/encounter.js     catch screen (throw physics, ring timing, curveballs, berries)
js/battle.js        real-time gym/raid battles
js/ui.js            panels, detail sheets, gym lobby, evolution/hatch ceremonies
js/main.js          boot + main loop + gym/raid flow
tests/              node:test unit tests (no deps)
scripts/            headless playtest, build
```
