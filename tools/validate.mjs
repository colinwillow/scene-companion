#!/usr/bin/env node
// Checks scene files against the rules in SKILL.md.
// Usage: node tools/validate.mjs [scenes/*.scene.json ...]   (defaults to every scene in scenes/)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getBehavior } from '../runtime/registry.js';
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

let errors = 0;
const err = (f, msg) => { errors++; console.error(`✗ ${f}: ${msg}`); };

for (const f of files) {
  const scene = JSON.parse(readFileSync(f, 'utf8'));
  const ids = new Set();
  for (const e of scene.entities || []) {
    if (!e.id) err(f, 'entity without an id');
    else if (ids.has(e.id)) err(f, `duplicate id "${e.id}"`);
    ids.add(e.id);
    if (!e.light && e.asset && !scene.assets?.[e.asset]) err(f, `${e.id}: unknown asset "${e.asset}"`);
    for (const b of e.behaviors || []) {
      const Cls = getBehavior(b.type);
      if (!Cls) { err(f, `${e.id}: unknown behavior "${b.type}"`); continue; }
      for (const [k, v] of Object.entries(b.params || {})) {
        const def = Cls.schema[k];
        if (!def) err(f, `${e.id}.${b.type}: "${k}" is not in the schema`);
        else if (!typeOk(def, v)) err(f, `${e.id}.${b.type}.${k}: ${JSON.stringify(v)} doesn't fit ${def.type}${def.min !== undefined ? ` [${def.min}..${def.max}]` : ''}`);
      }
    }
  }
  if (!errors) console.log(`✓ ${f} — ${ids.size} entities`);
}

// No hardcoded placement in behavior code: flag literal position assignments.
const src = readFileSync('behaviors/index.js', 'utf8');
const bad = src.match(/position\.set\(\s*-?\d/g);
if (bad) err('behaviors/index.js', `hardcoded placement (${bad.length}× position.set with literals) — put it in the scene file`);

process.exit(errors ? 1 : 0);
