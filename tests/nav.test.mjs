import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NavGrid } from '../runtime/nav.js';

const box = (x, z, sx, sz, h = 2) => ({ params: { size: [sx, h, sz], anchor: 'bottom', shape: 'box' }, entity: { object3d: { position: { x, y: 0, z }, rotation: { x: 0, y: 0, z: 0 } } },
  box() { return { minX: x - sx / 2, maxX: x + sx / 2, minY: 0, maxY: h, minZ: z - sz / 2, maxZ: z + sz / 2 }; } });

test('NavGrid: around a wall instead of through it; a kerb is stepped over; open ground is one straight leg', () => {
  const g = new NavGrid().build([box(0, 0, 1, 10), box(5, 8, 2, 2, 0.2)]);
  assert.deepEqual(g.path([-3, 0], [3, 0.5]).length > 1, true, 'a wall between: a detour');
  const p = g.path([-3, 0], [3, 0]);
  for (const [x, z] of p) assert.ok(Math.abs(z) > 4.5 || Math.abs(x) > 0.9, 'never through the wall');
  assert.deepEqual(g.path([3, 8], [7, 8]), [[7, 8]], 'the 20 cm kerb is not in the way');
  assert.deepEqual(g.path([-3, -20], [3, -20]), [[3, -20]]);
});

test('NavGrid: a closed room has no way in; a target against a wall is reached from the nearest open cell', () => {
  const g = new NavGrid().build([box(0, 3, 6, 0.5), box(0, -3, 6, 0.5), box(3, 0, 0.5, 6), box(-3, 0, 0.5, 6)]);
  assert.equal(g.path([10, 0], [0, 0]), null);
  const g2 = new NavGrid().build([box(0, 0, 1, 10)]);
  assert.ok(g2.path([-3, 0], [0.4, 0]), 'standing against the wall');
});

test('Chase walks around a wall to reach its target (and with navigate off, walks into it)', async () => {
  const { Chase } = await import('../behaviors/index.js');
  for (const navigate of [true, false]) {
    const me = { id: 'm', object3d: { position: { x: -3, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, visible: true } };
    const target = { id: 'player', object3d: { position: { x: 3, y: 0, z: 0 } } };
    const world = { solids: [box(0, 0, 1, 10)], getEntity: id => (id === 'player' ? target : null) };
    const c = new Chase(me, { radius: 20, speed: 3, navigate }, world); c.start();
    let through = false;
    for (let i = 0; i < 60 * 8; i++) { c.update(1 / 60); const p = me.object3d.position; if (Math.abs(p.x) < 0.5 && Math.abs(p.z) < 5) through = true; }
    const d = Math.hypot(me.object3d.position.x - 3, me.object3d.position.z);
    if (navigate) { assert.equal(through, false, 'never through the wall'); assert.ok(d < 0.5, `reached it (${d.toFixed(2)} m)`); }
    else assert.equal(through, true, 'the old straight line goes through (Chase has no collision of its own)');
  }
});

test('Reactions as a state machine: idle → (near) chase round a wall → (leave) home; rules only run in their state', async () => {
  const { Reactions } = await import('../behaviors/index.js');
  const guard = { id: 'guard', behaviors: [], object3d: { position: { x: -3, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } } };
  const player = { id: 'player', object3d: { position: { x: 3, y: 0, z: 30 } } }, said = [];
  const world = { vars: {}, solids: [box(0, 0, 1, 10)], on() {}, emit: (...a) => said.push(a), getEntity: id => (id === 'player' ? player : id === 'guard' ? guard : null) };
  const rules = [
    { when: { type: 'near', target: 'player', radius: 8 }, if: { state: 'idle' }, do: [{ type: 'go', state: 'chase' }] },
    { when: { type: 'enter', state: 'chase' }, do: [{ type: 'move', mode: 'chase', target: 'player', speed: 3 }, { type: 'say', text: 'Hey!' }] },
    { when: { type: 'leave', target: 'player', radius: 14 }, if: { state: 'chase' }, do: [{ type: 'go', state: 'home' }] },
    { when: { type: 'enter', state: 'home' }, do: [{ type: 'move', mode: 'home', speed: 3 }] },
  ];
  const r = new Reactions(guard, { rules, state: 'idle' }, world); guard.behaviors.push(r); r.start();
  const run = s => { for (let i = 0; i < s * 60; i++) r.update(1 / 60); };
  run(1); assert.equal(r.mode, 'idle'); assert.deepEqual([guard.object3d.position.x, guard.object3d.position.z], [-3, 0]);
  player.object3d.position.z = 0; run(0.2); assert.equal(r.mode, 'chase'); assert.ok(said.some(a => a[0] === 'say'));
  run(6); const p = guard.object3d.position;
  assert.ok(Math.hypot(p.x - 3, p.z) < 1.2, `caught up round the wall (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
  player.object3d.position.z = 40; run(0.2); assert.equal(r.mode, 'home');
  run(10); assert.ok(Math.hypot(p.x + 3, p.z) < 0.2, 'back home');
});
