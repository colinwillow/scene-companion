// Scene-data edits the editor (and later the MCP server) make. Pure data, no three/DOM.
// Entities may nest (`children`, runtime/tree.js): lookups search the whole tree; ids are unique scene-wide.
import { allEntities, findEntity, walkEntities } from './tree.js';

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

const ids = data => allEntities(data).map(e => e.id);
const byId = (data, id) => findEntity(data, id)?.entity;

// Add a new entity from a prefab ({ prefab: 'coin' }) or a scene asset ({ asset: 'crate' }) at a position.
export function addEntity(data, source, position = [0, 0, 0]) {
  const base = source.prefab || source.asset;
  if (!base) throw new Error('addEntity needs a prefab or an asset');
  const e = { id: nextId(ids(data), base), ...(source.prefab ? { prefab: source.prefab } : { asset: source.asset }), position: position.map(r3) };
  data.entities.push(e);
  return e;
}

// Copy an entity (everything authored, deep, children too) under new ids, nudged so it doesn't overlap.
// The copy sits next to the original (same parent).
export function duplicateEntity(data, id, offset = [1, 0, 0]) {
  const hit = findEntity(data, id);
  if (!hit) return null;
  const copy = structuredClone(hit.entity);
  const taken = ids(data);
  walkEntities([copy], e => { e.id = nextId(taken, e.id); taken.push(e.id); });
  if (copy.position) copy.position = copy.position.map((v, k) => r3(v + offset[k]));
  hit.list.splice(hit.index + 1, 0, copy);
  return copy;
}

// Delete an entity (and its children) wherever it sits in the tree.
export function deleteEntity(data, id) {
  const hit = findEntity(data, id);
  if (!hit) return false;
  hit.list.splice(hit.index, 1);
  if (hit.parent && !hit.parent.children.length) delete hit.parent.children;
  return true;
}

// Swap which scene asset an entity uses (works on prefab instances too: an instance's asset wins).
export function setAsset(data, id, assetKey) {
  const e = byId(data, id);
  if (!e || !data.assets?.[assetKey]) return false;
  e.asset = assetKey;
  return true;
}

// Which GLB an entity shows (web variant), for "Send to Blender". assetDef: its asset, resolved (prefab merged,
// scene asset key looked up). → path or null
// characters: { "./…/x.character.json": loadedJson } (World.characters) so a `character` variant resolves to its GLB.
export function modelPath(assetDef, characters = {}) {
  const v = assetDef?.variants ? assetDef.variants.web : assetDef;
  if (typeof v?.glb === 'string') return v.glb;
  const ch = v?.character && characters[v.character];
  return typeof ch?.glb === 'string' ? ch.glb : null;
}

