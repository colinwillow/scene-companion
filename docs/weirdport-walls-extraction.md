# weirdport breakable walls: extraction map (step 1)

Where the breakable building kit lives in `colinwillow/weirdport` and what it becomes in Scene Companion.
Line numbers are `weirdport/index.html` at commit **bff4711** (m890, a 51,038-line file). If they have moved, grep for the symbol.
His own spec for the export is `models/building_kit/BUILDING_KIT_NOTES.md` ("Breakable walls", "moving parts", "Static collision").

**The data is already here.** `assets/models/colin/buildings/building_kit_test_visual.glb` (the kitchen sink's `test_house`)
carries **20 breakable walls** (`wallB_*`, a `chunks` table each — 9 to ~16 chunks) and **33 moving parts** (`breakable`:
door, glass, shutter, wall). Today they are drawn and nothing reads them; the house's collision GLB gives the floors and the
static walls only, so a breakable wall can be walked through.

## The format (his notes, measured here)

| What | Where | Notes |
|---|---|---|
| Chunk id per vertex | `geometry.attributes._chunk` (exported `_CHUNK`; GLTFLoader lower-cases it) | `-1` = trim that never breaks (frames, sills, floor band) |
| Chunk table | node extras `chunks` (a JSON **string**) | `{ id, box: [x0,y0,z0,x1,y1,z1], hp: 20, anchored, nb: [ids] }` |
| Chunk box axes | **Blender Z-up** | `(x, y, z) → (x, z, −y)`, re-sorted, then the wall's world matrix (`kitBox` 19277) |
| Moving parts | node extras `breakable` (`door` / `glass` / `shutter` / `hatch` / `ac_unit`), `hp`, `door`, `open_min_deg/max`, `travel` | doors hinge on local Y (already Y-up), shutter slides up `travel` 2.6 m, hatch rotates on local X 0..110° |
| Ivy / dressing | `_host` + `_chunk` per vertex, `hosts` extras | leaves on a dead chunk hide; awnings / signs fall |

## Systems → Scene Companion

| System | weirdport symbol (line) | What it does | Becomes | Gap |
|---|---|---|---|---|
| Chunk colliders | `buildKit` 19660, records ~19806 | Each chunk's box, turned with the wall, is a collider (an OBB) | `BreakableWall` behavior (one per wall node, found by `chunks` extras under a `Breakables` root) registering each live chunk as a Solid-shaped `obb` in `world.solids` | none: `walkShape` has `obb` |
| Damage in | `kitBlast` 20190 (one door for bolt, blast, hammer; `KIT.dmg` 12× scale) | Sphere vs chunk spheres; first hit clones the shared geometry | A world event `blast(x, y, z, r, dmg)` that Melee hits / projectiles / explosions emit; `Breakables` listens | Melee needs to emit `blast` at the hit point (it only strikes entities now) |
| Kill a chunk | `kitKill` 20084 | Collapse its vertices to its own centre (zero-area triangles, no draw cost); drop its collider; dust burst; clang | Same, in the behavior (`geometry.clone()` on first hit — `kitClone` 20072, the geometry is SHARED by ten nodes) | none |
| Holding on | `kitFlood` 20131, `kitFallStep` 20240 | Flood from anchored chunks through `nb`; orphans fall after `KIT.fall` (.28 s, staggered ×1.35 each) so a hole spreads | Same | none |
| Debris | `kitDebrisChunk` 20539, `kitDebrisStep` 21081 | The dead chunk's own triangles copied out and thrown with spin, then dropped | A small pooled debris set in the behavior (or Stage 7 particles) | Stage 7 VFX for the dust |
| Repair | `kitRestore` 20153, `workerAI` | A kill run backwards: vertices back from the source, box back in | `BreakableWall.restore(id)` + a Reaction `repair` | none |
| Doors / shutter / hatch / glass | `KPARTS`, `kitPartAdd`, `kitPartStep` (~20260+) | Doors swing AWAY from him as he walks in (no button), shutter rolls up, hatch opens from below, glass breaks outward along the shot | `KitPart` behavior per moving part (proximity open, hp, break) | none |
| Hanging things | `kitHang` 19010, `kitHangDrop` 19041 | Ivy puffs, awnings / signs fall, AC units drop with their host chunk | Later, after the walls | — |
| Intact → twin swap | `kitSwap` 19632 (the kit CITY only) | City walls are intact meshes until hit, then the chunked twin goes in | Later (the kit city) | — |
| Batching | `kitBatch` 20923 | 1,505 draws → 84, walls keep vertex ranges | Stage 7 performance | — |

## Order for the next items

1. **`BreakableWall`**: chunk colliders from the extras (Z-up → Y-up, through the wall's matrix), the `blast` event,
   kill = collapse + collider out, flood + staggered fall; the test house's walls solid and breakable in the kitchen sink.
   Melee emits `blast` at its hit point.
2. **Debris + repair**: the chunk's triangles thrown out; `restore`.
3. **`KitPart`**: doors that swing away, the shutter, the hatch, glass that breaks outward.
4. Then the **Kit walls** item (the generator's `cells` / `heights` for intact kit walls) and a collider view in the editor.
