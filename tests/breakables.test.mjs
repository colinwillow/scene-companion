import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Breakables } from '../behaviors/index.js';
import { walkShape } from '../runtime/collide.js';

// A wall like Colin's wallB_*: 3 chunks stacked in Blender Z (0..1, 1..2, 2..3 m up), 1 m along x, 0.25 thick (Blender y).
// Only the bottom one is anchored; each vertex carries its chunk id in `_chunk`.
function house(yaw = 0) {
  const root = new THREE.Group(), wall = new THREE.Group(); wall.position.set(10, 0, 5); wall.rotation.y = yaw; root.add(wall);
  const geos = [0, 1, 2].map(i => { const g = new THREE.BoxGeometry(1, 1, 0.25); g.translate(0.5, i + 0.5, 0.125); g.setAttribute('_chunk', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(i), 1)); return g; });
  const geo = new THREE.BufferGeometry(), all = geos.map(g => g.toNonIndexed());
  const pos = [], ch = []; for (const g of all) { pos.push(...g.attributes.position.array); ch.push(...g.attributes._chunk.array); }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('_chunk', new THREE.Float32BufferAttribute(ch, 1));
  const mesh = new THREE.Mesh(geo); wall.add(mesh); wall.name = 'wallB_test';
  wall.userData.chunks = JSON.stringify([0, 1, 2].map(i => ({ id: i, box: [0, -0.25, i, 1, 0, i + 1], hp: 20, anchored: i === 0, nb: [i - 1, i + 1].filter(n => n >= 0 && n < 3) })));
  const handlers = {}, world = { solids: [], emitted: [], on: (n, f) => { handlers[n] = f; }, emit(...a) { this.emitted.push(a); if (handlers[a[0]]) handlers[a[0]](...a.slice(1)); } };
  const b = new Breakables({ id: 'house', object3d: root }, {}, world); b.start();
  return { b, world, mesh, geo };
}

test('Breakables: every chunk is a turned box collider where his Z-up box says (through the wall\'s matrix)', () => {
  const { world } = house(Math.PI / 2);
  assert.equal(world.solids.length, 3);
  const s = walkShape(world.solids[1]);              // the middle chunk: 1..2 m up, 1 m long turned to run along −z from (10, 5)
  assert.ok(Math.abs(s.minY - 1) < 1e-6 && Math.abs(s.maxY - 2) < 1e-6, `height ${s.minY}..${s.maxY}`);
  assert.equal(s.near(10.12, 4.5).inside, true, 'inside the turned wall');
  assert.equal(s.near(10.6, 5.1).inside, false, 'not where the unturned wall would be');
});

test('Breakables: a blast kills what it reaches (vertices collapse, collider out); the chunk above, cut off, falls a moment later', () => {
  const { b, world, mesh, geo } = house();
  world.emit('blast', 10.5, 0.5, 5.1, 0.2, 2);           // 2 × 12 = 24 ≥ hp 20: the bottom (anchored) chunk dies
  assert.equal(b.alive, 2); assert.equal(world.solids.length, 2);
  assert.notEqual(mesh.geometry, geo, 'cloned on the first hit — the source stays as authored');
  const p = mesh.geometry.attributes.position, ch = mesh.geometry.attributes._chunk;
  for (let i = 0; i < ch.count; i++) if (ch.getX(i) === 0) assert.deepEqual([p.getX(i), p.getY(i), p.getZ(i)].map(v => +v.toFixed(4)), [0.5, 0.5, 0.125]);
  for (let i = 0; i < 30; i++) b.update(1 / 60);
  assert.equal(b.alive, 0, 'nothing anchored is left: the rest came down, staggered');
  b.destroy(); assert.equal(mesh.geometry, geo, 'Stop puts the wall back'); assert.equal(world.solids.length, 0);
});

test('Breakables: a weak hit chips (hp), a far one misses, the same blast cannot hit a chunk twice', () => {
  const { b, world } = house();
  world.emit('blast', 10.5, 2.5, 5.1, 0.2, 1);           // 12 of 20
  assert.equal(b.alive, 3);
  world.emit('blast', 10.5, 2.5, 5.1, 0.2, 1);           // inside the cooldown
  assert.equal(b.walls[0].byId.get(2).hp, 8);
  for (let i = 0; i < 20; i++) b.update(1 / 60);
  world.emit('blast', 10.5, 2.5, 5.1, 0.2, 1); assert.equal(b.alive, 2, 'the top chunk goes; the rest still stands on the anchor');
  world.emit('blast', 30, 2.5, 5, 0.2, 9); assert.equal(b.alive, 2);
});
