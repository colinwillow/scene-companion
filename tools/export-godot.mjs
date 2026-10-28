#!/usr/bin/env node
// npm run export:godot scenes/tiny-hop.scene.json [out-dir]
// Writes a Godot 4 project: project.godot, main.tscn (runtime/godot.js) and a copy of every asset the scene uses at the
// same relative path, so res://assets/... resolves. Open the folder in Godot 4 and press Play. Default out: export/godot/<scene>/.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { resolveScene, measure, isDraco } from './scene-resolve.mjs';
import { toTscn } from '../runtime/godot.js';
import { undraco, glbExternal } from './undraco.mjs';

const [scenePath, outArg] = process.argv.slice(2);
if (!scenePath) { console.error('usage: npm run export:godot <scene.json> [out-dir]'); process.exit(1); }
const rel = p => String(p).replace(/^\.\//, '');
const json = p => JSON.parse(readFileSync(rel(p), 'utf8'));
const scene = json(scenePath), stem = basename(scenePath).replace(/\.scene\.json$|\.json$/, '');
const out = outArg || join('export/godot', stem);

const entities = resolveScene(scene);
const { tscn, files } = toTscn(entities, { name: stem, settings: scene.settings || {}, measure });

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'main.tscn'), tscn);
writeFileSync(join(out, 'project.godot'), `; Exported by Scene Companion from ${scenePath}\nconfig_version=5\n\n[application]\n\nconfig/name="${stem}"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.3")\n\n[rendering]\n\nrenderer/rendering_method="mobile"\n`);
const missing = [], draco = [];
for (const g of [...files]) if (g.endsWith('.glb')) for (const x of glbExternal(g)) if (!files.includes(x)) files.push(x);   // textures beside a GLB
for (const f of files) {
  if (!existsSync(f)) { missing.push(f); continue; }
  mkdirSync(join(out, dirname(f)), { recursive: true });
  if (f.endsWith('.glb') && isDraco(f)) { writeFileSync(join(out, f), (await undraco(readFileSync(f))).buf); draco.push(f); }   // Godot 4 cannot read Draco
  else copyFileSync(f, join(out, f));
}
writeFileSync(join(out, 'scene-companion.json'), JSON.stringify(scene, null, 1) + '\n');   // the source scene, for a Godot-side importer later
console.log(`wrote ${out}/ — main.tscn (${entities.length} top-level nodes), project.godot, ${files.length - missing.length} asset file(s)`);
if (missing.length) console.log(`⚠ missing: ${missing.join(', ')}`);
if (draco.length) console.log(`${draco.length} Draco model(s) decoded to plain GLB for Godot (it cannot read Draco): ${draco.map(f => basename(f)).join(', ')}`);
console.log('Open the folder in Godot 4.3+ and press Play. Behaviors are on each node as metadata "sc_behaviors" (JSON); they do not run in Godot yet.');
