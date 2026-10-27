# What a real game engine has — and where Scene Companion stands

Written 2026-10-27 at Colin's request: TheCherno's engine brief (https://gist.github.com/TheCherno/ccf5d7656c68423b22398d9474c7af5d)
asks Claude for a full C++ engine. We stay on Three.js (web + phone), but use that brief and standard engine
architecture as a checklist of everything an engine owns, so Scene Companion grows into an engine, not just an editor.

Status: ✅ have · 🟡 partial · ❌ missing. "Web approach" is how we'd do it here without leaving Three.js.

| # | Subsystem | Status | What we have | What's missing | Web approach |
|---|---|---|---|---|---|
| 1 | **Core loop + time** | 🟡 | variable-dt update, Play/Stop | fixed timestep for gameplay/physics (render interpolated), time scale / pause / hit-stop / slow-mo, seeded RNG for replays and tests | accumulator loop in World; `world.time.scale`; `world.rng` |
| 2 | **Entities (scene graph / ECS)** | 🟡 | entities + behaviors + prefabs, stable ids, scene files | **parent/child entities** (a rider on a board, a sword in a hand, a door in a house), tags/layers, queries (`world.find({tag, behavior})`), **runtime spawn/destroy of prefabs from behaviors** (bullets, pickups, debris) | `children` in the scene file; `world.spawn(prefab, at)` / `world.destroy(id)`; runtime entities never saved |
| 3 | **Scripting API** | 🟡 | pure-JS behaviors, schema → sliders, start/update/destroy/onMoved, events | fixedUpdate/lateUpdate, timers/coroutines (`this.after(0.5, fn)`), messages between entities, a documented API page, a test scene that calls every API (Cherno's rule) | stays JS — keeps the native-backend door open (SPEC §5) |
| 4 | **Physics + collision** | 🟡 | own collider: axis-aligned Solids, PlayerController, Trigger volumes | rotated boxes, spheres/capsules, mesh colliders from a collision GLB (Colin's weirdport-style exports), **raycast/sweep queries for behaviors**, collision layers/masks, slopes + steps, rigid bodies (ragdolls, debris, destruction) | keep the hand-written collider as default; Rapier (WASM) as an opt-in tier for real physics, per house rule |
| 5 | **Animation** | 🟡 | clip play + crossfade, Animator (idle/walk/run/jump/fall/land) | speed-matched blending (no foot sliding), **layers + masks** (upper body shoots while legs run), frame events (footstep, hit frame), root motion on/off, foot IK + look-at, retargeting (`retarget-anims`), ragdoll | three's AnimationMixer + our own layer/mask code; Colin's rules from weirdport (weights sum to 1, ask weight not isRunning) |
| 6 | **Rendering** | 🟡 | looks (toon/baked/pbr), tiers, sky + IBL, shadows following camera, post (AO/bloom/vignette), outlines | **frustum culling is OFF on every GLB mesh** (World.js), **instancing for repeated prefabs** (trees, grass, coins), LOD, KTX2 textures, particles/VFX, decals, water, terrain, light probes / baked light | `InstancedMesh` per prefab+asset; KTX2Loader (Colin's pipeline already bakes them); a pooled `Points`/sprite particle system |
| 7 | **Audio** | 🟡 | synthesized blips, mute | sound files, **AudioSource behavior** (3D positional, loop, volume in schema), music + crossfade, buses (music/sfx/voice) with sliders | three's PositionalAudio wrapped so behaviors only emit `sound` events |
| 8 | **Input** | 🟡 | Colin's sticks (in progress), WASD | **action mapping** (tap/flick/hold/drag per stick → named actions in the scene file), gamepad, rebinding | `settings.input` table; behaviors read actions, never gestures |
| 9 | **Game UI / HUD** | ❌ | page-owned HUD | HUD authored in the scene (score, health bar, prompts, menus, dialogue), editable like objects | DOM overlay driven by a `ui` section of the scene file + UI behaviors |
| 10 | **Camera** | 🟡 | follow cam + collision in the game page | camera as an entity with behaviors (follow, orbit, rail, fixed), shake, zoom, blend between cameras, cutscene cams | `Camera*` behaviors; the page only renders the active camera |
| 11 | **AI** | 🟡 | Chase, Patrol, Stompable | pathfinding (grid/navmesh A*), state machine or behavior tree authored in the editor, perception (sight cone, hearing), squads | navmesh baked from Solids + collision GLB; FSM as data in the scene |
| 12 | **Gameplay framework** | 🟡 | Health, Pickup, score events | game state (menu → play → win/lose), **scene switching/levels**, spawn points + checkpoints + respawn, **save/load game**, damage system (types, knockback, i-frames), inventory/equipment, weapons (mounts already measured in Colin's rigs) | small framework behaviors + a `game` section in settings |
| 13 | **Asset pipeline** | 🟡 | GLB variants per tier, Draco, prefabs, Libraries panel, inventory planned | **asset IDs (GUIDs) instead of paths** (renames break scenes), thumbnails, import checks (doubleSided, BLEND, scale), KTX2/meshopt, hot reload, dependency tracking, packs (SPEC §7b) | `assets/<id>.meta.json`; validator enforces budgets |
| 14 | **Editor** | 🟡→✅ | select, gizmo, inspector, undo, add/dup/delete, list, play/stop, live link, save, MCP, Blender bridge, libraries | multi-select, parenting in the hierarchy, snapping (planned), **collider/debug view**, console/log panel, timeline (cutscenes), particle + material editors, terrain/scatter brush (planned) | same web editor, phone-first |
| 15 | **Debug + profiling** | 🟡 | FPS + errors reported to editor | stats (draw calls, triangles, texture memory), per-tier budgets that warn, collider overlay, frame timing | `renderer.info` in livestate; budgets in settings |
| 16 | **Build + ship** | 🟡 | Pages, play.html | loading screen + progress, asset streaming, PWA/offline, Publish (planned), Capacitor (planned), engine exports (planned) | see SPEC §7c |
| 17 | **Testing** | ✅ | unit tests, validator, kitchen-sink scene, route bot, MCP finish-line | performance regression test (draws/tris budget per scene), screenshot diff | headless Chromium, already used |
| 18 | Networking | ❌ | — | multiplayer (later, if ever) | — |
| 19 | Localization / accessibility | ❌ | — | text tables, subtitles, remappable controls, colour-blind options | later |

## The order that matters for Colin's games
1. **Entities that spawn and nest** (#2, #3): nothing combat-y works without bullets, debris and held items.
2. **Fixed timestep + time scale + seeded RNG** (#1): hit-stop, slow-mo KOs, deterministic tests.
3. **Collision queries + shapes** (#4): raycasts for aiming/ledges/wall-runs; his collision GLBs.
4. **Animation layers, masks and frame events** (#5): the goblin's katana over running legs; footsteps and hit frames.
5. **Performance basics** (#6, #15): culling back on, instancing, stats + budgets — before levels get big.
6. **Audio sources** (#7), **particles** (#6), **HUD** (#9), **game flow + save** (#12).
7. Then camera entities, AI pathfinding + state machines, asset GUIDs, action mapping.
