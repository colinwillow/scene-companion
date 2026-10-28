// Shared by the engine exporters (Godot / Unity / Unreal): read a scene, resolve it (prefabs merged, the web variant
// picked, characters turned into their model variant), and read facts about its GLBs straight from the files.
import { readFileSync, existsSync } from 'node:fs';
import { mergeEntity } from '../runtime/prefabs.js';
import { characterVariant } from '../runtime/character.js';

export const rel = p => String(p).replace(/^\.\//, '');
const json = p => JSON.parse(readFileSync(rel(p), 'utf8'));

// ---- GLB facts read straight from the file: its bounds as authored (for `height`), and whether it is Draco
function glbJson(p) { const b = readFileSync(rel(p)); return JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12))); }
const mul = (a, b) => { const r = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return r; };
const trs = n => { if (n.matrix) return n.matrix; const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1]; };
const measured = new Map();
export function measure(p) {
  if (measured.has(p)) return measured.get(p);
  let r = null;
  try {
    const g = glbJson(p); let lo = Infinity, hi = -Infinity;
    const visit = (i, M) => { const n = g.nodes[i], W = mul(M, trs(n));
      if (n.mesh !== undefined) for (const pr of g.meshes[n.mesh].primitives) { const a = g.accessors[pr.attributes.POSITION]; if (!a?.min) continue;
        // a skinned mesh's vertices ignore its node (its bind pose is already world space in these exports)
        for (const cx of [a.min[0], a.max[0]]) for (const cy of [a.min[1], a.max[1]]) for (const cz of [a.min[2], a.max[2]]) {
          const y = n.skin !== undefined ? cy : W[1] * cx + W[5] * cy + W[9] * cz + W[13]; lo = Math.min(lo, y); hi = Math.max(hi, y); } }
      for (const c of n.children || []) visit(c, W); };
    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (const r0 of g.scenes?.[g.scene ?? 0]?.nodes || []) visit(r0, I);
    if (hi > lo) r = { minY: lo, height: hi - lo };
  } catch {}
  measured.set(p, r); return r;
}
export const isDraco = p => { try { return (glbJson(p).extensionsUsed || []).includes('KHR_draco_mesh_compression'); } catch { return false; } };

// ---- resolve: prefabs merged, the web variant picked, characters turned into their model variant
export function resolveScene(scene) {
const prefabCache = {};
const prefabOf = name => { const path = scene.prefabs?.[name] || `./prefabs/${name}.prefab.json`; return (prefabCache[name] ||= existsSync(rel(path)) ? json(path) : null); };
const variantOf = asset => { const a = typeof asset === 'string' ? scene.assets?.[asset] : asset, v = a?.variants?.web || a?.variants && Object.values(a.variants)[0];
  if (v?.character) { const ch = json(v.character); return characterVariant(ch, v); } return v || null; };
function resolve(e, prefix = '') {
  const pf = e.prefab ? prefabOf(e.prefab) : null, m = mergeEntity(pf, e);
  const kids = [...(pf?.children || []).map(c => ({ ...c, id: `${e.id}_${c.id}` })), ...(e.children || [])];
  return { ...m, id: prefix + e.id, variant: m.asset ? variantOf(m.asset) : null, children: kids.map(c => resolve(c)) };
}
return (scene.entities || []).map(e => resolve(e));
}
