import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { KitWalls } from '../behaviors/index.js';
import { walkShape } from '../runtime/collide.js';

test('KitWalls: one box per exposed cell edge per floor from cells/heights; a setback walls only the drop; a chunked wall is skipped', () => {
  const root = new THREE.Group(), bld = new THREE.Group(); bld.position.set(10, 0, -14); root.add(bld);
  Object.assign(bld.userData, { cells: '[[0, 0], [1, 0]]', heights: '{"0,0": 2, "1,0": 1}', bay_m: 3, floor_m: 3 });
  const world = { solids: [] };
  const k = new KitWalls({ id: 'row', object3d: root }, {}, world); k.start();
  assert.equal(world.solids.length, 10, '7 round the tall cell (its side over the low one only on floor 2) + 3 round the low one');
  const front = world.solids.map(walkShape).filter(s => s.maxY <= 3.01 && s.near(14.5, -14.1).inside);
  assert.equal(front.length, 1, 'the low cell\'s front wall, inside the footprint');
  k.destroy(); assert.equal(world.solids.length, 0);
  const wall = new THREE.Group(); wall.position.set(3, 0, 0); wall.userData.chunks = '[]'; bld.add(wall);   // a wallB_ piece at the low cell's front-left corner
  const k2 = new KitWalls({ id: 'row', object3d: root }, {}, world); k2.start();
  assert.equal(world.solids.length, 9, 'Breakables owns that one side, and only that one');
});
