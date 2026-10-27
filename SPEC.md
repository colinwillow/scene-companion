# Scene Companion — Spec (working name)

## The idea
People now build Three.js games by talking to AI, but there's no place to *stand inside the scene*. Scene Companion is a visual editor that lives alongside the code. You can vibe-code a game into existence with Claude, then open it in the editor and click, drag, swap and tune things like in Unity or Godot. Or you can do both, back and forth, at any time.

It is not a rival to Unreal. It's the missing middle between "AI writes the code" and "I want to see and grab things."

## 1. One source of truth
Every game built this way has two halves:

- **Scene files (data):** `scenes/<name>.scene.json`. Every object has a stable ID, a transform, an asset reference, and a list of attached behaviors with their settings. Example: `enemy_03` sits at x/y/z, uses `characters/alien.glb`, and has Patrol (speed 2) and Health (50).
- **Behaviors (code):** `behaviors/<Name>.js`. Small components such as Patrol, Chase, Jump, Breakable, WeaponMount and Pickup. Each declares its tunable values in a schema (name, type, default, min/max). The editor turns that schema into sliders, toggles and pickers.

**The one rule:** each fact has exactly one owner. Placement and settings live in the scene file. Logic lives in behavior code. Code never hardcodes something the scene file owns. If it did, the two halves would fight and drift apart.

## 2. The skill (Claude's side)
A Claude skill makes every game "editor-ready from birth." Whenever Claude creates something, it also creates its companion entry. Vibe-code "third person, twin-stick, jump, weapon mount, a few AIs, breakable buildings," and the result already opens in the editor with everything visible and tweakable. See `SKILL.md`.

## 3. Handshake / sync
- **The git repo is the truth.** Claude pushes scene and behavior changes, and the editor pulls and reloads. The editor writes the same files, then commits and pushes, and Claude sees the changes next time.
- **Live link while playing:** a small dev-server WebSocket. Edits made in the editor hot-patch the running game without a restart, and the game reports state back (positions, errors, FPS).
- **Conflicts:** stable IDs plus per-object merges, so moving one guy in the editor while Claude edits another doesn't collide.

## 4. The editor app
- **Web first.** It runs anywhere the games run, and everything is already web-light. It installs as a PWA.
- **Mobile is a selling point.** It's fully usable on a phone in both portrait and landscape: touch gizmos, a bottom-sheet inspector, two-finger orbit, and tap-to-select. Mobile-first, like Colin's games.
- **Desktop app later.** A Tauri wrapper of the same web app adds direct file access and local bridges (Blender and so on) without a helper.
- **Core features:** scene view, hierarchy list, inspector (transform + behaviors + schema sliders), add/duplicate/delete, attach a behavior from a library, swap a model, and a Play/Stop button (stop snaps everything back), plus undo/redo.

