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

## What it adds over the web editor
- `save_scene` / `list_scenes` / `load_scene` (desktop/src-tauri/src/main.rs): the editor checks for `window.__TAURI__`
  and uses them for ⇪ Save and the 🎬 picker; on the web nothing changes.
- Next (roadmap Desktop part 2): open any project folder, the Library reading its assets, the Blender bridge without the dev server.
