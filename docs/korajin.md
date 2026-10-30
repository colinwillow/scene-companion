# KORAJIN in Scene Companion: reverse-engineering, then building forward

KORAJIN (Grumbo, the Red Hollows, the restoration) lives inside `colinwillow/zap` today: one 73k-line `index.html`,
432 MB of models. KORAJIN.md says it will move into its own repo "the way zap was copied out of weirdport". The goal
here is that Colin can **open KORAJIN in Scene Companion** (look at it, arrange it, tune it), and that everything new he
builds is made in a shape both can read. **The day it moves out of zap, it moves onto the Scene Companion runtime.**

Surveyed Oct 29 2026 at zap `460300f` (line numbers will drift; grep the symbol). This is the plan; ROADMAP.md
Stage 11 has the items. The handoff the KORAJIN sessions follow lives in zap: `zap/SCENE_COMPANION.md`.

## What exists (the short version)

| side | today in zap | how close to Scene Companion |
|---|---|---|
| **Characters** | Grumbo `alien_goblin_game.glb` (137 joints: Mixamo + 82 hair/cape spring bones, 123 clips) + forged bake. Enemies are kind tables in `ARENA.kinds`: SAMURAI, ARCHER, OSARI_BOW (each with `clips{}`, `h`, `walkRef`/`runRef`). Beasts `ARENA.beast` (3-headed dog, blue dragon, mech dragon). Bosses `GUARD` / `OLMEC` (clips from `forged/`). `SPIDER` (procedural legs). The toad NPC `TOADK` | **Close.** The kind tables ARE character.json in all but name. `agoblin.character.json` already exists here (goblin extraction). |
| **Animation** | One global `CLIPS` role table for every hero (same clip names on every pipeline GLB) plus role names in ~12 feature tables (KATANA, NINJA, VAULT, WRUN, BOW, KSET…). Upper/lower split by clip-name suffix (`__up`, `__legs`). The Forge bakes clips per role into `models/characters/forged/<stem>.glb` | Roles match `runtime/character.js` ROLES for the basics; the feature roles need names added (attack sets, guard, bow, ride). Forged GLBs load as-is. |
| **Places** | All procedural code. The Dojo (`DOJO`, `dojoBuild`, `floatIsland`, `islandDress`), ~40 forge buildings in `BLDG.list` (each a param table with `at` + a builder), the Courtyard (`courtBuild`), the Red Hollows (`buildHome`: heightfield terrain `HOLLOW`, places `GHOME` `GMERCH` `GMILL` `GPEAK` `GJINRA` `GCASTLE`, seeded scatters), the ship (`shipMake`), sandbox zones (`WPARK` `PROVE` `ROPEB` `SNOWZ` `DRAGZ` `SHIPZ`) | **Far for the insides, close for the layout.** Each place's position and parameters are data; what's inside is hundreds of inline primitives. Collision is generated from code (`BOXES`, `TRI`). |
| **Levels as data** | `LVG1` (level grid: path, branches, posts, beats), `BEACON.plan` + `CHUNKS` (a level made from chunk names), `COURSE.blocks` | **Already data.** These export straight to scene entities. |
| **Systems** | Player: one priority chain in `stepPlayer` on a global `player` (parkour, katana stack + guard/parry/deflect, bow, rocket, dragon riding). Per-entity: enemy brains on `d.K` (`archerAI`, `foeAI`, `beastStep`), `SPIDER`, `GUARD`, `RESTORE` rigs, coins, Jinra wisps, bars/zips/rings. No event bus | Player systems are global, so port them as behaviors one at a time (the goblin extraction already did wall run, ledge, vault, katana, Dynamics, high bar, duel). The per-entity ones map cleanly to behaviors with params. |
| **Story** | Design only (the uncle, Betsy, artifacts). Zap's QUEST/TALK are not KORAJIN's | Start it in Scene Companion: Reactions + variables + a Quest behavior, no zap port needed. |

## The plan

### Phase 1: Open KORAJIN's characters and assets (no zap changes)
- The dev server serves the local zap checkout at `/zap/` (as it already does `/forge/`), so the editor reads KORAJIN's
  GLBs in place: 432 MB is never copied. To ship (Pages / Publish), the used files get copied in.
