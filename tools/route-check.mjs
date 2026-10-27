#!/usr/bin/env node
// Route check: a bot walks and jumps through a list of entities in the real game page (headless), so a level
// edit can be checked without a phone. It steers straight at each target, jumps at the edge of what it stands on
// (or when close), and waits for moving platforms to come within reach.
//   node tools/route-check.mjs ./scenes/sky-steps.scene.json coin_09 step_01 step_02 … summit
//   npm run route -- ./scenes/sky-steps.scene.json      (no ids: uses the scene's settings.route)
// Targets with a Solid must be landed on; anything else just has to be reached. Exit 1 if any target fails.
// Needs playwright (like the MCP headless editor). Software GL is slow, so loading takes a while; the climb itself
// is stepped at a fixed 60 Hz inside the page, so results don't depend on the machine's speed.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [scene, ...ids] = process.argv.slice(2);
let route = ids;
if (scene && !route.length) try { route = JSON.parse(readFileSync(join(ROOT, scene.replace(/^\.\//, '')), 'utf8')).settings?.route || []; } catch {}
if (!scene || !route.length) { console.error('usage: node tools/route-check.mjs <scene.json> <id> [id …]'); process.exit(2); }
let pw; try { pw = await import('playwright'); } catch { try { pw = createRequire(import.meta.url)('playwright'); } catch {} }
if (!pw) { console.error('needs playwright: npm i -D playwright && npx playwright install chromium'); process.exit(2); }

const PORT = 18500 + Math.floor(Math.random() * 1000);
const dev = spawn(process.execPath, [join(ROOT, 'tools/dev-server.mjs')], { cwd: ROOT, env: { ...process.env, PORT }, stdio: 'ignore' });
const browser = await (pw.chromium || pw.default.chromium).launch({ args: ['--enable-unsafe-swiftshader'] });
let code = 1;
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 700 } });
  await page.route(/cdn\.jsdelivr\.net\/npm\/three@[^/]+\//, r => r.fulfill({ path: join(ROOT, 'node_modules/three', new URL(r.request().url()).pathname.replace(/^\/npm\/three@[^/]+\//, '')) }));
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await new Promise(r => setTimeout(r, 400));
  await page.goto(`http://localhost:${PORT}/play.html?scene=${encodeURIComponent(scene)}`);
  await page.waitForFunction(() => window.__sc?.world?.entities?.get?.('player'), null, { timeout: 240000 });
  const res = await page.evaluate(route => {
    const w = window.__sc.world, pl = w.entities.get('player');
    const find = (e, n) => e?.behaviors.find(b => b.constructor.name === n);
    const pc = find(pl, 'PlayerController'), hp = () => find(pl, 'Health')?.current, p = pl.object3d.position;
    const out = []; let prev = null, t = 0;
    for (const id of route) {
      const ent = w.entities.get(id);
      if (!ent) { out.push({ id, ok: false, why: 'no such entity' }); break; }
      const solid = find(ent, 'Solid'), tp = ent.object3d.position;
      const t0 = t; let ok = false;
      for (let f = 0; f < 900 && !ok; f++, t += 1 / 60) {
        const dx = tp.x - p.x, dz = tp.z - p.z, d = Math.hypot(dx, dz), top = solid ? solid.box().maxY : null;
        if (solid ? pc.grounded && d < 0.6 && Math.abs(p.y - top) < 0.05 : d < 0.5) { ok = true; break; }
        w.input.move = d > 0.2 ? [dx / d, dz / d] : [0, 0];
        const pb = prev?.box(), atEdge = !pb || p.x < pb.minX + 0.1 || p.x > pb.maxX - 0.1 || p.z < pb.minZ + 0.1 || p.z > pb.maxZ - 0.1;
        const reach = pc.params.jumpSpeed ** 2 / (2 * pc.params.gravity) - 0.4;   // jump apex minus a margin
        if (solid && pc.grounded && p.y < top - 0.05 && (d < 2.6 || atEdge)) {
          if (top - p.y < reach) w.input.jump = true;
          else if (prev && atEdge) w.input.move = [0, 0];                       // too high for now: wait at the edge (moving platforms)
        }
        w.update(1 / 60); w.animate(1 / 60);
      }
      out.push({ id, ok, seconds: +(t - t0).toFixed(1), y: +p.y.toFixed(2), hp: hp() });
      if (!ok) break;
      prev = solid || null;
    }
    w.input.move = [0, 0];
    return out;
  }, route);
  await new Promise(r => setTimeout(r, 300));
  for (const r of res) console.log(`${r.ok ? '✓' : '✗'} ${r.id}${r.why ? ` — ${r.why}` : ` (${r.seconds} s, y ${r.y}, health ${r.hp})`}`);
  console.log(`coins ${await page.textContent('#coins').catch(() => '?')}; page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  code = res.length === route.length && res.every(r => r.ok) && !errors.length ? 0 : 1;
} finally { await browser.close(); dev.kill(); }
process.exit(code);