// Blender bridge "Send Back": point one entity at the edited GLB. Keeps its id, transform, behaviors and the web
// variant's size settings (height/scale/offset/frontSide); other tiers' variants are dropped since they'd still
// show the old model. Becomes an inline asset on this entity only (an override on prefab instances).
// A `character` variant keeps its character file (roles still apply); the new glb overrides the file's model.
export function replaceModel(data, id, glb, assetDef, characters = {}) {
  const e = byId(data, id);
  if (!e || !modelPath(assetDef, characters)) return false;
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
  const e = byId(data, id);
  const def = e?.light && LIGHT_FIELDS[e.light.type]?.[key];
  if (!def) return false;
  if (def.type === 'number') value = Math.min(def.max, Math.max(def.min, +value));
  if (def.type === 'boolean') value = !!value;
  if (def.type === 'color' && !/^#[0-9a-f]{6}$/i.test(value)) return false;
  if (e.light[key] === value) return false;
  e.light[key] = value;
  return true;
}

// Scatter brush: from the surface points a drag passed over, keep the ones at least `spacing` metres from every
// instance already placed this stroke (placed: [[x, y, z]]). → new points to place (also appended to placed)
export function scatterPoints(samples, spacing, placed = []) {
  const out = [];
  for (const p of samples) {
    if (placed.some(q => Math.hypot(p[0] - q[0], p[2] - q[2]) < spacing)) continue;
    placed.push(p); out.push(p);
  }
  return out;
}

// One painted instance: a prefab at a point with a random turn and a little size variety. rng: () => [0, 1)
// scaleJitter 0.2 = ±20% size; turn false = keep the prefab's facing (for rows of fences, posts…)
export function scatterEntity(data, prefab, point, rng = Math.random, { scaleJitter = 0.2, turn = true } = {}) {
  const e = addEntity(data, { prefab }, point);
  if (turn) e.rotation = [0, Math.round(rng() * 360), 0];
  const s = r3(1 + (rng() * 2 - 1) * scaleJitter);
  if (s !== 1) e.scale = [s, s, s];
  return e;
}

// The brush's jitter slider (0–1) → scatterEntity options: size variety up to ±50%, random turn once it's above 0.
export const jitterOptions = j => ({ scaleJitter: r3(Math.min(1, Math.max(0, +j || 0)) * 0.5), turn: +j > 0 });

// Erase brush: ids of `prefab` instances whose ground position (x, z) is within `radius` of any sample the drag
// passed over. Only that prefab, only top-level placed instances (an instance's own model/asset swap still counts).
export function scatterEraseIds(data, prefab, samples, radius) {
  const out = [];
  for (const e of data.entities || []) {
    if (e.prefab !== prefab || !e.position) continue;
    if (samples.some(p => Math.hypot(p[0] - e.position[0], p[2] - e.position[2]) <= radius)) out.push(e.id);
  }
  return out;
}

// Brush size for erasing: a little wider than the paint spacing so one pass clears a painted strip.
export const eraseRadius = spacing => r3(Math.max(0.6, spacing * 0.6));

// Library › Characters: add a bare character (character.json) at a point — a scene asset pointing at the file
// (reused if one already does) + an entity with an Animator that plays its roles. → the new entity
export function addCharacter(data, name, path, point) {
  data.assets ||= {};
  const same = Object.entries(data.assets).find(([, a]) => (a?.variants?.web || a)?.character === path);
  let key = same?.[0];
  if (!key) { key = name; let n = 2; while (data.assets[key]) key = `${name}_${n++}`; data.assets[key] = { variants: { web: { character: path } } }; }
  const e = addEntity(data, { asset: key }, point);
  e.id = nextId(ids(data).filter(i => i !== e.id), name);   // named after the character, even when reusing e.g. a `player` asset
  e.behaviors = [{ type: 'Animator', params: {} }];
  return e;
}

// Fields whose strings name a file, model, prefab or clip — never an object — even when the words match
const NOT_IDS = new Set(['asset', 'prefab', 'character', 'model', 'file', 'path', 'url', 'src', 'animation', 'clip', 'type', 'kind', 'motions']);
// Rename an entity and every reference to it: any string anywhere in the scene that IS the old id (a behavior's
// target, a rule's who/what, a camera follow…), and `{old}` / `{old.field}` inside text templates (HudLabel).
// Children's ids are their own and stay. → { ok, refs } or { ok: false, error } (bad name / taken / not found).
export function renameEntity(data, oldId, newId) {
  newId = String(newId || '').trim();
  if (!/^[A-Za-z][\w-]{0,63}$/.test(newId)) return { ok: false, error: 'use letters, numbers, _ or - (start with a letter)' };
  const hit = findEntity(data, oldId);
  if (!hit) return { ok: false, error: `no object called ${oldId}` };
  if (newId === oldId) return { ok: true, refs: 0 };
  if (allEntities(data).some(e => e.id === newId)) return { ok: false, error: `${newId} is already taken` };
  const target = hit.entity, ents = new Set(allEntities(data));
  let refs = 0;
  const esc = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), tpl = new RegExp(`\\{${esc}(?=[.}])`, 'g');
  const fix = v => {
    if (typeof v === 'string') {
      if (v === oldId) { refs++; return newId; }
      if (v.includes('{' + oldId)) { const out = v.replace(tpl, () => { refs++; return '{' + newId; }); return out; }
      return v;
    }
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = fix(v[i]); return v; }
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) { if ((k === 'id' && ents.has(v)) || NOT_IDS.has(k)) continue; v[k] = fix(v[k]); }   // an entity's own id, or a field naming a model/prefab/clip, is not a reference
      return v;
    }
    return v;
  };
  for (const k of Object.keys(data)) if (k !== 'assets' && k !== 'prefabs') data[k] = fix(data[k]);
  target.id = newId;
  return { ok: true, refs };
}
