// About how many draw calls a scene will cost, before it is played (validate warns over the budget). Pure.
// Each entity: { id, prims, mats, parts, batched, staticKey } — `prims` its mesh primitives, `mats` its distinct materials,
// `parts` the primitives that stay separate when batched (moving parts), `batched` (a Batch behavior), and `staticKey` when
// it is a static prop that World.instanceStatic can instance (same key ×4 or more → drawn once). Shadows draw it again.
export function estimateDraws(list, { shadows = true, instanceMin = 4 } = {}) {
  const groups = new Map(); let total = 0; const by = [];
  for (const e of list) if (e.staticKey) groups.set(e.staticKey, (groups.get(e.staticKey) || 0) + 1);
  const counted = new Set();
  for (const e of list) {
    if (e.staticKey && groups.get(e.staticKey) >= instanceMin) {
      if (counted.has(e.staticKey)) continue;
      counted.add(e.staticKey);
    }
    const d = e.batched ? e.mats + e.parts : e.prims;
    total += d; by.push([e.id, d]);
  }
  by.sort((a, b) => b[1] - a[1]);
  return { draws: total * (shadows ? 2 : 1), top: by.slice(0, 3) };
}

// A GLB's draw facts from its JSON chunk: { prims, mats, parts } (`parts`: primitives under nodes with door / breakable extras)
export function glbDrawFacts(json) {
  const nodes = json.nodes || [], meshes = json.meshes || [], parent = {};
  nodes.forEach((n, i) => (n.children || []).forEach(c => { parent[c] = i; }));
  const under = (i, f) => { for (let k = i; k !== undefined; k = parent[k]) if (f(nodes[k])) return true; return false; };
  let prims = 0, parts = 0; const mats = new Set();
  nodes.forEach((n, i) => {
    if (n.mesh === undefined || /^col_/.test(n.name || '') || n.extras?.collider) return;
    const ps = meshes[n.mesh]?.primitives || []; prims += ps.length;
    if (under(i, x => x.extras?.door)) parts += ps.length;   // doors, shutters, lids move: one draw each (walls, glass and AC units are batched)
    else ps.forEach(p => mats.add(p.material ?? -1));
  });
  return { prims, mats: mats.size, parts };
}
