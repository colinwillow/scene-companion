# Roadmap — one task per build run

Top unchecked item = next run. Colin can reorder, add or delete freely.
Each run: read SPEC.md, FEEDBACK.md, then do ONE item. Keep `npm run validate` passing and the kitchen-sink scene working.

## Stage 1.5 — Make it look like a game (Colin's priority, do these first)
Goal: the kitchen-sink scene should look alive, closer to a modern engine than a debug view. Web tier stays phone-friendly; desktop tier goes all out.
- [x] Sky + environment lighting: procedural sky (three's Sky addon) or gradient sky, PMREM environment from it, sun direction/colour from scene settings, filmic tone mapping. Make `pbr` look great by default.
- [x] Post-processing stack scaled by tier: ambient occlusion (GTAO/SAO), bloom, anti-aliasing, subtle vignette/colour grade. Web = light, desktop = full. Settings live in the scene file.
- [x] Shadows + ground: tuned soft shadows that follow the camera, a good-looking ground (procedural texture or noise, not flat green), a bit of fog/atmosphere.
- [ ] [IN PROGRESS 22:58 UTC, build run] Real models: replace primitives with free CC0 models (e.g. Quaternius or Kenney packs from GitHub) — crates, coins, props, trees/rocks, enemies — and dress the kitchen-sink scene so it reads as a small game level.
- [x] Toon look upgrade: outlines + rim light so `toon` looks stylized and intentional, not flat.

## Stage 1 — Format + runtime (v0 done)
- [x] Scene format, Behavior base + schema, registry, World loader, look profiles, tier variants, validator, editor page v0
- [x] GLB assets in scenes (with a sample character) + animation clips per entity
- [x] Prefabs: reusable entity templates (`prefabs/*.prefab.json`) that scenes instance and override
- [ ] Unit tests for the runtime and every behavior (node test runner, no browser)

## Stage 2 — Skill
- [ ] Vibe-code a tiny game from scratch following SKILL.md (third-person, jump, a few enemies, pickups); fix the skill wherever it was unclear
- [ ] Validator: catch hardcoded placement more robustly; check prefab references

## Stage 3 — Editor v1
- [ ] Hierarchy list (all entities, tap to select, search)
- [ ] Add / duplicate / delete entities; asset picker
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
