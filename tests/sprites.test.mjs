import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normClip, clipFrame, frameUV, sliceSheet, spriteRole } from '../runtime/sprites.js';
import { SpriteAnimator, PlayerController } from '../behaviors/index.js';
import { fakeEntity, fakeWorld, attach, run } from './fakes.js';

test('clips: arrays or objects, loop or hold', () => {
  assert.deepEqual(normClip([2, 5, 10]), { from: 2, to: 5, fps: 10, loop: true });
  assert.deepEqual(normClip({ from: 7, to: 3 }), { from: 7, to: 7, fps: 8, loop: true });
  const run4 = normClip([2, 5, 10]);
  assert.deepEqual([0, 0.1, 0.35, 0.4, 0.45].map(t => clipFrame(run4, t)), [2, 3, 5, 2, 2]);
  assert.equal(clipFrame(normClip({ from: 0, to: 2, fps: 10, loop: false }), 5), 2);
});

test('frameUV: frame 0 is the top-left cell', () => {
  assert.deepEqual(frameUV(0, 4, 2), { offset: [0, 0.5], repeat: [0.25, 0.5] });
  assert.deepEqual(frameUV(6, 4, 2), { offset: [0.5, 0], repeat: [0.25, 0.5] });
});

test('sliceSheet: by frame size or by grid', () => {
  assert.deepEqual(sliceSheet(128, 64, { frame: [32] }), { cols: 4, rows: 2, frameW: 32, frameH: 32, count: 8 });
  assert.deepEqual(sliceSheet(100, 50, { grid: [5, 1] }), { cols: 5, rows: 1, frameW: 20, frameH: 50, count: 5 });
});

test('spriteRole: air beats ground, run when moving, falls back to what exists', () => {
  const all = { idle: 1, run: 1, jump: 1, fall: 1 };
  assert.equal(spriteRole({ grounded: true, speed: 0 }, all), 'idle');
  assert.equal(spriteRole({ grounded: true, speed: 3 }, all), 'run');
  assert.equal(spriteRole({ grounded: false, vy: 2 }, all), 'jump');
  assert.equal(spriteRole({ grounded: false, vy: -2 }, all), 'fall');
  assert.equal(spriteRole({ grounded: false, vy: -2 }, { idle: 1, jump: 1 }), 'jump');
});

test('SpriteAnimator: runs the run clip while moving and flips to the way he faces', () => {
  const ent = fakeEntity('p', [0, 0, 0]), w = fakeWorld([ent]);
  w.input = { move: [-1, 0], jump: false };
  const frames = [], faces = [];
  ent.sprite = { clips: { idle: normClip([0, 1, 3]), run: normClip([2, 5, 10]) }, setFrame: i => frames.push(i), face: y => faces.push(Math.sin(y)) };
  const pc = attach(PlayerController, ent, { plane: 'side' }, w), sa = attach(SpriteAnimator, ent, {}, w);
  for (let i = 0; i < 20; i++) { pc.update(1 / 60); sa.update(1 / 60); }
  assert.ok(frames.slice(5).every(f => f >= 2 && f <= 5), `frames ${frames}`);
  assert.ok(faces.at(-1) < -0.9, 'faces -x');
  w.input.move = [0, 0];
  for (let i = 0; i < 5; i++) { pc.update(1 / 60); sa.update(1 / 60); }
  assert.ok(frames.at(-1) <= 1, 'back to idle');
});
