import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Solid, PlayerController, Vault } from '../behaviors/index.js';
import { fakeEntity, fakeWorld, attach } from './fakes.js';

function setup(size = [1, 0.8, 3]) {   // a hurdle at x = 2 (x 1.5..2.5)
  const player = fakeEntity('player', [0.6, 0, 0]), block = fakeEntity('block', [2, 0, 0]);
  const w = fakeWorld([player, block]); w.input = { move: [0, 0], jump: false };
  attach(Solid, block, { size }, w);
  const pc = attach(PlayerController, player, { height: 1.35, radius: 0.3 }, w), v = attach(Vault, player, {}, w);
  const step = n => { for (let i = 0; i < n; i++) for (const b of player.behaviors) b.update(1 / 60); };
  return { w, player, pc, v, step, p: player.object3d.position };
}

test('tap while running into a hurdle → over it in an arc, clear of the top, landing past it', () => {
  const { w, player, v, step, p } = setup();
  w.input.move = [1, 0]; step(2); w.input.jump = true; step(1);
  assert.ok(v.arc, 'vaulting'); assert.equal(player.mover, v);
  let minClear = Infinity;
  for (let i = 0; i < 40; i++) { step(1); if (p.x > 1.5 && p.x < 2.5) minClear = Math.min(minClear, p.y - 0.8); }
  assert.ok(minClear > -0.05, `feet stay over the top, clearance ${minClear.toFixed(2)}`);
  step(60);
  assert.ok(p.x > 2.8 && Math.abs(p.y) < 1e-6, `landed past it, x=${p.x.toFixed(2)}`);
});

test('a wall-high block or a deep platform is not a hurdle: the tap is a jump', () => {
  for (const size of [[1, 1.6, 3], [4, 0.8, 3]]) {
    const { w, v, pc, step } = setup(size);
    w.input.move = [1, 0]; step(2); w.input.jump = true; step(1);
    assert.equal(v.arc, null, `size ${size}`); assert.ok(pc.vy > 0, 'jumped');
  }
});
