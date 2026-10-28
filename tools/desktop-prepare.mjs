#!/usr/bin/env node
// npm run desktop:prepare — copy the editor, the game and everything they load into desktop/dist (what the Tauri app
// bundles), with three.js vendored so the desktop app runs offline. Run it before `npm run tauri build` in desktop/.
import { readFileSync, writeFileSync, cpSync, existsSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { vendorThree, localThree } from './vendor-three.mjs';

const OUT = 'desktop/dist';
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const pages = ['index.html', 'play.html', 'vfx.html', 'spritebake.html'].filter(existsSync);
const dirs = ['runtime', 'ui', 'behaviors', 'vendor', 'scenes', 'prefabs', 'assets', 'extensions', 'thumbs', 'packs', 'parks'].filter(existsSync);
for (const d of dirs) cpSync(d, join(OUT, d), { recursive: true });
for (const p of pages) writeFileSync(join(OUT, p), localThree(readFileSync(p, 'utf8')));
const code = [...pages, ...['runtime', 'behaviors'].flatMap(d => readdirSync(d).filter(f => f.endsWith('.js')).map(f => join(d, f)))];
const n = vendorThree(OUT, code);
const left = pages.filter(p => /cdn\.jsdelivr/.test(readFileSync(join(OUT, p), 'utf8')));
console.log(`desktop/dist: ${pages.length} pages, ${dirs.length} folders, three + ${n} addon files${left.length ? ` — ⚠ still naming the CDN: ${left.join(', ')}` : ''}`);
