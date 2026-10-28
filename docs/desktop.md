# Scene Companion desktop app (Tauri 2)

The same editor and game in a native window: **offline** (three.js is bundled), and **Save writes to your computer** —
`<Documents>/SceneCompanion/scenes/<name>.scene.json` — with no GitHub token. Saved scenes are at the top of the 🎬 picker (💾).

## Build it (Mac, Windows or Linux)
1. Install Rust (rustup.rs) and Node. On Linux also: `libwebkit2gtk-4.1-dev librsvg2-dev` (Mac and Windows need nothing else).
2. In the scene-companion folder: `npm run desktop:prepare` — copies the editor + assets into `desktop/dist` with three bundled.
3. `cd desktop/src-tauri && cargo install tauri-cli --version "^2" && cargo tauri build`
   → the installer is in `desktop/src-tauri/target/release/bundle/` (.dmg on a Mac, .msi / .exe on Windows, .deb / .AppImage on Linux).
   For a quick run without an installer: `cargo tauri dev`.
4. The icon is a placeholder (orange, a white play mark). For your own: `cargo tauri icon your-art.png` in `desktop/src-tauri`.

On a Mac the first launch of an unsigned app needs right-click › Open (signing needs an Apple Developer account).

## Projects: work on a folder on your computer
🎬 picker › **📁 Open project folder…** (or launch with `--project <folder>` / `SC_PROJECT=<folder>`). A project is any folder
laid out like this repo — `scenes/`, `prefabs/`, `assets/` … — e.g. a clone of one of your game repos. The window is then
served from that folder: its scenes are listed with 📁, its models and prefabs load from it, and **⇪ Save writes the scene
back into the folder** (only `scenes/*.json` and `prefabs/*.json` can be written). The editor's own code always comes from
the app, and anything the folder lacks (a model, the example scenes) falls back to the bundled copy.

## Ultra quality
The tier menu (and `play.html?tier=ultra`) has a third setting, **ultra** — the desktop app's default, remembered once picked:
everything the desktop tier has, plus soft shadows (4096 variance shadow maps), 8× anti-aliasing, full-resolution ambient
occlusion and bloom, and **screen-space reflections** on the objects a scene lists: `"post": { "reflect": ["plaza"] }`
(the kitchen sink's plaza). An asset can carry an `ultra` variant (a glossier material, a richer model); web and desktop
fall back to theirs. It is for a real GPU — on a phone it would be slow, which is why web stays the default there.

## What it adds over the web editor
- `save_scene` / `list_scenes` / `load_scene` (no project: <Documents>/SceneCompanion/scenes), `open_project` /
  `list_project_scenes` / `write_project_file` and the `project:` protocol (desktop/src-tauri/src/main.rs): the editor checks
  for `window.__TAURI__` and uses them for ⇪ Save and the 🎬 picker; on the web nothing changes.
- `SC_SELFTEST=1` makes the editor report what it loaded (and a test save) on stdout and quit — how it is checked headless.
- **The Blender bridge without `npm run dev`** (desktop/src-tauri/src/bridge.rs): with a project open, the app answers the
  add-on on `http://localhost:8080` itself — the add-on's default, so nothing to change in Blender. → Blender on an object
  queues it; Send Back in Blender saves the edit into the project's `assets/models/bridge/` and the editor swaps it in.
  (If `npm run dev` is already running on 8080 the app leaves the port to it. `SC_BRIDGE_PORT` picks another.)
