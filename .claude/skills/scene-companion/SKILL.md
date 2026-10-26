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
6. **Prefabs for anything repeated.** If an object appears more than once (enemies, coins, props), make `prefabs/<name>.prefab.json` and list it under `prefabs` in the scene. Each instance gives only its id, position and what differs: behavior params merge by type, and `removeBehaviors` drops one. Never copy-paste a full object definition.
7. **Keep IDs stable.** Never rename or regenerate IDs. Renaming breaks the editor, the Blender bridge and merges.
8. **Validate.** After changes, run `npm run validate`. It checks that every behavior in a scene exists, that values match their schemas, that there are no duplicate IDs, and that no hardcoded placement exists in code.

## When asked for a feature
Make a behavior and attach it in the scene. For "breakable buildings": create a `Breakable` behavior with `health`, `debrisCount` and `debrisModel` in its schema, then attach it to the building objects in the scene file.

## Never
- Spawn authored objects from code with literal positions
- Store tuning values only in code
- Edit an object's ID or delete objects the editor placed without being asked
