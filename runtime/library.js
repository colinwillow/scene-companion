// Libraries panel: sort what can be added into Characters and Props. Pure (no three/DOM) so it's testable.
//   libraryGroups({ name: prefabJson }, scene) → { characters: [{ kind, name }], props: [{ kind, name }] }
// kind is 'prefab' or 'asset'. A prefab is a character if it plays an animation or moves on its own
// (Chase/Patrol/PlayerController/Animator); a scene asset is one if an entity using it has an animation or Animator.
const MOVERS = new Set(['Chase', 'Patrol', 'PlayerController', 'Animator']);
const isMover = e => !!e?.animation || (e?.behaviors || []).some(b => MOVERS.has(b.type));

export function libraryGroups(prefabs = {}, scene = {}) {
  const out = { characters: [], props: [] };
  for (const [name, p] of Object.entries(prefabs).sort(([a], [b]) => a.localeCompare(b)))
    if (p) out[isMover(p) ? 'characters' : 'props'].push({ kind: 'prefab', name });
  const animated = new Set((scene.entities || []).filter(e => typeof e.asset === 'string' && isMover(e)).map(e => e.asset));
  for (const name of Object.keys(scene.assets || {}).sort()) {
    if (name === 'ground') continue;
    out[animated.has(name) ? 'characters' : 'props'].push({ kind: 'asset', name });
  }
  return out;
}

// Case-insensitive filter on name; clips (motions) filter the same way.
export const filterNames = (items, q) => (q ? items.filter(i => (i.name ?? i).toLowerCase().includes(q.toLowerCase())) : items);
