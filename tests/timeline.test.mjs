import test from 'node:test';
import assert from 'node:assert/strict';
import { clipFps, frameAt, frameCount, readout, viewPose } from '../runtime/timeline.js';

test('timeline: fps from keys, frames and readout', () => {
  assert.equal(clipFps([{ times: [0, 1 / 24, 2 / 24, 3 / 24] }]), 24);
  assert.equal(clipFps([{ times: [0, 1] }, { times: [0, 1 / 30, 2 / 30] }]), 30);
  assert.equal(clipFps([]), 30);
  assert.equal(frameAt(0.5, 24), 12);
  assert.equal(frameCount(1.417, 24), 34);
  assert.equal(readout(0.5, 1, 24), '0.50 s · frame 12 / 24 (24 fps)');
});

test('timeline views: front is where it faces, side is square to it, top is above', () => {
  const c = [0, 1, 0], near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  const f = viewPose(c, 0, 1.8, 'front');            // facing +Z → camera on +Z
  assert.ok(f[2] > 3 && Math.abs(f[0]) < 1e-9);
  const turned = viewPose(c, Math.PI / 2, 1.8, 'front');   // facing +X → camera on +X
  assert.ok(turned[0] > 3 && Math.abs(turned[2]) < 1e-9);
  const s = viewPose(c, 0, 1.8, 'side');
  assert.ok(Math.abs(s[2]) < 1e-9 && Math.abs(s[0]) > 3);
  const t = viewPose(c, 0, 1.8, 'top');
  assert.ok(t[1] > 4 && near([t[0], t[2]].map(v => +v.toFixed(1)), [0, 0]));
});
