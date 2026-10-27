import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { KitParts } from '../behaviors/index.js';

// a wall with a hinged door (hinge at the node, leaf 1 m along +x, its col_ child), a pane of glass, and a roof hatch at 3 m
function house() {
  const root = new THREE.Group(), wall = new THREE.Group(); root.add(wall);
  const part = (name, extras, size, at) => {
    const n = new THREE.Group(); n.name = name; Object.assign(n.userData, extras); n.position.set(...at);
    const col = new THREE.Mesh(new THREE.BoxGeometry(...size)); col.position.set(size[0] / 2, size[1] / 2, 0); col.userData.collider = true; n.add(col); wall.add(n); return n;
  };
  const door = part('door', { door: 'hinged', open_min_deg: -100, open_max_deg: 100, hp: 40 }, [1, 2, 0.06], [0, 0, 0]);
  const glass = part('glass', { breakable: 'glass', hp: 5 }, [1, 1, 0.02], [3, 1, 0]);
  const hatch = part('hatch', { door: 'hatch', open_min_deg: 0, open_max_deg: 110, hp: 60 }, [1, 0.06, 1], [-4, 3, 0]);
  const me = new THREE.Group(), handlers = {};
  const world = { solids: [], on: (n, f) => { handlers[n] = f; }, emit: (n, ...a) => handlers[n]?.(...a), getEntity: id => id === 'player' ? { object3d: me } : null };
  const k = new KitParts({ id: 'house', object3d: root }, {}, world); k.start();
  return { k, world, me, door, glass, hatch };
}
const run = (k, s) => { for (let i = 0; i < s * 60; i++) k.update(1 / 60); };

test('KitParts: a door swings away from whoever walks into it, its collider out while it stands open, and shuts after', () => {
  const { k, world, me, door } = house();
  assert.equal(world.solids.length, 3, 'door, glass and hatch are colliders'); assert.equal(door.children[0].visible, false, 'col_ hidden');
  me.position.set(0.5, 0, 1.2); run(k, 1);              // on the +z side
  assert.ok(door.rotation.y > 1.5, `swung (${door.rotation.y.toFixed(2)} rad) — +z side opens toward max`);
  assert.equal(world.solids.length, 2, 'the doorway is clear');
  me.position.set(0.5, 0, -1.2); run(k, 0.5);           // through to the other side: it stays open while he is in it
  me.position.set(20, 0, 20); run(k, 4);
  assert.ok(Math.abs(door.rotation.y) < 0.05, 'shut again'); assert.equal(world.solids.length, 3);
  me.position.set(0.5, 0, -1.2); run(k, 1);
  assert.ok(door.rotation.y < -1.5, 'from the other side it swings the other way');
  k.destroy(); assert.equal(door.rotation.y, 0); assert.equal(world.solids.length, 0);
});

test('KitParts: glass breaks on a blast; the hatch opens for someone under it and not for someone on the roof', () => {
  const { k, world, me, glass, hatch } = house();
  world.emit('blast', 3.5, 1.5, 0, 0.3, 1);
  assert.equal(glass.visible, false); assert.equal(world.solids.length, 2);
  me.position.set(-3.5, 0.5, 0); run(k, 1); assert.ok(hatch.rotation.x < -1.5, 'opened from below');
  me.position.set(-3.5, 3.1, 0); run(k, 4); assert.ok(Math.abs(hatch.rotation.x) < 0.05, 'a lid from above');
});

test('KitParts batches the panes; a broken pane collapses inside its range and the others stay', () => {
  const root = new THREE.Group(), mat = new THREE.MeshStandardMaterial(), panes = [];
  for (const x of [0, 2]) {
    const n = new THREE.Group(); n.userData.breakable = 'glass'; n.position.set(x, 1, 0);
    n.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.02), mat));
    const col = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.02)); col.userData.collider = true; n.add(col);
    root.add(n); panes.push(n);
  }
  const handlers = {}, world = { solids: [], on: (n, f) => { handlers[n] = f; }, emit: (n, ...a) => handlers[n]?.(...a), getEntity: () => null };
  const k = new KitParts({ id: 'h', object3d: root }, {}, world); k.start();
  assert.equal(k.glass.length, 1); assert.equal(panes[0].children[0].visible, false);
  const pos = k.glass[0].mesh.geometry.attributes.position, before = pos.array.slice();
  world.emit('blast', 2, 1, 0, 0.2, 1);
  const n = pos.count / 2; let same = true, flat = true;
  for (let i = 0; i < n; i++) if (pos.getX(i) !== before[i * 3]) same = false;
  for (let i = n + 1; i < pos.count; i++) if (pos.getX(i) !== pos.getX(n) || pos.getY(i) !== pos.getY(n)) flat = false;
  assert.ok(same, 'the first pane untouched'); assert.ok(flat, 'the broken pane is a point');
  k.destroy(); assert.equal(panes[0].children[0].visible, true);
});
