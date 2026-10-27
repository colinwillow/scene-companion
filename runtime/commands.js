// Scene commands shared by the editor and the MCP server. Pure data (no three/DOM): each command reads or
// edits scene data and throws a readable Error on bad input *before* changing anything.
//
//   runCommand(data, op, args, { schemas, prefabs }) → { result, changed }
//   schemas: { BehaviorName: schema }   prefabs: { name: prefabJson }   (both supplied by the host)
import { addEntity, deleteEntity, addLight, setLightValue, LIGHT_FIELDS } from './editing.js';
import { mergeEntity, setOverride } from './prefabs.js';
import { libraryPacks, setInstalled } from './packs.js';
import { allEntities, findEntity, walkEntities, reparent } from './tree.js';

const r3 = v => Math.round(v * 1000) / 1000;
const isVec3 = v => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));

function need(data, id) {
  const e = findEntity(data, id)?.entity;   // nested children too
  if (!e) throw new Error(`No entity "${id}". Use list_entities to see ids.`);
  return e;
}
const resolved = (e, prefabs) => (e.prefab ? mergeEntity(prefabs?.[e.prefab], e) : e);

// Check one param against its schema; returns the cleaned value.
export function checkParam(schemas, type, key, value) {
  const schema = schemas?.[type];
  if (!schema) throw new Error(`Unknown behavior "${type}". Known: ${Object.keys(schemas || {}).join(', ')}`);
  const def = schema[key];
  if (!def) throw new Error(`${type} has no param "${key}". Params: ${Object.keys(schema).join(', ')}`);
  switch (def.type) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${type}.${key} must be a number`);
      if ((def.min !== undefined && value < def.min) || (def.max !== undefined && value > def.max))
        throw new Error(`${type}.${key} must be between ${def.min} and ${def.max}`);
      return value;
    case 'boolean': if (typeof value !== 'boolean') throw new Error(`${type}.${key} must be true/false`); return value;
    case 'string': if (typeof value !== 'string') throw new Error(`${type}.${key} must be a string`); return value;
    case 'vec3': if (!isVec3(value)) throw new Error(`${type}.${key} must be [x, y, z]`); return value.map(r3);
    case 'color': if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${type}.${key} must be a colour`); return value;
    default: return value;
  }
}

const summary = (e, prefabs) => ({
  id: e.id,
  ...(e.prefab ? { prefab: e.prefab } : {}),
  ...(e.asset !== undefined ? { asset: typeof e.asset === 'string' ? e.asset : 'inline' } : {}),
  ...(e.light ? { light: e.light.type } : {}),
  position: e.position || [0, 0, 0],
  behaviors: (resolved(e, prefabs).behaviors || []).map(b => b.type),
});

