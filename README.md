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

## Live editing (dev server)
`npm install` then `npm run dev`. Open the editor on your computer (`/index.html?scene=./scenes/tiny-hop.scene.json`) and the game on your phone
(`http://<computer-ip>:8080/play.html`, same Wi-Fi). Moves, slider tweaks and animation changes apply instantly; adding/removing objects or
swapping models restarts the game with the new scene. Nothing is saved until you press ⇪ Save.

## Claude in the editor (MCP server)
1. `npm run dev`, then open the editor (`/index.html`, phone or computer) and leave it open.
2. Claude Code picks up `.mcp.json` in this repo (server `scene-companion` → `node tools/mcp-server.mjs`). Point it elsewhere with `SC_DEV_URL=ws://<host>:<port>/live`.
3. Tools: `list_entities`, `get_entity`, `list_library`, `get_selection`, `select`, `spawn`, `move`, `delete`, `attach_behavior`, `set_param`, `remove_behavior`, `set_animation`, `batch` (many edits, one rebuild — use it to lay out a level), `play`, `stop`, `screenshot`, `read_errors`, `new_scene` (fresh scene from a template), `save_scene`.

No editor open? The MCP server starts the dev server if needed and opens a headless editor itself (needs `playwright`: `npm i -D playwright && npx playwright install chromium`; `SC_HEADLESS=off` to disable, `SC_SCENE=./scenes/x.scene.json` to pick the scene). Software rendering is slow: adding objects can take a while there.

**Finish-line test:** `scenes/sky-steps.scene.json` (play it at `play.html?scene=./scenes/sky-steps.scene.json`) was built entirely through MCP calls — replay them with `node tools/mcp-replay.mjs tests/finish-line/sky-steps.calls.json` (delete the scene file first; ~4 min headless).

Edits go through `runtime/commands.js` (schema-checked, all-or-nothing), are undoable in the editor, and stream to running games over the live link. `save_scene` writes the scene file into `scenes/`; run `npm run check` and commit after.
