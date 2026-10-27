#!/usr/bin/env node
// Checks scene files against the rules in SKILL.md.
// Usage: node tools/validate.mjs [scenes/*.scene.json ...]   (defaults to every scene in scenes/)
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
}[def.type] ?? true);

let errors = 0, warnings = 0;
const err = (f, msg) => { errors++; console.error(`✗ ${f}: ${msg}`); };
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
  }
  const used = new Set((scene.entities || []).map(e => e.prefab).filter(Boolean));
  for (const name of Object.keys(prefabs)) if (!used.has(name)) warn(f, `prefab "${name}" is listed but never used`);
  for (const authored of scene.entities || []) {
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
    for (const v of Object.values(asset?.variants || {})) {
      if (!v.glb) continue;
      const clips = clipsOf(v.glb.replace(/^\.\//, ''));
      if (clips === null) err(f, `${e.id}: model file not found: ${v.glb}`);
      else if (e.animation && !clips.includes(e.animation)) err(f, `${e.id}: animation "${e.animation}" isn't in ${v.glb} (has: ${clips.join(', ')})`);
      else for (const b of e.behaviors || []) for (const [k, val] of Object.entries(b.params || {}))
        if (/Clip$/.test(k) && val && typeof val === 'string' && !clips.includes(val)) err(f, `${e.id}: ${b.type}.${k} "${val}" isn't in ${v.glb}`);
    }
    checkBehaviors(f, e.id, e.behaviors);
  }
  for (const r of scene.settings?.route || []) if (!ids.has(r)) err(f, `settings.route: no entity "${r}"`);
  const known = scene.settings?.routeKnownIssue;
  if (known !== undefined && (typeof known !== 'string' || !known.trim())) err(f, 'settings.routeKnownIssue must be a short reason (string)');
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
if (warnings) console.log(`${warnings} warning(s)`);

process.exit(errors ? 1 : 0);
