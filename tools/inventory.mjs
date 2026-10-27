#!/usr/bin/env node
// Inventory: one index of every GLB across Colin's repos, so assets are taken stock of once and promoted on purpose
// (SPEC §7b). Reads only each GLB's JSON chunk (no decoding), so a few thousand files take seconds.
//   node tools/inventory.mjs                    scan the default sibling checkouts (../weirdport, ../zap, … ../colinwillow/city)
//   node tools/inventory.mjs ../zap ../peggy    scan just these
// Writes inventory.json (every unique file by content hash, with every place it lives) and INVENTORY.md (readable).
// Status per asset: raw → imported (same bytes are in this repo's assets/) → full asset (a character.json uses it)
// → packed (listed in a pack). `npm run validate` warns when an imported model of Colin's is missing from the inventory.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_REPOS = ['weirdport', 'zap', 'colinwillow/city', 'rollergirl', 'plutopia', 'peggy', 'blender-addons',
  'retarget-anims', 'culture_war', 'robits', 'BigDon', 'glorp', 'creature', 'water', 'colin'];
const SKIP_DIRS = new Set(['.git', 'node_modules', 'morph', '__pycache__', 'exports', 'shots']);
const RESIDUE = /^(CINEMA_4D_Main|tpose)(\.\d+)?$|\.\d{3}$/;   // exporter residue and Blender .001 duplicates

// ---- GLB reading (pure, tested)
export function readGlbJson(buf) {
  if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'glTF') return null;
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.toString('utf8', 20, 20 + len));
}

function quatMat([x, y, z, w]) {
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}
function nodeMatrix(n) {   // 3x4 row-major [R*S | T]
  if (n.matrix) { const m = n.matrix; return [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]]; }
  const r = quatMat(n.rotation || [0, 0, 0, 1]), [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
  return [r[0] * sx, r[1] * sy, r[2] * sz, tx, r[3] * sx, r[4] * sy, r[5] * sz, ty, r[6] * sx, r[7] * sy, r[8] * sz, tz];
}
function mul(a, b) {
  const o = new Array(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) o[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j];
    o[i * 4 + 3] = a[i * 4] * b[3] + a[i * 4 + 1] * b[7] + a[i * 4 + 2] * b[11] + a[i * 4 + 3];
  }
  return o;
}
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

// Summarise a parsed glTF: kind, rig, clips, size in metres, triangles, compression.
export function glbInfo(j) {
  const nodes = j.nodes || [], meshes = j.meshes || [], acc = j.accessors || [];
  const joints = Math.max(0, ...(j.skins || []).map(s => s.joints.length));
  const jointNames = new Set((j.skins || []).flatMap(s => s.joints.map(i => nodes[i]?.name || '')));
  const mixamo = [...jointNames].some(n => /^mixamorig/i.test(n));
  const clips = (j.animations || []).map(a => a.name || '').filter(n => n && !RESIDUE.test(n));
  let tris = 0;
  for (const m of meshes) for (const p of m.primitives || []) {
    const c = p.indices !== undefined ? acc[p.indices]?.count : acc[p.attributes?.POSITION]?.count;
    tris += Math.floor((c || 0) / 3);
  }
  // Bounds: a skinned mesh's geometry is already in bind (≈ world) space, so its node transform is ignored —
  // the armature's 0.01 scale would otherwise shrink it 100×. Everything else goes through its node transforms.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const scene = (j.scenes || [])[j.scene || 0] || { nodes: nodes.map((_, i) => i) };
  const walk = (i, M, depth) => {
    const n = nodes[i]; if (!n || depth > 64) return;
    const W = mul(M, nodeMatrix(n));
    if (n.mesh !== undefined) {
      const T = n.skin !== undefined ? IDENT : W;
      for (const p of meshes[n.mesh]?.primitives || []) {
        const a = acc[p.attributes?.POSITION]; if (!a?.min || !a?.max) continue;
        for (let k = 0; k < 8; k++) {
          const v = [k & 1 ? a.max[0] : a.min[0], k & 2 ? a.max[1] : a.min[1], k & 4 ? a.max[2] : a.min[2]];
          for (let r = 0; r < 3; r++) {
            const c = T[r * 4] * v[0] + T[r * 4 + 1] * v[1] + T[r * 4 + 2] * v[2] + T[r * 4 + 3];
            lo[r] = Math.min(lo[r], c); hi[r] = Math.max(hi[r], c);
          }
        }
      }
    }
    for (const c of n.children || []) walk(c, W, depth + 1);
  };
  for (const r of scene.nodes || []) walk(r, IDENT, 0);
  const size = Number.isFinite(lo[0]) ? hi.map((h, k) => +(h - lo[k]).toFixed(3)) : null;
  const ext = j.extensionsUsed || [];
  const skinned = (j.skins || []).length > 0 && meshes.length > 0;
  const kind = skinned ? 'character' : meshes.length ? (clips.length ? 'animated' : 'model') : clips.length ? 'motion' : 'empty';
  return {
    kind, joints, mixamo, clips, tris, size,
    draco: ext.includes('KHR_draco_mesh_compression'), meshopt: ext.includes('EXT_meshopt_compression'),
    ktx2: ext.includes('KHR_texture_basisu'), webp: ext.includes('EXT_texture_webp'),
    images: (j.images || []).length,
    doubleSided: (j.materials || []).some(m => m.doubleSided),
    blend: (j.materials || []).some(m => m.alphaMode === 'BLEND'),
  };
}