export const COMMANDS = {
  list_entities: {
    mutates: false,
    run(data, { filter } = {}, ctx) {
      const f = filter ? String(filter).toLowerCase() : '';
      const out = [];
      walkEntities(data.entities, (e, { parent }) => { out.push(parent ? { ...summary(e, ctx.prefabs), parent: parent.id } : summary(e, ctx.prefabs)); });
      return out.filter(s => !f || JSON.stringify(s).toLowerCase().includes(f));
    },
  },
  get_entity: {
    mutates: false,
    run(data, { id }, ctx) {
      const e = need(data, id);
      return { authored: structuredClone(e), resolved: structuredClone(resolved(e, ctx.prefabs)) };
    },
  },
  list_library: {
    mutates: false,
    run(data, _args, ctx) {
      return {
        assets: Object.keys(data.assets || {}),
        prefabs: Object.keys(data.prefabs || {}),
        behaviors: Object.fromEntries(Object.entries(ctx.schemas || {}).map(([n, s]) => [n, s])),
      };
    },
  },
  spawn: {
    mutates: true,
    run(data, { prefab, asset, position = [0, 0, 0], id, parent }, ctx = {}) {
      if (!prefab && !asset) throw new Error('spawn needs a prefab or an asset (see list_library)');
      if (prefab && !data.prefabs?.[prefab]) {
        // ctx.library: prefab files from prefabs/ the host fetched ({ name: json }); spawning one adds it to the scene
        if (!ctx.library?.[prefab]) throw new Error(`No prefab "${prefab}" in this scene or in prefabs/. Scene prefabs: ${Object.keys(data.prefabs || {}).join(', ')}`);
        data.prefabs = { ...data.prefabs, [prefab]: `./prefabs/${prefab}.prefab.json` };
        ctx.prefabs = { ...ctx.prefabs, [prefab]: ctx.library[prefab] };      // so later calls in a batch resolve it
      }
      if (asset && !data.assets?.[asset]) throw new Error(`No asset "${asset}" in this scene. Assets: ${Object.keys(data.assets || {}).join(', ')}`);
      if (!isVec3(position)) throw new Error('position must be [x, y, z] in metres');
      if (id !== undefined) {
        if (!/^[a-z0-9_]+$/.test(id)) throw new Error('id must be lowercase_with_underscores');
        if (findEntity(data, id)) throw new Error(`id "${id}" is taken`);
      }
      if (parent && !findEntity(data, parent)) throw new Error(`No entity "${parent}" to be the parent`);
      const e = addEntity(data, prefab ? { prefab } : { asset }, position);
      if (id) e.id = id;
      if (parent) reparent(data, e.id, parent);   // position stays a world position; stored relative to the parent
      return { id: e.id, position: e.position, ...(parent ? { parent } : {}) };
    },
  },
  move: {
    mutates: true,
    run(data, { id, position, rotation, scale }) {
      const e = need(data, id);
      for (const [k, v] of Object.entries({ position, rotation, scale })) if (v !== undefined && !isVec3(v)) throw new Error(`${k} must be [x, y, z]`);
      if (position === undefined && rotation === undefined && scale === undefined) throw new Error('move needs position, rotation (degrees) or scale');
      if (position) e.position = position.map(r3);
      if (rotation) e.rotation = rotation.map(r3);
      if (scale) e.scale = scale.map(r3);
      return { id, position: e.position, rotation: e.rotation, scale: e.scale };
    },
  },
  delete: {
    mutates: true,
    run(data, { id }) { need(data, id); deleteEntity(data, id); return { deleted: id }; },
  },
  attach_behavior: {
    mutates: true,
    run(data, { id, type, params = {} }, ctx) {
      const e = need(data, id);
      if (!ctx.schemas?.[type]) throw new Error(`Unknown behavior "${type}". Known: ${Object.keys(ctx.schemas || {}).join(', ')}`);
      if ((resolved(e, ctx.prefabs).behaviors || []).some(b => b.type === type)) throw new Error(`${id} already has ${type}; use set_param`);
      const clean = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, checkParam(ctx.schemas, type, k, v)]));
      if (e.removeBehaviors?.includes(type)) { e.removeBehaviors = e.removeBehaviors.filter(t => t !== type); if (!e.removeBehaviors.length) delete e.removeBehaviors; }
      (e.behaviors ||= []).push({ type, params: clean });
      return { id, type, params: clean };
    },
  },
  set_param: {
    mutates: true,
    run(data, { id, type, key, value }, ctx) {
      const e = need(data, id);
      if (!(resolved(e, ctx.prefabs).behaviors || []).some(b => b.type === type)) throw new Error(`${id} has no ${type}; use attach_behavior`);
      const v = checkParam(ctx.schemas, type, key, value);
      setOverride(e, type, key, v);
      return { id, type, key, value: v };
    },
  },
  remove_behavior: {
    mutates: true,
    run(data, { id, type }, ctx) {
      const e = need(data, id);
      const own = (e.behaviors || []).findIndex(b => b.type === type);
      const fromPrefab = e.prefab && (ctx.prefabs?.[e.prefab]?.behaviors || []).some(b => b.type === type);
      if (own < 0 && !fromPrefab) throw new Error(`${id} has no ${type}`);
      if (own >= 0) e.behaviors.splice(own, 1);
      if (e.behaviors && !e.behaviors.length) delete e.behaviors;
      if (fromPrefab && !e.removeBehaviors?.includes(type)) (e.removeBehaviors ||= []).push(type);
      return { id, removed: type };
    },
  },
  add_light: {
    mutates: true,
    run(data, { type, position = [0, 0, 0], id, ...values }) {
      if (!LIGHT_FIELDS[type]) throw new Error(`type must be one of ${Object.keys(LIGHT_FIELDS).join(', ')}`);
      if (!isVec3(position)) throw new Error('position must be [x, y, z] in metres (point lights go 2.5 m above it, spots 4 m)');
      for (const k of Object.keys(values)) if (!LIGHT_FIELDS[type][k]) throw new Error(`${type} lights have no "${k}" (fields: ${Object.keys(LIGHT_FIELDS[type]).join(', ')})`);
      if (id !== undefined && (!/^[a-z0-9_]+$/.test(id) || findEntity(data, id))) throw new Error(`id "${id}" is taken or not lowercase_with_underscores`);
      const e = addLight(data, type, position);
      if (id) e.id = id;
      for (const [k, v] of Object.entries(values)) setLightValue(data, e.id, k, v);
      return { id: e.id, light: e.light, position: e.position };
    },
  },
  set_light: {
    mutates: true,
    run(data, { id, values }) {
      const e = need(data, id);
      if (!e.light) throw new Error(`${id} isn't a light`);
      const fields = LIGHT_FIELDS[e.light.type] || {};
      if (!values || typeof values !== 'object' || !Object.keys(values).length) throw new Error(`values: { ${Object.keys(fields).join(', ')} }`);
      for (const [k, v] of Object.entries(values)) {
        if (!fields[k]) throw new Error(`${e.light.type} lights have no "${k}" (fields: ${Object.keys(fields).join(', ')})`);
        if (fields[k].type === 'color' && !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${k} must be a #rrggbb colour`);
        if (fields[k].type === 'number' && !Number.isFinite(+v)) throw new Error(`${k} must be a number (${fields[k].min}–${fields[k].max})`);
      }
      for (const [k, v] of Object.entries(values)) setLightValue(data, id, k, v);
      return { id, light: e.light };
    },
  },
  set_animation: {
    mutates: true,
    run(data, { id, clip }) {
      const e = need(data, id);
      if (clip === null || clip === '') delete e.animation;
      else if (typeof clip !== 'string') throw new Error('clip must be a clip name (see get_entity / the model) or null');
      else e.animation = clip;
      return { id, animation: e.animation ?? null };
    },
  },
  set_parent: {
    mutates: true,
    run(data, { id, parent = null }) {
      const e = reparent(data, id, parent || null);
      return { id, parent: parent || null, position: e.position, rotation: e.rotation || [0, 0, 0], scale: e.scale || [1, 1, 1] };
    },
  },
  list_packs: {
    mutates: false,
    run(data, _args, ctx) {
      return libraryPacks(ctx.packs || [], data, ctx.unlocks || []).map(r => ({ id: r.pack.id, name: r.pack.name, version: r.pack.version,
        tier: r.pack.tier, installed: r.installed, locked: r.locked, items: r.items.map(i => `${i.kind}:${i.name}`) }));
    },
  },
  install_pack: {
    mutates: true,
    run(data, { id }, ctx) { return { packs: setInstalled(data, ctx.packs || [], id, true) }; },
  },
  uninstall_pack: {
    mutates: true,
    run(data, { id }, ctx) { return { packs: setInstalled(data, ctx.packs || [], id, false), note: 'objects already placed from it stay in the scene' }; },
  },
  // Several edits in one go: one undo step, one rebuild (spawning 40 things one by one is slow on a phone).
  // All or nothing: if any call fails, nothing changes and the error names the failing call.
  batch: {
    mutates: true,
    run(data, { calls }, ctx) {
      if (!Array.isArray(calls) || !calls.length) throw new Error('batch needs calls: [{ tool, args }, …]');
      return calls.map(({ tool, args = {} }, i) => {
        const cmd = COMMANDS[tool];
        if (!cmd || tool === 'batch') throw new Error(`batch call ${i + 1}: "${tool}" can't be batched (scene edits and reads only)`);
        try { return cmd.run(data, args, ctx); }
        catch (e) { throw new Error(`batch call ${i + 1} (${tool}): ${e.message}`); }
      });
    },
  },
};

