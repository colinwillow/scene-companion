// Scene-data edits the editor (and later the MCP server) make. Pure data, no three/DOM.

const r3 = v => Math.round(v * 1000) / 1000;

// "crate" + existing ["crate_01", "crate_02"] → "crate_03". Bases are cleaned to lowercase_with_underscores.
export function nextId(existingIds, base) {
  const clean = String(base).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/_\d+$/, '').replace(/^_+|_+$/g, '') || 'object';
  const ids = new Set(existingIds);
  let max = 0;
  for (const id of ids) {
    const m = id.match(new RegExp(`^${clean}_(\\d+)$`));
    if (m) max = Math.max(max, +m[1]);
  }
  let n = max + 1, id;
  do id = `${clean}_${String(n++).padStart(2, '0')}`; while (ids.has(id));
  return id;
}

const ids = data => data.entities.map(e => e.id);

// Add a new entity from a prefab ({ prefab: 'coin' }) or a scene asset ({ asset: 'crate' }) at a position.
export function addEntity(data, source, position = [0, 0, 0]) {
  const base = source.prefab || source.asset;
  if (!base) throw new Error('addEntity needs a prefab or an asset');
  const e = { id: nextId(ids(data), base), ...(source.prefab ? { prefab: source.prefab } : { asset: source.asset }), position: position.map(r3) };
  data.entities.push(e);
  return e;
}

// Copy an entity (everything authored, deep) under a new id, nudged so it doesn't overlap.
export function duplicateEntity(data, id, offset = [1, 0, 0]) {
  const i = data.entities.findIndex(e => e.id === id);
  if (i < 0) return null;
  const copy = structuredClone(data.entities[i]);
  copy.id = nextId(ids(data), id);
  if (copy.position) copy.position = copy.position.map((v, k) => r3(v + offset[k]));
  data.entities.splice(i + 1, 0, copy);
  return copy;
}

export function deleteEntity(data, id) {
  const i = data.entities.findIndex(e => e.id === id);
  if (i < 0) return false;
  data.entities.splice(i, 1);
  return true;
}

// Swap which scene asset an entity uses (works on prefab instances too: an instance's asset wins).
export function setAsset(data, id, assetKey) {
  const e = data.entities.find(x => x.id === id);
  if (!e || !data.assets?.[assetKey]) return false;
  e.asset = assetKey;
  return true;
}
