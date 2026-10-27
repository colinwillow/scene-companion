import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Duelist } from '../behaviors/index.js';
import { fakeEntity, fakeWorld, attach } from './fakes.js';

function setup(params = {}) {
  const player = fakeEntity('player', [0, 0, 0]), foe = fakeEntity('foe', [0, 0, 6]);
  const w = fakeWorld([player, foe]); w.rng = () => 0.99;     // never guards unless a test says so
  const d = attach(Duelist, foe, { rest: [0.1, 0.1, 0], ...params }, w);
  const ev = []; for (const n of ['windup', 'hurt', 'blocked', 'interrupt', 'stomp']) w.on(n, () => ev.push(n));
  const step = n => { for (let i = 0; i < n; i++) d.update(1 / 60); };
  return { w, d, foe, ev, step, q: foe.object3d.position };
}

test('he closes to his stand-off, winds up (the tell), then the strike lands', () => {
  const { d, ev, step, q } = setup();
  step(120);
  assert.ok(q.z >= 1.6 - 1e-6 && q.z <= 2.1, `closed to within reach, never past the stand-off, z=${q.z.toFixed(2)}`);
  assert.ok(ev.includes('windup'));
  step(60);
  assert.ok(ev.includes('hurt'), 'the swing landed');
  assert.ok(ev.indexOf('windup') < ev.indexOf('hurt'), 'the tell comes first');
});

test('struck during the wind-up: the swing is cancelled and he staggers', () => {
  const { w, d, ev, step } = setup();
  while (d.st !== 'windup') step(1);
  w.emit('struck', 'player', 'foe', 1);
  assert.equal(d.st, 'stagger'); assert.equal(d.hpLeft, 4); assert.ok(ev.includes('interrupt'));
  step(20); assert.ok(!ev.includes('hurt'), 'his swing never landed');
});

test('your swing may meet his guard: no damage', () => {
  const { w, d, ev, step } = setup({ guardChance: 1 });
  step(100); while (d.st !== 'rest' && d.st !== 'idle') step(1);
  d.st = 'rest'; d.restT = 5;
  w.emit('swing', 'player'); assert.equal(d.st, 'guard');
  w.emit('struck', 'player', 'foe', 1);
  assert.equal(d.hpLeft, 5); assert.ok(ev.includes('blocked'));
});

test('enough hits put him down for good', () => {
  const { w, d, foe, ev } = setup({ hp: 2 });
  w.emit('struck', 'player', 'foe', 1); w.emit('struck', 'player', 'foe', 1);
  assert.equal(foe.defeated, true); assert.ok(ev.includes('stomp'));
  d.update(1 / 60); w.emit('struck', 'player', 'foe', 1); assert.equal(d.hpLeft, 0);
});
