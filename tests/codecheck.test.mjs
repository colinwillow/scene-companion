import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findHardcoded, findSpawnedMeshes, stripComments } from '../tools/codecheck.mjs';

test('flags literal placement in its common forms', () => {
  const src = [
    'enemy.position.set(3, 0, -2);',
    'o.position.x = 4.5;',
    'o.scale.y = 2;',
    'o.position.fromArray([1, 2, 3]);',
    'o.position.copy(new THREE.Vector3(0, 1, 0));',
  ].join('\n');
  assert.deepEqual(findHardcoded(src).map(h => h.line), [1, 2, 3, 4, 5]);
});

test('allows computed values, comparisons, cameras and comments', () => {
  const src = [
    'p.x += dx * k;',
    'p.y = support;',
    'if (o.position.y === 0) {}',
    'camera.position.set(10, 11, 14);',
    '// o.position.set(1, 2, 3);',
    '/* o.position.x = 5; */',
    'p.x = this.target[0];',
    'o.position.set(...this.spawn);',
  ].join('\n');
  assert.deepEqual(findHardcoded(src), []);
});

test('stripComments keeps URLs in strings', () => {
  assert.match(stripComments("const u = 'https://x.y/z'; // note"), /https:\/\/x\.y\/z/);
});

test('finds meshes created in code', () => {
  assert.equal(findSpawnedMeshes('const m = new THREE.Mesh(g, mat);\nconst v = new Vector3();').length, 1);
  assert.equal(findSpawnedMeshes('const marker = new THREE.Mesh(g, mat);   // sc:overlay').length, 0, 'overlay opt-out');
});
