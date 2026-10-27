import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Deck, Skater } from '../behaviors/index.js';

// A board built like Colin's skateboard.glb: a node turned +90° about X at 0.01 scale, its length along the node's Y.
function boardModel() {
  const model = new THREE.Group(), node = new THREE.Mesh(new THREE.BoxGeometry(1.7, 5.4, 0.9));
  node.rotation.x = Math.PI / 2; node.scale.setScalar(0.01); node.position.set(0.3, 0, 0); model.add(node); return model;
}

test('Deck sizes the board to `length`, sets its wheels on the floor and stands the rider on the deck', () => {
  const rider = new THREE.Group(), riderModel = new THREE.Group(), board = new THREE.Group(), bm = boardModel();
  rider.add(riderModel); board.add(bm); board.userData.entityId = 'board'; rider.add(board); riderModel.position.y = 0.02;
  const ents = { player: { id: 'player', object3d: rider }, board: { id: 'board', parent: 'player', object3d: board } };
  const world = { getEntity: id => ents[id], emit() {} };
  const d = new Deck(ents.board, { length: 0.8 }, world); d.start();
  board.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(bm);
  assert.ok(Math.abs(box.max.z - box.min.z - 0.8) < 1e-6, 'nose to tail = length');
  assert.ok(Math.abs(box.min.y) < 1e-6, 'wheels on the floor');
  assert.ok(Math.abs(box.min.x + box.max.x) < 1e-6 && Math.abs(box.min.z + box.max.z) < 1e-6, 'centred under him');
  assert.ok(Math.abs(riderModel.position.y - 0.02 - box.max.y) < 1e-6, 'rider raised by the deck top');
  d.start(); assert.ok(Math.abs(riderModel.position.y - 0.02 - box.max.y) < 1e-6, 'Play again does not stack the lift');
  d.destroy(); assert.equal(riderModel.position.y, 0.02, 'put back');
  new Deck(ents.board, { length: 0.8, lift: 0.11 }, world).start();
  assert.ok(Math.abs(riderModel.position.y - 0.13) < 1e-9, 'a typed lift wins');
});

test('the board preset only names real Skater params, and the skateboard scene carries it', async () => {
  const fs = await import('node:fs');
  for (const k of Object.keys(Skater.presets.board)) assert.ok(k in Skater.schema, k);
  const scene = JSON.parse(fs.readFileSync(new URL('../scenes/skateboard.scene.json', import.meta.url)));
  const p = scene.entities.find(e => e.id === 'player');
  assert.deepEqual(p.behaviors.find(b => b.type === 'Skater').params, Skater.presets.board);
  assert.equal(p.children[0].behaviors[0].type, 'Deck');
});
