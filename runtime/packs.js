// Packs (SPEC §7b): packs/<id>/pack.json lists what a pack brings into a project's library.
//   { "id", "name", "version": "1.0.0", "tier": "free"|"unlock", "description"?,
//     "characters": ["./assets/…/zap.character.json"], "prefabs": ["tree"], "behaviors": ["Chase"],
//     "scenes": ["./scenes/sky-steps.scene.json"], "thumbnails": { "<item>": "./packs/<id>/thumbs/<item>.png" } }
// Pure (no three/DOM). Installed packs are listed in packs/index.json (["colin-starter", …]).

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
