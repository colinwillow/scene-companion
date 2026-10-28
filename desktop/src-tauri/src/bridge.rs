// The Blender bridge inside the desktop app: the same HTTP routes the dev server answers (tools/dev-server.mjs), on
// 127.0.0.1:8080 — the add-on's default — so tools/blender/scene_companion_bridge.py works with no `npm run dev`.
//   GET  /bridge/inbox    Blender takes the queue (its heartbeat)      GET /bridge/status  { blender, queued }
//   POST /bridge/send     a job { id, glb, scene, prefab? } (the editor uses the bridge_send command instead)
//   POST /bridge/return?id=&scene=&prefab=   the edited GLB → <project>/assets/models/bridge/<id|prefab>-<n>.glb
//                         (prefab: its prefabs/<name>.prefab.json points at it), then the editor hears "bridge-return"
//   GET  /<path>          a project file (how Blender downloads the model), else the bundled copy
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct Bridge { queue: Vec<Value>, last_poll: Option<Instant>, jobs: HashMap<String, Value> }
pub type Shared = Arc<Mutex<Bridge>>;

fn id_ok(s: &str) -> bool { !s.is_empty() && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') }

/// Queue a job for Blender (validated like the dev server does).
pub fn send(b: &Shared, root: Option<PathBuf>, job: Value) -> Result<Value, String> {
    let id = job["id"].as_str().unwrap_or("");
    let glb = job["glb"].as_str().unwrap_or("");
    if !id_ok(id) || !glb.to_ascii_lowercase().ends_with(".glb") || glb.contains("..") { return Err("need id and a .glb path".into()); }
    if let Some(p) = job["prefab"].as_str().filter(|p| !p.is_empty()) {
        let ok = id_ok(p) && root.map(|r| r.join("prefabs").join(format!("{p}.prefab.json")).is_file()).unwrap_or(false);
        if !ok { return Err(format!("no prefabs/{p}.prefab.json in the project")); }
    }
    let mut j = json!({ "id": id, "glb": glb, "scene": job["scene"].as_str().unwrap_or("") });
    if let Some(p) = job["prefab"].as_str().filter(|p| !p.is_empty()) { j["prefab"] = json!(p); }
    let mut g = b.lock().unwrap();
    g.queue.retain(|q| q["id"] != j["id"]);
    g.queue.push(j.clone());
    g.jobs.insert(id.to_string(), j);
    let on = g.last_poll.map(|t| t.elapsed().as_secs_f32() < 5.0).unwrap_or(false);
    Ok(json!({ "queued": true, "blender": on }))
}

pub fn status(b: &Shared) -> Value {
    let g = b.lock().unwrap();
    json!({ "blender": g.last_poll.map(|t| t.elapsed().as_secs()), "queued": g.queue.len() })
}

fn reply(req: tiny_http::Request, code: u16, body: Vec<u8>, mime: &str) {
    let h = tiny_http::Header::from_bytes(&b"Content-Type"[..], mime.as_bytes()).unwrap();
    let _ = req.respond(tiny_http::Response::from_data(body).with_status_code(code).with_header(h));
}
fn reply_json(req: tiny_http::Request, code: u16, v: Value) { reply(req, code, v.to_string().into_bytes(), "application/json"); }

fn query(url: &str) -> HashMap<String, String> {
    url.split_once('?').map(|(_, q)| q.split('&').filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_string(), crate::percent_decode(&v.replace('+', " ")))).collect()).unwrap_or_default()
}

