#!/usr/bin/env node
// npm run export:app scenes/tiny-hop.scene.json [--id com.you.tinyhop] [--name "Tiny Hop"] [out-dir]
// Writes a Capacitor project (default export/app/<scene>/) whose www/ is the game, self-contained and offline: the play
// page (opening straight into this scene, no editor links), three.js vendored next to it, the runtime and behaviors, and
// only the asset files the scene reaches. Then, on a Mac / PC: docs/ship-app.md (npm install, npx cap add ios|android).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, cpSync, readdirSync } from 'node:fs';
import { dirname, join, basename, normalize } from 'node:path';
import { glbExternal } from './undraco.mjs';
import { vendorThree, localThree } from './vendor-three.mjs';

const args = process.argv.slice(2), flag = k => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
const appId = flag('--id'), appName = flag('--name');
const [scenePath, outArg] = args;
if (!scenePath) { console.error('usage: npm run export:app <scene.json> [--id com.you.game] [--name "Game"] [out-dir]'); process.exit(1); }
const rel = p => normalize(String(p).replace(/^\.\//, ''));
const scene = JSON.parse(readFileSync(rel(scenePath), 'utf8')), stem = basename(scenePath).replace(/\.scene\.json$|\.json$/, '');
const out = outArg || join('export/app', stem), www = join(out, 'www');
const title = appName || scene.settings?.title?.text || stem;

// ---- every file the scene reaches: any "./assets/…" / "./prefabs/…" string in it, in the prefabs it uses, and in the
// character files those name (their glb). Followed until nothing new turns up.
const files = new Set([rel(scenePath)]), queue = [scene];
const take = p => { const r = rel(p); if (files.has(r) || !existsSync(r)) return; files.add(r);
  if (r.endsWith('.json')) queue.push(JSON.parse(readFileSync(r, 'utf8'))); if (r.endsWith('.glb')) glbExternal(r).forEach(take); };
for (const name of Object.keys(scene.prefabs || {})) take(scene.prefabs[name]);
const walkStrings = (v, fn) => Array.isArray(v) ? v.forEach(x => walkStrings(x, fn)) : v && typeof v === 'object' ? Object.values(v).forEach(x => walkStrings(x, fn)) : typeof v === 'string' && fn(v);
while (queue.length) walkStrings(queue.shift(), s => { if (/^(\.\/)?(assets|prefabs)\/.+\.\w+$/.test(s)) take(s); });
for (const e of scene.entities || []) if (e.prefab && !scene.prefabs?.[e.prefab]) take(`./prefabs/${e.prefab}.prefab.json`);
while (queue.length) walkStrings(queue.shift(), s => { if (/^(\.\/)?(assets|prefabs)\/.+\.\w+$/.test(s)) take(s); });
if (existsSync('assets/fx')) for (const f of readdirSync('assets/fx')) take(`assets/fx/${f}`);   // particle presets are looked up by name at run time

const ownCode = ['play.html', ...['runtime', 'behaviors'].flatMap(d => readdirSync(d).filter(f => f.endsWith('.js')).map(f => join(d, f)))];
mkdirSync(www, { recursive: true });
for (const d of ['runtime', 'behaviors', 'vendor', 'ui']) cpSync(d, join(www, d), { recursive: true });
const addonCount = vendorThree(www, ownCode);
for (const f of files) { mkdirSync(join(www, dirname(f)), { recursive: true }); copyFileSync(f, join(www, f)); }
writeFileSync(join(www, 'scenes/index.json'), JSON.stringify([{ file: './' + rel(scenePath), title, note: '' }], null, 1) + '\n');

// the page: three from the vendored copy, this scene by default, and no editor / scene-list buttons
let page = localThree(readFileSync('play.html', 'utf8'));
page = page.replace('<head>', `<head>\n<script>if (!location.search.includes('scene=')) history.replaceState(null, '', '?scene=${encodeURIComponent('./' + rel(scenePath))}');</script>\n<style>#edit, #scenesBtn { display: none !important; }</style>`);
if (/cdn\.jsdelivr/.test(page)) console.warn('⚠ the page still names the CDN somewhere — check www/index.html');
writeFileSync(join(www, 'index.html'), page);

const id = appId || `com.scenecompanion.${stem.replace(/[^a-z0-9]/gi, '').toLowerCase()}`;
writeFileSync(join(out, 'capacitor.config.json'), JSON.stringify({ appId: id, appName: title, webDir: 'www', ios: { contentInset: 'never' }, android: { allowMixedContent: false } }, null, 2) + '\n');
writeFileSync(join(out, 'package.json'), JSON.stringify({ name: stem.toLowerCase(), private: true, version: '1.0.0',
  scripts: { 'add:ios': 'cap add ios', 'add:android': 'cap add android', sync: 'cap sync', 'open:ios': 'cap open ios', 'open:android': 'cap open android' },
  dependencies: { '@capacitor/core': '^6.2.0', '@capacitor/ios': '^6.2.0', '@capacitor/android': '^6.2.0' }, devDependencies: { '@capacitor/cli': '^6.2.0' } }, null, 2) + '\n');
writeFileSync(join(out, 'README.md'), `# ${title} — app build\n\nMade by Scene Companion from \`${scenePath}\`. \`www/\` is the whole game, offline.\nSteps: see Scene Companion's docs/ship-app.md (npm install → npx cap add ios / android → npx cap open ios / android).\n`);
const kb = [...files].reduce((n, f) => n + readFileSync(f).length, 0) / 1024;
console.log(`wrote ${out}/ — www/ (${files.size} scene file(s), ${(kb / 1024).toFixed(1)} MB of assets, three + ${addonCount} addon file(s)), capacitor.config.json (${id}), package.json`);
console.log('Next, on a Mac (iOS) or any PC (Android): see docs/ship-app.md');
