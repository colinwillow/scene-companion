import test from 'node:test';
import assert from 'node:assert/strict';
import { Solid, Chase } from '../behaviors/index.js';
import { fakeEntity, fakeWorld, attach } from './fakes.js';

const near = (a, b, e = 1e-3) => a.every((v, i) => Math.abs(v - b[i]) < e);
function world(defs) {
  const w = fakeWorld();
  for (const [id, pos, params, rotY] of defs) {
    const e = fakeEntity(id, pos); if (rotY) e.object3d.rotation.y = rotY;
    attach(Solid, e, params, w);
  }
  return w;
}

test('raycast hits the nearest box face with its normal', () => {
  const w = world([['wall', [5, 0, 0], { size: [1, 2, 4] }], ['far', [9, 0, 0], { size: [1, 2, 4] }]]);
  const h = w.raycast([0, 1, 0], [1, 0, 0]);
  assert.equal(h.id, 'wall');
  assert.ok(Math.abs(h.distance - 4.5) < 1e-6);
  assert.ok(near(h.normal, [-1, 0, 0]) && near(h.point, [4.5, 1, 0]));
  assert.equal(w.raycast([0, 1, 0], [1, 0, 0], { maxDist: 3 }), null, 'maxDist');
  assert.equal(w.raycast([0, 1, 0], [-1, 0, 0]), null, 'behind');
});

test('layers and ignore filter what a query sees', () => {
  const w = world([['glass', [3, 0, 0], { size: [1, 2, 4], layer: 'glass' }], ['wall', [6, 0, 0], { size: [1, 2, 4] }]]);
  assert.equal(w.raycast([0, 1, 0], [1, 0, 0]).id, 'glass');
  assert.equal(w.raycast([0, 1, 0], [1, 0, 0], { layers: ['default'] }).id, 'wall');
  assert.equal(w.raycast([0, 1, 0], [1, 0, 0], { ignore: 'glass' }).id, 'wall');
});

test('sphere, capsule, turned box and ramp shapes', () => {
  const w = world([
    ['ball', [0, 0, 5], { size: [2, 2, 2], shape: 'sphere' }],                     // centre (0,1,5), r 1
    ['pill', [5, 0, 0], { size: [1, 3, 1], shape: 'capsule' }],                    // r .5
    ['door', [0, 0, -5], { size: [4, 2, 0.2], rotated: true }, Math.PI / 2],       // turned 90°: thin along x now
    ['ramp', [-5, 0, 0], { size: [4, 2, 2], slope: true }],                        // rises along +x from x=-7 to -3
  ]);
  const s = w.raycast([0, 1, 0], [0, 0, 1]); assert.equal(s.id, 'ball'); assert.ok(Math.abs(s.distance - 4) < 1e-6);
  const c = w.raycast([0, 1.5, 0], [1, 0, 0]); assert.equal(c.id, 'pill'); assert.ok(Math.abs(c.distance - 4.5) < 1e-6);
  const d = w.raycast([0, 1, 0], [0, 0, -1]); assert.equal(d.id, 'door'); assert.ok(Math.abs(d.distance - 3) < 1e-6, `door at ${d.distance}`);
  assert.equal(w.raycast([1.5, 1, 0], [0, 0, -1]), null, 'the turned door is only 0.2 wide in x');
  const r = w.raycast([-6.5, 5, 0], [0, -1, 0]);                                   // straight down near the low end
  assert.equal(r.id, 'ramp'); assert.ok(Math.abs(r.point[1] - 0.25) < 0.01, `ramp top ${r.point[1]}`);
  assert.ok(r.normal[1] > 0.8 && r.normal[0] < 0, 'slope normal leans back');
});

test('sweep is a fat ray; overlap finds everything a sphere touches', () => {
  const w = world([['wall', [5, 0, 0], { size: [1, 2, 4] }]]);
  assert.equal(w.raycast([0, 1, 2.3], [1, 0, 0]), null, 'a thin ray passes the corner');
  const h = w.sweep([0, 1, 2.3], [1, 0, 0], 0.5);
  assert.equal(h?.id, 'wall', 'a 0.5 m ball clips it');
  assert.ok(Math.abs(h.distance - 4) < 1e-6);
  assert.deepEqual(w.overlap([4, 1, 0], 0.6).map(o => o.id), ['wall']);
  assert.deepEqual(w.overlap([3, 1, 0], 0.6), []);
});

test('Chase with sight: a wall in between stops the chase', () => {
  const w = world([['wall', [3, 0, 0], { size: [0.5, 3, 6] }]]);
  const player = fakeEntity('player', [6, 0, 0]), guard = fakeEntity('guard', [0, 0, 0]);
  const m = new Map([['player', player], ['guard', guard]]); w.getEntity = id => m.get(id);
  const blind = attach(Chase, guard, { radius: 12, speed: 2, sight: true, returnHome: false }, w);
  blind.update(0.5);
  assert.equal(guard.object3d.position.x, 0, 'cannot see through the wall');
  player.object3d.position.z = 8;                     // step out: the sight line now passes the wall's end (z 4 > 3)
  blind.update(0.5);
  assert.ok(guard.object3d.position.x > 0 || guard.object3d.position.z > 0, 'sees and chases');
});

test('solidOutline: a box by its bounds, a turned box turned', async () => {
  const { solidOutline } = await import('../runtime/collide.js');
  const mk = (size, pos, yaw, rotated) => ({ params: { size, anchor: 'center', shape: 'box', rotated }, entity: { object3d: { position: { x: pos[0], y: pos[1], z: pos[2] }, rotation: { x: 0, y: yaw, z: 0 } } },
    box() { const [sx, sy, sz] = size; return { minX: pos[0] - sx / 2, maxX: pos[0] + sx / 2, minY: pos[1] - sy / 2, maxY: pos[1] + sy / 2, minZ: pos[2] - sz / 2, maxZ: pos[2] + sz / 2 }; } });
  const a = solidOutline(mk([2, 1, 4], [1, 0.5, 2], 0, false));
  assert.deepEqual(a, { c: [1, 0.5, 2], half: [1, 0.5, 2], yaw: 0, kind: 'box' });
  const b = solidOutline(mk([2, 1, 4], [1, 0.5, 2], 0.5, true));
  assert.equal(b.kind, 'obb'); assert.equal(b.yaw, 0.5); assert.deepEqual(b.half, [1, 0.5, 2]);
});
