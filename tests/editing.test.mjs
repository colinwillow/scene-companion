import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextId, addEntity, duplicateEntity, deleteEntity, setAsset, isDropSurface, dropPoint, isGround, snapXZ } from '../runtime/editing.js';

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

test('drop surfaces: ground + Solid entities only', () => {
  assert.equal(isDropSurface('ground', { asset: 'x' }), true);
  assert.equal(isDropSurface('floor_a', { asset: 'ground_tile' }), true);
  assert.equal(isDropSurface('plat_01', { behaviors: [{ type: 'Bob' }, { type: 'Solid' }] }), true);
  assert.equal(isDropSurface('coin_01', { behaviors: [{ type: 'Bob' }] }), false);
  assert.equal(isDropSurface('crate_01', {}), false);
});

test('drop point: surface hit, else y=0 plane, else below the focus', () => {
  assert.deepEqual(dropPoint([1.23456, 2, 3], [9, 0, 9], [0, 0, 0]), [1.235, 2, 3]);
  assert.deepEqual(dropPoint(null, [4, 0.0001, -5], [0, 3, 0]), [4, 0, -5]);
  assert.deepEqual(dropPoint(null, [4000, 0, 0], [1, 3, 2]), [1, 0, 2]);   // ray grazing the horizon
  assert.deepEqual(dropPoint(null, null, [1, 3, 2]), [1, 0, 2]);           // looking up at the sky
});

test('ground taps count as empty', () => {
  assert.equal(isGround('ground', {}), true);
  assert.equal(isGround('floor', { asset: 'ground_big' }), true);
  assert.equal(isGround('plat_01', { asset: 'block', behaviors: [{ type: 'Solid' }] }), false);
  assert.equal(isGround(null, null), false);
});

test('grid snap rounds x/z to 0.5 m, keeps the surface height', () => {
  assert.deepEqual(snapXZ([1.26, 2.37, -0.74]), [1.5, 2.37, -0.5]);
  assert.deepEqual(snapXZ([0.2, 0, 0.3], 1), [0, 0, 0]);
});
