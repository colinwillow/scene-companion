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

## Unreal
Not built yet (next): a Python editor script that imports the GLBs and places the actors.
