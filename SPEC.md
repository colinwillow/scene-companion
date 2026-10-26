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
- **Native backend (later, optional):** a C++/Vulkan runtime that reads the *same* scene files, for when the web ceiling is hit. **Decide now:** behaviors must be runnable by both runtimes. Either write behaviors in Lua (embeddable everywhere), or keep JS and embed a small JS runtime (e.g. QuickJS) in the native build. This is the rule that keeps "both" possible without a rewrite.

## 6. MCP server
Claude can see what you see. The tools include: list scene objects, get the selection, move/spawn/delete, attach a behavior, set a value, play/stop, take a screenshot, and read errors. So you can select a guy and say "make him patrol between these two points."

## 7. Bridges and plug-ins
- **Blender bridge:** a Blender add-on runs a local socket server. Click an object, choose "Send to Blender," and its GLB opens in Blender, tagged with its ID. Edit it, hit Send Back, and the asset is replaced in place, keeping its ID and behaviors. On desktop this goes direct. On the web or a phone it goes through the repo or a small local helper. (A C4D bridge works the same way later.)
- **Generators** (a provider plug-in interface, using your own API keys): image→3D (Tripo and others), image generation (OpenAI and others), and sound/voice. Generated assets land in the library with their source prompt saved.
- **Libraries** as side panels: characters, motions (from the mocap app), sounds, props, and behaviors. Everything is drag-and-drop, and everything is pre-optimized for mobile (texture sizes, Draco, and so on). Free and unlockable tiers later.

## 8. Build stages
1. **Format + runtime:** the scene file format, behavior base class and schema, and a loader that builds a Three.js scene from them. Prove it on one small demo game.
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
- Behavior language for cross-runtime: Lua or JS + embedded runtime?
- Product name and repo name
- Editor UI in plain JS or React?
- How to retrofit existing games (Weirdport and others), as a migration skill
- Multiplayer editing? Monetization of libraries?
- Open-source the core, sell the libraries?
