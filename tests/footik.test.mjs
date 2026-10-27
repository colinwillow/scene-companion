import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FootIK, Solid } from '../behaviors/index.js';
import { fakeWorld, attach } from './fakes.js';

// a body (entity group → model) with two legs: hip 0.9 up, knee 0.45, ankle 0.08 above the soles; the knees bent a little
function body(liftModel = 0) {
  const o = new THREE.Group(), model = new THREE.Group(), hips = new THREE.Bone(); o.add(model); model.add(hips); hips.position.y = 0.9;
  const leg = (side, x) => {
    const up = new THREE.Bone(), mid = new THREE.Bone(), foot = new THREE.Bone();
    up.name = `mixamorig_${side}UpLeg`; mid.name = `mixamorig_${side}Leg`; foot.name = `mixamorig_${side}Foot`;
    up.position.set(x, 0, 0); mid.position.set(0, -0.42, 0.12); foot.position.set(0, -0.4, -0.12);
    hips.add(up); up.add(mid); mid.add(foot);
  };
  leg('Left', 0.1); leg('Right', -0.1);
  return { o, model, ent: { id: 'p', object3d: o, behaviors: [] } };
}
const soleY = (o, side, ankle) => o.getObjectByName(`mixamorig_${side}Foot`).getWorldPosition(new THREE.Vector3()).y - ankle;

test('FootIK drops a floating body until the lower sole touches the floor (a kerb under one foot: that leg reaches)', () => {
  const { o, model, ent } = body(); const w = fakeWorld([ent]);
  const ik = attach(FootIK, ent, { ease: 0.005 }, w);
  ik.lateUpdate(1 / 60);                      // first grounded frame: measures the ankles over the soles
  const ankle = ik.legs[0].ankle;
  model.position.y += 0.1;                    // now he floats 10 cm (a clip that tucks the legs up, say)
  ik.baseY = 0;
  for (let i = 0; i < 60; i++) { model.position.y = 0.1; ik.baseY = 0.1; ik.lateUpdate(1 / 60); }
  assert.ok(Math.abs(soleY(o, 'Left', ankle)) < 0.01 && Math.abs(soleY(o, 'Right', ankle)) < 0.01, `soles on the floor: ${soleY(o, 'Left', ankle).toFixed(3)} / ${soleY(o, 'Right', ankle).toFixed(3)}`);
});

test('FootIK: a plate under one foot — the body rises onto it (at most maxRaise), the other leg reaches down', () => {
  const { o, ent } = body(); const step = { id: 'kerb', object3d: { position: { x: 0.1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }, behaviors: [] };
  const w = fakeWorld([ent, step]);
  attach(Solid, step, { size: [0.15, 0.06, 0.6] }, w);     // a 6 cm plate under the LEFT foot only
  const ik = attach(FootIK, ent, { ease: 0.005 }, w);
  for (let i = 0; i < 60; i++) ik.lateUpdate(1 / 60);
  const ankle = ik.legs[0].ankle;
  assert.ok(Math.abs(soleY(o, 'Left', ankle) - 0.06) < 0.015, `left sole on the plate, ${soleY(o, 'Left', ankle).toFixed(3)}`);
  assert.ok(soleY(o, 'Right', ankle) < 0.03, `right leg reached down toward its floor (as far as a leg reaches), ${soleY(o, 'Right', ankle).toFixed(3)}`);
  const leg = ik.legs[1], hip = leg.up.getWorldPosition(new THREE.Vector3()), foot = leg.foot.getWorldPosition(new THREE.Vector3());
  assert.ok(hip.distanceTo(foot) > 0.84, 'the leg is at full stretch, not bent');
});
