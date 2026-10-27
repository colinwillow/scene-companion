import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Mount } from '../behaviors/index.js';

test('Mount hangs a prop on a named bone, sized by `unit`, and gives it back on destroy', () => {
  const scene = new THREE.Scene(), body = new THREE.Group(), hand = new THREE.Bone(), root = new THREE.Bone();
  hand.name = 'mixamorig_RightHand'; root.name = 'weapon_root_right';
  body.scale.setScalar(0.5); body.add(hand); hand.add(root); scene.add(body);
  const prop = new THREE.Group(); scene.add(prop); prop.position.set(3, 3, 3);
  const ents = { player: { id: 'player', object3d: body }, katana: { id: 'katana', parent: 'player', object3d: prop } };
  const world = { getEntity: id => ents[id], emit() {} };
  const m = new Mount(ents.katana, { unit: 0.01 }, world); m.start();
  assert.equal(prop.parent, root, 'on the bone');
  assert.deepEqual(prop.position.toArray(), [0, 0, 0], 'identity in the bone frame');
  prop.updateMatrixWorld(true);
  assert.ok(Math.abs(prop.getWorldScale(new THREE.Vector3()).x - 0.01) < 1e-9, 'one prop unit = 1 cm in the world, whatever the rig scale');
  m.destroy();
  assert.equal(prop.parent, scene, 'back where it came from');
});

test('Mount with no such bone leaves the prop alone (and says so)', () => {
  const said = [], body = new THREE.Group(), prop = new THREE.Group(), scene = new THREE.Scene(); scene.add(body, prop);
  const ents = { player: { id: 'player', object3d: body }, katana: { id: 'katana', parent: 'player', object3d: prop } };
  new Mount(ents.katana, { bone: 'nope' }, { getEntity: id => ents[id], emit: (n, m) => said.push(m) }).start();
  assert.equal(prop.parent, scene); assert.match(said[0], /no bone "nope"/);
});
