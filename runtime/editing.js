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

// Which GLB an entity shows (web variant), for "Send to Blender". assetDef: its asset, resolved (prefab merged,
// scene asset key looked up). → path or null
export function modelPath(assetDef) {
  const v = assetDef?.variants ? assetDef.variants.web : assetDef;
  return typeof v?.glb === 'string' ? v.glb : null;
}

// Blender bridge "Send Back": point one entity at the edited GLB. Keeps its id, transform, behaviors and the web
// variant's size settings (height/scale/offset/frontSide); other tiers' variants are dropped since they'd still
// show the old model. Becomes an inline asset on this entity only (an override on prefab instances).
export function replaceModel(data, id, glb, assetDef) {
  const e = data.entities.find(x => x.id === id);
  if (!e || !modelPath(assetDef)) return false;
  const web = structuredClone(assetDef.variants ? assetDef.variants.web : assetDef);
  e.asset = { variants: { web: { ...web, glb } } };
  return true;
}

// The ground counts as "empty" for tapping: a tap on it deselects instead of selecting it (pick it from ☰ List).
export function isGround(id, resolved) {
  return /^ground/.test(id || '') || (typeof resolved?.asset === 'string' && /^ground/.test(resolved.asset));
}

// Where "＋Add" drops things: the surfaces the screen-centre ray may land on — anything with a Solid behavior,
// plus the ground (id or asset named ground*). resolved: the entity with its prefab merged in.
export function isDropSurface(id, resolved) {
  if (isGround(id, resolved)) return true;
  return (resolved?.behaviors || []).some(b => b.type === 'Solid');
}

// Pick the drop point: the first surface hit, else where the ray meets the y=0 plane (if it's not absurdly far),
// else straight below the orbit focus. Points are [x, y, z]; hit/plane may be null.
export function dropPoint(hit, plane, focus, maxDist = 500) {
  if (hit) return hit.map(r3);
  if (plane && Math.hypot(plane[0] - focus[0], plane[2] - focus[2]) < maxDist) return [r3(plane[0]), 0, r3(plane[2])];
  return [r3(focus[0]), 0, r3(focus[2])];
}

// Grid snapping (editor ▦ Snap): round x and z to the grid; y is left alone (it comes from the surface you drop on).
export const GRID = { move: 0.5, turnDeg: 15, scale: 0.25 };
export function snapXZ(p, step = GRID.move) {
  const s = v => r3(Math.round(v / step) * step);
  return [s(p[0]), r3(p[1]), s(p[2])];
}

// Light entities ({ id, light: { type, color, intensity, … }, position }). The inspector draws these fields per type.
// Physical units (three r155+): point/spot intensity is in candela, so they need bigger numbers than the sun.
export const LIGHT_FIELDS = {
  directional: { color: { type: 'color', default: '#ffffff' }, intensity: { type: 'number', default: 2, min: 0, max: 8, step: 0.1 }, shadows: { type: 'boolean', default: true } },
  hemisphere:  { color: { type: 'color', default: '#ffffff' }, groundColor: { type: 'color', default: '#444444' }, intensity: { type: 'number', default: 1, min: 0, max: 4, step: 0.05 } },
  ambient:     { color: { type: 'color', default: '#ffffff' }, intensity: { type: 'number', default: 0.5, min: 0, max: 4, step: 0.05 } },
  point: { color: { type: 'color', default: '#ffd9a0' }, intensity: { type: 'number', default: 20, min: 0, max: 200, step: 1 },
           distance: { type: 'number', default: 10, min: 0, max: 60, step: 0.5 }, shadows: { type: 'boolean', default: false } },
  spot:  { color: { type: 'color', default: '#ffffff' }, intensity: { type: 'number', default: 40, min: 0, max: 400, step: 1 },
           distance: { type: 'number', default: 15, min: 0, max: 80, step: 0.5 }, angle: { type: 'number', default: 35, min: 5, max: 85, step: 1 },
           penumbra: { type: 'number', default: 0.3, min: 0, max: 1, step: 0.05 }, shadows: { type: 'boolean', default: false } },
};

// Add a point / spot (or any type above) light at a position (point lights hang 2.5 m above it, spots 4 m).
export function addLight(data, type, position = [0, 0, 0]) {
  const fields = LIGHT_FIELDS[type];
  if (!fields) throw new Error(`Light type must be one of ${Object.keys(LIGHT_FIELDS).join(', ')}`);
  const lift = type === 'point' ? 2.5 : type === 'spot' ? 4 : 0;
  const e = { id: nextId(ids(data), `${type}_light`), light: { type, ...Object.fromEntries(Object.entries(fields).map(([k, d]) => [k, d.default])) },
    position: [position[0], position[1] + lift, position[2]].map(r3) };
  data.entities.push(e);
  return e;
}

// Set one light field (validated against LIGHT_FIELDS). → true if it changed
export function setLightValue(data, id, key, value) {
  const e = data.entities.find(x => x.id === id);
  const def = e?.light && LIGHT_FIELDS[e.light.type]?.[key];
  if (!def) return false;
  if (def.type === 'number') value = Math.min(def.max, Math.max(def.min, +value));
  if (def.type === 'boolean') value = !!value;
  if (def.type === 'color' && !/^#[0-9a-f]{6}$/i.test(value)) return false;
  if (e.light[key] === value) return false;
  e.light[key] = value;
  return true;
}