export const sha1 = buf => createHash('sha1').update(buf).digest('hex');

function* glbFiles(dir) {
  let list; try { list = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of list) {
    if (d.isDirectory()) { if (!SKIP_DIRS.has(d.name)) yield* glbFiles(join(dir, d.name)); }
    else if (d.name.toLowerCase().endsWith('.glb')) yield join(dir, d.name);
  }
}

// What this repo already uses: hash → status, from assets/, character.json files and packs.
function localStatus() {
  const byHash = new Map();
  const rank = { imported: 1, 'full asset': 2, packed: 3 };
  const bump = (h, s, where) => {
    const cur = byHash.get(h);
    if (!cur || rank[s] > rank[cur.status]) byHash.set(h, { status: s, where: cur?.where || where });
  };
  const pathHash = new Map();
  for (const f of glbFiles(join(ROOT, 'assets'))) {
    const h = sha1(readFileSync(f)); const rel = './' + relative(ROOT, f);
    pathHash.set(rel, h); bump(h, 'imported', rel);
  }
  const charFiles = [...(function* walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) yield* walk(join(d, e.name)); else if (e.name.endsWith('.character.json')) yield join(d, e.name);
    }
  })(join(ROOT, 'assets'))];
  const charGlb = new Map();
  for (const f of charFiles) {
    try { const c = JSON.parse(readFileSync(f, 'utf8')); const h = pathHash.get(c.glb); if (h) { bump(h, 'full asset', c.glb); charGlb.set('./' + relative(ROOT, f), h); } } catch {}
  }
  const packsDir = join(ROOT, 'packs');
  if (existsSync(packsDir)) for (const d of readdirSync(packsDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    try {
      const p = JSON.parse(readFileSync(join(packsDir, d.name, 'pack.json'), 'utf8'));
      for (const c of p.characters || []) { const h = charGlb.get(c); if (h) bump(h, 'packed', c); }
      for (const name of p.prefabs || []) {
        const pf = join(ROOT, 'prefabs', `${name}.prefab.json`); if (!existsSync(pf)) continue;
        const glb = JSON.stringify(JSON.parse(readFileSync(pf, 'utf8'))).match(/"glb":"([^"]+)"/)?.[1];
        const h = glb && pathHash.get(glb); if (h) bump(h, 'packed', glb);
      }
    } catch {}
  }
  return byHash;
}

// Re-runs only re-read files whose size or mtime changed (the cache is local, gitignored).
const CACHE = join(ROOT, '.inventory-cache.json');
export function scan(repoDirs, { cache = true } = {}) {
  const local = localStatus();
  const old = cache && existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {}, fresh = {};
  const assets = new Map();   // hash → entry
  let files = 0, lfs = 0;
  for (const dir of repoDirs) {
    const repo = relative(join(ROOT, '..'), dir) || basename(dir);
    for (const f of glbFiles(dir)) {
      const st = statSync(f);
      if (st.size < 1024) { lfs++; continue; }    // LFS pointer or empty
      const key = `${f}|${st.size}|${st.mtimeMs}`;
      let h, info;
      if (old[key]) ({ h, info } = old[key]);
      else {
        let buf; try { buf = readFileSync(f); } catch { continue; }
        let j; try { j = readGlbJson(buf); } catch { j = null; }
        if (!j) { lfs++; continue; }
        h = sha1(buf); info = glbInfo(j);
      }
      fresh[key] = { h, info };
      files++;
      const at = `${repo}/${relative(dir, f)}`;
      const cur = assets.get(h);
      if (cur) { cur.locations.push(at); continue; }
      assets.set(h, { hash: h.slice(0, 12), name: basename(f, '.glb'), kb: Math.round(st.size / 1024), ...info,
        status: local.get(h)?.status || 'raw', here: local.get(h)?.where || null, locations: [at] });
    }
  }
  if (cache) writeFileSync(CACHE, JSON.stringify(fresh));
  return { files, skipped: lfs, assets: [...assets.values()] };
}

