import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readGlbJson, glbInfo } from '../tools/inventory.mjs';

test('inventory reads a rigged character: kind, rig, clips without residue, bind-space size', () => {
  const info = glbInfo(readGlbJson(readFileSync(new URL('../assets/models/colin/characters/zap.glb', import.meta.url))));
  assert.equal(info.kind, 'character');
  assert.equal(info.joints, 62);
  assert.ok(info.mixamo);
  assert.ok(info.clips.includes('in_air') && !info.clips.includes('CINEMA_4D_Main'));
  assert.ok(info.draco && info.webp);
  assert.ok(Math.abs(info.size[1] - 0.909) < 0.01, `height ${info.size[1]}`);   // bind geometry, not ×0.01 armature
});

test('inventory reads a prop through its node transforms', () => {
  const info = glbInfo(readGlbJson(readFileSync(new URL('../assets/models/colin/props/e_crates.glb', import.meta.url))));
  assert.equal(info.kind, 'model');
  assert.ok(info.tris > 0);
  assert.ok(Math.abs(info.size[1] - 1.41) < 0.01);
  assert.equal(readGlbJson(Buffer.from('not a glb at all, nope')), null);
});
