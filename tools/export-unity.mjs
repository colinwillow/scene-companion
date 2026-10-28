#!/usr/bin/env node
// npm run export:unity scenes/tiny-hop.scene.json [out-dir]
// Writes export/unity/<scene>/SceneCompanion/ — a folder to drop into a Unity project's Assets/: the scene as JSON
// (<scene>.sc.json, already in Unity's space), the GLBs it uses (Draco decoded; textures beside them copied), and two
// scripts (Editor/SceneCompanionImporter.cs, ScBehaviors.cs). In Unity: install glTFast, then Scene Companion › Build Scene.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { resolveScene, measure, isDraco } from './scene-resolve.mjs';
import { flatNodes, toUnity } from '../runtime/engines.js';
import { undraco, glbExternal } from './undraco.mjs';

const [scenePath, outArg] = process.argv.slice(2);
if (!scenePath) { console.error('usage: npm run export:unity <scene.json> [out-dir]'); process.exit(1); }
const scene = JSON.parse(readFileSync(scenePath.replace(/^\.\//, ''), 'utf8')), stem = basename(scenePath).replace(/\.scene\.json$|\.json$/, '');
const out = join(outArg || join('export/unity', stem), 'SceneCompanion');
const flat = flatNodes(resolveScene(scene), { measure });
// JsonUtility cannot read a null number: every light field gets the game's default
const nodes = toUnity(flat).map(n => n.light ? { ...n, light: { ...n.light, intensity: n.light.intensity ?? (n.light.type === 'directional' ? 2 : n.light.type === 'hemisphere' ? 1 : 20),
  distance: n.light.distance ?? (n.light.type === 'spot' ? 15 : 10), angle: n.light.angle ?? 35, shadows: n.light.shadows !== false } } : n);
const st = scene.settings || {};
mkdirSync(join(out, 'Editor'), { recursive: true });
writeFileSync(join(out, `${stem}.sc.json`), JSON.stringify({ name: stem, background: st.background || '#202833', sky: !!st.sky, player: 'player', nodes }, null, 1) + '\n');
copyFileSync('tools/unity/SceneCompanionImporter.cs', join(out, 'Editor/SceneCompanionImporter.cs'));
copyFileSync('tools/unity/ScBehaviors.cs', join(out, 'ScBehaviors.cs'));
const files = [...flat.files]; for (const g of [...files]) for (const x of glbExternal(g)) if (!files.includes(x)) files.push(x);
const missing = [], draco = [];
for (const f of files) {
  if (!existsSync(f)) { missing.push(f); continue; }
  mkdirSync(join(out, dirname(f)), { recursive: true });
  if (f.endsWith('.glb') && isDraco(f)) { writeFileSync(join(out, f), (await undraco(readFileSync(f))).buf); draco.push(f); }
  else copyFileSync(f, join(out, f));
}
console.log(`wrote ${out}/ — ${stem}.sc.json (${nodes.length} objects), ${files.length - missing.length} asset file(s), the importer scripts${draco.length ? `; ${draco.length} Draco model(s) decoded` : ''}`);
if (missing.length) console.log(`⚠ missing: ${missing.join(', ')}`);
console.log('In Unity: install glTFast (Package Manager › + › Add package by name › com.unity.cloud.gltfast), drop the SceneCompanion folder into Assets, then menu Scene Companion › Build Scene. Steps: docs/ship-engines.md');
