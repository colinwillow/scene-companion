import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Solid, PlayerController, Ledge } from '../behaviors/index.js';
import { fakeEntity, fakeWorld, attach } from './fakes.js';

// a 2 m block (x 1..3, top at y 2) and a 1.35 m player falling beside its face
function setup(start = [0.4, 1.3, 0]) {
  const player = fakeEntity('player', start), block = fakeEntity('block', [2, 0, 0]);
  const w = fakeWorld([player, block]); w.input = { move: [0, 0], jump: false };
  attach(Solid, block, { size: [2, 2, 2] }, w);
  const pc = attach(PlayerController, player, { height: 1.35, radius: 0.3 }, w), lg = attach(Ledge, player, {}, w);
  pc.grounded = false; pc.vy = -0.5;
  const step = n => { for (let i = 0; i < n; i++) for (const b of player.behaviors) b.update(1 / 60); };
  return { w, player, pc, lg, step, p: player.object3d.position };
}

test('falling past the lip with the stick into the face → he hangs from it', () => {
  const { w, player, lg, step, p } = setup();
  w.input.move = [1, 0]; step(20);
  assert.ok(lg.hold, 'caught the lip'); assert.equal(player.mover, lg);
  assert.ok(Math.abs(p.y - (2 - 0.86 * 1.35)) < 1e-6, `hangs below the lip, y=${p.y.toFixed(3)}`);
  assert.ok(p.x < 1, `outside the face, x=${p.x.toFixed(3)}`);
  const y = p.y; step(60); assert.equal(p.y, y, 'and stays there');
});

test('no stick into it → no grab (a jump beside a wall does not hang him)', () => {
  const { lg, step } = setup();
  step(40); assert.equal(lg.hold, null);
});

test('tap while hanging → climbs up and stands on top', () => {
  const { w, player, pc, lg, step, p } = setup();
  w.input.move = [1, 0]; step(20); w.input.move = [0, 0];
  w.input.jump = true; step(1);
  assert.equal(lg.clip, 'ledge_hang_to_get_up_over_ledge');
  step(90);
  assert.equal(lg.hold, null); assert.equal(player.mover, null);
  assert.ok(Math.abs(p.y - 2) < 1e-6 && p.x > 1, `on top, ${p.x.toFixed(2)}, ${p.y.toFixed(2)}`);
  step(30); assert.ok(pc.grounded && Math.abs(p.y - 2) < 1e-6, 'and the PlayerController keeps him there');
});

test('stick pulled away while hanging → lets go and falls', () => {
  const { w, lg, pc, step, p } = setup();
  w.input.move = [1, 0]; step(20); w.input.move = [-1, 0]; step(30);
  assert.equal(lg.hold, null); step(60);
  assert.ok(pc.grounded && Math.abs(p.y) < 1e-6, `back on the floor, y=${p.y}`);
});
