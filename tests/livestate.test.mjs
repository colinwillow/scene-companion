import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFpsMeter, buildState, describeState, sameScene } from '../runtime/livestate.js';
import { fakeEntity, fakeWorld } from './fakes.js';

test('fps meter averages over its window', () => {
  const m = createFpsMeter(1);
  for (let i = 0; i < 59; i++) m.tick(1 / 60);
  assert.equal(m.fps, 0, 'no reading before a full window');
  m.tick(1 / 60);
  assert.ok(Math.abs(m.fps - 60) < 1e-6);
});

test('state reports the selected object live, rounded, and caps errors', () => {
  const crate = fakeEntity('crate', [1.23456, 2, 3]);
  crate.object3d.visible = false;
  const s = buildState(fakeWorld([crate]), { url: 'scenes/a.json', fps: 59.6, errors: [1, 2, 3, 4, 5, 6, 7], selectedId: 'crate' });
  assert.deepEqual(s.selected, { id: 'crate', position: [1.235, 2, 3], visible: false });
  assert.equal(s.fps, 60);
  assert.equal(s.errors.length, 5);
  assert.equal(buildState(fakeWorld([]), { selectedId: 'gone' }).selected, null);
});

test('badge text and scene matching', () => {
  assert.equal(describeState({ fps: 58 }), '● LIVE · 58 fps');
  assert.equal(describeState({ fps: 30 }, 2), '● LIVE · 30 fps · 2 errors');
  assert.equal(describeState(null), '● LIVE');
  assert.ok(sameScene('./scenes/a.json', 'scenes/a.json'));
  assert.ok(!sameScene('./scenes/a.json', undefined));
});

test('budgets: the frame stats ride the state; the LIVE badge shows draws and warns over the tier budget', async () => {
  const { buildState, describeState, overBudget, BUDGETS } = await import('../runtime/livestate.js');
  const world = { getEntity: () => null, solids: [1, 2, 3] };
  const s = buildState(world, { fps: 58.6, draws: 412, tris: 120000 });
  assert.equal(s.draws, 412); assert.equal(s.solids, 3);
  assert.equal(describeState(s), '● LIVE · 59 fps · 412 draws ⚠');
  assert.deepEqual(overBudget(s), ['draws 412 > 300']);
  assert.deepEqual(overBudget({ draws: 100, tris: 900000 }, BUDGETS.web), ['tris 900k > 500k']);
  assert.equal(describeState(buildState(world, { fps: 60 })), '● LIVE · 60 fps', 'no stats sent: as before');
});
