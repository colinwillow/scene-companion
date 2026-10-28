// Scene Companion desktop: the web editor in a native window, offline (desktop/dist), plus what a browser cannot do —
// read and write a project folder on this computer. The editor calls these through window.__TAURI__.core.invoke (it
// checks for it; on the web nothing changes).
//
// A PROJECT is any folder laid out like the repo (scenes/, prefabs/, assets/ …). Opened, the window is served from it
// through the `project:` protocol: the folder's own files first, the editor's code (runtime/, behaviors/, vendor/, the
// pages) always from the app, and anything the folder lacks falls back to the bundled examples.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{http, Manager};

static PROJECT: Mutex<Option<PathBuf>> = Mutex::new(None);
const APP_OWN: &[&str] = &["runtime/", "behaviors/", "vendor/", "index.html", "play.html", "vfx.html", "spritebake.html"];

fn project() -> Option<PathBuf> { PROJECT.lock().unwrap().clone() }

/// The page URL of a file served from the project, in this platform's form for a custom protocol.
fn project_url(file: &str) -> String {
    if cfg!(any(windows, target_os = "android")) { format!("http://project.localhost/{file}") } else { format!("project://localhost/{file}") }
}

fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "html" => "text/html", "js" | "mjs" => "text/javascript", "json" => "application/json", "css" => "text/css",
        "glb" => "model/gltf-binary", "gltf" => "model/gltf+json", "bin" => "application/octet-stream", "wasm" => "application/wasm",
        "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "webp" => "image/webp", "ktx2" => "image/ktx2", "svg" => "image/svg+xml",
        "mp3" => "audio/mpeg", "ogg" => "audio/ogg", "wav" => "audio/wav", "md" => "text/markdown", _ => "application/octet-stream",
    }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) { out.push(v); i += 3; continue; }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A path inside the project: relative, no "..", no drive letters. None if it would leave the folder.
fn inside(root: &Path, rel: &str) -> Option<PathBuf> {
    let rel = rel.trim_start_matches('/');
    if rel.is_empty() || rel.contains("..") || rel.contains(':') || rel.starts_with('\\') { return None; }
    Some(root.join(rel))
}

fn respond(bytes: Vec<u8>, mime: &str, status: u16) -> http::Response<Vec<u8>> {
    http::Response::builder().status(status).header("Content-Type", mime).header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", "no-store").body(bytes).unwrap()
}

/// Open a folder as the project; the editor then reloads from project_url("index.html").
#[tauri::command]
fn open_project(path: String) -> Result<String, String> {
    let p = fs::canonicalize(&path).map_err(|e| format!("{path}: {e}"))?;
    if !p.is_dir() { return Err(format!("{path} is not a folder")); }
    *PROJECT.lock().unwrap() = Some(p);
    Ok(project_url("index.html"))
}

/// The open project folder, if any.
#[tauri::command]
fn project_root() -> Option<String> { project().map(|p| p.to_string_lossy().into_owned()) }

/// The project's scenes (scenes/*.scene.json), as ./scenes/<file> paths.
#[tauri::command]
fn list_project_scenes() -> Result<Vec<String>, String> {
    let root = project().ok_or("no project open")?;
    let mut v: Vec<String> = fs::read_dir(root.join("scenes")).map_err(|e| e.to_string())?
        .filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".scene.json")).map(|n| format!("./scenes/{n}")).collect();
    v.sort();
    Ok(v)
}

