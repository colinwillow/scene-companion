import { test } from 'node:test';
import assert from 'node:assert/strict';
import { framing, thumbItems, thumbKey, thumbPath, packThumbnails } from '../runtime/thumbs.js';

test('framing: looks at the box centre from a fixed three-quarter view, far enough to fit it', () => {
  const a = framing([-0.5, 0, -0.5], [0.5, 1, 0.5], 30), b = framing([-1, 0, -1], [1, 2, 1], 30);
  assert.deepEqual(a.target, [0, 0.5, 0]);
  const dist = f => Math.hypot(...f.position.map((v, i) => v - f.target[i]));
  assert.ok(Math.abs(dist(b) / dist(a) - 2) < 1e-3, 'twice the size → twice the distance');
  assert.ok(dist(a) > Math.hypot(1, 1, 1) / 2 / Math.sin(Math.PI / 12), 'whole bounding sphere fits the fov');
  assert.ok(a.position[0] > 0 && a.position[2] > 0 && a.position[1] > 0.5, 'front-right, from above');
  const t = framing([-0.5, 0, -0.5], [0.5, 1, 0.5], 30, 180);
  assert.ok(t.position[0] < 0 && t.position[2] < 0, 'turntable frame 180° is the back');
});

test('thumb items, keys, paths and pack thumbnails', () => {
  const items = thumbItems(['tree'], ['./a/zap.character.json', './a/readme.md']);
  assert.deepEqual(items, [{ kind: 'character', name: 'zap', path: './a/zap.character.json' }, { kind: 'prefab', name: 'tree' }]);
  assert.equal(thumbKey(items[1]), 'prefab:tree');
  assert.equal(thumbPath(items[0], true), './thumbs/character/zap.turntable.png');
  const index = { 'prefab:tree': './thumbs/prefab/tree.png', 'character:zap': './thumbs/character/zap.png' };
  assert.deepEqual(packThumbnails({ characters: ['./a/zap.character.json'], prefabs: ['tree', 'rock'] }, index),
    { zap: './thumbs/character/zap.png', tree: './thumbs/prefab/tree.png' });
});

test('cropSquare: square around the union of visible pixels, with margin, inside the image', async () => {
  const { cropSquare } = await import('../runtime/thumbs.js');
  assert.equal(cropSquare([null], 512), null);
  assert.deepEqual(cropSquare([{ x0: 200, y0: 100, x1: 299, y1: 399 }], 512, 0), { x: 100, y: 100, s: 300 }, 'tall thing: side = height, centred');
  assert.deepEqual(cropSquare([{ x0: 0, y0: 0, x1: 99, y1: 99 }, { x0: 300, y0: 0, x1: 399, y1: 99 }], 512, 0), { x: 0, y: 0, s: 400 }, 'union of frames, clamped at the edge');
  assert.equal(cropSquare([{ x0: 0, y0: 0, x1: 511, y1: 511 }], 512).s, 512, 'never bigger than the image');
});
