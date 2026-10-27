#!/usr/bin/env node
// Checks scene files against the rules in SKILL.md.
// Usage: node tools/validate.mjs [scenes/*.scene.json ...]   (defaults to every scene in scenes/)
import { LIGHT_FIELDS } from '../runtime/editing.js';
import { characterVariant, checkCharacter } from '../runtime/character.js';
import { checkPack, checkScenePacks } from '../runtime/packs.js';
import { checkMotions, entityMotions } from '../runtime/motions.js';
import { checkRules } from '../runtime/reactions.js';
import { checkClipVariants, mergeClipVariants } from '../runtime/animlayers.js';
import { allEntities, walkEntities } from '../runtime/tree.js';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { findHardcoded, findSpawnedMeshes } from './codecheck.mjs';

// Read clip names straight out of a .glb's JSON chunk (no three needed).
const glbClips = new Map();
function clipsOf(path) {
  if (glbClips.has(path)) return glbClips.get(path);
  let names = null;
  if (existsSync(path)) {
    const b = readFileSync(path);
    const len = b.readUInt32LE(12);
    names = (JSON.parse(b.subarray(20, 20 + len).toString()).animations || []).map(a => a.name);
  }
  glbClips.set(path, names);
  return names;
}

// character.json files (runtime/character.js): loaded + checked once each; problems reported against the scene using it.
const characters = new Map();
function characterOf(f, path) {
  if (!characters.has(path)) {
    let ch = null, problems = [];
    const rel = path.replace(/^\.\//, '');
    if (!existsSync(rel)) problems = [{ level: 'error', msg: 'file not found' }];
    else {
      try { ch = JSON.parse(readFileSync(rel, 'utf8')); } catch (x) { problems = [{ level: 'error', msg: `bad JSON: ${x.message}` }]; }
      if (ch) problems = checkCharacter(ch, typeof ch.glb === 'string' ? clipsOf(ch.glb.replace(/^\.\//, '')) : null);
    }
    characters.set(path, { ch: problems.some(p => p.level === 'error') ? null : ch, problems, reported: new Set() });
  }
  const c = characters.get(path);
  if (!c.reported.has(f)) { c.reported.add(f); for (const p of c.problems) (p.level === 'error' ? err : warn)(f, `${path}: ${p.msg}`); }
  return c.ch;
}
import { getBehavior } from '../runtime/registry.js';
import { mergeEntity } from '../runtime/prefabs.js';
import '../behaviors/index.js';

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync('scenes').filter(f => f.endsWith('.scene.json')).map(f => join('scenes', f));

const typeOk = (def, v) => ({
  number: typeof v === 'number' && (def.min === undefined || v >= def.min) && (def.max === undefined || v <= def.max),
  boolean: typeof v === 'boolean',
  string: typeof v === 'string',
  color: typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v),
  vec3: Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number'),
  rules: checkRules(v).length === 0,
}[def.type] ?? true);

let errors = 0, warnings = 0;
const err = (f, msg) => { errors++; console.error(`✗ ${f}: ${msg}`); };
const checkTags = (f, who, tags) => { if (tags !== undefined && (!Array.isArray(tags) || !tags.every(t => typeof t === 'string' && /^[a-z0-9_-]+$/.test(t)))) err(f, `${who}: tags must be a list of lowercase words`); };
const warn = (f, msg) => { warnings++; console.error(`⚠ ${f}: ${msg}`); };

// Behavior params must exist in the schema and fit their type/range.
function checkBehaviors(f, who, behaviors) {
  for (const b of behaviors || []) {
    const Cls = getBehavior(b.type);
    if (!Cls) { err(f, `${who}: unknown behavior "${b.type}"`); continue; }
    for (const [k, v] of Object.entries(b.params || {})) {
      const def = Cls.schema[k];
      if (!def) err(f, `${who}.${b.type}: "${k}" is not in the schema`);
      else if (!typeOk(def, v)) err(f, `${who}.${b.type}.${k}: ${JSON.stringify(v)} doesn't fit ${def.type}${def.min !== undefined ? ` [${def.min}..${def.max}]` : ''}`);
    }
  }
}

for (const f of files) {
  const errorsBefore = errors;
  const scene = JSON.parse(readFileSync(f, 'utf8'));
  const ids = new Set();
  const prefabs = {};
  for (const [name, url] of Object.entries(scene.prefabs || {})) {
    const path = url.replace(/^\.\//, '');
    if (!existsSync(path)) { err(f, `prefab "${name}" file not found: ${url}`); continue; }
    try { prefabs[name] = JSON.parse(readFileSync(path, 'utf8')); }
    catch (e) { err(f, `prefab "${name}" isn't valid JSON: ${e.message}`); continue; }
    const p = prefabs[name];
    for (const k of ['id', 'position', 'prefab']) if (k in p) err(f, `prefab "${name}": "${k}" belongs on instances, not in the prefab`);
    if (!p.asset && !p.light) err(f, `prefab "${name}": no asset`);
    checkBehaviors(f, `prefab ${name}`, p.behaviors);
    checkTags(f, `prefab ${name}`, p.tags);
    if (p.children !== undefined) {     // come with every instance; ids are prefixed with the instance id at runtime
      if (!Array.isArray(p.children)) err(f, `prefab "${name}": children must be a list`);
      else { const seen = new Set(); walkEntities(p.children, c => {
        if (!c.id || !/^[a-z0-9_]+$/.test(c.id)) err(f, `prefab "${name}": every child needs a lowercase_with_underscores id`);
        else if (seen.has(c.id)) err(f, `prefab "${name}": duplicate child id "${c.id}"`);
        seen.add(c.id); checkBehaviors(f, `prefab ${name} › ${c.id}`, c.behaviors);
      }); }
    }
  }
  const used = new Set(allEntities(scene).map(e => e.prefab).filter(Boolean));
  for (const name of Object.keys(prefabs)) if (!used.has(name)) warn(f, `prefab "${name}" is listed but never used`);
  for (const authored of allEntities(scene)) {          // nested children included; ids unique scene-wide
    if (authored.children !== undefined && !Array.isArray(authored.children)) err(f, `${authored.id}: children must be a list of entities`);
    checkTags(f, authored.id, authored.tags);
    if (authored.prefab && !prefabs[authored.prefab]) err(f, `${authored.id}: unknown prefab "${authored.prefab}"`);
    if (authored.removeBehaviors) {
      if (!authored.prefab) err(f, `${authored.id}: removeBehaviors only works on prefab instances`);
      else for (const t of authored.removeBehaviors)
        if (prefabs[authored.prefab] && !(prefabs[authored.prefab].behaviors || []).some(b => b.type === t))
          err(f, `${authored.id}: removeBehaviors "${t}" — prefab "${authored.prefab}" has no such behavior`);
    }
    if (authored.id && !/^[a-z0-9_]+$/.test(authored.id)) warn(f, `${authored.id}: ids should be lowercase_with_underscores`);
    const e = authored.prefab ? mergeEntity(prefabs[authored.prefab], authored) : authored;
    if (!e.id) err(f, 'entity without an id');
    else if (ids.has(e.id)) err(f, `duplicate id "${e.id}"`);
    ids.add(e.id);
    const asset = typeof e.asset === 'object' ? e.asset : scene.assets?.[e.asset];
    if (!e.light && e.asset && !asset) err(f, `${e.id}: unknown asset "${e.asset}"`);
    if (e.light) {
      const fields = LIGHT_FIELDS[e.light.type];
      if (!fields) err(f, `${e.id}: light type "${e.light.type}" (use ${Object.keys(LIGHT_FIELDS).join(', ')})`);
      else for (const k of Object.keys(e.light)) if (k !== 'type' && k !== 'shadowRadius' && !fields[k]) warn(f, `${e.id}: ${e.light.type} lights have no "${k}"`);
    }
    for (const m of checkMotions(e.motions)) err(f, `${e.id}: ${m}`);
    for (let v of Object.values(asset?.variants || {})) {
      let ch = null;
      if (v.character) {
        ch = characterOf(f, v.character);
        if (!ch) continue;
        v = characterVariant(ch, v);
      }
      if (!v.glb) continue;
      const baked = clipsOf(v.glb.replace(/^\.\//, ''));
      const clips = baked && [...baked, ...entityMotions(ch, e)];   // motion-library clips are retargeted on at load
      if (clips) { for (const m of checkClipVariants(mergeClipVariants(ch, e), clips)) err(f, `${e.id}: ${m}`); clips.push(...Object.keys(mergeClipVariants(ch, e))); }
      if (clips === null) err(f, `${e.id}: model file not found: ${v.glb}`);
      else if (e.animation && !clips.includes(e.animation)) err(f, `${e.id}: animation "${e.animation}" isn't in ${v.glb} (has: ${clips.join(', ')})`);
      else for (const b of e.behaviors || []) for (const [k, val] of Object.entries(b.params || {}))
        if (/Clip$/.test(k) && val && val !== 'none' && typeof val === 'string' && !clips.includes(val)) err(f, `${e.id}: ${b.type}.${k} "${val}" isn't in ${v.glb}`);
    }
    checkBehaviors(f, e.id, e.behaviors);
  }
  for (const r of scene.settings?.route || []) if (!ids.has(r)) err(f, `settings.route: no entity "${r}"`);
  { let cat = []; try { cat = JSON.parse(readFileSync('packs/index.json', 'utf8')); } catch {}
    for (const m of checkScenePacks(scene, Array.isArray(cat) ? cat : [])) err(f, m); }
  const known = scene.settings?.routeKnownIssue;
  if (known !== undefined && (typeof known !== 'string' || !known.trim())) err(f, 'settings.routeKnownIssue must be a short reason (string)');
  const seed = scene.settings?.seed;
  if (seed !== undefined && !(Number.isInteger(seed) && seed >= 0)) err(f, 'settings.seed must be a whole number ≥ 0 (pins world.rng for every Play)');
  const jt = scene.settings?.controls?.jumpTap;
  if (jt !== undefined && !['right', 'either'].includes(jt)) err(f, `settings.controls.jumpTap must be "right" or "either" (got ${JSON.stringify(jt)})`);
  if (known && !scene.settings?.route?.length) warn(f, 'settings.routeKnownIssue without a settings.route');
  if (errors === errorsBefore) console.log(`✓ ${f} — ${ids.size} entities`);
}

// prefabs/index.json lists every prefab file, so the editor's ＋Add menu can offer them (it can't list a folder).
// Kept up to date here, so adding a prefab file and running validate is enough.
{
  const names = readdirSync('prefabs').filter(n => n.endsWith('.prefab.json')).map(n => n.slice(0, -'.prefab.json'.length)).sort();
  const text = JSON.stringify(names, null, 1) + '\n';
  if (!existsSync('prefabs/index.json') || readFileSync('prefabs/index.json', 'utf8') !== text) {
    writeFileSync('prefabs/index.json', text);
    console.log(`✎ prefabs/index.json updated (${names.length} prefabs) — commit it`);
  }
}

// No hardcoded placement in code: behaviors, plus game pages/scripts at the root and in games/.
const codeFiles = [
  ...readdirSync('behaviors').filter(n => n.endsWith('.js')).map(n => join('behaviors', n)),
  ...readdirSync('.').filter(n => /\.(html|js|mjs)$/.test(n)),
  ...(existsSync('games') ? readdirSync('games', { recursive: true }).filter(n => /\.(html|js|mjs)$/.test(n)).map(n => join('games', n)) : []),
];
for (const cf of codeFiles) {
  const src = readFileSync(cf, 'utf8');
  for (const h of findHardcoded(src)) err(cf, `line ${h.line}: hardcoded placement (${h.why}) — put it in the scene file: ${h.text}`);
  if (cf.startsWith('behaviors')) for (const h of findSpawnedMeshes(src)) err(cf, `line ${h.line}: behaviors must not create meshes: ${h.text}`);
  else for (const h of findSpawnedMeshes(src)) warn(cf, `line ${h.line}: creates a mesh in code — if it's a placed object, it belongs in the scene file`);
}
// Packs: packs/<id>/pack.json (runtime/packs.js); packs/index.json is the catalog; a scene's "packs" says what that project installed.
if (existsSync('packs')) {
  const rel = p => String(p).replace(/^\.\//, '');
  const has = { file: p => existsSync(rel(p)), prefab: n => existsSync(join('prefabs', `${n}.prefab.json`)), behavior: n => !!getBehavior(n) };
  const dirs = readdirSync('packs', { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
  let installed = [];
  if (existsSync('packs/index.json')) { try { installed = JSON.parse(readFileSync('packs/index.json', 'utf8')); } catch { err('packs/index.json', 'bad JSON'); } }
  for (const id of installed) if (!dirs.includes(id)) err('packs/index.json', `no pack folder "${id}"`);
  for (const id of dirs) {
    const pf = join('packs', id, 'pack.json');
    if (!existsSync(pf)) { err(pf, 'missing'); continue; }
    let pack; try { pack = JSON.parse(readFileSync(pf, 'utf8')); } catch (x) { err(pf, `bad JSON: ${x.message}`); continue; }
    const before = errors;
    for (const pr of checkPack(pack, id, has)) (pr.level === 'error' ? err : warn)(pf, pr.msg);
    for (const c of pack.characters || []) if (has.file(c)) characterOf(pf, c);   // character files get checked too
    if (!installed.includes(id)) warn(pf, 'not listed in packs/index.json (the catalog), so no project can install it');
    if (errors === before) console.log(`✓ ${pf} — ${['characters', 'prefabs', 'behaviors', 'scenes'].map(k => `${(pack[k] || []).length} ${k}`).join(', ')}`);
  }
}
// Inventory (SPEC §7b): every model imported from Colin's repos should be traceable to where it came from.
{
  const ROOT_DIR = join(dirname(new URL(import.meta.url).pathname), '..');
  const inv = join(ROOT_DIR, 'inventory.json'), colin = join(ROOT_DIR, 'assets/models/colin');
  if (existsSync(inv) && existsSync(colin)) {
    const known = new Set(JSON.parse(readFileSync(inv, 'utf8')).assets.map(a => a.hash));
    const { createHash } = await import('node:crypto');
    const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.glb') ? [join(d, e.name)] : []);
    for (const f of walk(colin)) {
      const h = createHash('sha1').update(readFileSync(f)).digest('hex').slice(0, 12);
      if (!known.has(h)) warn(f.slice(ROOT_DIR.length + 1), 'not in inventory.json (new or changed since the last scan) — run `npm run inventory`');
    }
  }
}
if (warnings) console.log(`${warnings} warning(s)`);

process.exit(errors ? 1 : 0);
