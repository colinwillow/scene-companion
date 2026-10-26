import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextId, addEntity, duplicateEntity, deleteEntity, setAsset } from '../runtime/editing.js';

const scene = () => ({
  assets: { crate: {}, tree_big: {} },
  entities: [{ id: 'crate_01', asset: 'crate', position: [0, 0, 0] }, { id: 'crate_02', asset: 'crate', position: [2, 0, 0] },
             { id: 'coin_01', prefab: 'coin', position: [0, 1, 0], behaviors: [{ type: 'Bob', params: { height: 1 } }] }],
});

test('nextId continues numbering and cleans names', () => {
  assert.equal(nextId(['crate_01', 'crate_02'], 'crate'), 'crate_03');
  assert.equal(nextId(['crate_01', 'crate_07'], 'crate_01'), 'crate_08');
  assert.equal(nextId([], 'Big Tree!'), 'big_tree_01');
  assert.equal(nextId(['player'], 'player'), 'player_01');
  assert.equal(nextId([], ''), 'object_01');
});

test('addEntity from a prefab or an asset', () => {
  const d = scene();
  const a = addEntity(d, { prefab: 'coin' }, [1.23456, 0, 2]);
  const b = addEntity(d, { asset: 'crate' });
  assert.deepEqual(a, { id: 'coin_02', prefab: 'coin', position: [1.235, 0, 2] });
  assert.deepEqual(b, { id: 'crate_03', asset: 'crate', position: [0, 0, 0] });
  assert.throws(() => addEntity(d, {}));
});

test('duplicateEntity deep-copies, renames, nudges and inserts after the original', () => {
  const d = scene();
  const c = duplicateEntity(d, 'coin_01');
  assert.equal(c.id, 'coin_02');
  assert.deepEqual(c.position, [1, 1, 0]);
  assert.equal(d.entities[3].id, 'coin_02');
  c.behaviors[0].params.height = 5;
  assert.equal(d.entities[2].behaviors[0].params.height, 1, 'original untouched');
  assert.equal(duplicateEntity(d, 'nope'), null);
});

test('deleteEntity and setAsset', () => {
  const d = scene();
  assert.equal(deleteEntity(d, 'crate_01'), true);
  assert.equal(deleteEntity(d, 'crate_01'), false);
  assert.deepEqual(d.entities.map(e => e.id), ['crate_02', 'coin_01']);
  assert.equal(setAsset(d, 'coin_01', 'tree_big'), true);
  assert.equal(d.entities[1].asset, 'tree_big');
  assert.equal(setAsset(d, 'coin_01', 'missing'), false);
});
