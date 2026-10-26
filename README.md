# Scene Companion (working name)

A visual editor that lives alongside AI-built Three.js games: vibe-code it, then click, drag and tune it — both ways, always in sync. See SPEC.md.

## Asset variants (scene `assets`)
- Primitive: `{ "primitive": "box|sphere|cylinder|capsule|plane", "size": [x,y,z], "color", "texture", ... }`
- Model: `{ "glb": "./assets/models/x.glb" }` plus one of
  - `"height": 1.75` — scale to that height and put the feet on the origin (characters)
  - `"scale": 2` or `[x,y,z]` — plain scale (props with a known size, e.g. Kenney tiles ≈ 1 m)
  - optional `"offset": [x,y,z]` — nudge in metres (e.g. sink a tile's base plate into the ground)
  - optional `"castShadow": false` — e.g. clouds
- Free CC0 models live in `assets/models/kenney/` (see its LICENSE.md). Kenney models have their origin at the bottom.

## Tests
`npm install` once (three as a dev dependency, same version as the CDN import map), then `npm test` — node's built-in runner, no browser.
Covers every behavior, prefab merging, the validator (including that it catches bad scenes), behavior purity, and World loading a scene with real three.
`npm run check` runs validate + tests. Add a test with every new behavior.

## Saving from the editor
**⇪ Save** commits the open scene to GitHub. First time it asks for `owner/repo`, branch and a fine-grained token
(github.com → Settings → Developer settings → Fine-grained tokens → only this repo → Contents: Read and write). The token stays on that device.
If the file changed on GitHub since you opened it (e.g. Claude pushed), it asks before overwriting. A 401/403 clears the token so you can enter a new one.
