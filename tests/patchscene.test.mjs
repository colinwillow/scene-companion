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

test('patchScene: re-parents in place; look and point lights in place; still rebuilds for other settings and the sun', async () => {
  const prev = scene(), w = await loaded(structuredClone(prev));
  const moved = structuredClone(prev); const hat = moved.entities[0].children.pop(); moved.entities.push(hat);
  const hatObj = w.getEntity('a_hat').object3d;
  assert.equal(await patchScene(w, prev, moved), 'patched', 're-parented in place');
  assert.equal(hatObj.parent, w.scene, 'the hat now hangs off the scene root');
  assert.equal(w.getEntity('a_hat').parent, null);
  assert.deepEqual(w.getEntity('a').children, []);
  const w2 = await loaded(structuredClone(prev));
  const fog = structuredClone(prev); fog.settings.fog = [10, 50];
  assert.equal(await patchScene(w2, prev, fog), 'rebuild', 'settings other than the look');
  const sun = structuredClone(prev); sun.entities.push({ id: 'sun', light: { type: 'directional' } });
  assert.equal(await patchScene(w2, prev, sun), 'rebuild', 'the sun');
  assert.equal(await patchScene(w2, prev, structuredClone(prev)), 'none');
  const bObj = w2.getEntity('b').object3d;
  w2.roomEnv = {};   // no GPU here: stand in for the pbr environment map
  const look = structuredClone(prev); look.settings.look = 'pbr';
  assert.equal(await patchScene(w2, prev, look), 'patched', 'look switches in place');
  assert.equal(w2.look, 'pbr'); assert.equal(w2.getEntity('b').object3d, bObj);
  assert.equal(bObj.material.type, 'MeshStandardMaterial', 'back to the model\'s own material');
  const toon = structuredClone(look); toon.settings.look = 'toon';
  assert.equal(await patchScene(w2, look, toon), 'patched');
  assert.equal(bObj.material.type, 'MeshToonMaterial');
  assert.ok(bObj.userData.outline, 'toon adds the outline');
  const back = structuredClone(toon); back.settings.look = 'baked';
  await patchScene(w2, toon, back);
  assert.equal(bObj.material.type, 'MeshBasicMaterial'); assert.ok(!bObj.userData.outline, 'and takes it away');
  const lamp = structuredClone(back); lamp.entities.push({ id: 'lamp', light: { type: 'point' }, position: [0, 2, 0] });
  assert.equal(await patchScene(w2, back, lamp), 'patched', 'a point light is added in place');
  assert.ok(w2.getEntity('lamp').object3d.isPointLight);
  assert.equal(await patchScene(w2, lamp, back), 'patched', 'and removed');
  assert.ok(!w2.getEntity('lamp'));
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

test('World.reset: Play/Stop rewinds without rebuilding models', async () => {
  const data = scene(); data.entities.push({ id: 's', prefab: 'spinner', position: [6, 0, 0] });
  const w = await loaded(data);
  const page = []; w.on('ping', () => page.push(1));         // the page's own listener survives a reset
  const bObj = w.getEntity('b').object3d, spin = w.getEntity('s').behaviors[0];
  bObj.position.set(9, 9, 9); bObj.visible = false; w.getEntity('b').defeated = true;
  w.vars.coins = 5;
  await w.spawn('spinner', { position: [1, 1, 1], id: 'extra' });
  w.destroy('a');
  await w.reset(data);
  assert.equal(w.getEntity('b').object3d, bObj, 'same object, not rebuilt');
  assert.deepEqual(bObj.position.toArray(), [3, 0, 0]); assert.equal(bObj.visible, true); assert.equal(w.getEntity('b').defeated, undefined);
  assert.ok(!w.getEntity('extra'), 'spawned objects gone');
  assert.ok(w.getEntity('a') && w.getEntity('a_hat'), 'destroyed authored objects back');
  assert.notEqual(w.getEntity('s').behaviors[0], spin, 'fresh behaviors');
  assert.equal(w.vars.coins, undefined);
  w.emit('ping'); assert.equal(page.length, 1, 'page listener kept, once');
  // edits made since the build (params) are picked up
  data.entities.find(e => e.id === 'b').position = [7, 0, 0];
  await w.reset(data);
  assert.equal(bObj.position.x, 7);
});
