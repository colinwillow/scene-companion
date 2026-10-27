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

## 7c. Who it's for, and how they never see GitHub (Colin, 2026-10-27)
**The target user has never coded and doesn't know what GitHub is.** They have an AI subscription and want to make a game. So, like Lovable, Bolt and Replit, the front door is an account and a Publish button, not a repo.

1. **Everyone:**
   - Sign in with Google/Apple.
   - Projects autosave to our cloud (like Google Docs, no Save button).
   - **Publish** uploads the game to static hosting and gives a shareable link. Netlify/Vercel/Cloudflare Pages take direct file uploads through their APIs, so no git is involved.
2. **Their AI:**
   - Scene Companion is a hosted MCP **connector** that people add to the Claude or ChatGPT app they already pay for.
   - They say "put a castle and three goblins in my level", their AI edits their cloud project, and the editor on their phone updates live.
   - It costs us nothing per request. (Running AI ourselves would mean API keys and a paid plan.)
3. **Creators (Colin):**
   - Connect GitHub through a GitHub App (repo, commits, Pages via the API; nothing to paste).
   - Export to Godot/Unity/Unreal, and Capacitor for the App Store/Play Store.

**What owning the backend costs:**
- Hosting and storage (big GLBs, so cheap object storage like Cloudflare R2).
- Moderation of public games (report and takedown).
- Privacy policy and accounts.
- Apple's review rules for apps that run user-made HTML5 games (check them before committing to an iPhone app).

## 7e. Animation workspace, creator nights, and the community library (Colin, 2026-10-27)
**Animation workspace (in the editor):**
- Tap a character → its clips → **Open in timeline**: a scrubbable timeline with play/loop/speed, the character orbitable in 3D (front/side/top views).
- **Non-destructive edits** saved as clip variants in `character.json`: trim start/end, loop points, playback rate, bone masks (toggle bones on/off → upper/lower body layers), additive layers, frame events (step, hit, spawn VFX).
- **Round trip with the Forge** (`retarget-anims`; `zap/forge.html` plus `forge-mcp`): "Open in Forge" sends the character and clip; Forge edits retargeting and tuning; "Send back" updates the character's clips in place, just like the Blender bridge. The Forge stays its own app and is also built in here.
- New motions from the clip library get retargeted onto the selected character from the Motions tab.

**Creator nights (make-a-batch workflow):** dedicated workspaces for making one kind of asset in bulk:
- a **VFX/particle editor** (emitters, sprites, colour/size curves, presets: sparks, smoke, slashes, magic);
- weapon / prop / building batches through the Blender bridge and image→3D.

Everything made lands in the library, auto-validated and thumbnailed.

**Thumbnail studio:** every asset gets standard, well-lit thumbnails and a turntable automatically (fixed lights, camera framing from its bounds), so the library looks consistent.

**Community library:** "open contributor" rather than fully open source.
- **Share to community** is a toggle on any asset. It is auto-sorted into a category (characters, NPCs, props, weapons, buildings, VFX, animations, levels) from its contents and a quick vision check, with licence per item (CC0 / CC-BY / paid).
- **Quality gate:** the validator rules (budgets, Draco/KTX2, rig + clip roles, scale, doubleSided/BLEND, thumbnails) must pass before it's public. That's how "a certain quality, made for web games" is enforced automatically.
- **Discovery:** stars/likes ranking per section, comments, creator profiles, collections.
- **Bounties:** someone posts "$10 for this character rigged well", a creator delivers privately or to the public library. Payouts via a payments provider (e.g. Stripe Connect), platform fee optional.
- **Marketplace:** asset packs and level packs for sale alongside the free library (SPEC §7b).
- Rigs made with tools like Auto-Rig Pro are fine to share and sell. It's the add-on that can't be redistributed, not its output.

## 7f. 2D and 2.5D games (later; Colin, 2026-10-27)
Lots of people make 2D games, so the engine should support them too. It's the same scene files, behaviors, editor, MCP and library, with a 2D flavour:
- **Sprites + sprite sheets:** import a sheet (or a folder of frames), slice it into a grid or auto-detect frames, name animations (`idle`, `run`, `jump`…). These are the same clip roles as 3D characters, so Animator/PlayerController work unchanged.
- **Camera modes:** orthographic side-view (platformer), top-down, and 2.5D (3D models or sprites on a side-scrolling plane, parallax layers).
- **2D collision:** the same Solid/Trigger behaviors, locked to a plane; tilemaps for levels (paint tiles in the editor).
- **Bridges:** render a 3D (Mixamo-rigged) character to a sprite sheet from any clip (fixed camera angles, pixel/toon look), so Colin's characters work in 2D games too; image-gen for sprite art.
- Library sections for sprites, tilesets and backgrounds.

## 7g. Reactions: visual "when this happens, do that" (Colin, 2026-10-27)
Roles cover the standard moments (idle, run, jump, hit…). Everything game-specific gets authored as **Reactions**, without code: a list on any object, edited in the inspector like behaviors, stored in the scene file.

- **When** (trigger), picked from a list, each with its own settings:
  - player/tag enters a zone or comes within N m ("notices" a jewel);
  - something bumps into me / I get hit;
  - an event fires (`pickup`, `stomp`, any custom name);
  - a timer;
  - a variable changes or crosses a value;
  - play starts;
  - a frame event in a clip (`hit`, `step`).
- **If** (optional conditions): a variable compares (`coins >= 10`), a random chance, once only, cooldown.
- **Do** (one or more actions):
  - play a clip / a role;
  - look at / turn to;
  - move to;
  - emit an event;
  - set / add to a variable;
  - spawn a prefab;
  - destroy / hide / show;
  - enable or disable a behavior;
  - play a sound / VFX;
  - camera shake;
  - show a HUD message;
  - load a scene.
- **Variables:** named numbers, flags and strings at scene level (`settings.variables`, shown in their own panel) and per object, readable by Reactions, behaviors and the HUD.
- It runs as one pure behavior (`Reactions`) over a small, schema-checked vocabulary, so the validator checks it, MCP can author it ("when the player gets near, he waves"), and an agent can turn a Reaction into a real behavior when it outgrows the list.
- Later: a node-graph view of the same data, for people who think in graphs.

## 7d. Engine scope
Scene Companion is growing into a full engine on Three.js. `docs/ENGINE.md` is the subsystem checklist (from TheCherno's brief and standard engine architecture) with status and order; ROADMAP Stage 7 builds it.

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
