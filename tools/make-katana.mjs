#!/usr/bin/env node
// The goblin's katana as a GLB (zap builds it in code — katanaScene, index.html@479d49e line 12990 — so there was no file).
// Same shapes, same frame: authored in the `weapon_root_right` bone's space (armature units), blade along +Y, edge +Z, so
// the Mount behavior parents it to that bone with identity and it sits in his hand. Re-run: node tools/make-katana.mjs
import * as THREE from 'three';
import { writeFileSync } from 'node:fs';
import { writeGlb } from './bake-motions.mjs';

const MATS = {
  steel: { baseColorFactor: [0.70, 0.74, 0.79, 1], metallicFactor: 1, roughnessFactor: 0.22 },
  wrap:  { baseColorFactor: [0.024, 0.017, 0.015, 1], metallicFactor: 0, roughnessFactor: 0.85 },
  iron:  { baseColorFactor: [0.043, 0.034, 0.027, 1], metallicFactor: 0.7, roughnessFactor: 0.45 },
  gold:  { baseColorFactor: [0.58, 0.36, 0.07, 1], metallicFactor: 1, roughnessFactor: 0.35 },
};
const parts = [];
const add = (geo, mat, y) => { geo.translate(0, y, 0); parts.push([geo, mat]); };
add(new THREE.CylinderGeometry(1.5, 1.6, 22, 10), 'wrap', -3);       // grip
add(new THREE.CylinderGeometry(1.8, 1.8, 1.4, 10), 'iron', -14.5);   // pommel
add(new THREE.CylinderGeometry(4.2, 4.2, 1.1, 20), 'iron', 8.6);     // guard (tsuba)
add(new THREE.BoxGeometry(1.4, 2.2, 3.4), 'gold', 10.2);             // collar (habaki)
{ // the blade: a thin tapered slab, edge along +Z, curved back toward the spine along its length
  const L = 58, sh = new THREE.Shape();
  sh.moveTo(0, -1.6); sh.lineTo(L, -1.4); sh.lineTo(L + 2.6, 1.0); sh.lineTo(L, 1.25); sh.lineTo(0, 1.6); sh.lineTo(0, -1.6);
  const bg = new THREE.ExtrudeGeometry(sh, { depth: .55, bevelEnabled: true, bevelThickness: .12, bevelSize: .1, bevelSegments: 1, steps: 1, curveSegments: 1 });
  bg.translate(0, 0, -.275); bg.rotateZ(Math.PI / 2); bg.rotateY(Math.PI / 2);
  const P = bg.attributes.position; for (let i = 0; i < P.count; i++) { const y = P.getY(i); P.setZ(i, P.getZ(i) - .0009 * y * y); }
  bg.computeVertexNormals(); add(bg, 'steel', 11.3);
}
// merge per material → one primitive each
const json = { asset: { version: '2.0', generator: 'scene-companion make-katana' }, scene: 0, scenes: [{ nodes: [0] }],
  nodes: [{ name: 'katana', mesh: 0 }], meshes: [{ name: 'katana', primitives: [] }], materials: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] };
const bins = []; let size = 0;
const push = (arr, type, target, minmax) => {
  const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), pad = (4 - (size % 4)) % 4;
  if (pad) { bins.push(Buffer.alloc(pad)); size += pad; }
  json.bufferViews.push({ buffer: 0, byteOffset: size, byteLength: buf.length, target });
  const n = { VEC3: 3, SCALAR: 1 }[type], acc = { bufferView: json.bufferViews.length - 1, componentType: arr instanceof Float32Array ? 5126 : 5125, count: arr.length / n, type };
  if (minmax) { acc.min = [0, 1, 2].map(k => Math.min(...arr.filter((_, i) => i % 3 === k))); acc.max = [0, 1, 2].map(k => Math.max(...arr.filter((_, i) => i % 3 === k))); }
  json.accessors.push(acc); bins.push(buf); size += buf.length; return json.accessors.length - 1;
};
for (const [name, pbr] of Object.entries(MATS)) {
  const geos = parts.filter(([, m]) => m === name).map(([g]) => g.index ? g.toNonIndexed() : g);
  if (!geos.length) continue;
  const pos = Float32Array.from(geos.flatMap(g => [...g.attributes.position.array]));
  const nrm = Float32Array.from(geos.flatMap(g => [...g.attributes.normal.array]));
  json.materials.push({ name, pbrMetallicRoughness: pbr });
  json.meshes[0].primitives.push({ attributes: { POSITION: push(pos, 'VEC3', 34962, true), NORMAL: push(nrm, 'VEC3', 34962) }, material: json.materials.length - 1 });
}
const bin = Buffer.concat(bins); json.buffers[0].byteLength = bin.length;
const out = new URL('../assets/models/colin/props/katana.glb', import.meta.url);
writeFileSync(out, writeGlb({ json, bin }));
console.log(`✓ ${out.pathname} (${bin.length} bytes of geometry, ${json.meshes[0].primitives.length} materials)`);
