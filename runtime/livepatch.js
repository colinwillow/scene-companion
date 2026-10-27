// Hot-patch a running World from new scene data (sent by the editor over the live link). No three/DOM.
// Returns 'rebuild' when the change can't be patched in place (objects added/removed, assets, prefabs, settings),
// otherwise 'patched' or 'none'. Only fields that changed since `prev` are applied, so a running game's
// runtime state (where the player walked to) isn't reset by unrelated edits.
import { mergeEntity } from './prefabs.js';
import { allEntities, walkEntities } from './tree.js';

const DEG = Math.PI / 180;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function applyScene(world, prev, next) {
  if (!prev) return 'rebuild';
  // Ids with their parent, so moving an entity under another parent also rebuilds.
  const ids = d => { const out = []; walkEntities(d.entities, (e, { parent }) => { out.push(`${parent?.id ?? ''}/${e.id}`); }); return out.sort(); };
  if (!same(ids(prev), ids(next)) || !same(prev.assets, next.assets) || !same(prev.prefabs, next.prefabs) || !same(prev.settings, next.settings))
    return 'rebuild';
  let changed = false;
  const strip = e => { const { children, ...rest } = e; return rest; };   // a child's edit is patched on the child itself
  const before = new Map(allEntities(prev).map(e => [e.id, strip(e)]));
  for (const full of allEntities(next)) {
    const authored = strip(full), old = before.get(authored.id);
    if (same(old, authored)) continue;
    const ent = world.getEntity(authored.id);
    if (!ent) return 'rebuild';
    if (!same(old.asset, authored.asset) || !same(old.prefab, authored.prefab) || !same(old.light, authored.light) || !same(old.removeBehaviors, authored.removeBehaviors)) return 'rebuild';
    const o = ent.object3d;
    let moved = false;
    if (!same(old.position, authored.position) && authored.position) { [o.position.x, o.position.y, o.position.z] = authored.position; changed = moved = true; }
    if (!same(old.rotation, authored.rotation) && authored.rotation) { [o.rotation.x, o.rotation.y, o.rotation.z] = authored.rotation.map(d => d * DEG); changed = true; }
    if (!same(old.scale, authored.scale) && authored.scale) { [o.scale.x, o.scale.y, o.scale.z] = authored.scale; changed = moved = true; }
    if (!same(old.animation, authored.animation) && authored.animation) { ent.anim?.play(authored.animation); changed = true; }
    // Behaviors: same list of types → push changed params live; otherwise rebuild.
    const pf = world.prefabs?.[authored.prefab];
    const oldB = (authored.prefab ? mergeEntity(pf, old) : old).behaviors || [];
    const newB = (authored.prefab ? mergeEntity(pf, authored) : authored).behaviors || [];
    if (!same(oldB.map(b => b.type), newB.map(b => b.type))) return 'rebuild';
    newB.forEach((b, i) => {
      const live = ent.behaviors.find(x => x.constructor.name === b.type) ?? ent.behaviors[i];
      for (const [k, v] of Object.entries(b.params || {}))
        if (!same(oldB[i].params?.[k], v)) { live?.onParamChanged(k, structuredClone(v)); changed = true; }
    });
    if (moved) ent.behaviors.forEach(b => b.onMoved?.());   // e.g. Bob re-reads its base height, Squash its scale
    ent.data = full;
  }
  return changed ? 'patched' : 'none';
}

// The editor's version: also handles objects ADDED or REMOVED (duplicate, delete, add, undo/redo of those) in place —
// destroy the removed, build only the new (world.add), then patch the rest — instead of rebuilding the whole World,
// which re-builds every model, look and shadow. Falls back to 'rebuild' for anything else structural (re-parenting,
// assets/settings changes, lights coming or going, prefab files changing). Async because building a model is.
export async function patchScene(world, prev, next) {
  if (!prev || !world.add) return 'rebuild';
  const withParent = d => { const m = new Map(); walkEntities(d.entities, (e, { parent }) => m.set(e.id, { e, parent: parent?.id ?? null })); return m; };
  const P = withParent(prev), N = withParent(next);
  const removed = [...P.keys()].filter(id => !N.has(id)), added = [...N.keys()].filter(id => !P.has(id));
  const moved = [...N.keys()].filter(id => P.has(id) && P.get(id).parent !== N.get(id).parent);
  if (!removed.length && !added.length && !moved.length) return applyScene(world, prev, next);
  if (!same(prev.assets, next.assets) || !same(prev.settings, next.settings)) return 'rebuild';
  const prefabsOk = Object.entries(prev.prefabs || {}).every(([k, v]) => same(next.prefabs?.[k], v));     // only new prefabs listed
  if (!prefabsOk) return 'rebuild';
  if ([...removed.map(id => P.get(id).e), ...added.map(id => N.get(id).e)].some(e => e.light)) return 'rebuild';   // the editor draws light markers at build
  world.data = next;
  for (const [k, url] of Object.entries(next.prefabs || {})) if (!prev.prefabs?.[k] && typeof url === 'object') (world.prefabs ||= {})[k] = url;
  // remove roots of removed subtrees (children go with them)
  for (const id of removed) if (!removed.includes(P.get(id).parent)) world.destroy(id);
  // re-parent: move the object under its new parent (its scene-file transform is already relative to it — tree.reparent)
  for (const id of moved) {
    const ent = world.getEntity(id), np = N.get(id).parent, host = np ? world.getEntity(np) : null;
    if (!ent || (np && !host) || ent.inherited) return 'rebuild';
    (host ? host.object3d : world.scene).add(ent.object3d);
    const old = ent.parent && world.getEntity(ent.parent); if (old) old.children = old.children.filter(c => c !== id);
    ent.parent = np; if (host) host.children.push(id);
    const depth = (x, d) => { x.depth = d; x.children.forEach(c => { const k = world.getEntity(c); if (k) depth(k, d + 1); }); };
    depth(ent, host ? host.depth + 1 : 0);
  }
  // add roots of new subtrees (world.add builds their authored children too)
  for (const id of added) {
    const { e, parent } = N.get(id);
    if (added.includes(parent)) continue;
    try { await world.add(e, parent); } catch { return 'rebuild'; }
  }
  // the rest (moves, params…): compare `next` against itself with each pre-existing entity's OLD fields swapped in,
  // so the structure matches and only real edits show (new entities compare equal to themselves).
  const keep = structuredClone(next);
  walkEntities(keep.entities, x => {
    const old = P.get(x.id)?.e; if (!old) return;
    for (const k of Object.keys(x)) if (k !== 'children') delete x[k];
    for (const [k, v] of Object.entries(old)) if (k !== 'children') x[k] = structuredClone(v);
  });
  const r = applyScene(world, keep, next);
  if (r === 'rebuild') return 'rebuild';
  for (const id of moved) {   // re-apply the (re-based) transform even if the numbers happen to be equal
    const ent = world.getEntity(id), e = N.get(id).e, o = ent.object3d;
    if (e.position) o.position.fromArray?.(e.position) ?? ([o.position.x, o.position.y, o.position.z] = e.position);
    if (e.rotation) [o.rotation.x, o.rotation.y, o.rotation.z] = e.rotation.map(d => d * DEG);
    if (e.scale) [o.scale.x, o.scale.y, o.scale.z] = e.scale;
    ent.behaviors.forEach(b => b.onMoved?.());
  }
  return 'patched';
}
