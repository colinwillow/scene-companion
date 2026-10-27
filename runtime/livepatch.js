// Hot-patch a running World from new scene data (sent by the editor over the live link). No three/DOM.
// Returns 'rebuild' when the change can't be patched in place (objects added/removed, assets, prefabs, settings),
// otherwise 'patched' or 'none'. Only fields that changed since `prev` are applied, so a running game's
// runtime state (where the player walked to) isn't reset by unrelated edits.
import { mergeEntity } from './prefabs.js';

const DEG = Math.PI / 180;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function applyScene(world, prev, next) {
  if (!prev) return 'rebuild';
  const ids = d => (d.entities || []).map(e => e.id);
  if (!same(ids(prev), ids(next)) || !same(prev.assets, next.assets) || !same(prev.prefabs, next.prefabs) || !same(prev.settings, next.settings))
    return 'rebuild';
  let changed = false;
  const before = new Map(prev.entities.map(e => [e.id, e]));
  for (const authored of next.entities) {
    const old = before.get(authored.id);
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
    ent.data = authored;
  }
  return changed ? 'patched' : 'none';
}
