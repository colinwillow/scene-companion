# Roadmap — one task per build run

Top unchecked item = next run. Colin can reorder, add or delete freely.
Each run: read SPEC.md, FEEDBACK.md, then do ONE item. Keep `npm run validate` passing and the kitchen-sink scene working.

## Stage 1.5 — Make it look like a game (Colin's priority, do these first)
Goal: the kitchen-sink scene should look alive, closer to a modern engine than a debug view. Web tier stays phone-friendly; desktop tier goes all out.
- [x] Sky + environment lighting: procedural sky (three's Sky addon) or gradient sky, PMREM environment from it, sun direction/colour from scene settings, filmic tone mapping. Make `pbr` look great by default.
- [x] Post-processing stack scaled by tier: ambient occlusion (GTAO/SAO), bloom, anti-aliasing, subtle vignette/colour grade. Web = light, desktop = full. Settings live in the scene file.
- [x] Shadows + ground: tuned soft shadows that follow the camera, a good-looking ground (procedural texture or noise, not flat green), a bit of fog/atmosphere.
- [x] Real models: replace primitives with free CC0 models (e.g. Quaternius or Kenney packs from GitHub) — crates, coins, props, trees/rocks, enemies — and dress the kitchen-sink scene so it reads as a small game level.
- [x] Toon look upgrade: outlines + rim light so `toon` looks stylized and intentional, not flat.
- [x] Fix toon look: rim light was inverted (lit every pixel → washed grey); toon now cancels the sky's low exposure; outline width is in world metres (rigged robot sits under ×39 bones, which blew its hull into black shards); outline hulls share morph weights; clouds don't cast shadows.
- [ ] [blocked: build runs can't list Kenney/Quaternius repos — needs Colin to drop a pack in or allow the repo] More CC0 models: rocks, crates, a ground enemy. Only found Kenney starter-kit GLBs by guessing paths (raw.githubusercontent works, GitHub API/jsDelivr are blocked from build runs). Ask Colin to add a pack to the repo, or allow a Kenney repo for read.

## Stage 1 — Format + runtime (v0 done)
- [x] Scene format, Behavior base + schema, registry, World loader, look profiles, tier variants, validator, editor page v0
- [x] GLB assets in scenes (with a sample character) + animation clips per entity
- [x] Prefabs: reusable entity templates (`prefabs/*.prefab.json`) that scenes instance and override
- [x] Unit tests for the runtime and every behavior (node test runner, no browser) — `npm test`, 29 tests

## Stage 2 — Skill
- [x] Vibe-code a tiny game from scratch following SKILL.md — **Tiny Hop** (`play.html`): third-person, joystick + jump, chasers you stomp, 10 coins, platforms incl. a moving one. New behaviors Solid, PlayerController, Chase, Stompable; SKILL.md got a Game kit section (input, collision, events, game page vs editor).
- [ ] Tiny Hop feel pass after Colin's playtest: jump/fall animation clips, carry the player on moving platforms, camera collision, sounds
- [x] Validator: catch hardcoded placement more robustly; check prefab references — set/assign/fromArray/copy literals in behaviors + game pages, comment-aware, camera exempt; prefab files (no id/position, asset, behavior params), unused prefabs, removeBehaviors typos, id style

## Stage 3 — Editor v1
- [x] Hierarchy list (all entities, tap to select, search) — ☰ List button: searchable by id/prefab/asset/behavior, tap selects + frames the camera; top sheet on phones (closes after a pick), left panel in landscape
- [x] Add / duplicate / delete entities; asset picker — ＋ Add menu (prefabs + models, dropped at the camera focus), Duplicate / Delete in the inspector, model picker swaps the asset; logic in pure `runtime/editing.js` (tested, ready for the MCP server)
- [ ] Undo / redo
- [ ] Mobile polish: bigger gizmo handles, two-finger orbit, bottom-sheet inspector snap points, landscape side panel
- [ ] Save scene back to the repo (GitHub API with a token) instead of Copy JSON

## Stage 4 — Play mode + live link
- [ ] Dev server with WebSocket: editor edits hot-patch a running game in another tab/phone
- [ ] Game reports state back (selection follows, errors, FPS)

## Stage 5 — MCP server
- [ ] MCP server exposing: list entities, get selection, spawn/move/delete, attach behavior, set param, play/stop, screenshot, read errors
- [ ] Finish-line test: Claude builds a small game (e.g. Tetris or a tiny platformer) through MCP alone

## Later
- [ ] Blender bridge add-on (send object to Blender and back)
- [ ] Libraries panel (characters, motions, sounds, props)
- [ ] Generator plug-ins (image→3D, image gen)
- [ ] Desktop app (Tauri) + Desktop Ultra tier (WebGPU)
