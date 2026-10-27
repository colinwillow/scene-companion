import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../runtime/World.js';
import '../behaviors/index.js';

globalThis.window ??= { devicePixelRatio: 1 };
const fakeRenderer = () => ({ shadowMap: {}, setPixelRatio() {}, toneMappingExposure: 1 });

test('instanceStatic: repeated static props become one InstancedMesh; anything with a moving behavior stays itself; undo restores', async () => {
  const crate = { variants: { web: { primitive: 'box', size: [1, 1, 1] } } };
  const ents = [0, 1, 2, 3, 4].map(i => ({ id: `c${i}`, asset: 'crate', position: [i * 2, 0, 0], behaviors: [{ type: 'Solid' }] }));
  ents.push({ id: 'spinner', asset: 'crate', position: [0, 0, 5], behaviors: [{ type: 'Spin' }] });
  const w = new World(fakeRenderer()); await w.load({ settings: { look: 'baked' }, assets: { crate }, entities: ents });
  assert.equal(w.instanceStatic(), 5);
  const ims = []; w.scene.traverse(o => { if (o.isInstancedMesh) ims.push(o); });
  assert.equal(ims.length, 1); assert.equal(ims[0].count, 5);
  const m = new THREE.Matrix4(); ims[0].getMatrixAt(3, m); assert.equal(new THREE.Vector3().setFromMatrixPosition(m).x, 6);
  let hidden = 0; w.getEntity('c0').object3d.traverse(o => { if (o.isMesh && !o.visible) hidden++; }); assert.equal(hidden, 1);
  let spin = 0; w.getEntity('spinner').object3d.traverse(o => { if (o.isMesh && o.visible) spin++; }); assert.equal(spin, 1, 'a Spin is not static');
  w.getEntity('c3').object3d.position.x = 20; w.instanceStatic();
  w.instanced[0].getMatrixAt(3, m); assert.equal(new THREE.Vector3().setFromMatrixPosition(m).x, 20, 'a live move re-instances');
  w.unInstance(); hidden = 0; w.getEntity('c0').object3d.traverse(o => { if (o.isMesh && !o.visible) hidden++; }); assert.equal(hidden, 0);
});