function markdown({ files, skipped, assets }, repos) {
  const L = [];
  const by = k => assets.filter(a => a.kind === k).sort((a, b) => a.locations[0].localeCompare(b.locations[0]));
  const flags = a => [a.draco && 'draco', a.meshopt && 'meshopt', a.ktx2 && 'ktx2', a.webp && 'webp', a.doubleSided && '2-sided', a.blend && 'BLEND'].filter(Boolean).join(' ');
  const dims = a => a.size ? a.size.map(v => v.toFixed(2)).join('×') : '';
  const where = a => a.locations.length > 1 ? `${a.locations[0]} (+${a.locations.length - 1} copies)` : a.locations[0];
  L.push('# Inventory — every GLB across Colin\'s repos', '',
    `Generated by \`node tools/inventory.mjs\` on ${new Date().toISOString().slice(0, 10)}. Do not edit by hand — re-run it.`,
    `Scanned: ${repos.join(', ')}. ${files} files → ${assets.length} unique (by content). ${skipped} skipped (LFS pointers / not GLB).`, '',
    'Status: **raw** (only in its game repo) → **imported** (same bytes in `assets/`) → **full asset** (a `character.json` uses it) → **packed** (in a pack).',
    'Sizes are metres as authored (raw units for some exports — e.g. Plutopia rocks are cm). `2-sided`/`BLEND` = fix before shipping (use `frontSide`).', '');
  const counts = {}; for (const a of assets) counts[a.kind] = (counts[a.kind] || 0) + 1;
  const st = {}; for (const a of assets) st[a.status] = (st[a.status] || 0) + 1;
  L.push(`**${counts.character || 0}** characters · **${counts.model || 0}** models · **${counts.animated || 0}** animated models · **${counts.motion || 0}** motion clips · status: ${Object.entries(st).map(([k, v]) => `${k} ${v}`).join(', ')}`, '');

  L.push('## Characters (rigged)', '', '| name | status | where | KB | joints | Mixamo | clips | tris | size (m) | flags |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const a of by('character')) L.push(`| ${a.name} | ${a.status} | ${where(a)} | ${a.kb} | ${a.joints} | ${a.mixamo ? '✓' : ''} | ${a.clips.length} | ${a.tris} | ${dims(a)} | ${flags(a)} |`);
  L.push('', '<details><summary>Clip lists per character</summary>', '');
  for (const a of by('character').filter(a => a.clips.length)) L.push(`- **${a.name}** (${where(a)}): ${a.clips.join(', ')}`);
  L.push('', '</details>', '');

  L.push('## Models (props, buildings, kits, worlds)', '', '| name | status | where | KB | tris | size | flags |', '|---|---|---|---|---|---|---|');
  for (const a of [...by('model'), ...by('animated')]) L.push(`| ${a.name}${a.kind === 'animated' ? ' 🎞' : ''} | ${a.status} | ${where(a)} | ${a.kb} | ${a.tris} | ${dims(a)} | ${flags(a)} |`);
  L.push('');

  L.push('## Motion clips (animation only)', '');
  const groups = new Map();
  for (const a of by('motion')) { const d = dirname(a.locations[0]); (groups.get(d) || groups.set(d, []).get(d)).push(a); }
  for (const [d, list] of [...groups].sort()) L.push(`- **${d}** (${list.length} files): ${list.map(a => a.clips.length === 1 ? a.clips[0] : `${a.name} [${a.clips.length}]`).join(', ')}`);
  L.push('');
  return L.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dirs = (args.length ? args.map(a => resolve(a)) : DEFAULT_REPOS.map(r => join(ROOT, '..', r))).filter(d => existsSync(d));
  if (!dirs.length) { console.error('no repo checkouts found next to scene-companion — clone them or pass paths'); process.exit(1); }
  const t0 = Date.now();
  const res = scan(dirs);
  const repos = dirs.map(d => relative(join(ROOT, '..'), d));
  writeFileSync(join(ROOT, 'inventory.json'), JSON.stringify({ generated: new Date().toISOString(), repos, ...res }, null, 0) + '\n');
  writeFileSync(join(ROOT, 'INVENTORY.md'), markdown(res, repos));
  console.log(`✓ ${res.files} GLBs in ${repos.length} repos → ${res.assets.length} unique → INVENTORY.md + inventory.json (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
