import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeEntity, setOverride } from '../runtime/prefabs.js';

const prefab = {
  asset: { variants: { web: { primitive: 'box' } } },
  rotation: [90, 0, 0],
  behaviors: [
    { type: 'Spin', params: { speed: 3 } },
    { type: 'Bob', params: { height: 0.2, speed: 2 } },
  ],
};

test('no prefab returns the entity unchanged', () => {
  const e = { id: 'a' };
  assert.equal(mergeEntity(undefined, e), e);
});

test('entity fields win; prefab fields fill in', () => {
  const m = mergeEntity(prefab, { id: 'c1', prefab: 'coin', position: [1, 2, 3], rotation: [0, 0, 0] });
  assert.deepEqual(m.position, [1, 2, 3]);
  assert.deepEqual(m.rotation, [0, 0, 0]);
  assert.deepEqual(m.asset, prefab.asset);
});

test('behavior params merge by type; new types append', () => {
  const m = mergeEntity(prefab, { id: 'c', behaviors: [{ type: 'Bob', params: { height: 1 } }, { type: 'Pickup' }] });
  assert.deepEqual(m.behaviors.map(b => b.type), ['Spin', 'Bob', 'Pickup']);
  assert.deepEqual(m.behaviors[1].params, { height: 1, speed: 2 });
});

test('removeBehaviors drops prefab behaviors and is not copied through', () => {
  const m = mergeEntity(prefab, { id: 'c', removeBehaviors: ['Bob'] });
  assert.deepEqual(m.behaviors.map(b => b.type), ['Spin']);
  assert.ok(!('removeBehaviors' in m));
});

test('merging never mutates the prefab', () => {
  const before = JSON.stringify(prefab);
  const m = mergeEntity(prefab, { id: 'c', behaviors: [{ type: 'Spin', params: { speed: 9 } }] });
  m.behaviors[0].params.speed = 7;
  m.asset.variants.web.primitive = 'sphere';
  assert.equal(JSON.stringify(prefab), before);
});

test('setOverride writes onto the instance only', () => {
  const e = { id: 'c', prefab: 'coin' };
  setOverride(e, 'Bob', 'height', 0.5);
  setOverride(e, 'Bob', 'speed', 1);
  assert.deepEqual(e.behaviors, [{ type: 'Bob', params: { height: 0.5, speed: 1 } }]);
  assert.equal(prefab.behaviors[1].params.height, 0.2);
});
