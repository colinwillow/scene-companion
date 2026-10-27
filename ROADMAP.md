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
- [x] Tiny Hop feel pass: jump/fall animation clips, carry the player on moving platforms, camera collision, sounds — Animator plays `jumpClip`/`fallClip` when airborne (robot uses Jump); PlayerController rides moving solids; camera pulls in front of solids/floor (`runtime/camera.js`); synthesized sfx + 🔊 mute (`runtime/sfx.js`); new `pickup`/`stomp`/`land` events
- [x] Tiny Hop: landing squash; footstep sounds — new `Squash` (event-driven squash & stretch around the authored scale) and `Footsteps` (a `step` event per stride, longer when running) behaviors; tiny-hop player has both, kitchen-sink player squashes on `score`
- [ ] [blocked: needs a model with a fall clip — robot.glb has none] Tiny Hop: a proper fall clip (`Animator.fallClip` is ready; set it once a character with a Fall/Falling clip is in assets)
- [x] Validator: catch hardcoded placement more robustly; check prefab references — set/assign/fromArray/copy literals in behaviors + game pages, comment-aware, camera exempt; prefab files (no id/position, asset, behavior params), unused prefabs, removeBehaviors typos, id style

## Stage 3 — Editor v1
- [x] Hierarchy list (all entities, tap to select, search) — ☰ List button: searchable by id/prefab/asset/behavior, tap selects + frames the camera; top sheet on phones (closes after a pick), left panel in landscape
- [x] Add / duplicate / delete entities; asset picker — ＋ Add menu (prefabs + models, dropped at the camera focus), Duplicate / Delete in the inspector, model picker swaps the asset; logic in pure `runtime/editing.js` (tested, ready for the MCP server)
- [x] Undo / redo — ↶ ↷ buttons + Ctrl/Cmd+Z, Ctrl+Shift+Z / Ctrl+Y; covers gizmo drags, sliders (one step per drag), position, animation, add/dup/delete, model swap, add behavior, look; pure `runtime/history.js` (tested)
- [x] Mobile polish: bigger gizmo handles, two-finger orbit, bottom-sheet inspector snap points, landscape side panel — on touch: gizmo ×1.6, one finger pans/taps, two fingers orbit + pinch; inspector sheet with a handle (drag or tap: peek / half / full; selecting opens it); landscape keeps the side panel; tighter toolbar
- [x] Save scene back to the repo (GitHub API with a token) instead of Copy JSON — ⇪ Save commits the open scene file; asks once for repo/branch/fine-grained token (stored on the device); warns before overwriting a newer repo copy; `runtime/github.js` tested against a fake API

## Stage 4 — Play mode + live link
- [x] Dev server with WebSocket: editor edits hot-patch a running game in another tab/phone — `npm run dev` (static + /live relay, prints LAN URLs); editor streams the scene; play.html patches transforms/params/animation in place and rebuilds on structural changes (`runtime/livepatch.js`, tested)
- [x] Live link polish: Bob keeps its old base height when an edit moves the object mid-play (re-read base on position patch); show a small 'live' badge on both pages — new `Behavior.onMoved()` hook called on live position patches (Bob re-bases, Chase re-homes, PlayerController re-spawns); green ● LIVE pill bottom-left on editor + game, flashes on each edit sent/applied
- [x] Game reports state back (selection follows, errors, FPS) — play.html reports twice a second (`runtime/livestate.js`, tested): editor LIVE badge shows game FPS + error count, game errors land in the editor's error box as `[game] …`, inspector shows the selected object's live position; editor selection shows as a green marker over the object in the game; dev server replays the last selection to late joiners
- [x] Live link: tap an object in the running game to select it in the editor (needs a 'select mode' toggle so it doesn't fight the joystick) — 🎯 button in the game HUD (only while live): taps pick objects instead of steering; editor selects + frames it, marker follows

## Stage 5 — MCP server
- [x] MCP server exposing: list entities, get selection, spawn/move/delete, attach behavior, set param, play/stop, screenshot, read errors — `tools/mcp-server.mjs` (stdio, no SDK) → dev server → editor tab; `.mcp.json` for Claude Code; 16 tools incl. get_entity, list_library, select, remove_behavior, save_scene; edits via pure `runtime/commands.js` (schema-checked, undoable, live-linked)
- [x] MCP: headless fallback — when no editor tab is open, the MCP server launches its own headless editor so Claude can work alone (cloud runs, finish-line test) — pings first; no answer → opens index.html in headless Chromium via Playwright (optional dep, three served from node_modules); also starts the dev server if none is running. `SC_HEADLESS=auto|off|always`, `SC_SCENE`, `SC_DEBUG`
- [ ] Finish-line test: Claude builds a small game (e.g. Tetris or a tiny platformer) through MCP alone

## Later
- [ ] Blender bridge add-on (send object to Blender and back)
- [ ] Libraries panel (characters, motions, sounds, props)
- [ ] Generator plug-ins (image→3D, image gen)
- [ ] Desktop app (Tauri) + Desktop Ultra tier (WebGPU)
