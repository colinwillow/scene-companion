import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateDraws, glbDrawFacts } from '../runtime/drawcount.js';

test('glbDrawFacts: primitives, materials, and the moving parts that stay separate (colliders and chunked walls not counted as parts)', () => {
  const json = { meshes: [{ primitives: [{ material: 0 }, { material: 1 }] }, { primitives: [{ material: 0 }] }],
    nodes: [{ name: 'a', mesh: 0 }, { name: 'door', extras: { door: 'hinged' }, children: [2] }, { name: 'leaf', mesh: 1 }, { name: 'col_door', mesh: 1 }, { name: 'wall', extras: { chunks: '[]', breakable: 'wall' }, children: [5] }, { name: 'w', mesh: 1 }] };
  assert.deepEqual(glbDrawFacts(json), { prims: 4, mats: 2, parts: 1 });
});

test('estimateDraws: a Batch costs its materials plus its parts; four or more of one static prop draw once; shadows double it', () => {
  const list = [{ id: 'house', prims: 200, mats: 9, parts: 20, batched: true }, { id: 'hero', prims: 3, mats: 1, parts: 0 },
    ...[1, 2, 3, 4, 5].map(i => ({ id: `tree${i}`, prims: 2, mats: 2, parts: 0, staticKey: 'tree' })), { id: 'rock1', prims: 1, mats: 1, parts: 0, staticKey: 'rock' }];
  const e = estimateDraws(list);
  assert.equal(e.draws, (29 + 3 + 2 + 1) * 2); assert.deepEqual(e.top[0], ['house', 29]);
});
