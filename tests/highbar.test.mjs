import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerController, Bar, HighBar } from '../behaviors/index.js';
import { fakeEntity, fakeWorld, attach } from './fakes.js';

// a 2.6 m bar along x at height 2.55, and a 1.35 m player jumping up under it
function setup() {
  const player = fakeEntity('player', [0, 0.9, 0]), bar = fakeEntity('bar', [0, 2.55, 0]);
  player.object3d.rotation.order = 'XYZ';
  const w = fakeWorld([player, bar]); w.input = { move: [0, 0], jump: false };
  attach(Bar, bar, {}, w);
  const pc = attach(PlayerController, player, { height: 1.35 }, w), hb = attach(HighBar, player, {}, w);
  pc.grounded = false; pc.vy = 0;
  const step = n => { for (let i = 0; i < n; i++) for (const b of player.behaviors) b.update(1 / 60); };
  return { w, player, pc, hb, step, p: player.object3d.position, o: player.object3d };
}

test('falling with his hands at the bar catches it: he hangs under it', () => {
  const { player, hb, step, p } = setup();
  step(1);
  assert.ok(hb.hang, 'caught'); assert.equal(player.mover, hb);
  step(600);                                   // no input: the swing dies down to hanging straight
  assert.ok(Math.abs(hb.hang.th) < 0.1, `hangs still, th=${hb.hang.th.toFixed(3)}`);
  assert.ok(Math.abs(p.y - (2.55 - 1.2 * 1.35)) < 0.02 && Math.abs(p.z) < 0.15, `under the bar, y=${p.y.toFixed(2)} z=${p.z.toFixed(2)}`);
});

test('pumping with the stick builds the swing to giant swings', () => {
  const { w, hb, step } = setup();
  step(1);
  let maxTh = 0;
  for (let i = 0; i < 900; i++) {
    const dirSign = hb.hang.face;                 // push along the way he faces across the bar, with the swing
    w.input.move = [0, Math.sign(hb.hang.w || 1) * dirSign];
    step(1); maxTh = Math.max(maxTh, Math.abs(hb.hang.th));
  }
  assert.ok(maxTh > 3, `over the top, max angle ${maxTh.toFixed(2)} rad`);
});

test('tap lets go along the swing: off the bar, flying, the rotation upright again', () => {
  const { w, player, pc, hb, step, o } = setup();
  step(1); hb.hang.th = 0.6; hb.hang.w = 6;     // swinging forward and up
  w.input.jump = true; step(1);
  assert.equal(hb.hang, null); assert.equal(player.mover, null);
  assert.ok(pc.vy > 3, `up, vy=${pc.vy.toFixed(2)}`); assert.ok(Math.hypot(...pc.carry) > 3, 'and away');
  assert.equal(o.rotation.x, 0); assert.equal(o.rotation.order, 'XYZ');
});
