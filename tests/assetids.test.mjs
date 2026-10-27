import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, rewriteRefs } from '../runtime/assetids.js';

test('asset ids: a moved file keeps its id (found by content), new files get one, a vanished file is reported', () => {
  let n = 0; const id = () => `n${++n}`;
  const reg = { a1: { path: 'assets/a.glb', sha: 'AAA' }, b1: { path: 'assets/b.glb', sha: 'BBB' }, c1: { path: 'assets/c.glb', sha: 'CCC' } };
  const r = reconcile(reg, [{ path: 'assets/a.glb', sha: 'AAA' }, { path: 'assets/new/b.glb', sha: 'BBB' }, { path: 'assets/d.mp3', sha: 'DDD' }], id);
  assert.deepEqual(r.registry.b1, { path: 'assets/new/b.glb', sha: 'BBB' });
  assert.deepEqual(r.moved, { 'assets/b.glb': 'assets/new/b.glb' });
  assert.deepEqual(r.added, ['assets/d.mp3']); assert.deepEqual(r.gone, ['assets/c.glb']);
  assert.equal(r.registry.a1.path, 'assets/a.glb');
});

test('asset ids: references are rewritten wherever they are in a scene, with or without ./', () => {
  const scene = { assets: { x: { variants: { web: { glb: './assets/b.glb', collision: 'assets/b.glb' } } } }, entities: [{ behaviors: [{ params: { clip: './assets/b.glb', other: 'b.glb' } }] }], list: ['./assets/b.glb'] };
  assert.equal(rewriteRefs(scene, { 'assets/b.glb': 'assets/new/b.glb' }), 4);
  assert.equal(scene.assets.x.variants.web.glb, './assets/new/b.glb'); assert.equal(scene.assets.x.variants.web.collision, 'assets/new/b.glb');
  assert.equal(scene.entities[0].behaviors[0].params.other, 'b.glb'); assert.equal(scene.list[0], './assets/new/b.glb');
});
