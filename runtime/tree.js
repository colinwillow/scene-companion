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
