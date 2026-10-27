// Packs (SPEC §7b): packs/<id>/pack.json lists what a pack brings into a project's library.
//   { "id", "name", "version": "1.0.0", "tier": "free"|"unlock", "description"?,
//     "characters": ["./assets/…/zap.character.json"], "prefabs": ["tree"], "behaviors": ["Chase"],
//     "scenes": ["./scenes/sky-steps.scene.json"], "thumbnails": { "<item>": "./packs/<id>/thumbs/<item>.png" } }
// Pure (no three/DOM). packs/index.json lists the packs this copy of Scene Companion has (the catalog); a
// scene's "packs" field says which of them are installed in that project.

export const PACK_TIERS = ['free', 'unlock'];
const LISTS = ['characters', 'prefabs', 'behaviors', 'scenes'];

// Problems with a pack. has: { file(path) → bool, prefab(name) → bool, behavior(name) → bool }. → [{ level, msg }]
export function checkPack(pack, dirId, has) {
  const out = [], err = msg => out.push({ level: 'error', msg }), warn = msg => out.push({ level: 'warn', msg });
  if (!pack || typeof pack !== 'object') { err('not a JSON object'); return out; }
  if (pack.id !== dirId) err(`"id" must match its folder (${dirId}), got ${JSON.stringify(pack.id)}`);
  if (typeof pack.name !== 'string' || !pack.name) err('needs a "name"');
  if (!/^\d+\.\d+\.\d+$/.test(pack.version || '')) err('"version" must look like 1.0.0');
  if (!PACK_TIERS.includes(pack.tier)) err(`"tier" must be ${PACK_TIERS.join(' or ')}`);
  for (const k of LISTS) if (pack[k] !== undefined && !Array.isArray(pack[k])) err(`"${k}" must be a list`);
  if (!LISTS.some(k => pack[k]?.length)) warn('pack is empty');
  for (const p of pack.characters || []) if (!/\.character\.json$/.test(p) || !has.file(p)) err(`character not found: ${p}`);
  for (const p of pack.scenes || []) if (!has.file(p)) err(`scene not found: ${p}`);
  for (const n of pack.prefabs || []) if (!has.prefab(n)) err(`prefab not found: ${n}`);
  for (const n of pack.behaviors || []) if (!has.behavior(n)) err(`behavior not registered: ${n}`);
  const items = new Set([...(pack.prefabs || []), ...(pack.characters || []).map(itemName)]);
  for (const [k, p] of Object.entries(pack.thumbnails || {})) {
    if (!items.has(k)) warn(`thumbnail for "${k}", which isn't in the pack`);
    if (!has.file(p)) err(`thumbnail not found: ${p}`);
  }
  return out;
}

// "./assets/…/zap.character.json" → "zap"
export const itemName = p => String(p).split('/').pop().replace(/\.character\.json$/, '');

// Library › Packs: a pack's addable items → [{ kind: 'prefab'|'character', name, path?, pack }]
export function packItems(pack) {
  if (!pack) return [];
  return [
    ...(pack.characters || []).map(path => ({ kind: 'character', name: itemName(path), path, pack: pack.id })),
    ...(pack.prefabs || []).map(name => ({ kind: 'prefab', name, pack: pack.id })),
  ];
}

// ---- installing packs into a project (the scene file is the project for now).
// scene.packs = ids installed in this project. No "packs" field = every free pack in the catalog (scenes from
// before install/uninstall keep showing what they always did). The catalog = packs/index.json's packs.
export function installedIds(scene, catalog = []) {
  if (Array.isArray(scene?.packs)) return scene.packs.slice();
  return catalog.filter(p => p.tier !== 'unlock').map(p => p.id);
}

// Install (on = true) or uninstall a pack; writes scene.packs (catalog order). Entities already placed from the
// pack stay in the scene — uninstalling only takes the pack out of the Library. → the new list of ids
export function setInstalled(scene, catalog, id, on) {
  if (!catalog.some(p => p.id === id)) throw new Error(`no pack "${id}" (packs: ${catalog.map(p => p.id).join(', ') || 'none'})`);
  const now = new Set(installedIds(scene, catalog));
  if (on) now.add(id); else now.delete(id);
  return (scene.packs = catalog.map(p => p.id).filter(i => now.has(i)));
}

// Unlock-tier packs stay locked until unlocked (Pack unlocks will own this; today a device list, see editor).
export const isLocked = (pack, unlocks = []) => pack?.tier === 'unlock' && !unlocks.includes(pack.id);

// "a, b" / ["a"] → ["a", "b"] (ids only)
export const parseUnlocks = v => (Array.isArray(v) ? v : String(v || '').split(','))
  .map(s => String(s).trim()).filter(s => /^[a-z0-9_-]+$/.test(s));

// Library › Packs rows: installed packs first (catalog order), then the rest.
// → [{ pack, installed, locked, items: packItems(pack) with locked flags }]
export function libraryPacks(catalog = [], scene, unlocks = []) {
  const inst = installedIds(scene, catalog);
  const rows = catalog.map(pack => {
    const locked = isLocked(pack, unlocks);
    return { pack, installed: inst.includes(pack.id), locked, items: packItems(pack).map(i => ({ ...i, locked })) };
  });
  return [...rows.filter(r => r.installed), ...rows.filter(r => !r.installed)];
}

// Problems with a scene's "packs" field against the catalog → [messages]
export function checkScenePacks(scene, catalogIds) {
  if (scene?.packs === undefined) return [];
  if (!Array.isArray(scene.packs)) return ['"packs" must be a list of pack ids'];
  return scene.packs.filter(id => !catalogIds.includes(id)).map(id => `packs: no pack "${id}" in packs/index.json`);
}
