import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { readGlb, writeGlb, appendClips, nodeTree, firstClip } from '../tools/bake-motions.mjs';

test('bake: clips appended to a GLB read back exactly; existing data untouched', () => {
  const src = readFileSync(new URL('../assets/models/colin/characters/zap.glb', import.meta.url));
  const glb = readGlb(src), before = glb.json.animations.length, binBefore = Buffer.from(glb.bin);
  const bone = glb.json.nodes.find(n => n.name === 'mixamorig_Hips').name;
  const times = [0, 0.5, 1], q = [0, 0, 0, 1, 0, 0.7071, 0, 0.7071, 0, 1, 0, 0];
  const clip = new THREE.AnimationClip('Baked_Test', 1, [
    new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, q),
    new THREE.VectorKeyframeTrack(`${bone}.position`, times, [0, 1, 0, 0, 1.1, 0, 0, 1, 0])]);
  assert.deepEqual(appendClips(glb, [clip]), []);
  assert.deepEqual(appendClips(glb, [clip]), ['Baked_Test'], 'same name twice is skipped');
  const back = readGlb(writeGlb(glb));
  assert.equal(back.json.animations.length, before + 1);
  assert.ok(back.bin.subarray(0, binBefore.length).equals(binBefore), 'the original binary (draco mesh) is byte-identical');
  // Read the new animation back through the same reader the baker uses for library clips.
  back.json.animations.unshift(back.json.animations.pop());
  const got = firstClip(back, 'x');
  const qt = got.tracks.find(t => t.name.endsWith('.quaternion'));
  assert.deepEqual([...qt.times], times);
  assert.deepEqual([...qt.values].map(v => +v.toFixed(4)), q);
  assert.ok(nodeTree(back.json).getObjectByName(bone).isBone);
});