// A copy of the scene ready to write to disk: prefabs no entity uses are dropped (the validator warns about them).
// → { data, dropped: [prefab names] }
export function sceneForSave(scene) {
  const used = new Set(allEntities(scene).map(e => e.prefab).filter(Boolean));
  const data = structuredClone(scene), dropped = Object.keys(data.prefabs || {}).filter(n => !used.has(n));
  for (const n of dropped) delete data.prefabs[n];
  return { data, dropped };
}

// A fresh scene from an existing one: same settings, assets and prefabs; keeps its lights plus any ids in `keep`.
export function sceneFromTemplate(base, keep = []) {
  const missing = keep.filter(id => !base.entities.some(e => e.id === id));
  if (missing.length) throw new Error(`Template has no ${missing.join(', ')}`);
  return {
    settings: (({ route, routeKnownIssue, ...rest }) => structuredClone(rest))(base.settings || {}),   // the template's route is about its entities
    assets: structuredClone(base.assets || {}),
    prefabs: structuredClone(base.prefabs || {}),
    entities: base.entities.filter(e => e.light || keep.includes(e.id)).map(e => structuredClone(e)),
  };
}

export function runCommand(data, op, args = {}, ctx = {}) {
  const cmd = COMMANDS[op];
  if (!cmd) throw new Error(`Unknown command "${op}"`);
  if (!cmd.mutates) return { result: cmd.run(data, args, ctx), changed: false };
  const draft = structuredClone(data);          // all-or-nothing: a throw leaves `data` untouched
  const result = cmd.run(draft, args, ctx);
  for (const k of Object.keys(data)) delete data[k];
  Object.assign(data, draft);
  return { result, changed: true };
}


