---
name: scene-companion
description: Use whenever building or changing a Three.js game that uses Scene Companion, so every object and behavior stays editable in the visual editor.
---

# Building games that are editor-ready from birth

## Always
1. **Objects go in the scene file, not the code.** Every character, prop, enemy, spawn point, trigger or light goes into `scenes/<name>.scene.json` with a stable, readable ID (`enemy_03`, `door_lab_main`). Never create placed objects inline in game code.
2. **Logic goes in behaviors.** Any game logic attached to an object is a component in `behaviors/<Name>.js` that extends `Behavior` and declares a `schema` for every tunable value (type, default, min, max). If a value might ever be tweaked, it goes in the schema, not as a hardcoded constant.
3. **One owner per fact.** Behavior code reads its settings from the scene file and never overwrites placement or settings that the scene file owns. Runtime state (current health, velocity) is fine to change; authored values are not.
4. **Assets by reference.** Models, textures and sounds live in `assets/` and are referenced by path. Keep within the game's budget (textures 512–2K, GLB under ~20 MB, Draco).
5. **Reuse first.** Before writing a new behavior, check `behaviors/` and the shared behavior library. Extend an existing one with a new schema field rather than forking it.
6. **Prefabs for anything repeated.** If an object appears more than once (enemies, coins, props), make `prefabs/<name>.prefab.json` and list it under `prefabs` in the scene. Each instance gives only its id, position and what differs: behavior params merge by type, and `removeBehaviors` drops one. Never copy-paste a full object definition. Any prefab in `prefabs/` can be spawned (editor ＋Add → More prefabs, or MCP `spawn`) and gets added to the scene's list; `npm run validate` keeps `prefabs/index.json` (the editor's list) up to date — commit it.
7. **Keep IDs stable.** Never rename or regenerate IDs. Renaming breaks the editor, the Blender bridge and merges.
8. **Validate.** After changes, run `npm run validate`. It checks that every behavior in a scene exists, that values match their schemas, that there are no duplicate IDs, prefab files and `removeBehaviors`, and that no hardcoded placement (literal `position`/`scale` set, assign, fromArray, copy) exists in behaviors or game pages. Behaviors may not create meshes. Warnings (⚠) don't fail but are worth fixing.

## Game kit (what exists already — reuse it)
- **Input:** behaviors never read the DOM. The game page fills `world.input = { move: [x, z], jump }` (move is world-space, camera-relative, length ≤ 1) and behaviors read it. Touch controls are Colin's twin sticks (`runtime/sticks.js`, see `play.html`): two floating pads — LEFT moves, RIGHT orbits the camera (yaw only), a TAP on the right stick jumps (`settings.controls.jumpTap: "either"` lets a left tap jump too); no jump button. Hold and flick on both sticks are reserved for future verbs (`bindStick(el, out, { onTap, onFlick })`). Keys: WASD/arrows, space, Q/E turn.
- **Collision:** our own tiny collider, no library. For obstacle courses use the level kit prefabs (`kit_block`, `kit_block_big`, `kit_step`, `kit_ledge`, `kit_platform`, `kit_beam`, `kit_pole`, `kit_wall`: bottom-pivot, Solid included, sizes on a 0.5 m grid). Give anything you can stand on or bump into a `Solid` behavior (`size` in metres, `anchor` bottom|center; axis-aligned). `PlayerController` walks, jumps (coyote time + jump buffer), lands on solids, respawns below `killY`; `airJumps: 1` gives a double jump (Animator `doubleJumpClip`, e.g. Zap's `front_flip`).
- **Enemies/pickups:** `Chase` (follow inside a radius, go home), `Stompable` (touch hurts, land on top defeats + bounce), `Pickup`, `Health`. Events: `score`, `pickup`, `stomp`, `hurt`, `bounce`, `health`, `gameover`, `jump`, `land`, `respawn`. `PlayerController` rides moving solids (anything that moves a `Solid`, e.g. `Bob`/`Patrol`, carries the player). `Animator` also plays `jumpClip` (`jumpRate` speeds it up, `jumpHold` lets a flip finish) / `fallClip` / `landClip` / `hardLandClip` (impact ≥ `hardLandSpeed`) when on a PlayerController; the validator checks every `*Clip` param exists in the model. Encounters: a `trigger_zone` prefab (`Trigger`: box volume, emits `event` and wakes ids in `activates` on entry) + `Dormant` on the enemies it wakes (`hidden: true` for an ambush). Juice: `Squash` (squash/stretch on any two events), `Footsteps` (`step` events per stride).
- **Check a level is beatable:** list the main path in the scene's `settings.route` (entity ids) and run `npm run route -- ./scenes/<name>.scene.json` — a headless bot walks and jumps it and says where it fails. `npm run check:full` runs `npm run check` plus the bot on every scene with a route; a known, accepted failure goes in `settings.routeKnownIssue` (a short reason) so it shows as ⚠ instead of failing.
- **Camera + sound (game page):** `runtime/camera.js` `clipCamera()` pulls the follow camera in front of solids (pure, tested); `runtime/sfx.js` gives synthesized blips (`sfx.play('jump')`), unlocked on the first tap, with a mute toggle.
- **Game page vs editor:** `index.html?scene=…` edits a scene; a game page (like `play.html`) loads the same scene file, plays it from a copy, and owns only camera, input and HUD.
- **Models:** `glb` variants take `height` (characters, and any prop in odd units — it normalizes size and puts the base at the origin), or `scale` + optional `offset`/`castShadow:false` (props), plus `frontSide:true` for Tripo/generated exports (they are all `doubleSided`). Draco GLBs work (decoder in `vendor/draco/`). Colin's own models are in `assets/models/colin/` (README lists clips); ground enemies `skeleton`/`mutant` and props `rock_*`, `crates`, `bench`, `dumpster`, `hydrant`, `street_lamp`… are prefabs. `Stompable.defeatClip` plays a fall before the enemy vanishes. Kenney models have their origin at the bottom, so `Solid` anchor stays `bottom`.
- **Tests:** add a node test for every new behavior (`tests/`, fakes in `tests/fakes.js`); `npm run check` must pass.

- **Live edits:** if a behavior caches anything from the position in `start()` (base height, home, spawn), also implement `onMoved()` to re-read it — the live link calls it when the editor moves the object mid-play. Game pages report state back with `runtime/livestate.js` (see `play.html`); debug overlays that aren't scene objects mark their `new Mesh` line with `// sc:overlay`.

- **MCP:** with `npm run dev` + the editor open, the `scene-companion` MCP server (`.mcp.json`) lets you list/spawn/move/delete, attach behaviors, set params, play/stop, screenshot and save. Prefer it for placement and tuning when the user is looking at the editor; it keeps everything in the scene file by construction.

## When asked for a feature
Make a behavior and attach it in the scene. For "breakable buildings": create a `Breakable` behavior with `health`, `debrisCount` and `debrisModel` in its schema, then attach it to the building objects in the scene file.

## Never
- Spawn authored objects from code with literal positions
- Store tuning values only in code
- Edit an object's ID or delete objects the editor placed without being asked
