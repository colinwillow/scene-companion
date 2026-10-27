import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTime, createRng, playSeed, STEP } from '../runtime/time.js';
import { Stompable, PlayerController, Health } from '../behaviors/index.js';
import { fakeEntity, fakeWorld, attach } from './fakes.js';

test('fixed step: 120 Hz frames run a step every other frame; 30 Hz runs two; alpha tracks the remainder', () => {
  const t = createTime();
  const steps = Array.from({ length: 8 }, () => t.advance(1 / 120));
  assert.equal(steps.reduce((a, b) => a + b, 0), 4);
  assert.ok(steps.every(n => n <= 1));
  const u = createTime();
  assert.equal(u.advance(1 / 30), 2);
  u.advance(STEP / 2); assert.ok(Math.abs(u.alpha - 0.5) < 1e-6);
  for (let i = 0; i < 3; i++) u.tick();
  assert.equal(u.frame, 3); assert.ok(Math.abs(u.t - 3 * STEP) < 1e-12);
});

test('backlog is capped (slow phone / background tab) instead of spiralling', () => {
  const t = createTime({ maxSteps: 5 });
  assert.equal(t.advance(2), 5);
  assert.equal(t.advance(0), 0);
});

test('scale, pause and hit-stop', () => {
  const t = createTime();
  t.scale = 0.5;
  assert.equal([t.advance(1 / 60), t.advance(1 / 60)].reduce((a, b) => a + b), 1);   // half speed
  assert.equal(t.visualDt(0.1), 0.05);
  t.scale = 1; t.paused = true;
  assert.equal(t.advance(1), 0); assert.equal(t.visualDt(0.1), 0);
  t.paused = false; t.hitStop(0.08); t.hitStop(0.02);                                  // the longer one wins
  assert.equal(t.advance(0.05), 0); assert.equal(t.visualDt(0.1), 0);
  assert.equal(t.advance(0.05), 0);                                                    // finishes the stop (real time)
  assert.equal(t.advance(1 / 60), 1);
});

test('rng: same seed → same sequence; helpers stay in range', () => {
  const a = createRng(42), b = createRng(42), c = createRng(43);
  const sa = Array.from({ length: 5 }, a.next), sb = Array.from({ length: 5 }, b.next);
  assert.deepEqual(sa, sb); assert.notDeepEqual(sa, Array.from({ length: 5 }, c.next));
  for (let i = 0; i < 200; i++) {
    const x = a.range(2, 3), n = a.int(1, 6);
    assert.ok(x >= 2 && x < 3); assert.ok(Number.isInteger(n) && n >= 1 && n <= 6);
  }
  const d = createRng(42), e = createRng(42); assert.equal(d(), e.next());   // callable like Math.random
  assert.equal(a.pick([]), undefined); assert.ok(['x', 'y'].includes(a.pick(['x', 'y'])));
  assert.equal(playSeed({ seed: 7 }), 7); assert.equal(playSeed({}, () => 99), 99);
});

test('Stompable hitStop freezes game time on a stomp', () => {
  const player = fakeEntity('player', [0, 0, 0]), w = fakeWorld([player]);
  w.input = { move: [0, 0], jump: false };
  const health = new Health(player, { max: 3 }, w); player.behaviors.push(health); health.start();
  const pc = attach(PlayerController, player, {}, w);
  const enemy = fakeEntity('enemy', [0.5, 0, 0]);
  const st = attach(Stompable, enemy, { height: 1, hitStop: 0.07 }, w);
  player.object3d.position.y = 0.8; pc.vy = -3;
  st.update(0.016);
  assert.equal(st.defeated, true);
  assert.ok(Math.abs(w.time.stopFor - 0.07) < 1e-9);
  assert.equal(w.time.advance(0.05), 0);
});

test('slowMo: game runs at its scale for that many real seconds, then back to normal', () => {
  const t = createTime();
  t.slowMo(0.25, 0.5);
  let n = 0; for (let i = 0; i < 30; i++) n += t.advance(1 / 60);   // 0.5 s real
  assert.ok(n >= 7 && n <= 8, `n=${n}`);                              // ≈ a quarter of 30
  assert.equal(t.slowFor, 0);
  n = 0; for (let i = 0; i < 30; i++) n += t.advance(1 / 60);
  assert.ok(n >= 29 && n <= 31, `n=${n}`);
  t.slowMo(0.5, 1); assert.equal(t.visualDt(0.1), 0.05);
});

test('Stompable slowMo + Footsteps pitch jitter use world.time / world.rng', async () => {
  const { Footsteps } = await import('../behaviors/index.js');
  const player = fakeEntity('player', [0, 0, 0]), w = fakeWorld([player]);
  w.input = { move: [1, 0], jump: false };
  const health = new Health(player, { max: 3 }, w); player.behaviors.push(health); health.start();
  const pc = attach(PlayerController, player, {}, w);
  const st = attach(Stompable, fakeEntity('enemy', [0.5, 0, 0]), { height: 1, slowMo: 1, slowMoScale: 0.2 }, w);
  player.object3d.position.y = 0.8; pc.vy = -3; st.update(0.016);
  assert.equal(w.time.slowFor, 1); assert.ok(Math.abs(w.time.rate - 0.2) < 1e-9);
  const fs = attach(Footsteps, player, { stride: 0.5, runStride: 0.5, pitchJitter: 0.1 }, w);
  pc.grounded = true;
  for (let i = 0; i < 6; i++) { player.object3d.position.x += 0.3; fs.update(1 / 60); }
  const steps = w.emitted.filter(e => e[0] === 'step');
  assert.ok(steps.length >= 2);
  for (const [, , o] of steps) assert.ok(o.pitch >= 0.9 && o.pitch <= 1.1);
  assert.notEqual(steps[0][2].pitch, steps[1][2].pitch);
});