/// Write a scene or prefab back into the project: `rel` like "scenes/x.scene.json" (only scenes/ and prefabs/, .json).
#[tauri::command]
fn write_project_file(rel: String, contents: String) -> Result<String, String> {
    let root = project().ok_or("no project open")?;
    let ok = (rel.starts_with("scenes/") || rel.starts_with("prefabs/")) && rel.ends_with(".json");
    if !ok { return Err(format!("can only write scenes/*.json and prefabs/*.json, not {rel}")); }
    serde_json::from_str::<serde_json::Value>(&contents).map_err(|e| format!("not valid JSON: {e}"))?;
    let path = inside(&root, &rel).ok_or("that path leaves the project folder")?;
    if let Some(dir) = path.parent() { fs::create_dir_all(dir).map_err(|e| e.to_string())?; }
    fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Where scenes go with no project open: <Documents>/SceneCompanion/scenes
fn scenes_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let docs = app.path().document_dir().map_err(|e| e.to_string())?;
    let dir = docs.join("SceneCompanion").join("scenes");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Save a scene file with no project open. `name` is a bare file name, e.g. "tiny-hop.scene.json". Returns the full path.
#[tauri::command]
fn save_scene(app: tauri::AppHandle, name: String, json: String) -> Result<String, String> {
    let ok = !name.is_empty() && name.ends_with(".json") && !name.contains(['/', '\\']) && !name.contains("..");
    if !ok { return Err(format!("not a scene file name: {name}")); }
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| format!("not valid JSON: {e}"))?;
    let path = scenes_dir(&app)?.join(&name);
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// The scenes saved so far (file names), newest first.
#[tauri::command]
fn list_scenes(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let mut v: Vec<(std::time::SystemTime, String)> = fs::read_dir(scenes_dir(&app)?).map_err(|e| e.to_string())?
        .filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().ends_with(".json"))
        .map(|e| (e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH), e.file_name().to_string_lossy().into_owned()))
        .collect();
    v.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(v.into_iter().map(|(_, n)| n).collect())
}

/// Read back a saved scene.
#[tauri::command]
fn load_scene(app: tauri::AppHandle, name: String) -> Result<String, String> {
    if name.contains(['/', '\\']) || name.contains("..") { return Err("bad name".into()); }
    fs::read_to_string(scenes_dir(&app)?.join(name)).map_err(|e| e.to_string())
}

/// SC_SELFTEST=1: the editor reports what it saw (scene, objects, a test save) and the app prints it and exits.
#[tauri::command]
fn selftest_wanted() -> bool { std::env::var("SC_SELFTEST").is_ok() }
#[tauri::command]
fn selftest_report(app: tauri::AppHandle, report: String) {
    println!("SC_SELFTEST {report}");
    app.exit(0);
}

fn main() {
    // `--project <dir>` or SC_PROJECT opens a folder at launch
    let args: Vec<String> = std::env::args().collect();
    let start = args.iter().position(|a| a == "--project").and_then(|i| args.get(i + 1).cloned()).or_else(|| std::env::var("SC_PROJECT").ok());
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol("project", |ctx, req| {
            let path = percent_decode(req.uri().path().trim_start_matches('/'));
            let path = if path.is_empty() { "index.html".to_string() } else { path };
            if path.contains("..") { return respond(b"no".to_vec(), "text/plain", 403); }
            let own = APP_OWN.iter().any(|p| path == *p || path.starts_with(p));
            if !own {
                if let Some(f) = project().and_then(|r| inside(&r, &path)) {
                    if f.is_file() { if let Ok(b) = fs::read(&f) { return respond(b, mime(&path), 200); } }
                }
            }
            match ctx.app_handle().asset_resolver().get(path.clone()) {
                Some(a) => respond(a.bytes().to_vec(), a.mime_type(), 200),
                None => respond(format!("not found: {path}").into_bytes(), "text/plain", 404),
            }
        })
        .setup(move |app| {
            if let Some(dir) = start.clone() {
                match open_project(dir) {
                    Ok(url) => { if let Some(w) = app.get_webview_window("main") { let _ = w.navigate(url.parse().unwrap()); } }
                    Err(e) => eprintln!("Scene Companion: could not open the project: {e}"),
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![save_scene, list_scenes, load_scene, open_project, project_root, list_project_scenes,
            write_project_file, selftest_wanted, selftest_report])
        .run(tauri::generate_context!())
        .expect("error while running Scene Companion");
}