## 5. Rendering: quality tiers
Same scene files, same behaviors; only renderer settings change.
- **Mobile tier:** lean and fast, toon-friendly (how Colin's games run today).
- **Desktop Ultra tier:** in the desktop app, Three.js WebGPU renderer with everything on: PBR, HDRI image-based lighting, soft shadows, SSAO, bloom, reflections, HDR tonemapping. One toggle, same project.
- **Native backend (later, optional):** a C++/Vulkan runtime that reads the *same* scene files, for when the web ceiling is hit. **Decide now:** behaviors must be runnable by both runtimes. **Decided: JavaScript.** Behaviors stay "pure": no `three`, DOM or browser imports, only the entity/world API. A native build embeds a small JS engine (e.g. QuickJS) to run the same files. This is the rule that keeps "both" possible without a rewrite.

### Look profiles (style, separate from quality)
A scene picks a **look**, and that look is independent of the tier:
- **Toon:** toon shading and outlines
- **Baked:** lighting baked into the textures (e.g. Tripo textures with their lighting left in), drawn unlit. Cheapest, and very consistent on phones.
- **PBR:** full physically based materials and lighting, the AAA path

The look and the tier combine freely: toon on desktop ultra, baked on mobile, and so on.

### Web → desktop as LOD
Every asset in a scene is a *logical asset* with **per-tier variants**: a web variant (baked 1K texture, lighter mesh) and an optional desktop variant (PBR maps, 2–4K, heavier mesh). The runtime picks the richest variant the current tier allows and falls back to the web variant when no desktop one exists. The game logic, behaviors and scene layout are 100% shared.

The result: iterate fast on mobile and web. Then open the same project in the desktop app, which already runs as-is, and upgrade only what you care about by dropping in PBR maps or hi-res meshes for the desktop variants. The two versions run in tandem and stay in sync because they are the same game.

## 6. MCP server
Claude can see what you see. The tools include: list scene objects, get the selection, move/spawn/delete, attach a behavior, set a value, play/stop, take a screenshot, and read errors. So you can select a guy and say "make him patrol between these two points."

## 7. Bridges and plug-ins
- **Blender bridge:** a Blender add-on runs a local socket server. Click an object, choose "Send to Blender," and its GLB opens in Blender, tagged with its ID. Edit it, hit Send Back, and the asset is replaced in place, keeping its ID and behaviors. On desktop this goes direct. On the web or a phone it goes through the repo or a small local helper. (A C4D bridge works the same way later.)
- **Generators** (a provider plug-in interface, using your own API keys): image→3D (Tripo and others), image generation (OpenAI and others), and sound/voice. Generated assets land in the library with their source prompt saved.
- **Libraries** as side panels: characters, motions (from the mocap app), sounds, props, and behaviors. Everything is drag-and-drop, and everything is pre-optimized for mobile (texture sizes, Draco, and so on). Free and unlockable tiers later.

## 7b. The platform: one shared library, many games, asset packs (Colin, 2026-10-27)
**Every game Colin makes gets reverse-engineered into pieces that fit the engine.** Zap, the goblin samurai, Roller Girl, Shred World, weirdport's breakable city, Clancy, Robits, Plutopia, Peggy: they overlap heavily and today share pieces by copy-paste between repos. From now on they share one library, and each game is thin (its scenes, plus a few behaviors of its own).

**A full asset** is something an agent can drop into any game with zero tweaking:
- **Character:** GLB (rigged, textured, Draco) plus `character.json`: measured height, facing, weapon mounts, a **clip-role map** (`idle, walk, run, sprint, jump, fall, land, hardLand, hit, knockdown, getUp, death, attack…` → that rig's clip names), tuned per-character animation layers (the retarget-anims profile), and dynamics settings (hair, cape, tail, cloth). Behaviors ask for roles, never clip names, so any character works in any game.
- **Behavior:** a pure-JS move or system (wall run, high bar, katana combo, skate, blaster, breakable wall), with schema, tests and a demo scene.
- **Prefab/prop:** model plus colliders plus behaviors, sized in metres.

**Packs:** `packs/<id>/pack.json` lists a pack's characters, behaviors, prefabs, scenes, thumbnails, version and tier (`free` | `unlock`). A pack installs into a project's library. The platform is free and ships a free starter pack; Colin sells packs. Unlocking a character gives it fully rigged, textured, animated and tuned, so it just works out of the box.

**Inventory:** one generated index of everything that exists across Colin's repos (what it is, where it lives, its rig, clips, size and status: raw → imported → full asset → in a pack), so assets are taken stock of once and promoted deliberately, not rediscovered by every session.

**Reach (why people use it for free):**
- cross-compatibility: Blender round trip, mocap/retarget, image→3D;
- AI agents via MCP;
- ship anywhere: web, a website, Capacitor → App Store/Play Store, and export to Godot / Unity / Unreal;
- one-button sign-in, so artists never touch tokens or permissions.

## 8. Build stages
1. **Format + runtime:** the scene file format, behavior base class and schema, and a loader that builds a Three.js scene from them. Prove it on one small demo game. *(v0 built: runtime/, behaviors/, scenes/kitchen-sink, index.html, tools/validate.mjs)*
2. **Skill:** Claude follows the rules on a fresh vibe-coded game, and a validator checks them.
3. **Editor v1:** view, select, move, inspector, save, on desktop + phone.
4. **Play mode + live link.**
5. **MCP server.**
6. **Blender bridge.**
7. **Libraries + generator plug-ins.**
8. **Desktop app (Tauri).**
9. **Desktop Ultra tier** (WebGPU, full lighting/shadows/post).
10. **Export targets** (e.g. writing Godot `.tscn` files) and, if needed, the **native backend**. Three.js stays the home.

## Working rules (borrowed from TheCherno's engine prompt)
- **Guide + skills first.** AGENTS.md/CLAUDE.md and skills exist before the code does.
- **Kitchen-sink test scene.** One scene that uses every behavior and feature; rerun after every change so nothing silently breaks. Plus automated tests.
- **Finish line for each stage:** Claude can build a small game (e.g. Tetris, a tiny platformer) entirely through the editor's MCP, with no human help.

## 9. Open questions
- Product name and repo name
- Editor UI in plain JS or React?
- How to retrofit existing games (Weirdport and others), as a migration skill
- Multiplayer editing? Monetization of libraries?
- Open-source the core, sell the libraries?
