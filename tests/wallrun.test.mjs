import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Solid, PlayerController, WallRun } from '../behaviors/index.js';
import { fakeEntity, fakeWorld, attach } from './fakes.js';

// a 12 m long, 3.6 m tall wall along z at x = 1 (face at x = 0.8), and the player beside it at the origin
function setup(wallPos = [1, 0, 0], wallSize = [0.4, 3.6, 12]) {
  const player = fakeEntity('player', [0, 0, -4]), wall = fakeEntity('wall', wallPos);
  const w = fakeWorld([player, wall]); w.input = { move: [0, 0], jump: false };
  attach(Solid, wall, { size: wallSize }, w);
  const pc = attach(PlayerController, player, {}, w), wr = attach(WallRun, player, {}, w);
  const step = n => { for (let i = 0; i < n; i++) for (const b of player.behaviors) b.update(1 / 60); };
  return { w, player, pc, wr, step, p: player.object3d.position, o: player.object3d };
}

test('tap while moving along a tall wall → a side run: along the face, off the floor, body rolled off the wall', () => {
  const { w, player, wr, step, p, o } = setup();
  w.input.move = [0, 1]; step(10);
  w.input.jump = true; step(1);
  assert.equal(wr.run?.kind, 'side'); assert.equal(player.mover, wr);
  const z0 = p.z; step(30);
  assert.ok(p.z - z0 > 3, `ran along it, ${(p.z - z0).toFixed(2)} m`);
  assert.ok(p.y > 0.3, `feet off the floor, y=${p.y.toFixed(2)}`);
  assert.ok(Math.abs(p.x - (0.8 - 0.35 - 0.06)) < 1e-6, `held on the face, x=${p.x}`);
  assert.ok(o.rotation.z > 0, `head leans off the wall (wall at +x is his left; +z roll tips the head to −x), z roll ${o.rotation.z}`);
});

test('the run ends by itself and hands the body back to the PlayerController', () => {
  const { w, player, pc, wr, step, p, o } = setup();
  w.input.move = [0, 1]; step(5); w.input.jump = true; step(1);
  w.input.move = [0, 0]; step(150);
  assert.equal(wr.run, null); assert.equal(player.mover, null); assert.equal(o.rotation.z, 0);
  assert.ok(pc.grounded && Math.abs(p.y) < 1e-6, `landed, y=${p.y}`);
});

test('tap on the wall → a wall jump: off the face and up, keeping speed along it', () => {
  const { w, pc, wr, step, p } = setup();
  w.input.move = [0, 1]; step(5); w.input.jump = true; step(1); step(10);
  w.input.move = [0, 0]; w.input.jump = true; step(1);
  assert.equal(wr.run, null); assert.ok(pc.vy > 6, `up, vy=${pc.vy}`);
  const x0 = p.x, z0 = p.z; step(20);
  assert.ok(p.x < x0 - 1, `kicked off the face (−x), ${(x0 - p.x).toFixed(2)} m`);
  assert.ok(p.z > z0 + 1, `kept going along it, ${(p.z - z0).toFixed(2)} m`);
});

test('heading into the wall → a run up it', () => {
  const { w, wr, step, p } = setup([1.2, 0, -4]);
  w.input.move = [1, 0]; step(10); w.input.jump = true; step(1);
  assert.equal(wr.run?.kind, 'up'); step(20);
  assert.ok(p.y > 1.5, `up the face, y=${p.y.toFixed(2)}`);
});

test('no wall in reach, or a short post → the tap is an ordinary jump', () => {
  const far = setup([3, 0, 0]);
  far.w.input.move = [0, 1]; far.step(5); far.w.input.jump = true; far.step(1);
  assert.equal(far.wr.run, null); assert.ok(far.pc.vy > 0, 'jumped');
  const low = setup([1, 0, 0], [0.4, 1, 12]);
  low.w.input.move = [0, 1]; low.step(5); low.w.input.jump = true; low.step(1);
  assert.equal(low.wr.run, null, 'a 1 m wall is a hurdle, not a wall');
});

test('setYaw normalises a quaternion-flipped Euler instead of facing the mirror image', async () => {
  const { setYaw } = await import('../behaviors/index.js');
  const o = { rotation: { x: Math.PI, y: Math.PI - 2.5, z: Math.PI } };   // how a 2.5 rad yaw reads back from a quaternion
  setYaw(o, 2.6);
  assert.deepEqual(o.rotation, { x: 0, y: 2.6, z: 0 });
  const tilted = { rotation: { x: 0.1, y: 0, z: 0 } }; setYaw(tilted, 1);
  assert.equal(tilted.rotation.x, 0.1, 'a small authored tilt is kept');
});
