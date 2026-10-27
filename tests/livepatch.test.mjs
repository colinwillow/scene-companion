import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyScene } from '../runtime/livepatch.js';
import { Spin } from '../behaviors/index.js';
import { fakeEntity, fakeWorld } from './fakes.js';

const scene = () => ({ settings: { look: 'toon' }, assets: { a: {} }, prefabs: {},
  entities: [{ id: 'crate', asset: 'a', position: [0, 0, 0], behaviors: [{ type: 'Spin', params: { speed: 1 } }] }, { id: 'player', asset: 'a', position: [0, 0, 0] }] });
function worldFor(data) {
  const ents = data.entities.map(e => fakeEntity(e.id, e.position));
  const w = fakeWorld(ents);
  const crate = w.getEntity('crate'); crate.behaviors.push(new Spin(crate, { speed: 1 }, w));
  return w;
}

test('moves only what changed and keeps runtime state elsewhere', () => {
  const prev = scene(), next = scene(), w = worldFor(prev);
  w.getEntity('player').object3d.position.x = 7;       // player walked during play
  next.entities[0].position = [1, 2, 3];
  next.entities[0].rotation = [0, 90, 0];
  assert.equal(applyScene(w, prev, next), 'patched');
  assert.deepEqual(Object.values(w.getEntity('crate').object3d.position), [1, 2, 3]);
  assert.ok(Math.abs(w.getEntity('crate').object3d.rotation.y - Math.PI / 2) < 1e-9);
  assert.equal(w.getEntity('player').object3d.position.x, 7, 'untouched');
});

test('pushes changed behavior params live', () => {
  const prev = scene(), next = scene(), w = worldFor(prev);
  next.entities[0].behaviors[0].params.speed = 4;
  assert.equal(applyScene(w, prev, next), 'patched');
  assert.equal(w.getEntity('crate').behaviors[0].params.speed, 4);
});

test('structural changes ask for a rebuild', () => {
  const w = worldFor(scene());
  const add = scene(); add.entities.push({ id: 'new' });
  const asset = scene(); asset.entities[0].asset = 'b';
  const look = scene(); look.settings.look = 'pbr';
  const beh = scene(); beh.entities[0].behaviors.push({ type: 'Bob' });
  for (const n of [add, asset, look, beh]) assert.equal(applyScene(w, scene(), n), 'rebuild');
  assert.equal(applyScene(w, null, scene()), 'rebuild');
  assert.equal(applyScene(w, scene(), scene()), 'none');
});

test('moving an object mid-play tells its behaviors (Bob keeps bobbing around the new height)', async () => {
  const { Bob } = await import('../behaviors/index.js');
  const prev = scene(), next = scene(), w = worldFor(prev);
  const crate = w.getEntity('crate');
  const bob = new Bob(crate, { height: 0.5, speed: 1 }, w); crate.behaviors.push(bob); bob.start();
  next.entities[0].position = [0, 4, 0];
  assert.equal(applyScene(w, prev, next), 'patched');
  bob.update(0.016, Math.PI / 2);
  assert.ok(Math.abs(crate.object3d.position.y - 4.5) < 1e-9, `y=${crate.object3d.position.y}`);
});
