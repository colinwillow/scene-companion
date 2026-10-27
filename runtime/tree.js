// Nested entities: any entity may have `children: [entity…]`, with position/rotation/scale relative to its parent.
// Ids stay unique across the whole scene. These helpers let editing code treat the tree like the old flat list.
// Pure (no three/DOM).

// Depth-first over a list of authored entities. fn(entity, { parent, list, index, depth }) — return false to skip children.
export function walkEntities(list = [], fn, parent = null, depth = 0) {
  list.forEach((e, index) => {
    if (fn(e, { parent, list, index, depth }) !== false && Array.isArray(e.children)) walkEntities(e.children, fn, e, depth + 1);
  });
}

// Every authored entity, parents before their children.
export function allEntities(data) {
  const out = [];
  walkEntities(data?.entities, e => { out.push(e); });
  return out;
}

// → { entity, parent, list, index, depth } or null. `list` is the array holding it (data.entities or parent.children).
export function findEntity(data, id) {
  let hit = null;
  walkEntities(data?.entities, (e, at) => { if (!hit && e.id === id) hit = { entity: e, ...at }; return !hit; });
  return hit;
}

// Ids under an entity (not including itself), e.g. to select or delete a subtree.
export function descendantIds(entity) {
  const out = [];
  walkEntities(entity?.children, e => { out.push(e.id); });
  return out;
}

// Prefab children become part of each instance; their ids get the instance id in front so two instances never clash.
//   prefab child "blade" on instance "goblin_01" → "goblin_01_blade"
export const childIdFor = (parentId, childId) => `${parentId}_${childId}`;

// Tags: authored `tags` (list of strings) plus the prefab's, without repeats.
export const mergeTags = (...lists) => [...new Set(lists.flat().filter(t => typeof t === 'string' && t))];

// world.find() query matching. q: 'tag' | { tag, prefab, id, near: [x, y, z], radius } | (ent) => bool
// ent: { id, tags, prefab, position: [x, y, z] }
export function matchesQuery(ent, q) {
  if (typeof q === 'function') return !!q(ent);
  if (typeof q === 'string') return (ent.tags || []).includes(q);
  if (!q || typeof q !== 'object') return false;
  if (q.tag && !(ent.tags || []).includes(q.tag)) return false;
  if (q.prefab && ent.prefab !== q.prefab) return false;
  if (q.id && ent.id !== q.id) return false;
  if (q.near) {
    const p = ent.position || [0, 0, 0];
    if (Math.hypot(p[0] - q.near[0], p[1] - q.near[1], p[2] - q.near[2]) > (q.radius ?? 1)) return false;
  }
  return true;
}

// Runtime id for a spawned entity: "<base>_s1", "_s2"… (the s marks it runtime-only). `seq` ({ base: lastN }) makes
// ids never repeat within a Play, so a behavior holding an old id never finds a different, newer copy under it.
export function spawnId(taken, base, seq = {}) {
  let n = (seq[base] || 0) + 1;
  while (taken.has(`${base}_s${n}`)) n++;
  seq[base] = n;
  return `${base}_s${n}`;
}

// ---- re-parenting that keeps where things are on screen.
// Transforms are { p: [x,y,z], q: [x,y,z,w], s: [x,y,z] }; rotations in scene files are degrees, Euler XYZ (three's
// default). Non-uniform scale under a rotated parent can't be kept exactly (it would shear); scale is divided per axis.
const D = Math.PI / 180;
export function quatFromEuler([x = 0, y = 0, z = 0] = []) {
  const [c1, c2, c3] = [Math.cos(x * D / 2), Math.cos(y * D / 2), Math.cos(z * D / 2)];
  const [s1, s2, s3] = [Math.sin(x * D / 2), Math.sin(y * D / 2), Math.sin(z * D / 2)];
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}
export function eulerFromQuat([x, y, z, w]) {   // → degrees, XYZ
  const m11 = 1 - 2 * (y * y + z * z), m12 = 2 * (x * y - w * z), m13 = 2 * (x * z + w * y);
  const m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - w * x), m32 = 2 * (y * z + w * x), m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
  const [ex, ez] = Math.abs(m13) < 0.9999999 ? [Math.atan2(-m23, m33), Math.atan2(-m12, m11)] : [Math.atan2(m32, m22), 0];
  return [ex / D, ey / D, ez / D];
}
const qmul = ([ax, ay, az, aw], [bx, by, bz, bw]) => [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
const qconj = ([x, y, z, w]) => [-x, -y, -z, w];
const qrot = (q, [x, y, z]) => qmul(qmul(q, [x, y, z, 0]), qconj(q)).slice(0, 3);
const local = e => ({ p: e.position || [0, 0, 0], q: quatFromEuler(e.rotation), s: e.scale || [1, 1, 1] });
const IDENT = { p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
const compose = (P, L) => ({ p: qrot(P.q, L.p.map((v, i) => v * P.s[i])).map((v, i) => v + P.p[i]), q: qmul(P.q, L.q), s: L.s.map((v, i) => v * P.s[i]) });
const relativeTo = (P, W) => ({ p: qrot(qconj(P.q), W.p.map((v, i) => v - P.p[i])).map((v, i) => v / (P.s[i] || 1)), q: qmul(qconj(P.q), W.q), s: W.s.map((v, i) => v / (P.s[i] || 1)) });

// An authored entity's world transform (its parents' transforms applied).
export function worldTransform(data, id) {
  const chain = [];
  for (let hit = findEntity(data, id); hit; hit = hit.parent ? findEntity(data, hit.parent.id) : null) chain.unshift(hit.entity);
  return chain.reduce((acc, e) => compose(acc, local(e)), IDENT);
}

// Move entity `id` under `parentId` (null = top level) without moving it in the world. Throws on a loop.
// → the entity. Values are rounded to 0.1 mm / 0.01°; identity rotation and scale are left out of the file.
export function reparent(data, id, parentId = null) {
  const hit = findEntity(data, id);
  if (!hit) throw new Error(`No entity "${id}"`);
  const target = parentId ? findEntity(data, parentId) : null;
  if (parentId && !target) throw new Error(`No entity "${parentId}"`);
  if (parentId === id || (parentId && descendantIds(hit.entity).includes(parentId))) throw new Error(`can't put ${id} inside itself`);
  if ((hit.parent?.id ?? null) === (parentId ?? null)) return hit.entity;
  const W = worldTransform(data, id), P = parentId ? worldTransform(data, parentId) : IDENT, L = relativeTo(P, W);
  hit.list.splice(hit.index, 1);
  if (hit.parent && !hit.parent.children.length) delete hit.parent.children;
  const e = hit.entity, r = (v, k) => Math.round(v * k) / k;
  e.position = L.p.map(v => r(v, 1e4) + 0);
  const rot = eulerFromQuat(L.q).map(v => r(v, 100) + 0), scl = L.s.map(v => r(v, 1e4) + 0);
  if (rot.some(v => v)) e.rotation = rot; else delete e.rotation;
  if (scl.some(v => v !== 1)) e.scale = scl; else delete e.scale;
  if (target) (target.entity.children ||= []).push(e); else data.entities.push(e);
  return e;
}
