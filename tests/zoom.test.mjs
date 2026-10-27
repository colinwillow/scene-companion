import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerController, Zoom } from '../behaviors/index.js';
import { fakeEntity, fakeWorld, attach } from './fakes.js';

function setup() {
  const player = fakeEntity('player', [0, 0, 0]);
  const w = fakeWorld([player]); w.input = { move: [0, 0], jump: false, charge: false };
  const pc = attach(PlayerController, player, {}, w), z = attach(Zoom, player, {}, w);
  const ev = []; w.on('zoom', (id, k) => ev.push(k));
  const step = n => { for (let i = 0; i < n; i++) for (const b of player.behaviors) b.update(1 / 60); };
  return { w, player, pc, z, ev, step, p: player.object3d.position };
}

test('hold to charge (he slows), let go to dash along his facing; a full charge goes further', () => {
  const dist = frames => {
    const { w, player, z, ev, step, p } = setup();
    w.input.charge = true; step(frames);
    assert.ok(player.moveScale < 0.5, 'slowed while charging');
    w.input.charge = false; step(1);
    assert.equal(player.mover, z); step(120);
    assert.equal(player.mover, null, 'hands back');
    return { z: p.z, k: ev[0] };
  };
  const half = dist(36), full = dist(90);
  assert.ok(half.k > 0.5 && half.k < 0.6 && full.k === 1, `charges ${half.k.toFixed(2)} / ${full.k}`);
  assert.ok(half.z > 4 && full.z > half.z + 1, `dashed ${half.z.toFixed(1)} m / ${full.z.toFixed(1)} m along +z`);
});

test('a short tap of a hold does nothing', () => {
  const { w, z, step, p, ev } = setup();
  w.input.charge = true; step(10); w.input.charge = false; step(30);
  assert.equal(z.run, null); assert.equal(ev.length, 0); assert.ok(Math.abs(p.z) < 1e-9);
});
