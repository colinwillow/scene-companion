import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rayBox, clipCamera } from '../runtime/camera.js';

const box = { minX: -1, maxX: 1, minY: 0, maxY: 2, minZ: 3, maxZ: 4 };

test('rayBox hits, misses and starts inside', () => {
  assert.equal(rayBox([0, 1, 0], [0, 0, 1], box), 3);
  assert.equal(rayBox([0, 1, 0], [0, 0, -1], box), Infinity);
  assert.equal(rayBox([5, 1, 0], [0, 0, 1], box), Infinity);
  assert.equal(rayBox([0, 1, 3.5], [0, 0, 1], box), 0);
});

test('clipCamera pulls in before a wall, keeps full distance when clear', () => {
  assert.equal(clipCamera([0, 1, 0], [0, 0, 1], 7, [box]), 3 - 0.25);
  assert.equal(clipCamera([0, 1, 0], [1, 0, 0], 7, [box]), 7);
  assert.equal(clipCamera([0, 1, 0], [0, 0, 1], 7, [box], { minDist: 3 }), 3);
});

test('clipCamera ignores the box the focus is in and respects the floor', () => {
  assert.equal(clipCamera([0, 1, 3.5], [0, 0, 1], 7, [box]), 7);
  const d = [0, -Math.SQRT1_2, Math.SQRT1_2];
  assert.ok(Math.abs(clipCamera([0, 1.3, 0], d, 7, [], { floorY: 0 }) - (1.3 - 0.25) * Math.SQRT2) < 1e-9);
});