/// Save an edited GLB back into the project (and point a prefab at it); → the editor's bridge-return payload.
fn take_return(b: &Shared, root: &PathBuf, q: &HashMap<String, String>, glb: &[u8]) -> Result<Value, String> {
    let id = q.get("id").cloned().unwrap_or_default();
    if !id_ok(&id) { return Err("bad id".into()); }
    if glb.len() < 4 || &glb[..4] != b"glTF" { return Err("not a GLB".into()); }
    let job = b.lock().unwrap().jobs.get(&id).cloned().unwrap_or(json!({}));
    let prefab = q.get("prefab").filter(|p| !p.is_empty()).cloned().or_else(|| job["prefab"].as_str().map(String::from)).unwrap_or_default();
    let pf_file = root.join("prefabs").join(format!("{prefab}.prefab.json"));
    let mut pf: Option<Value> = None;
    if !prefab.is_empty() {
        if !id_ok(&prefab) || !pf_file.is_file() { return Err(format!("no prefabs/{prefab}.prefab.json")); }
        pf = Some(serde_json::from_str(&fs::read_to_string(&pf_file).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?);
    }
    let base = if prefab.is_empty() { id.clone() } else { prefab.clone() };
    let dir = root.join("assets/models/bridge");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut n = 1;
    while dir.join(format!("{base}-{n}.glb")).exists() { n += 1; }
    fs::write(dir.join(format!("{base}-{n}.glb")), glb).map_err(|e| e.to_string())?;
    let path = format!("./assets/models/bridge/{base}-{n}.glb");
    if let Some(mut p) = pf {                       // every instance of the prefab gets the edit
        let web = if p["asset"]["variants"].is_object() { p["asset"]["variants"]["web"].clone() } else { p["asset"].clone() };
        let mut web = if web.is_object() { web } else { json!({}) };
        web["glb"] = json!(path);
        p["asset"] = json!({ "variants": { "web": web } });
        fs::write(&pf_file, serde_json::to_string_pretty(&p).unwrap() + "\n").map_err(|e| e.to_string())?;
    }
    let scene = q.get("scene").filter(|s| !s.is_empty()).cloned().or_else(|| job["scene"].as_str().map(String::from)).unwrap_or_default();
    let mut msg = json!({ "type": "bridge-return", "id": id, "glb": path, "scene": scene });
    if !prefab.is_empty() { msg["prefab"] = json!(prefab); }
    Ok(msg)
}

/// Start the server (a thread). If the port is taken — `npm run dev` already running — the app simply doesn't serve it.
pub fn start(app: AppHandle, b: Shared, port: u16) {
    let server = match tiny_http::Server::http(("127.0.0.1", port)) {
        Ok(s) => s,
        Err(e) => { eprintln!("Scene Companion: Blender bridge not started on {port}: {e}"); return; }
    };
    std::thread::spawn(move || {
        for mut req in server.incoming_requests() {
            let url = req.url().to_string();
            let path = url.split('?').next().unwrap_or("").to_string();
            let post = *req.method() == tiny_http::Method::Post;
            match (post, path.as_str()) {
                (false, "/bridge/status") => { let v = status(&b); reply_json(req, 200, v); }
                (false, "/bridge/inbox") => {
                    let q = { let mut g = b.lock().unwrap(); g.last_poll = Some(Instant::now()); std::mem::take(&mut g.queue) };
                    reply_json(req, 200, Value::Array(q));
                }
                (true, "/bridge/send") => {
                    let mut s = String::new(); let _ = req.as_reader().take(100_000).read_to_string(&mut s);
                    match serde_json::from_str::<Value>(&s).map_err(|e| e.to_string()).and_then(|j| send(&b, crate::project(), j)) {
                        Ok(v) => reply_json(req, 200, v), Err(e) => reply_json(req, 400, json!({ "error": e })) }
                }
                (true, "/bridge/return") => {
                    let mut glb = Vec::new(); let _ = req.as_reader().take(60_000_000).read_to_end(&mut glb);
                    let res = crate::project().ok_or_else(|| "open a project folder in Scene Companion first".to_string())
                        .and_then(|root| take_return(&b, &root, &query(&url), &glb));
                    match res {
                        Ok(msg) => { let _ = app.emit("bridge-return", msg.clone()); reply_json(req, 200, json!({ "saved": msg["glb"], "bytes": glb.len() })); }
                        Err(e) => reply_json(req, 400, json!({ "error": e })),
                    }
                }
                (false, p) => {                       // a file: the project's, else the bundled copy
                    let rel = crate::percent_decode(p.trim_start_matches('/'));
                    let from_project = crate::project().and_then(|r| crate::inside(&r, &rel)).filter(|f| f.is_file()).and_then(|f| fs::read(f).ok());
                    match from_project.or_else(|| app.asset_resolver().get(rel.clone()).map(|a| a.bytes().to_vec())) {
                        Some(bytes) => reply(req, 200, bytes, crate::mime(&rel)),
                        None => reply_json(req, 404, json!({ "error": format!("not found: {rel}") })),
                    }
                }
                _ => reply_json(req, 404, json!({ "error": "unknown bridge route" })),
            }
        }
    });
}
