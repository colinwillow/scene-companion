# Take a scene into Godot / Unity / Unreal

All of these run on your computer; the result is a folder to open in the engine. Behaviors are JavaScript and do not
run in another engine yet: every object keeps its behaviors as JSON (Godot node metadata `sc_behaviors`, Unity
component `ScBehaviors`) so a script there can read them later. Draco models are decoded to plain GLBs on the way out,
and textures that sit beside a GLB (Kenney's `Textures/colormap.png`) are copied with it.

## Godot 4.3+
1. `npm run export:godot scenes/<scene>.scene.json` → `export/godot/<scene>/`
2. Godot → Import → pick that folder's `project.godot` → ▶ Play. You get the level, its lights, sky, collision boxes and a camera.

## Unity 2022.3+ (Built-in, URP or HDRP)
1. `npm run export:unity scenes/<scene>.scene.json` → `export/unity/<scene>/SceneCompanion/`
2. In Unity: Window › Package Manager › **+** › Add package by name → `com.unity.cloud.gltfast` (the glTF importer)
3. Drag the `SceneCompanion` folder into the project's `Assets/`. Wait for the GLBs to import.
4. Menu **Scene Companion › Build Scene**. It builds everything under one object named after the scene (undoable), sets a camera behind the player, and logs how many objects it made.

Unverified (no Unity here): the C# has not been compiled; the mirror axis is glTFast's (X) — if every model comes in
facing or standing mirrored, it is one line in `runtime/engines.js` (`unityPos` / `unityQuat`). Light brightness is a guess.

## Unreal 5.3+
1. `npm run export:unreal scenes/<scene>.scene.json` → `export/unreal/<scene>/SceneCompanion/`
2. Copy that folder anywhere on your computer (it does not need to be inside the project).
3. In Unreal: Edit › Plugins — make sure **Python Editor Script Plugin** is on (restart if you turned it on).
4. Tools › **Execute Python Script…** → pick `SceneCompanion/scene_companion_build.py`. It imports every GLB under
   `/Game/SceneCompanion/<scene>/` and places the level in the open map: models, basic shapes with a coloured material,
   lights, hidden collision boxes for Solids, a camera. Every actor is tagged `sc:<id>`; behaviors go to `<scene>.behaviors.json`.

Units and axes: Unreal is Z-up in centimetres; the exporter maps the game's (x, y, z) metres to Unreal's (z, x, y) × 100,
the same mapping Epic's own glTF code uses. Checked by running the script against a stand-in `unreal` module (positions,
children, collider heights, scales); **not run inside Unreal** — if models come in turned or mirrored, it is `ueVec` /
`ueQuat` in `runtime/engines.js`. A GLB with several meshes is placed as each of its meshes at the object's transform.
