import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TailWave } from '../behaviors/index.js';

function rig(n = 8) {
  const o = new THREE.Group(), hips = new THREE.Bone(); o.add(hips);
  let p = hips; const bones = [];
  for (let i = 0; i < n; i++) { const b = new THREE.Bone(); b.name = i ? `tail_${i}` : 'tail'; b.position.set(0, i ? 0 : -0.1, -0.12); p.add(b); p = b; bones.push(b); }
  return { o, hips, bones, tip: () => bones.at(-1).getWorldPosition(new THREE.Vector3()) };
}

test('TailWave: still body = the authored pose; a turn swings the tip behind and it settles back', () => {
  const { o, hips, tip } = rig(), tw = new TailWave({ id: 't', object3d: o }, {}, {}); tw.start();
  o.updateMatrixWorld(true); const rest = tip();
  for (let i = 0; i < 30; i++) tw.lateUpdate(1 / 60);
  assert.ok(tip().distanceTo(rest) < 1e-6, 'standing still it IS the pose');
  let lagMax = 0;
  for (let i = 0; i < 30; i++) {           // turn the hips 3 rad/s for half a second
    hips.rotation.y += 0.05; o.updateMatrixWorld(true); tw.lateUpdate(1 / 60);
    const rigid = new THREE.Vector3(0, -0.1, -0.12 * 8).applyAxisAngle(new THREE.Vector3(0, 1, 0), hips.rotation.y);
    lagMax = Math.max(lagMax, tip().distanceTo(rigid));
  }
  assert.ok(lagMax > 0.05, `the tip trails the turn, ${lagMax.toFixed(3)} m`);
  for (let i = 0; i < 300; i++) tw.lateUpdate(1 / 60);
  const rigid = new THREE.Vector3(0, -0.1, -0.12 * 8).applyAxisAngle(new THREE.Vector3(0, 1, 0), hips.rotation.y);
  assert.ok(tip().distanceTo(rigid) < 0.005, 'and settles back onto the pose');
});

test('TailWave: the same wave at 20 and 60 fps (sub-stepped)', () => {
  const lag = fps => {
    const { o, hips, tip } = rig(), tw = new TailWave({ id: 't', object3d: o }, {}, {}); tw.start(); tw.lateUpdate(1 / fps);
    for (let t = 0; t < 0.5; t += 1 / fps) { hips.rotation.y += 3 / fps; o.updateMatrixWorld(true); tw.lateUpdate(1 / fps); }
    return tip().distanceTo(new THREE.Vector3(0, -0.1, -0.96).applyAxisAngle(new THREE.Vector3(0, 1, 0), hips.rotation.y));
  };
  const a = lag(60), b = lag(20);
  assert.ok(Math.abs(a - b) / a < 0.1, `60 fps ${a.toFixed(3)} vs 20 fps ${b.toFixed(3)}`);
});
