import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stickVector, releaseGesture, armFlick, STICK } from '../runtime/sticks.js';

test('stick vector is relative to the landing point and clamped to the ring', () => {
  assert.deepEqual(stickVector(26, 0), { x: 0.5, y: 0, px: 26, py: 0 });
  const v = stickVector(300, 400);
  assert.ok(Math.abs(Math.hypot(v.x, v.y) - 1) < 1e-9);
  assert.ok(Math.abs(v.x - 0.6) < 1e-9 && Math.abs(v.y - 0.8) < 1e-9);
});

test('release: short small touch = tap (jump), long or far = nothing, armed sweep = flick', () => {
  assert.equal(releaseGesture({ far: 0.1, heldMs: 120, flick: null, now: 0 }), 'tap');
  assert.equal(releaseGesture({ far: 0.1, heldMs: 600, flick: null, now: 0 }), null);     // a hold
  assert.equal(releaseGesture({ far: 0.9, heldMs: 150, flick: null, now: 0 }), null);     // a drag
  assert.equal(releaseGesture({ far: 1, heldMs: 150, flick: { x: 1, y: 0, t: 100 }, now: 200 }), 'flick');
  assert.equal(releaseGesture({ far: 1, heldMs: 900, flick: { x: 1, y: 0, t: 100 }, now: 100 + STICK.flickLet + 1 }), null);  // swept then held
});

test('flick arms on a fast sweep only', () => {
  assert.deepEqual(armFlick([{ x: 0, y: 0, t: 0 }, { x: 0.9, y: 0, t: 100 }]), { x: 0.9, y: 0, t: 100 });
  assert.equal(armFlick([{ x: 0, y: 0, t: 0 }, { x: 0.3, y: 0, t: 100 }]), null);           // too small
  assert.equal(armFlick([{ x: 0, y: 0, t: 0 }, { x: 0.9, y: 0, t: 1000 }]), null);          // too slow
  assert.equal(armFlick([{ x: 0, y: 0, t: 0 }]), null);
});
