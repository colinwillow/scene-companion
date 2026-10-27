// World loads a scene and runs behaviors in Node with real three (no WebGL: toon look, primitives only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../runtime/World.js';
import '../behaviors/index.js';

globalThis.window ??= { devicePixelRatio: 1 };
const fakeRenderer = () => ({ shadowMap: {}, setPixelRatio() {}, toneMappingExposure: 1 });

const scene = () => ({
  settings: { look: 'toon', fog: [10, 50] },
  assets: {
    crate: { variants: { web: { primitive: 'box', size: [1, 1, 1], color: '#c08a4b' },
                         desktop: { primitive: 'sphere', size: [1, 1, 1] } } },
  },
  entities: [
    { id: 'sun', light: { type: 'directional', intensity: 2 }, position: [5, 10, 5] },
    { id: 'player', asset: { variants: { web: { primitive: 'capsule', size: [0.5, 1.75, 0.5] } } }, position: [0, 0, 0] },
    { id: 'crate_01', asset: 'crate', position: [1, 0.5, 2], rotation: [0, 90, 0], scale: [2, 2, 2] },
    { id: 'coin', asset: 'crate', position: [0.5, 0, 0], behaviors: [{ type: 'Pickup', params: { radius: 1, points: 5 } }, { type: 'Spin', params: { speed: 1 } }] },
    { id: 'odd', asset: 'crate', behaviors: [{ type: 'NotABehavior' }] },
  ],
});

async function load(tier = 'web', data = scene()) {
  const w = new World(fakeRenderer(), { tier });
  const warn = console.warn; console.warn = () => {};
  try { await w.load(data); } finally { console.warn = warn; }
  return w;
}

test('builds every entity with its authored transform', async () => {
  const w = await load();
  assert.deepEqual([...w.entities.keys()], ['sun', 'player', 'crate_01', 'coin', 'odd']);
  const c = w.getEntity('crate_01').object3d;
  assert.deepEqual(c.position.toArray(), [1, 0.5, 2]);
  assert.ok(Math.abs(c.rotation.y - Math.PI / 2) < 1e-9, 'degrees → radians');
  assert.deepEqual(c.scale.toArray(), [2, 2, 2]);
  assert.equal(c.userData.entityId, 'crate_01');
  assert.equal(w.scene.fog.far, 50);
});

test('tier picks the richest allowed variant, falling back to web', async () => {
  const web = await load('web'), desk = await load('desktop');
  assert.equal(web.getEntity('crate_01').object3d.geometry.type, 'BoxGeometry');
  assert.equal(desk.getEntity('crate_01').object3d.geometry.type, 'SphereGeometry');
  assert.equal(desk.getEntity('player').object3d.geometry.type, 'CapsuleGeometry', 'web-only asset still loads on desktop');
});

test('toon look converts materials and adds outlines', async () => {
  const w = await load();
  const m = w.getEntity('crate_01').object3d;
  assert.equal(m.material.type, 'MeshToonMaterial');
  assert.ok(m.children.some(c => c.name === '__outline'));
});

test('behaviors attach, unknown ones are skipped, and they run', async () => {
  const w = await load();
  const scores = [];
  w.on('score', p => scores.push(p));
  assert.equal(w.getEntity('odd').behaviors.length, 0);
  assert.equal(w.getEntity('coin').behaviors.length, 2);
  w.time.interpolate = false;          // read the exact game state (interpolation is tested below)
  w.update(0.5);
  assert.deepEqual(scores, [5]);
  assert.equal(w.getEntity('coin').object3d.visible, false);
  assert.ok(Math.abs(w.getEntity('coin').object3d.rotation.y - 0.5) < 1e-9);
});

test('fixed step + interpolation: behaviors see whole steps, the screen sees a blend; outside moves stick', async () => {
  const w = await load();
  const coin = w.getEntity('coin').object3d;
  w.update(0.5);                        // 30 steps; shown between step 29 and 30
  assert.equal(w.time.frame, 30);
  assert.ok(coin.rotation.y > 0.5 - 1 / 60 - 1e-6 && coin.rotation.y <= 0.5 + 1e-6, `y=${coin.rotation.y}`);
  w.update(1 / 120);                    // half a step: no gameplay step, blend moves on
  assert.equal(w.time.frame, 30);
  coin.position.x = 9;                  // e.g. a live-link move between frames
  w.update(1 / 60);
  assert.equal(coin.position.x, 9);
  w.time.scale = 0;
  w.update(1); assert.equal(w.time.frame, 31);
});

test('load never mutates the authored scene data', async () => {
  const data = scene();
  const before = JSON.stringify(data);
  const w = await load('web', data);
  w.update(1);
  assert.equal(JSON.stringify(data), before);
});

test('dispose clears entities', async () => {
  const w = await load();
  w.dispose();
  assert.equal(w.entities.size, 0);
});

test('Worlds share one loader + model cache, and dispose() never frees cached geometry', async () => {
  const THREE = await import('three');
  const { markShared, clearAssetCache } = await import('../runtime/World.js');
  const geo = new THREE.BoxGeometry(), mat = new THREE.MeshStandardMaterial();
  const gscene = new THREE.Group(); gscene.add(new THREE.Mesh(geo, mat));
  let freed = 0; geo.addEventListener('dispose', () => freed++);
  const data = () => ({ settings: { look: 'baked' }, entities: [{ id: 'a', asset: { variants: { web: { glb: 'fake.glb', scale: 1 } } } }] });
  const w1 = new World(fakeRenderer());
  w1.gltfCache.set('fake.glb', Promise.resolve(markShared({ scene: gscene, animations: [] })));
  await w1.load(data());
  const w2 = new World(fakeRenderer());
  assert.equal(w2.loader, w1.loader, 'one loader (one Draco worker pool) per page');
  assert.equal(w2.gltfCache, w1.gltfCache, 'one parsed-GLB cache per page');
  w1.dispose();
  await w2.load(data());
  assert.equal(freed, 0, 'cached geometry survives the old World being disposed');
  assert.ok(w2.getEntity('a'));
  clearAssetCache();
  assert.equal(w2.gltfCache.size, 0);
});
