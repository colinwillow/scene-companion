import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reparent, worldTransform, quatFromEuler, eulerFromQuat, findEntity } from '../runtime/tree.js';

const near = (a, b, eps = 1e-3) => a.every((v, i) => Math.abs(v - b[i]) < eps);
const scene = () => ({ entities: [
  { id: 'cart', position: [10, 0, 0], rotation: [0, 90, 0], children: [{ id: 'pip', position: [0, 1, 2] }] },
  { id: 'box', position: [3, 0, 4], scale: [2, 2, 2] },
] });

test('euler ↔ quaternion round trip (degrees, XYZ)', () => {
  for (const r of [[0, 0, 0], [30, 45, 60], [-10, 80, 5], [90, 0, -45]]) assert.ok(near(eulerFromQuat(quatFromEuler(r)), r), `${r}`);
});

test('worldTransform applies parents', () => {
  const W = worldTransform(scene(), 'pip');
  assert.ok(near(W.p, [12, 1, 0]), `${W.p}`);          // yaw 90° turns local +z into world +x
});

test('reparent keeps the world transform: out to the top, into a scaled parent, into a turned one', () => {
  const d = scene();
  const before = worldTransform(d, 'pip');
  reparent(d, 'pip', null);
  assert.ok(d.entities.some(e => e.id === 'pip')); assert.equal(d.entities[0].children, undefined);
  assert.ok(near(d.entities.at(-1).position, [12, 1, 0]));
  assert.ok(near(d.entities.at(-1).rotation, [0, 90, 0]));
  reparent(d, 'pip', 'box');
  assert.ok(near(worldTransform(d, 'pip').p, before.p));
  assert.ok(near(findEntity(d, 'pip').entity.scale, [0.5, 0.5, 0.5]));
  reparent(d, 'box', 'cart');
  assert.ok(near(worldTransform(d, 'pip').p, before.p), `${worldTransform(d, 'pip').p}`);
  assert.ok(near(worldTransform(d, 'box').p, [3, 0, 4]));
});

test('reparent refuses loops and unknown ids', () => {
  const d = scene();
  assert.throws(() => reparent(d, 'cart', 'pip'), /inside itself/);
  assert.throws(() => reparent(d, 'cart', 'cart'), /inside itself/);
  assert.throws(() => reparent(d, 'ghost', null), /No entity/);
  assert.throws(() => reparent(d, 'box', 'ghost'), /No entity/);
});

test('MCP set_parent + spawn with parent (world position kept)', async () => {
  const { runCommand } = await import('../runtime/commands.js');
  const d = scene(); d.prefabs = { coin: './prefabs/coin.prefab.json' };
  const r = runCommand(d, 'set_parent', { id: 'box', parent: 'cart' }).result;
  assert.equal(r.parent, 'cart'); assert.ok(near(worldTransform(d, 'box').p, [3, 0, 4]));
  runCommand(d, 'set_parent', { id: 'box', parent: null });
  assert.ok(d.entities.some(e => e.id === 'box'));
  const s = runCommand(d, 'spawn', { prefab: 'coin', position: [10, 1, 1], parent: 'cart' }, { prefabs: {} }).result;
  assert.equal(s.parent, 'cart');
  assert.ok(near(worldTransform(d, s.id).p, [10, 1, 1]));
  assert.throws(() => runCommand(d, 'set_parent', { id: 'cart', parent: s.id }), /inside itself/);
  assert.throws(() => runCommand(d, 'spawn', { prefab: 'coin', parent: 'ghost' }, { prefabs: {} }), /No entity "ghost"/);
});
