import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DeckTricks, Skater } from '../behaviors/index.js';

function rig() {
  const rider = new THREE.Group(), board = new THREE.Group(); rider.add(board);
  const sk = Object.create(Skater.prototype); Object.assign(sk, { grounded: false, grind: null, heading: 0, entity: { id: 'player', behaviors: [] } });
  const said = [], ents = { player: { id: 'player', object3d: rider, behaviors: [sk] }, board: { id: 'board', parent: 'player', object3d: board } };
  const world = { getEntity: id => ents[id], emit: (...a) => said.push(a), input: {} };
  const t = new DeckTricks(ents.board, {}, world); t.start();
  return { t, sk, world, said, board };
}
const step = (t, s) => { for (let i = 0; i < s * 60; i++) { t.update(1 / 60); t.lateUpdate(1 / 60); } };

test('DeckTricks: a flick forward in the air is a kickflip (a roll about the deck), landed round when he touches down', () => {
  const { t, sk, world, said, board } = rig();
  world.input.attack = [0, 1];                       // forward along his heading (0 → +z)
  t.update(1 / 60); assert.equal(t.trick.kind, 'kickflip');
  step(t, 0.17);
  const z = new THREE.Vector3(0, 0, 1).applyQuaternion(board.quaternion), y = new THREE.Vector3(0, 1, 0).applyQuaternion(board.quaternion);
  assert.ok(z.z > 0.99 && y.y < 0.3, 'half way round: still pointing along, rolled over');
  step(t, 0.5); sk.grounded = true; t.update(1 / 60); t.lateUpdate();
  assert.ok(said.some(a => a[0] === 'landtrick' && a[2] === 'kickflip'), 'landed');
  assert.ok(board.quaternion.angleTo(new THREE.Quaternion()) < 1e-6 && board.position.length() < 1e-9, 'board back under him');
});

test('DeckTricks: back = 360 flip, sideways = shove-it that way; touching down early is a bail; on the ground a flick is not a trick', () => {
  let r = rig(); r.world.input.attack = [0, -1]; r.t.update(1 / 60); assert.equal(r.t.trick.kind, '360 flip');
  r.sk.grounded = true; r.t.update(0.05);
  assert.ok(r.said.some(a => a[0] === 'bail'), 'touched down a few degrees in: bailed');
  r = rig(); r.world.input.attack = [-1, 0]; r.t.update(1 / 60);   // −x is his right when he faces +z
  assert.equal(r.t.trick.kind, 'shove-it'); assert.equal(r.t.trick.sign, 1);
  r = rig(); r.sk.grounded = true; r.world.input.attack = [0, 1]; r.t.update(1 / 60);
  assert.equal(r.t.trick, null); assert.deepEqual(r.world.input.attack, [0, 1], 'left for anything else that wants it');
});
