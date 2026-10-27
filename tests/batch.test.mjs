import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeMeshes } from '../runtime/batch.js';
import { Batch, Breakables } from '../behaviors/index.js';

test('mergeMeshes: one mesh per material, baked into the root\'s space, each source keeping its vertex range', () => {
  const root = new THREE.Group(); root.position.set(100, 0, 0); root.rotation.y = Math.PI / 2;
  const red = new THREE.MeshStandardMaterial(), blue = new THREE.MeshStandardMaterial();
  const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), red); a.position.set(2, 0, 0);
  const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), red); b.position.set(0, 3, 0); b.rotation.z = Math.PI / 2;
  const c = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), blue);
  root.add(a, b, c);
  const out = mergeMeshes(root, [a, b, c]);
  assert.equal(out.length, 2);
  const R = out.find(o => o.mesh.material === red);
  assert.deepEqual(R.ranges.get(a), { start: 0, count: 24 }); assert.deepEqual(R.ranges.get(b), { start: 24, count: 24 });
  root.add(R.mesh); root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(R.mesh), want = new THREE.Box3().setFromObject(a).union(new THREE.Box3().setFromObject(b));
  assert.ok(box.min.distanceTo(want.min) < 1e-5 && box.max.distanceTo(want.max) < 1e-5, 'drawn exactly where the sources were');
  assert.equal(R.mesh.geometry.index.count, 72);
});

test('Batch: static meshes merged and hidden; breakable walls, parts and colliders left alone; Stop puts them back', () => {
  const root = new THREE.Group(), mat = new THREE.MeshStandardMaterial(), mk = () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  const s1 = mk(), s2 = mk(), wall = new THREE.Group(), w = mk(), door = new THREE.Group(), d = mk(), col = mk();
  wall.userData.chunks = '[]'; wall.add(w); door.userData.door = 'hinged'; door.add(d); col.name = 'col_x';
  root.add(s1, s2, wall, door, col);
  const bt = new Batch({ id: 'h', object3d: root }, {}, { emit() {} }); bt.start();
  assert.equal(bt.batches.length, 1); assert.equal(bt.sources.length, 2);
  assert.equal(s1.visible, false); assert.equal(w.visible, true); assert.equal(d.visible, true); assert.equal(col.visible, true);
  bt.destroy(); assert.equal(s1.visible, true); assert.equal(root.children.length, 5);
});

test('Breakables batched: a chunk collapses inside its wall\'s range of the merged buffer, and restore puts it back', () => {
  const root = new THREE.Group(), mat = new THREE.MeshStandardMaterial(), walls = [];
  for (const x of [0, 5]) {
    const wall = new THREE.Group(); wall.name = `w${x}`; wall.position.set(x, 0, 0);
    const g = new THREE.BoxGeometry(1, 1, 0.25).toNonIndexed(); g.translate(0.5, 0.5, 0.125);
    g.setAttribute('_chunk', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(0), 1));
    wall.add(new THREE.Mesh(g, mat)); wall.userData.chunks = JSON.stringify([{ id: 0, box: [0, -0.25, 0, 1, 0, 1], hp: 20, anchored: true, nb: [] }]);
    root.add(wall); walls.push(wall);
  }
  const handlers = {}, world = { scene: new THREE.Scene(), solids: [], on: (n, f) => { handlers[n] = f; }, emit() {} };
  const b = new Breakables({ id: 'h', object3d: root }, { debris: 0 }, world); b.start();
  assert.equal(b.batches.length, 1); assert.equal(walls[0].children[0].visible, false);
  const pos = b.batches[0].mesh.geometry.attributes.position, before = pos.array.slice();
  b.blast(5.5, 0.5, 0, 0.2, 2);                                    // the second wall's chunk
  for (let i = 0; i < pos.count; i++) {
    if (i < pos.count / 2) assert.equal(pos.getX(i), before[i * 3], 'the first wall untouched');
    else assert.deepEqual([pos.getX(i), pos.getY(i), pos.getZ(i)].map(v => +v.toFixed(4)), [5.5, 0.5, 0.125]);
  }
  b.restore('w5', 0); assert.deepEqual(Array.from(pos.array), Array.from(before));
  b.destroy(); assert.equal(walls[0].children[0].visible, true); assert.equal(root.children.length, 2);
});
