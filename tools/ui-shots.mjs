#!/usr/bin/env node
// npm run ui:shots [out-dir] [--only name,name]  — screenshots of every screen, phone portrait (390×844) and landscape
// (844×390) and desktop where it matters, as JPEGs, for the UI work (Stage 9): before / after pictures and the audit.
// Needs the dev server on PORT (default 8793; it starts one if none answers) and playwright (installed globally here).
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2), only = (() => { const i = args.indexOf('--only'); return i >= 0 ? args.splice(i, 2)[1].split(',') : null; })();
const OUT = args[0] || 'docs/ui/shots', PORT = +(process.env.PORT || 8793), BASE = `http://localhost:${PORT}/`;
const pw = (await import(join(execSync('npm root -g').toString().trim(), 'playwright/index.js'))).default;
let server = null;
try { await fetch(BASE + 'index.html'); } catch { server = spawn('node', ['tools/dev-server.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1500)); }

const PHONE = { width: 390, height: 844 }, LAND = { width: 844, height: 390 }, DESK = { width: 1280, height: 800 };
const ready = p => p.waitForFunction(() => window.__sc?.world?.ready !== false && window.__sc?.world?.entities?.size > 0, null, { timeout: 150000 });
const shots = [
  // the editor
  { name: 'editor-portrait', url: 'index.html?scene=scenes/kitchen-sink.scene.json', view: PHONE },
  { name: 'editor-landscape', url: 'index.html?scene=scenes/kitchen-sink.scene.json', view: LAND },
  { name: 'editor-desktop', url: 'index.html?scene=scenes/kitchen-sink.scene.json', view: DESK },
  { name: 'editor-selected', url: 'index.html?scene=scenes/kitchen-sink.scene.json', view: PHONE, act: async p => { await p.evaluate(() => window.__sc.select('player')); } },
  { name: 'inspector', url: 'index.html?scene=scenes/kitchen-sink.scene.json', view: PHONE, act: async p => { await p.evaluate(() => window.__sc.select('player')); await p.click('#chipEdit').catch(() => {}); } },
  { name: 'inspector-landscape', url: 'index.html?scene=scenes/kitchen-sink.scene.json', view: LAND, act: async p => { await p.evaluate(() => window.__sc.select('player')); await p.click('#chipEdit').catch(() => {}); } },
  ...['characters', 'props', 'kit', 'motions', 'sounds', 'generate', 'sprites', 'ext', 'vars'].map(t => ({ name: `library-${t}`, url: 'index.html?scene=scenes/kitchen-sink.scene.json', view: PHONE,
    act: async p => { if (t === 'motions') await p.evaluate(() => window.__sc.select('player')); await p.click('#libBtn'); await p.click(`#lib .tabs button[data-t=${t}]`); await p.waitForTimeout(1200); } })),
  { name: 'slicer', url: 'index.html?scene=scenes/kitchen-sink.scene.json', view: PHONE,
    act: async p => { await p.click('#libBtn'); await p.click('#lib .tabs button[data-t=sprites]'); await p.waitForTimeout(1000); await p.click('#libList li:nth-child(3)'); await p.waitForTimeout(1500); } },
  { name: 'tile-paint', url: 'index.html?scene=scenes/tile-hop.scene.json', view: PHONE,
    act: async p => { await p.waitForFunction(() => window.__sc.world.getEntity('level')?.object3d.getObjectByName('__tiles'), null, { timeout: 100000 }); await p.evaluate(() => window.__scTile.tilePaint('level')); } },
  // the game
  { name: 'play-scenes', url: 'play.html', view: PHONE, wait: 'none' },
  { name: 'play-title', url: 'play.html?scene=scenes/side-hop.scene.json&fresh', view: PHONE },
  { name: 'play-portrait', url: 'play.html?scene=scenes/tiny-hop.scene.json&fresh', view: PHONE, act: async p => { await p.click('#titleGo').catch(() => {}); } },
  { name: 'play-landscape', url: 'play.html?scene=scenes/tiny-hop.scene.json&fresh', view: LAND, act: async p => { await p.click('#titleGo').catch(() => {}); } },
  { name: 'play-pause', url: 'play.html?scene=scenes/tiny-hop.scene.json&fresh', view: PHONE, act: async p => { await p.click('#titleGo').catch(() => {}); await p.click('#pause'); } },
  { name: 'play-mixer', url: 'play.html?scene=scenes/tiny-hop.scene.json&fresh', view: PHONE, act: async p => { await p.click('#titleGo').catch(() => {}); await p.click('#mute'); } },
  { name: 'play-2d', url: 'play.html?scene=scenes/zap-tiles.scene.json&fresh', view: LAND, act: async p => { await p.click('#titleGo').catch(() => {}); } },
  // the tool pages
  { name: 'vfx-portrait', url: 'vfx.html', view: PHONE, wait: 'none' },
  { name: 'vfx-desktop', url: 'vfx.html', view: DESK, wait: 'none' },
  { name: 'spritebake', url: 'spritebake.html', view: DESK, wait: 'none' },
].filter(s => !only || only.includes(s.name));

mkdirSync(OUT, { recursive: true });
const b = await pw.chromium.launch(), report = [];
for (const s of shots) {
  const p = await b.newPage({ viewport: s.view, deviceScaleFactor: 1, hasTouch: s.view !== DESK, isMobile: s.view !== DESK });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/cdn\.jsdelivr\.net\/npm\/three@[^/]+\/(.*)/, r => r.fulfill({ path: 'node_modules/three/' + r.request().url().match(/three@[^/]+\/(.*)/)[1] }));
  try {
    await p.goto(BASE + s.url);
    if (s.wait !== 'none') await ready(p); else await p.waitForTimeout(2500);
    await p.waitForTimeout(1500);
    if (s.act) await s.act(p);
    await p.waitForTimeout(1200);
    await p.screenshot({ path: join(OUT, `${s.name}.jpg`), type: 'jpeg', quality: 72, timeout: 120000 });
    report.push(`✓ ${s.name}${errs.length ? '  (page errors: ' + errs.slice(0, 2).join(' | ') + ')' : ''}`);
  } catch (e) { report.push(`✗ ${s.name}: ${e.message.split('\n')[0]}`); }
  await p.close();
}
await b.close(); server?.kill();
writeFileSync(join(OUT, 'index.txt'), report.join('\n') + '\n');
console.log(report.join('\n'));
