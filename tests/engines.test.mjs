import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { quatXYZ, flatNodes, toUnity, unityPos, unityQuat } from '../runtime/engines.js';

test('quatXYZ matches three for any Euler XYZ', () => {
  for (const r of [[0, 90, 0], [30, 40, 50], [-120, 10, 200]]) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...r.map(d => d * Math.PI / 180), 'XYZ'));
    quatXYZ(r).forEach((v, i) => assert.ok(Math.abs(v - [q.x, q.y, q.z, q.w][i]) < 1e-12));
  }
});

test('flatNodes: models at game size, primitives, solids, children by index', () => {
  const ents = [
    { id: 'p', position: [1, 2, 3], variant: { glb: './assets/a.glb', height: 2 }, behaviors: [{ type: 'Solid', params: { size: [1, 2, 1] } }],
      children: [{ id: 'k', variant: { primitive: 'box', size: [1, 1, 1], color: '#f00', pivot: 'bottom' } }] },
    { id: 'sun', light: { type: 'directional', intensity: 2 }, position: [0, 5, 0] },
  ];
  const { nodes, files } = flatNodes(ents, { measure: () => ({ minY: -0.25, height: 0.5 }) });
  assert.deepEqual(files, ['assets/a.glb']);
  assert.deepEqual(nodes[0].model, { file: 'assets/a.glb', scale: [4, 4, 4], offset: [0, 1, 0] });
  assert.deepEqual(nodes[0].solids, [{ center: [0, 1, 0], size: [1, 2, 1] }]);
  assert.equal(nodes[1].parent, 0); assert.equal(nodes[1].primitive.lift, 0.5);
  assert.equal(nodes[2].light.type, 'directional');
});

test('toUnity mirrors X like glTFast: a mirrored quaternion still turns the mirrored point', () => {
  assert.deepEqual(unityPos([1, 2, 3]), [-1, 2, 3]);
  // rotating a point then mirroring == mirroring the point then rotating by the mirrored quaternion
  const q = quatXYZ([20, 70, -30]), p = new THREE.Vector3(0.3, -1.2, 2);
  const a = p.clone().applyQuaternion(new THREE.Quaternion(...q)); const A = unityPos(a.toArray());
  const B = new THREE.Vector3(...unityPos(p.toArray())).applyQuaternion(new THREE.Quaternion(...unityQuat(q))).toArray();
  A.forEach((v, i) => assert.ok(Math.abs(v - B[i]) < 1e-9, `${A} vs ${B}`));
  const [n] = toUnity({ nodes: [{ name: 'x', parent: -1, pos: [1, 0, 0], quat: [0, 0, 0, 1], scale: [1, 1, 1], solids: [], behaviors: [{ type: 'Spin' }] }] });
  assert.equal(n.behaviors, '[{"type":"Spin"}]'); assert.deepEqual(n.pos, [-1, 0, 0]);
});

test('Unreal: Z-up centimetres, and the editor script runs end to end against a stand-in unreal module', async t => {
  const { toUnreal, ueVec, ueQuat } = await import('../runtime/engines.js');
  assert.deepEqual(ueVec([1, 2, 3], 100), [300, 100, 200]);
  // a +90° turn about three's Y (up) is a +90° turn about Unreal's Z (up)
  assert.deepEqual(ueQuat(quatXYZ([0, 90, 0])).map(v => +v.toFixed(4)), [0, 0, 0.7071, 0.7071]);
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, readFileSync, writeFileSync, copyFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  try { execFileSync('python3', ['--version']); } catch { t.skip('no python3'); return; }
  const dir = mkdtempSync(join(tmpdir(), 'ue-'));
  const { nodes } = { nodes: toUnreal(flatNodes([
    { id: 'player', position: [0, 0, 6], variant: { glb: './zap.glb', height: 2 } },
    { id: 'plat', position: [2.5, 0, 2], variant: { primitive: 'box', size: [2, 0.5, 2], color: '#ff8800' }, behaviors: [{ type: 'Solid', params: { size: [2, 0.5, 2] } }],
      children: [{ id: 'coin', position: [0, 1, 0], rotation: [0, 90, 0], variant: { primitive: 'sphere', size: [0.5, 0.5, 0.5] } }] },
    { id: 'sun', light: { type: 'directional', intensity: 2 }, position: [5, 10, 5] },
  ], { measure: () => ({ minY: 0, height: 1 }) })) };
  writeFileSync(join(dir, 'zap.glb'), 'x');
  writeFileSync(join(dir, 't.sc.json'), JSON.stringify({ name: 't', player: 'player', nodes }));
  copyFileSync(new URL('../tools/unreal/scene_companion_build.py', import.meta.url), join(dir, 'scene_companion_build.py'));
  execFileSync('python3', [join(dir, 'scene_companion_build.py')], { env: { ...process.env, PYTHONPATH: new URL('./fixtures/unreal_stub', import.meta.url).pathname, SC_SPAWNS: join(dir, 's.json') } });
  const S = JSON.parse(readFileSync(join(dir, 's.json'), 'utf8')), by = l => S.find(s => s.label === l);
  assert.deepEqual(by('player').loc, [600, 0, 0]); assert.deepEqual(by('player').scale, [2, 2, 2]);
  assert.deepEqual(by('plat').loc, [200, 250, 0]);
  assert.deepEqual(by('plat_collider').loc, [200, 250, 25]); assert.equal(by('plat_collider').hidden, true);
  assert.deepEqual(by('coin').loc, [200, 250, 100]);                     // a child lands at its parent + its own offset
  assert.ok(by('sun') && by('SceneCompanion_Camera'));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 't.behaviors.json'), 'utf8')).plat, [{ type: 'Solid', params: { size: [2, 0.5, 2] } }]);
});
