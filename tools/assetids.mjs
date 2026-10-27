// npm run assets — give every file under assets/ a stable id (assets/ids.json: { id: { path, sha } }), notice files that were
// renamed or moved (same content, new path) and rewrite every reference to them in scenes/, prefabs/, packs/ and the character
// files, so nothing breaks. A file that is gone with no twin is reported. Run it after moving or renaming assets.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { reconcile, rewriteRefs, ASSET_EXT } from '../runtime/assetids.js';

const walk = (dir, out = []) => { for (const n of readdirSync(dir)) { const p = join(dir, n); statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; };
const files = walk('assets').filter(p => ASSET_EXT.test(p)).map(p => ({ path: p.replace(/\\/g, '/'), sha: createHash('sha1').update(readFileSync(p)).digest('hex').slice(0, 16) }));
const REG = 'assets/ids.json', registry = existsSync(REG) ? JSON.parse(readFileSync(REG, 'utf8')) : {};
const { registry: next, moved, added, gone } = reconcile(registry, files, () => randomUUID().slice(0, 13));
writeFileSync(REG, JSON.stringify(Object.fromEntries(Object.entries(next).sort((a, b) => a[1].path.localeCompare(b[1].path))), null, 1) + '\n');
// the Library's Sounds tab reads this list (a folder can't be listed from a web page)
writeFileSync('assets/audio/index.json', JSON.stringify(files.map(f => f.path).filter(p => /\.(mp3|ogg|wav)$/i.test(p)).map(p => './' + p).sort(), null, 1) + '\n');
let refs = 0;
if (Object.keys(moved).length) {
  const jsons = ['scenes', 'prefabs', 'packs', 'assets'].filter(existsSync).flatMap(d => walk(d)).filter(p => p.endsWith('.json') && !p.endsWith('ids.json'));
  for (const p of jsons) { const j = JSON.parse(readFileSync(p, 'utf8')), n = rewriteRefs(j, moved); if (n) { writeFileSync(p, JSON.stringify(j, null, 2) + '\n'); refs += n; console.log(`  ${p}: ${n} reference(s) relinked`); } }
}
for (const [a, b] of Object.entries(moved)) console.log(`moved   ${a} → ${b}`);
for (const g of gone) console.log(`GONE    ${g} (no file with the same content — fix its references by hand)`);
console.log(`${files.length} assets, ${added.length} new, ${Object.keys(moved).length} moved (${refs} references relinked), ${gone.length} gone`);
