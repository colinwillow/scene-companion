# Scene Companion (working name)

A visual editor that lives alongside AI-built Three.js games: vibe-code it, then click, drag and tune it — both ways, always in sync. See SPEC.md.

## Asset variants (scene `assets`)
- Primitive: `{ "primitive": "box|sphere|cylinder|capsule|plane", "size": [x,y,z], "color", "texture", ... }`
- Model: `{ "glb": "./assets/models/x.glb" }` plus one of
  - `"height": 1.75` — scale to that height and put the feet on the origin (characters)
  - `"scale": 2` or `[x,y,z]` — plain scale (props with a known size, e.g. Kenney tiles ≈ 1 m)
  - optional `"offset": [x,y,z]` — nudge in metres (e.g. sink a tile's base plate into the ground)
- Free CC0 models live in `assets/models/kenney/` (see its LICENSE.md). Kenney models have their origin at the bottom.
