#!/usr/bin/env node
// Bake motion-library clips INTO a character's GLB, so the game plays them with no motion library around (GitHub Pages,
// Publish, a phone). Same retarget the editor runs live (runtime/retarget.js, the Forge's layer 1), done once here.
//   node tools/bake-motions.mjs assets/models/colin/characters/zap.character.json            every motion it uses
//   node tools/bake-motions.mjs assets/models/colin/characters/zap.character.json Box_Jump   just these (added to its motions)
// Motions used = the character's `motions` + every scene entity that uses this character and lists `motions`.
// Writes <model>.motions.glb next to the original (the mesh is untouched — only animation data is appended) and points the
// character's `glb` at it (`sourceGlb` keeps the original, so a re-bake always starts clean). The library comes from
// SC_MOTIONS or ../retarget-anims/library. Baked clips are retargeted onto Colin's own characters, which is how games ship
// Mixamo animation; the raw library clips themselves are never committed.
import * as THREE from 'three';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { retargetClip } from '../runtime/retarget.js';
import { MOTION_STEM } from '../runtime/motions.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- GLB in / out
export function readGlb(buf) {
  if (buf.toString('latin1', 0, 4) !== 'glTF') throw new Error('not a GLB');
  let off = 12, json = null, bin = Buffer.alloc(0);
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4), body = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8')); else if (type === 0x004e4942) bin = Buffer.from(body);
    off += 8 + len;
  }
  return { json, bin };
}
export function writeGlb({ json, bin }) {
  const pad = (b, fill) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
  const j = pad(Buffer.from(JSON.stringify(json)), 0x20), b = pad(bin, 0);
  const head = Buffer.alloc(12); head.write('glTF', 0, 'latin1'); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8);
  const ch = (len, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(len, 0); h.writeUInt32LE(type, 4); return h; };
  return Buffer.concat([head, ch(j.length, 0x4e4f534a), j, ch(b.length, 0x004e4942), b]);
}

const COMPS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function readAccessor({ json, bin }, i) {
  const a = json.accessors[i], bv = json.bufferViews[a.bufferView], n = COMPS[a.type];
  if (a.componentType !== 5126) throw new Error(`accessor ${i}: only float animation data is supported`);
  const stride = bv.byteStride || n * 4, base = (bv.byteOffset || 0) + (a.byteOffset || 0), out = new Float32Array(a.count * n);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = bin.readFloatLE(base + k * stride + c * 4);
  return out;
}

// glTF node tree → three objects (TRS only, no meshes: the skeleton is all a retarget needs). mixamorig_* nodes become Bones.
export function nodeTree(json) {
  const objs = json.nodes.map(n => {
    const o = /^mixamorig/.test(n.name || '') ? new THREE.Bone() : new THREE.Object3D();
    o.name = n.name || '';
    if (n.matrix) new THREE.Matrix4().fromArray(n.matrix).decompose(o.position, o.quaternion, o.scale);
    else { if (n.translation) o.position.fromArray(n.translation); if (n.rotation) o.quaternion.fromArray(n.rotation); if (n.scale) o.scale.fromArray(n.scale); }
    return o;
  });
  json.nodes.forEach((n, i) => (n.children || []).forEach(c => objs[i].add(objs[c])));
  const root = new THREE.Group();
  for (const r of json.scenes[json.scene || 0].nodes) root.add(objs[r]);
  return root;
}

// The first animation of a library clip GLB as a THREE.AnimationClip (tracks named <node>.<property>).
export function firstClip(glb, name) { return clipByIndex(glb, 0, name); }
export function clipByName(glb, name) {
  const i = (glb.json.animations || []).findIndex(a => a.name === name);
  if (i < 0) throw new Error(`no clip "${name}"`);
  return clipByIndex(glb, i, name);
}
function clipByIndex(glb, i, name) {
  const anim = glb.json.animations?.[i]; if (!anim) throw new Error('no animation');
  const PROP = { translation: ['position', THREE.VectorKeyframeTrack], rotation: ['quaternion', THREE.QuaternionKeyframeTrack], scale: ['scale', THREE.VectorKeyframeTrack] };
  const tracks = [];
  for (const ch of anim.channels) {
    const node = glb.json.nodes[ch.target.node], p = PROP[ch.target.path]; if (!node || !p) continue;
    const s = anim.samplers[ch.sampler];
    tracks.push(new p[1](`${node.name}.${p[0]}`, readAccessor(glb, s.input), readAccessor(glb, s.output)));
  }
  return new THREE.AnimationClip(name, -1, tracks);
}

