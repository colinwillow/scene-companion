import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../runtime/World.js';
import { patchScene } from '../runtime/livepatch.js';
import '../behaviors/index.js';

globalThis.window ??= { devicePixelRatio: 1 };
const fakeRenderer = () => ({ shadowMap: {}, setPixelRatio() {}, toneMappingExposure: 1 });
const box = { variants: { web: { primitive: 'box', size: [1, 1, 1] } } };
const scene = () => ({ settings: { look: 'baked' }, assets: { box }, prefabs: { spinner: { asset: box, behaviors: [{ type: 'Spin', params: { speed: 2 } }] } },
  entities: [{ id: 'a', asset: 'box', position: [0, 0, 0], children: [{ id: 'a_hat', asset: 'box', position: [0, 1, 0] }] }, { id: 'b', asset: 'box', position: [3, 0, 0] }] });

async function loaded(data) { const w = new World(fakeRenderer()); await w.load(data); return w; }

test('patchScene: adds and removes objects in place (no rebuild), keeps the rest', async () => {
  const prev = scene(), w = await loaded(structuredClone(prev));
  const bObj = w.getEntity('b').object3d;
  const next = structuredClone(prev);
  next.entities.push({ id: 'c', prefab: 'spinner', position: [5, 0, 0], children: [{ id: 'c_top', asset: 'box', position: [0, 1, 0] }] });
  next.entities = next.entities.filter(e => e.id !== 'a');          // delete a (and its child)
  next.entities.find(e => e.id === 'b').position = [4, 0, 0];      // and move b
  assert.equal(await patchScene(w, prev, next), 'patched');
  assert.ok(!w.getEntity('a') && !w.getEntity('a_hat'), 'a and its child gone');
  assert.ok(w.getEntity('c') && w.getEntity('c_top'), 'c and its child built');
  assert.equal(w.getEntity('c').behaviors[0].constructor.name, 'Spin', 'behaviors attached + started');
  assert.equal(w.getEntity('b').object3d, bObj, 'b is the same object (not rebuilt)…');
  assert.equal(bObj.position.x, 4, '…and was moved');
});

test('patchScene: re-parents in place; still rebuilds for settings and lights', async () => {
  const prev = scene(), w = await loaded(structuredClone(prev));
  const moved = structuredClone(prev); const hat = moved.entities[0].children.pop(); moved.entities.push(hat);
  const hatObj = w.getEntity('a_hat').object3d;
  assert.equal(await patchScene(w, prev, moved), 'patched', 're-parented in place');
  assert.equal(hatObj.parent, w.scene, 'the hat now hangs off the scene root');
  assert.equal(w.getEntity('a_hat').parent, null);
  assert.deepEqual(w.getEntity('a').children, []);
  const w2 = await loaded(structuredClone(prev));
  const look = structuredClone(prev); look.settings.look = 'toon';
  assert.equal(await patchScene(w2, prev, look), 'rebuild', 'settings');
  const lamp = structuredClone(prev); lamp.entities.push({ id: 'lamp', light: { type: 'point' }, position: [0, 2, 0] });
  assert.equal(await patchScene(w2, prev, lamp), 'rebuild', 'lights');
  assert.equal(await patchScene(w2, prev, structuredClone(prev)), 'none');
});

test('patchScene: an object whose clips/events change is rebuilt alone (others untouched)', async () => {
  const prev = scene(), w = await loaded(structuredClone(prev));
  const bObj = w.getEntity('b').object3d, aObj = w.getEntity('a').object3d;
  const next = structuredClone(prev); next.entities[0].events = { idle: [{ t: 0.1, name: 'hit' }] };
  assert.equal(await patchScene(w, prev, next), 'patched');
  assert.notEqual(w.getEntity('a').object3d, aObj, 'a was rebuilt');
  assert.ok(w.getEntity('a_hat'), 'with its child');
  assert.equal(w.getEntity('b').object3d, bObj, 'b untouched');
});
