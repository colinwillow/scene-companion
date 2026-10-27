import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextId, addEntity, duplicateEntity, deleteEntity, setAsset, isDropSurface, dropPoint, isGround, snapXZ, addLight, setLightValue, LIGHT_FIELDS, scatterPoints, scatterEntity, jitterOptions, scatterEraseIds, eraseRadius } from '../runtime/editing.js';

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

test('lights: add point/spot with defaults, lifted; set values clamped and validated', () => {
  const d = scene();
  const pt = addLight(d, 'point', [1, 0, 2]);
  assert.equal(pt.id, 'point_light_01'); assert.deepEqual(pt.position, [1, 2.5, 2]);
  assert.equal(pt.light.intensity, LIGHT_FIELDS.point.intensity.default);
  const sp = addLight(d, 'spot', [0, 0, 0]);
  assert.equal(sp.position[1], 4); assert.equal(sp.light.angle, 35);
  assert.throws(() => addLight(d, 'laser'));
  assert.equal(setLightValue(d, 'point_light_01', 'intensity', 9999), true);
  assert.equal(pt.light.intensity, 200);
  assert.equal(setLightValue(d, 'point_light_01', 'color', 'red'), false);
  assert.equal(setLightValue(d, 'point_light_01', 'angle', 20), false, 'points have no angle');
  assert.equal(setLightValue(d, 'crate_01', 'intensity', 1), false);
});

test('scatter: spacing between painted points, random turn + size per instance', () => {
  const placed = [];
  const a = scatterPoints([[0, 0, 0], [0.5, 0, 0], [1.6, 0, 0], [1.7, 0, 0.2]], 1.5, placed);
  assert.deepEqual(a, [[0, 0, 0], [1.6, 0, 0]]);
  assert.deepEqual(scatterPoints([[0.2, 0, 0.2], [3.5, 1, 0]], 1.5, placed), [[3.5, 1, 0]]);   // later in the same stroke
  const d = scene(); let k = 0; const rng = () => [0.5, 1, 0.25, 0][k++ % 4];
  const e1 = scatterEntity(d, 'tree', [1, 0, 2], rng), e2 = scatterEntity(d, 'tree', [3, 0, 2], rng);
  assert.deepEqual([e1.id, e1.rotation, e1.scale], ['tree_01', [0, 180, 0], [1.2, 1.2, 1.2]]);
  assert.deepEqual([e2.id, e2.rotation, e2.scale], ['tree_02', [0, 90, 0], [0.8, 0.8, 0.8]]);
});

test('scatter: jitter slider + erase brush only removes that prefab near the stroke', () => {
  assert.deepEqual(jitterOptions(0), { scaleJitter: 0, turn: false });
  assert.deepEqual(jitterOptions(0.4), { scaleJitter: 0.2, turn: true });
  assert.deepEqual(jitterOptions(5), { scaleJitter: 0.5, turn: true });
  const d = scene();
  const flat = scatterEntity(d, 'fence', [0, 0, 0], () => 0.5, jitterOptions(0));
  assert.equal(flat.rotation, undefined); assert.equal(flat.scale, undefined);
  scatterEntity(d, 'tree', [1, 0, 0], () => 0.5); scatterEntity(d, 'tree', [5, 0, 0], () => 0.5);
  const near = scatterEraseIds(d, 'tree', [[0.5, 3, 0.4]], eraseRadius(1.5));
  assert.deepEqual(near, ['tree_01'], 'fence at the same spot stays; far tree stays; height ignored');
  assert.deepEqual(scatterEraseIds(d, 'tree', [[0.2, 0, 0], [5.2, 0, 0]], 0.9), ['tree_01', 'tree_02']);
  assert.equal(eraseRadius(0.75), 0.6); assert.equal(eraseRadius(6), 3.6);
});
