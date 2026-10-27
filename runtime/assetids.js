// Stable asset ids (pure): a registry { id: { path, sha } } and the reference rewrite that keeps scenes working when a file is
// renamed or moved. The tool (tools/assetids.mjs) does the file system; this does the logic so it can be tested.
export const ASSET_EXT = /\.(glb|gltf|mp3|ogg|wav|png|jpg|jpeg|webp|ktx2)$/i;

// registry: { id: { path, sha } }; files: [{ path, sha }] as they are now → { registry, moved: { oldPath: newPath }, added, gone }
export function reconcile(registry, files, newId) {
  const out = {}, moved = {}, added = [], gone = [];
  const byPath = new Map(files.map(f => [f.path, f])), bySha = new Map();
  for (const f of files) (bySha.get(f.sha) || bySha.set(f.sha, []).get(f.sha)).push(f);
  const claimed = new Set();
  for (const [id, e] of Object.entries(registry || {})) {
    if (byPath.has(e.path)) { out[id] = { path: e.path, sha: byPath.get(e.path).sha }; claimed.add(e.path); continue; }
    const twin = (bySha.get(e.sha) || []).find(f => !claimed.has(f.path) && !Object.values(registry).some(r => r.path === f.path));
    if (twin) { out[id] = { path: twin.path, sha: twin.sha }; moved[e.path] = twin.path; claimed.add(twin.path); }
    else gone.push(e.path);
  }
  for (const f of files) if (!claimed.has(f.path)) { const id = newId(); out[id] = { path: f.path, sha: f.sha }; added.push(f.path); claimed.add(f.path); }
  return { registry: out, moved, added, gone };
}

// every string in a JSON value that names a moved file (with or without "./") is rewritten → how many
export function rewriteRefs(json, moved) {
  let n = 0;
  const fix = v => { const bare = v.replace(/^\.\//, ''); return moved[bare] ? (v.startsWith('./') ? './' : '') + moved[bare] : null; };
  const walk = o => {
    if (Array.isArray(o)) o.forEach((v, i) => { if (typeof v === 'string') { const f = fix(v); if (f) { o[i] = f; n++; } } else if (v && typeof v === 'object') walk(v); });
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (typeof v === 'string') { const f = fix(v); if (f) { o[k] = f; n++; } } else if (v && typeof v === 'object') walk(v); }
  };
  walk(json);
  return n;
}
