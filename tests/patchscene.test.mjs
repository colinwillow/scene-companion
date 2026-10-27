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

test('patchScene: still rebuilds for re-parenting, settings and lights', async () => {
  const prev = scene(), w = await loaded(structuredClone(prev));
  const moved = structuredClone(prev); const hat = moved.entities[0].children.pop(); moved.entities.push(hat);
  assert.equal(await patchScene(w, prev, moved), 'rebuild', 're-parented');
  const look = structuredClone(prev); look.settings.look = 'toon';
  assert.equal(await patchScene(w, prev, look), 'rebuild', 'settings');
  const lamp = structuredClone(prev); lamp.entities.push({ id: 'lamp', light: { type: 'point' }, position: [0, 2, 0] });
  assert.equal(await patchScene(w, prev, lamp), 'rebuild', 'lights');
  const none = structuredClone(prev);
  assert.equal(await patchScene(w, prev, none), 'none');
});