// Append three AnimationClips to a GLB as glTF animations targeting its nodes by name. Returns names skipped (already there).
export function appendClips(glb, clips) {
  const { json } = glb, byName = new Map(json.nodes.map((n, i) => [n.name, i]));
  json.animations ||= []; json.accessors ||= []; json.bufferViews ||= [];
  const existing = new Set(json.animations.map(a => a.name)), skipped = [], parts = [glb.bin];
  let size = glb.bin.length;
  const push = (arr, type, minmax) => {
    const pad = (4 - (size % 4)) % 4; if (pad) { parts.push(Buffer.alloc(pad)); size += pad; }
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    json.bufferViews.push({ buffer: 0, byteOffset: size, byteLength: buf.length });
    const acc = { bufferView: json.bufferViews.length - 1, componentType: 5126, count: arr.length / COMPS[type], type };
    if (minmax) { acc.min = [Math.min(...arr)]; acc.max = [Math.max(...arr)]; }
    json.accessors.push(acc); parts.push(buf); size += buf.length;
    return json.accessors.length - 1;
  };
  for (const clip of clips) {
    if (existing.has(clip.name)) { skipped.push(clip.name); continue; }
    const anim = { name: clip.name, samplers: [], channels: [] }, inputs = new Map();
    for (const t of clip.tracks) {
      const [node, prop] = t.name.split('.'), idx = byName.get(node); if (idx === undefined) continue;
      const path = { quaternion: 'rotation', position: 'translation', scale: 'scale' }[prop]; if (!path) continue;
      if (!inputs.has(t.times)) inputs.set(t.times, push(Float32Array.from(t.times), 'SCALAR', true));
      const out = push(Float32Array.from(t.values), prop === 'quaternion' ? 'VEC4' : 'VEC3');
      anim.samplers.push({ input: inputs.get(t.times), output: out, interpolation: 'LINEAR' });
      anim.channels.push({ sampler: anim.samplers.length - 1, target: { node: idx, path } });
    }
    json.animations.push(anim);
  }
  glb.bin = Buffer.concat(parts);
  json.buffers[0].byteLength = glb.bin.length;
  return skipped;
}

// ---- CLI
function usedMotions(charPath) {
  const ch = JSON.parse(readFileSync(charPath, 'utf8')), rel = './' + relative(ROOT, charPath), out = new Set(ch.motions || []);
  for (const f of readdirSync(join(ROOT, 'scenes')).filter(f => f.endsWith('.scene.json'))) {
    const s = JSON.parse(readFileSync(join(ROOT, 'scenes', f), 'utf8'));
    const uses = a => JSON.stringify(a ?? '').includes(rel);
    const walk = es => es?.forEach(e => {
      const asset = typeof e.asset === 'string' ? s.assets?.[e.asset] : e.asset;
      if (uses(asset)) (e.motions || []).forEach(m => out.add(m));
      walk(e.children);
    });
    walk(s.entities);
  }
  return [...out];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [charArg, ...only] = process.argv.slice(2);
  if (!charArg?.endsWith('.character.json')) { console.error('usage: node tools/bake-motions.mjs <x.character.json> [stem …]'); process.exit(1); }
  const charPath = join(process.cwd(), charArg), ch = JSON.parse(readFileSync(charPath, 'utf8'));
  const lib = [process.env.SC_MOTIONS, join(ROOT, '../retarget-anims/library')].find(d => d && existsSync(join(d, 'index.json')));
  if (!lib) { console.error('no motion library: clone retarget-anims next to scene-companion or set SC_MOTIONS'); process.exit(1); }
  const stems = [...new Set([...usedMotions(charPath), ...only])];
  if (only.length) { ch.motions = [...new Set([...(ch.motions || []), ...only])]; }
  const bad = stems.filter(s => !MOTION_STEM.test(s)); if (bad.length) { console.error('not library stems:', bad.join(', ')); process.exit(1); }
  if (!stems.length) { console.log('nothing to bake (no motions on the character or its scene entities)'); process.exit(0); }
  const srcGlb = ch.sourceGlb || ch.glb, srcFile = join(ROOT, srcGlb);
  const glb = readGlb(readFileSync(srcFile)), dst = nodeTree(glb.json);
  const clips = [];
  for (const stem of stems) {
    const f = join(lib, 'clips', `${stem}.glb`);
    if (!existsSync(f)) { console.error(`✗ ${stem}: not in the library`); continue; }
    const src = readGlb(readFileSync(f));
    clips.push(retargetClip(nodeTree(src.json), firstClip(src, stem), dst, { name: stem }));
    console.log(`✓ ${stem}`);
  }
  const skipped = appendClips(glb, clips);
  if (skipped.length) console.log(`(already in ${srcGlb}: ${skipped.join(', ')})`);
  const outRel = srcGlb.replace(/\.glb$/, '.motions.glb');
  writeFileSync(join(ROOT, outRel), writeGlb(glb));
  ch.sourceGlb = srcGlb; ch.glb = outRel;
  writeFileSync(charPath, JSON.stringify(ch, null, 2) + '\n');
  console.log(`→ ${outRel} (${clips.length} clips baked); ${basename(charPath)} now points at it (sourceGlb: ${srcGlb})`);
}
