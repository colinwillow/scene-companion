// npm run quality [files…] — the quality gate on every model under assets/ (or the given ones): what fails, what to fix.
// --strict exits 1 when anything fails (for a pre-publish check).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readGlbJson, glbInfo } from './inventory.mjs';
import { qualityReport, passes } from '../runtime/quality.js';

const args = process.argv.slice(2).filter(a => !a.startsWith('--')), strict = process.argv.includes('--strict');
const walk = (d, o = []) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p, o) : p.endsWith('.glb') && o.push(p); } return o; };
const files = args.length ? args : walk('assets/models');
const thumbs = existsSync('thumbs/index.json') ? JSON.parse(readFileSync('thumbs/index.json', 'utf8')) : {};
const chars = new Map();   // glb path → character name (thumbnails are keyed by it)
for (const d of ['assets/models/colin/characters']) if (existsSync(d)) for (const n of readdirSync(d)) if (n.endsWith('.character.json')) {
  try { const c = JSON.parse(readFileSync(join(d, n), 'utf8')); chars.set(c.glb.replace(/^\.\//, ''), n.replace('.character.json', '')); } catch {}
}
let fails = 0, warns = 0;
for (const f of files) {
  const buf = readFileSync(f), info = glbInfo(readGlbJson(buf) || {}), ch = chars.get(f.replace(/\\/g, '/'));
  const r = qualityReport(info, { kb: buf.length / 1024, role: ch ? 'character' : '', thumb: ch ? thumbs[`character:${ch}`] : null });
  const tag = !passes(r) ? '✗' : r.length ? '⚠' : '✓';
  console.log(`${tag} ${f} — ${info.kind}, ${info.tris.toLocaleString()} tris, ${(buf.length / 1048576).toFixed(1)} MB`);
  for (const x of r) { console.log(`    ${x.level === 'fail' ? 'FAIL' : 'warn'}: ${x.msg}\n          fix: ${x.fix}`); x.level === 'fail' ? fails++ : warns++; }
}
console.log(`\n${files.length} models: ${fails} failing, ${warns} warnings`);
if (strict && fails) process.exit(1);
