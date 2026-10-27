#!/usr/bin/env node
// Full check: `npm run check` (validate + tests), then the route bot on every scene that lists a settings.route.
//   npm run check:full
// Slow (a headless browser per scene), so it isn't part of `npm run check`. Needs playwright.
// A scene can mark a route failure as known with settings.routeKnownIssue ("why"): it's reported as ⚠ and doesn't
// fail the run. If that route starts passing, the run says so, so the note can be removed.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = args => spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' }).status;

console.log('── npm run check');
const npm = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', '-s', 'check'], { cwd: ROOT, stdio: 'inherit' });
if (npm.status !== 0) { console.error('✗ npm run check failed'); process.exit(1); }

const scenes = readdirSync(join(ROOT, 'scenes')).filter(f => f.endsWith('.scene.json')).sort().map(f => {
  let settings = {}; try { settings = JSON.parse(readFileSync(join(ROOT, 'scenes', f), 'utf8')).settings || {}; } catch {}
  return { file: `./scenes/${f}`, route: settings.route || [], known: settings.routeKnownIssue };
}).filter(s => s.route.length);

const results = [];
for (const s of scenes) {
  console.log(`── route ${s.file} (${s.route.length} stops)`);
  const code = run([join(ROOT, 'tools/route-check.mjs'), s.file]);
  results.push({ ...s, code });
  if (code === 2) { console.error('✗ route bot could not run (playwright missing?)'); process.exit(1); }
}

console.log('── summary');
let failed = 0;
for (const r of results) {
  if (r.code === 0) console.log(`✓ ${r.file}${r.known ? ' — passes now; remove settings.routeKnownIssue' : ''}`);
  else if (r.known) console.log(`⚠ ${r.file} — known issue: ${r.known}`);
  else { console.log(`✗ ${r.file}`); failed++; }
}
if (!results.length) console.log('(no scene has a settings.route)');
process.exit(failed ? 1 : 0);
