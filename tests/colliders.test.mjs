import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { colliderKind, fitBox, fitColliders, placeCollider } from '../runtime/colliders.js';
import { readGlb } from '../tools/bake-motions.mjs';
import { CollisionMesh, PlayerController } from '../behaviors/index.js';
import { fakeEntity, fakeWorld, attach, run } from './fakes.js';

// a box's 8 corners, turned by yaw about its centre (entity convention: world = Ry(yaw) · local)
const corners = (c, [sx, sy, sz], yaw = 0) => {
  const C = Math.cos(yaw), S = Math.sin(yaw), out = [];
  for (const x of [-sx / 2, sx / 2]) for (const y of [-sy / 2, sy / 2]) for (const z of [-sz / 2, sz / 2]) out.push(c[0] + C * x + S * z, c[1] + y, c[2] - S * x + C * z);
  return out;
};
const near = (a, b, e = 1e-3) => Math.abs(a - b) < e;

test('colliderKind reads Colin\'s naming', () => {
  assert.equal(colliderKind('bld_corner__L0_C0_0'), 'wall');
  assert.equal(colliderKind('col_bld_rb_car'), 'wall');
  assert.equal(colliderKind('deck_floor__L0'), 'floor');
  assert.equal(colliderKind('ramp_stair__X0_0'), 'ramp');
  assert.equal(colliderKind('climb_ladder_1f'), null);
  assert.equal(colliderKind('fence_post'), null);
});

test('fitBox finds a turned box exactly (centre, size, yaw)', () => {
  const b = fitBox(corners([4, 1, -2], [3, 2, 1], 30 * Math.PI / 180));
  assert.ok(near(b.c[0], 4) && near(b.c[1], 1) && near(b.c[2], -2), `centre ${b.c}`);
  const [sx, , sz] = b.size, yawDeg = b.yaw * 180 / Math.PI;
  // a box is the same box turned 90° with its sides swapped: check the footprint, and that the yaw is 30° or 120°
  assert.ok((near(sx, 3) && near(sz, 1)) || (near(sx, 1) && near(sz, 3)), `size ${b.size}`);
  assert.ok(near(((yawDeg % 90) + 90) % 90, 30, 0.6), `yaw ${yawDeg}`);
  assert.ok(near(b.size[1], 2));
});

test('a ramp_ mesh becomes a Solid ramp rising toward its high end', () => {
  // a wedge 4 m along +x, 2 m wide, rising 0 → 1.5
  const pts = [0, 0, -1, 0, 0, 1, 4, 0, -1, 4, 0, 1, 4, 1.5, -1, 4, 1.5, 1];
  const [r] = fitColliders([{ name: 'ramp_stair', points: pts }]);
  assert.equal(r.slope, true); assert.equal(r.yaw, 0);
  assert.deepEqual(r.size.map(v => +v.toFixed(3)), [4, 1.5, 2]);
  const [r2] = fitColliders([{ name: 'ramp_x', points: pts.map((v, i) => i % 3 === 0 ? -v : v) }]);   // mirrored: rises toward -x
  assert.equal(r2.yaw, Math.PI);
});

test('placeCollider follows the owner: position, yaw, scale', () => {
  const p = placeCollider({ c: [1, 0.5, 0], size: [1, 1, 1], yaw: 0 }, [10, 0, 0], Math.PI / 2, 2);
  assert.ok(near(p.c[0], 10) && near(p.c[1], 1) && near(p.c[2], -2), `${p.c}`);
  assert.deepEqual(p.size, [2, 2, 2]); assert.equal(p.yaw, Math.PI / 2);
});

test('Colin\'s test house: every bld_/deck_/solid_/ramp_ mesh becomes a collider; ladders do not', () => {
  const glb = readGlb(readFileSync('assets/models/colin/buildings/building_kit_test_collision.glb'));
  const names = glb.json.nodes.map(n => n.name);
  const want = names.filter(colliderKind).length;
  assert.ok(want >= 49, `colliders named in the file: ${want}`);
  assert.ok(!names.filter(n => /^climb_/.test(n)).some(colliderKind), 'ladders are not solid');
});

test('CollisionMesh: the player stands on a fitted floor and is stopped by a fitted wall', () => {
  const floor = fitColliders([{ name: 'deck_floor', points: corners([0, 0.95, 0], [6, 0.1, 6]) }])[0];
  const wall = fitColliders([{ name: 'bld_wall', points: corners([2.5, 2, 0], [0.2, 2, 6]) }])[0];
  const player = fakeEntity('player', [0, 3, 0]), house = fakeEntity('house', [0, 0, 0]);
  const w = fakeWorld([player, house]); w.input = { move: [0, 0], jump: false };
  attach(CollisionMesh, house, { colliders: [floor, wall] }, w);
  assert.equal(w.solids.length, 2);
  const pc = attach(PlayerController, player, {}, w), p = player.object3d.position;
  run(pc, 90);
  assert.ok(near(p.y, 1) && pc.grounded, `on the deck, y=${p.y}`);
  w.input.move = [1, 0]; run(pc, 90);
  assert.ok(near(p.x, 2.4 - 0.35), `stopped by the wall, x=${p.x}`);
});
