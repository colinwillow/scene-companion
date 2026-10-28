// Scene thumbnails for the scene picker cards (Stage 9): plays each scene in scenes/index.json headless for a moment
// and saves a small JPEG at thumbs/scenes/<scene name>.jpg (the HUD, sticks and title card hidden).
// Usage: npm run thumbs:scenes [-- --only tiny-hop,sky-steps]. Needs playwright (installed globally here).
// Re-run after a scene changes how it looks. The picker falls back to a coloured card when a thumbnail is missing.
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2), oi = args.indexOf('--only'), only = oi >= 0 ? args[oi + 1].split(',') : null;
const PORT = +(process.env.PORT || 8795), BASE = `http://localhost:${PORT}/`;
const pw = (await import(join(execSync('npm root -g').toString().trim(), 'playwright/index.js'))).default;
const list = JSON.parse(readFileSync('scenes/index.json', 'utf8'));
const stem = f => f.split('/').pop().replace(/\.scene\.json$/, '');
mkdirSync('thumbs/scenes', { recursive: true });

let server = null;
try { await fetch(BASE + 'play.html'); } catch { server = spawn('node', ['tools/dev-server.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1500)); }
const b = await pw.chromium.launch();
for (const sc of list) {
  const name = stem(sc.file);
  if (only && !only.includes(name)) continue;
  const p = await b.newPage({ viewport: { width: 480, height: 300 } });
  await p.route(/cdn\.jsdelivr\.net\/npm\/three@[^/]+\/(.*)/, r => r.fulfill({ path: 'node_modules/three/' + r.request().url().match(/three@[^/]+\/(.*)/)[1] }));
  try {
    await p.goto(BASE + 'play.html?scene=' + encodeURIComponent(sc.file));
    await p.waitForFunction(() => window.__sc?.world?.entities?.size > 0, null, { timeout: 90000 });
    await p.waitForTimeout(2500);
    await p.addStyleTag({ content: '#hud,.pad,#hint,#liveBadge,#title,#stats,#scenes,#hudMsg,.bubble{display:none!important}' });
    await p.waitForTimeout(300);
    await p.screenshot({ path: `thumbs/scenes/${name}.jpg`, type: 'jpeg', quality: 70 });
    console.log('✓', name);
  } catch (e) { console.log('✗', name, e.message.split('\n')[0]); }
  await p.close();
}
await b.close(); server?.kill();
