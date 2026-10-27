import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TriGrid, meshTriangles } from '../runtime/trimesh.js';
import { Surface, PlayerController } from '../behaviors/index.js';
import { fakeWorld, attach } from './fakes.js';

test('TriGrid: height and normal under a point, either winding; walls are not floors', () => {
  const g = new TriGrid({ cell: 1, maxSlope: 60 });
  assert.ok(g.add(0, 0, 0, 4, 2, 0, 0, 0, 4));      // a slope rising 2 m over 4 along x
  assert.ok(g.add(0, 0, 4, 4, 2, 0, 4, 2, 4));
  assert.ok(!g.add(5, 0, 0, 5, 3, 0, 5, 0, 3), 'a vertical face is not a floor');
  const h = g.groundAt(2, 2);
  assert.ok(Math.abs(h.y - 1) < 1e-9, `y=${h.y}`);
  assert.ok(Math.abs(h.n[1] - Math.cos(Math.atan(0.5))) < 1e-9 && h.n[0] < 0, `normal ${h.n}`);
  assert.equal(g.groundAt(10, 10), null);
  assert.equal(g.groundAt(2, 2, 0.5), null, 'nothing at or under 0.5 m there');
});

test('meshTriangles reads a three mesh in world space (scale, turn, position)', () => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2));   // a 2×2 floor
  m.position.set(10, 3, 0); m.scale.setScalar(2);
  const root = new THREE.Group(); root.add(m);
  const [{ pos, index }] = meshTriangles(root);
  const g = new TriGrid(); assert.equal(g.addPositions(pos, index), 2);
  assert.ok(Math.abs(g.groundAt(11.5, 1.5).y - 3) < 1e-9 && g.groundAt(12.5, 0) === null);
});

test('PlayerController walks up a Surface ramp as drawn, and stands on its top', () => {
  // a 30° ramp: 6 m long along +x rising 3.46 m, then a flat top
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, -2), new THREE.Vector3(6, 3.46, -2), new THREE.Vector3(0, 0, 2),
    new THREE.Vector3(0, 0, 2), new THREE.Vector3(6, 3.46, -2), new THREE.Vector3(6, 3.46, 2),
    new THREE.Vector3(6, 3.46, -2), new THREE.Vector3(10, 3.46, -2), new THREE.Vector3(6, 3.46, 2),
    new THREE.Vector3(6, 3.46, 2), new THREE.Vector3(10, 3.46, -2), new THREE.Vector3(10, 3.46, 2)]);
  const ramp = { id: 'ramp', object3d: new THREE.Mesh(geo), behaviors: [] };
  const playerObj = new THREE.Group(); playerObj.position.set(-1, 0, 0);
  const player = { id: 'player', object3d: playerObj, behaviors: [] };
  const w = fakeWorld([player, ramp]); w.input = { move: [1, 0], jump: false };
  const sf = attach(Surface, ramp, {}, w); assert.equal(sf.count, 4);
  const pc = attach(PlayerController, player, {}, w);
  let maxStep = 0, prev = 0;
  for (let i = 0; i < 90; i++) { pc.update(1 / 60); maxStep = Math.max(maxStep, Math.abs(playerObj.position.y - prev)); prev = playerObj.position.y; }
  const x = playerObj.position.x, want = Math.min(3.46, Math.max(0, x) * 3.46 / 6);
  assert.ok(Math.abs(playerObj.position.y - want) < 0.02 && pc.grounded, `on the slope: x=${x.toFixed(2)} y=${playerObj.position.y.toFixed(2)} (want ${want.toFixed(2)})`);
  for (let i = 0; i < 20; i++) pc.update(1 / 60);
  assert.ok(Math.abs(playerObj.position.y - 3.46) < 1e-6 && playerObj.position.x > 6, `on the top: x=${playerObj.position.x.toFixed(2)} y=${playerObj.position.y.toFixed(3)}`);
  assert.ok(maxStep < 0.2, `smooth, biggest step ${maxStep.toFixed(3)} m`);
});
