import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Dynamics } from '../behaviors/index.js';

// a body with a head and a 4-bone cape hanging off the hips, pointing down (-y) at rest
function rig() {
  const root = new THREE.Group(), hips = new THREE.Bone(), head = new THREE.Bone();
  hips.name = 'mixamorig_Hips'; hips.position.y = 1; head.name = 'mixamorig_Head'; head.position.y = 0.6;
  root.add(hips); hips.add(head);
  let parent = hips; const cape = [];
  for (let j = 0; j < 4; j++) { const b = new THREE.Bone(); b.name = `cape_0_${j}`; b.position.set(0, j ? -0.2 : 0, j ? 0 : -0.25); parent.add(b); parent = b; cape.push(b); }
  return { root, hips, cape };
}
const tipOf = cape => cape.at(-1).getWorldPosition(new THREE.Vector3());

test('Dynamics finds the chains and leaves a still body at rest', () => {
  const { root, cape } = rig(), ent = { id: 'g', object3d: root };
  const d = new Dynamics(ent, {}, { emit() {} }); d.start();
  root.updateMatrixWorld(true); const rest = tipOf(cape);
  for (let i = 0; i < 120; i++) { d.lateUpdate(1 / 60); root.updateMatrixWorld(true); }
  assert.equal(d.segs.length, 3, 'three segments between four bones');
  assert.ok(tipOf(cape).distanceTo(rest) < 0.05, `stays near its pose, moved ${tipOf(cape).distanceTo(rest).toFixed(3)} m`);
});

test('Dynamics: the cape trails behind when the body moves, then swings back', () => {
  const { root, cape } = rig(), ent = { id: 'g', object3d: root };
  const d = new Dynamics(ent, {}, { emit() {} }); d.start();
  for (let i = 0; i < 30; i++) { d.lateUpdate(1 / 60); root.updateMatrixWorld(true); }
  let lagMax = 0;
  for (let i = 0; i < 30; i++) {                 // run forward (+z) at 6 m/s
    root.position.z += 0.1; root.updateMatrixWorld(true); d.lateUpdate(1 / 60); root.updateMatrixWorld(true);
    lagMax = Math.max(lagMax, root.position.z - 0.25 - tipOf(cape).z);
  }
  assert.ok(lagMax > 0.05, `the tip trails behind (−z), ${lagMax.toFixed(3)} m`);
  for (let i = 0; i < 300; i++) { d.lateUpdate(1 / 60); root.updateMatrixWorld(true); }
  assert.ok(Math.abs(root.position.z - 0.25 - tipOf(cape).z) < 0.06, 'and settles back under him');
  for (const s of d.segs) {
    const a = s.b.getWorldPosition(new THREE.Vector3()), b = s.cur;
    assert.ok(Math.abs(a.distanceTo(b) - s.len) < 1e-6, 'segment lengths hold');
  }
});

test('Dynamics off = the pose untouched', () => {
  const { root, cape } = rig(), d = new Dynamics({ id: 'g', object3d: root }, { on: false }, { emit() {} }); d.start();
  const q = cape[0].quaternion.clone(); root.position.z = 5; root.updateMatrixWorld(true); d.lateUpdate(1 / 60);
  assert.ok(cape[0].quaternion.equals(q));
});
