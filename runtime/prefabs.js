// Prefabs: reusable entity templates. A scene entity with "prefab": "enemy"
// starts from prefabs/enemy.prefab.json and overrides only what it lists.
//
// Merge rules (no three, so the validator and a native runtime can share this):
//  - top-level fields (asset, animation, rotation, scale…): entity wins
//  - behaviors: matched by type; entity params merge over prefab params;
//    entity behaviors with a new type are appended
//  - "removeBehaviors": ["Patrol"] drops prefab behaviors by type

export function mergeEntity(prefab, entity) {
  if (!prefab) return entity;
  const { behaviors: pb = [], ...pRest } = structuredClone(prefab);
  const { behaviors: eb = [], removeBehaviors = [], ...eRest } = entity;
  const behaviors = pb.filter(b => !removeBehaviors.includes(b.type));
  for (const b of eb) {
    const match = behaviors.find(x => x.type === b.type);
    if (match) match.params = { ...(match.params || {}), ...(b.params || {}) };
    else behaviors.push(structuredClone(b));
  }
  return { ...pRest, ...eRest, behaviors };
}

// Write one behavior param as an override on the authored entity
// (never touches the prefab file).
export function setOverride(entity, type, key, value) {
  entity.behaviors ||= [];
  let b = entity.behaviors.find(x => x.type === type);
  if (!b) { b = { type, params: {} }; entity.behaviors.push(b); }
  (b.params ||= {})[key] = value;
}
