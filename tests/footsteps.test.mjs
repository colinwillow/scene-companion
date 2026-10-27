import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { plants, measure } from '../tools/footsteps.mjs';
import { readGlb } from '../tools/bake-motions.mjs';
import { Footsteps, PlayerController } from '../behaviors/index.js';
import { fakeEntity, fakeWorld, attach } from './fakes.js';

test('plants: one per foot per cycle, at the foot\'s most forward moment', () => {
  const fwd = Array.from({ length: 100 }, (_, i) => Math.sin((i / 100) * 2 * Math.PI));   // peaks at i = 25
  assert.deepEqual(plants(fwd, 0.01), [0.25]);
  assert.deepEqual(plants(new Array(10).fill(1), 0.1), [], 'a still foot never plants');
});

test('measured on Zap\'s real walk: the feet alternate, about half a cycle apart', () => {
  const glb = readGlb(readFileSync(new URL('../assets/models/colin/characters/zap.glb', import.meta.url)));
  const ev = measure(glb, 'walk_fwd');
  assert.deepEqual(ev.map(e => e.foot).sort(), ['L', 'R']);
  const gap = Math.abs(ev[1].t - ev[0].t);
  assert.ok(gap > 0.4 && gap < 1.0, `gap ${gap} of a 1.42 s cycle`);
});

test('Footsteps follows foot events when the character has them (and only while moving)', () => {
  const player = fakeEntity('player');
  player.anim = { events: { run: [{ t: 0.2, name: 'foot', foot: 'L' }] } };
  const w = fakeWorld([player]); w.input = { move: [0, 0], jump: false };
  attach(PlayerController, player, {}, w);
  const fs = attach(Footsteps, player, {}, w);
  assert.equal(fs.fromClip, true);
  const steps = []; w.on('step', (id, o) => steps.push(o.foot));
  fs.update(1 / 60); w.emit('foot', 'player', { clip: 'run', foot: 'L' });
  assert.deepEqual(steps, [], 'standing still: no step');
  w.input.move = [1, 0]; player.behaviors[0].grounded = true; fs.update(1 / 60);
  w.emit('foot', 'player', { clip: 'run', foot: 'R' });
  w.emit('foot', 'someone_else', { clip: 'run', foot: 'L' });
  assert.deepEqual(steps, ['R']);
});
