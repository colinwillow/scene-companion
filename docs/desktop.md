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

## What it adds over the web editor
- `save_scene` / `list_scenes` / `load_scene` (no project: <Documents>/SceneCompanion/scenes), `open_project` /
  `list_project_scenes` / `write_project_file` and the `project:` protocol (desktop/src-tauri/src/main.rs): the editor checks
  for `window.__TAURI__` and uses them for ⇪ Save and the 🎬 picker; on the web nothing changes.
- `SC_SELFTEST=1` makes the editor report what it loaded (and a test save) on stdout and quit — how it is checked headless.
- Next (roadmap Desktop part 2b): the Blender bridge without the dev server.