- A `korajin` pack: `character.json` for Grumbo (from `agoblin`), the samurai, archer, Osari bowman, toad,
  stone guardian, Olmec, 3-headed dog, blue dragon, mech dragon (role tables lifted from `ARENA.kinds` / `ARENA.beast` /
  `GUARD` / `OLMEC` / `TOADK`; forged clips through `clips:`), plus prefabs with the behaviors that exist
  (`Duelist`, `Melee`, `Chase`, `Health`, `Dynamics` for hair/cape, `Mount` + `HandGrip` for the katana).
- A KORAJIN sandbox scene: Grumbo, a samurai, a bowman, the dog, the toad, a few kit blocks. **First thing Colin can open.**

### Phase 2: Import what is already data
- `tools/korajin-import.mjs`: reads `LVG1`, `BEACON.plan`/`CHUNKS`, `COURSE.blocks` **out of zap's shipped
  `index.html`** (lifted, never retyped: zap's own rule) and writes scenes made of kit prefabs (blocks, ledges, bars,
  zips, posts as enemy spawns, beats as Triggers/Reactions).
- The Red Hollows' and the Dojo's **layout**: one entity per place (`GHOME`, `GMERCH`, `GMILL`… at its `at`/`yaw`), each
  a placeholder until its building is baked (phase 3).

### Phase 3: Bake procedural places into assets
- A headless bake in zap (`tools/bake-place.mjs`, Playwright on the real page, like its other tools): run a builder
  (`BLDG.list` entries, `ghomeBuild`, `dojoBuild` islands…), export the meshes as a draco GLB + its `BOXES`/`TRI` as a
  collision GLB, with the FALLEN and RESTORED poses of each `RESTORE` piece as node names + a pose table.
- Those land as Library props in the `korajin` pack: the hero kit buildings, the enemy kit (black and gold), islands.
  Colin can then **lay out new places in the editor** from his own buildings.
- The terrain (`HOLLOW` heightfield) bakes to a mesh + walk triangles the same way.

### Phase 4: Systems as behaviors (in the order he plays them)
Already behaviors (goblin extraction): WallRun, Ledge, Vault, Bar/HighBar, Melee (combo, lock-on, air slam), Duelist
(guard, KO), Dynamics (hair, cape, chains), Mount, HandGrip, Zoom. Next:
1. `Guard` + `Parry` + `Deflect` (BLOCK.perfect, DEFL: arrows bounced back)
2. `Bow` (BOW, BARC: charge, arc line, loose) and `Launcher` (ROCKET)
3. Enemy brains: `Archer` (ARCH), `Horde` (HORDE through Spawner), `Beast` (ARENA.beast: rest/charge/fire), `Spider`
   (procedural legs), `Guardian` boss (GUARD / OLMEC); limbs and halving (LIMB, HALVE) on Melee
4. `Jinra`: a seep / burst / homing-wisp emitter on kills and breaks + a counter variable; `Coin` (Pickup + doubloon);
   `Shop` (MSHOP: wares, prices from coins)
5. `Restore`: two poses per piece (fallen pose table, restored = authored), a staggered lift, jets, a trigger plate.
   The editor gets a FALLEN / RESTORED switch to look at both
6. `Ride` (DRAGZ: tame with an orb, ride ground + air, fireballs, gun while riding)
7. Story: Quest + Talk on Reactions (the uncle, the merchant, Betsy). New in Scene Companion; zap has none for KORAJIN.

Each one: a behavior with the zap tuning object as its schema defaults, a test, a spot in the KORAJIN sandbox scene.

### Phase 5: The move
When KORAJIN leaves zap (KORAJIN.md: "a copy, the way zap was copied out of weirdport"), the new repo is a Scene
Companion game: `scenes/`, `prefabs/`, `behaviors/`, the `korajin` pack, a game page like `play.html` with Colin's
pads. Whatever is not ported yet keeps running from zap until it is.

## Honest scale

Phases 1–2 are days. Phase 3 is a week or two (the bake tool is the work; then it runs per building). Phase 4 is
the long one: the player's systems live on one global `player` and each is a careful port (the goblin's took a few
build loops). It does not have to be finished before he gets value: from phase 1 he can open his characters, from
phase 3 he can lay out places from his own buildings.

What makes it work long term is the handoff (`zap/SCENE_COMPANION.md`): if every new character, place and system is
built data-first from now on, the export is mechanical and the gap stops growing.
