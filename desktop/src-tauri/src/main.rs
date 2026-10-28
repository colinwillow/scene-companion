// Scene Companion desktop: the web editor in a native window, offline (desktop/dist), plus what a browser cannot do —
// write files. The editor calls these through window.__TAURI__.core.invoke (it checks for it; on the web nothing changes).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// Where saved scenes go: <Documents>/SceneCompanion/scenes
fn scenes_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let docs = app.path().document_dir().map_err(|e| e.to_string())?;
    let dir = docs.join("SceneCompanion").join("scenes");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Save a scene file. `name` is a bare file name (no folders), e.g. "tiny-hop.scene.json". Returns the full path.
#[tauri::command]
fn save_scene(app: tauri::AppHandle, name: String, json: String) -> Result<String, String> {
    let ok = !name.is_empty() && name.ends_with(".json") && !name.contains(['/', '\\']) && !name.contains("..");
    if !ok {
        return Err(format!("not a scene file name: {name}"));
    }
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| format!("not valid JSON: {e}"))?;
    let path = scenes_dir(&app)?.join(&name);
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// The scenes saved so far (file names), newest first.
#[tauri::command]
fn list_scenes(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let mut v: Vec<(std::time::SystemTime, String)> = fs::read_dir(scenes_dir(&app)?)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().ends_with(".json"))
        .map(|e| (e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH), e.file_name().to_string_lossy().into_owned()))
        .collect();
    v.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(v.into_iter().map(|(_, n)| n).collect())
}

/// Read back a saved scene.
#[tauri::command]
fn load_scene(app: tauri::AppHandle, name: String) -> Result<String, String> {
    if name.contains(['/', '\\']) || name.contains("..") {
        return Err("bad name".into());
    }
    fs::read_to_string(scenes_dir(&app)?.join(name)).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![save_scene, list_scenes, load_scene])
        .run(tauri::generate_context!())
        .expect("error while running Scene Companion");
}
