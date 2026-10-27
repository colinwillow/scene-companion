#!/usr/bin/env node
// Thumbnail studio: renders a standard lit thumbnail for every library prefab and character, headless.
//   node tools/thumbs.mjs                 every prefab (prefabs/index.json) + character (assets/…/characters/index.json)
//   node tools/thumbs.mjs tree zap        only these
//   node tools/thumbs.mjs --turntable     also an 8-frame turntable strip per character (thumbs/character/<name>.turntable.png)
//   --size 256 (px, square)  --look toon|pbr|baked
// Writes thumbs/<kind>/<name>.png, thumbs/index.json ({ "prefab:tree": "./thumbs/prefab/tree.png", … }) and fills each
// pack's `thumbnails`. Needs playwright (like the route bot). Browse the result at thumbs.html.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { thumbItems, thumbKey, thumbPath, packThumbnails } from '../runtime/thumbs.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const size = +opt('--size', 256), look = opt('--look', 'toon');
const turntable = args.includes('--turntable'); if (turntable) args.splice(args.indexOf('--turntable'), 1);
const readJson = (p, d) => { try { return JSON.parse(readFileSync(join(ROOT, p), 'utf8')); } catch { return d; } };

let items = thumbItems(readJson('prefabs/index.json', []), readJson('assets/models/colin/characters/index.json', []));
if (args.length) items = items.filter(i => args.includes(i.name));
if (!items.length) { console.error('nothing to render'); process.exit(2); }

let pw; try { pw = await import('playwright'); } catch { try { pw = createRequire(import.meta.url)('playwright'); } catch {} }
if (!pw) { console.error('needs playwright: npm i -D playwright && npx playwright install chromium'); process.exit(2); }

const PORT = 18500 + Math.floor(Math.random() * 1000);
const dev = spawn(process.execPath, [join(ROOT, 'tools/dev-server.mjs')], { cwd: ROOT, env: { ...process.env, PORT }, stdio: 'ignore' });
const browser = await (pw.chromium || pw.default.chromium).launch({ args: ['--enable-unsafe-swiftshader'] });
const index = readJson('thumbs/index.json', {});
let failed = 0;
try {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.route(/cdn\.jsdelivr\.net\/npm\/three@[^/]+\//, r => r.fulfill({ path: join(ROOT, 'node_modules/three', new URL(r.request().url()).pathname.replace(/^\/npm\/three@[^/]+\//, '')) }));
  page.on('pageerror', e => console.error('  page error:', e.message));
  await new Promise(r => setTimeout(r, 400));
  await page.goto(`http://localhost:${PORT}/thumbs.html?headless`);
  await page.waitForFunction(() => window.thumbsReady, null, { timeout: 120000 });
  for (const item of items) {
    const passes = [false, ...(turntable && item.kind === 'character' ? [true] : [])];
    for (const tt of passes) {
      try {
        const url = await page.evaluate(([i, o]) => window.renderThumb(i, o), [item, { size, look, turntable: tt }]);
        const out = thumbPath(item, tt);
        mkdirSync(join(ROOT, dirname(out)), { recursive: true });
        writeFileSync(join(ROOT, out), Buffer.from(url.split(',')[1], 'base64'));
        if (!tt) index[thumbKey(item)] = out;
        console.log(`✓ ${out}`);
      } catch (e) { failed++; console.error(`✗ ${item.kind} ${item.name}: ${e.message.split('\n')[0]}`); }
    }
  }
} finally { await browser.close(); dev.kill(); }

const sorted = Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)));
mkdirSync(join(ROOT, 'thumbs'), { recursive: true });
writeFileSync(join(ROOT, 'thumbs/index.json'), JSON.stringify(sorted, null, 1) + '\n');
// Packs list their items' thumbnails so a pack page / store can show them.
for (const id of existsSync(join(ROOT, 'packs')) ? readdirSync(join(ROOT, 'packs'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) : []) {
  const pf = `packs/${id}/pack.json`, pack = readJson(pf, null); if (!pack) continue;
  pack.thumbnails = packThumbnails(pack, sorted);
  writeFileSync(join(ROOT, pf), JSON.stringify(pack, null, 2) + '\n');
}
console.log(`${Object.keys(sorted).length} thumbnails in thumbs/index.json${failed ? `, ${failed} failed` : ''}`);
process.exit(failed ? 1 : 0);
