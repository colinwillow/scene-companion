import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Behavior } from '../runtime/Behavior.js';
import { getBehavior, behaviorNames } from '../runtime/registry.js';
import { Spin, Bob, Patrol, Pickup, Health, MoveTo, Animator } from '../behaviors/index.js';
import { fakeEntity, fakeWorld, attach, run } from './fakes.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('every registered behavior has a schema with sane defaults', () => {
  const names = behaviorNames();
  for (const n of ['Spin', 'Bob', 'Patrol', 'Pickup', 'Health', 'MoveTo', 'Animator']) assert.ok(names.includes(n), n);
  for (const n of names) {
    const Cls = getBehavior(n);
    assert.ok(Cls.prototype instanceof Behavior, `${n} extends Behavior`);
    for (const [k, def] of Object.entries(Cls.schema)) {
      assert.ok(def.type, `${n}.${k} has a type`);
      assert.ok('default' in def, `${n}.${k} has a default`);
      if (def.type === 'number' && def.min !== undefined) assert.ok(def.default >= def.min && def.default <= def.max, `${n}.${k} default in range`);
    }
  }
});

test('resolveParams fills defaults and deep-copies them', () => {
  const a = new Patrol(fakeEntity(), {}, fakeWorld());
  const b = new Patrol(fakeEntity(), { speed: 4 }, fakeWorld());
  assert.deepEqual(a.params.pointA, [-3, 0, 0]);
  assert.equal(b.params.speed, 4);
  a.params.pointA[0] = 99;
  assert.equal(Patrol.schema.pointA.default[0], -3, 'schema default not mutated');
  assert.ok(!('bogus' in new Spin(fakeEntity(), { bogus: 1 }, fakeWorld()).params), 'unknown params dropped');
});

test('onParamChanged updates a live value', () => {
  const s = new Spin(fakeEntity(), { speed: 1 }, fakeWorld());
  s.onParamChanged('speed', 5);
  assert.equal(s.params.speed, 5);
});

test('Spin turns around Y at speed rad/s', () => {
  const e = fakeEntity();
  run(attach(Spin, e, { speed: 2 }, fakeWorld()), 60);
  near(e.object3d.rotation.y, 2, 1e-9);
});

test('Bob oscillates around the authored height', () => {
  const e = fakeEntity('c', [0, 1.5, 0]);
  const b = attach(Bob, e, { height: 0.5, speed: 1 }, fakeWorld());
  b.update(0, Math.PI / 2);
  near(e.object3d.position.y, 2);
  b.update(0, Math.PI * 1.5);
  near(e.object3d.position.y, 1);
  b.update(0, Math.PI);
  near(e.object3d.position.y, 1.5);
});

test('Patrol walks to B, turns back to A, keeps Y, faces travel', () => {
  const e = fakeEntity('p', [0, 0.8, 0]);
  const p = attach(Patrol, e, { pointA: [0, 0, 0], pointB: [2, 0, 0], speed: 1 }, fakeWorld());
  run(p, 60, 1 / 60);                         // 1 s → x≈1
  near(e.object3d.position.x, 1, 1e-6);
  near(e.object3d.position.y, 0.8);
  near(e.object3d.rotation.y, Math.PI / 2);   // facing +X
  run(p, 100, 1 / 60);                        // reaches B at 2 s, then heads back
  assert.equal(p.toB, false);
  assert.ok(e.object3d.position.x < 2 && e.object3d.position.x > 0);
  near(e.object3d.rotation.y, -Math.PI / 2);
});

test('Patrol faceDirection=false leaves rotation alone', () => {
  const e = fakeEntity();
  run(attach(Patrol, e, { faceDirection: false }, fakeWorld()), 30);
  assert.equal(e.object3d.rotation.y, 0);
});

test('Pickup collects once inside radius and emits score', () => {
  const player = fakeEntity('player', [5, 0, 0]);
  const coin = fakeEntity('coin', [0, 0.5, 0]);
  const w = fakeWorld([player, coin]);
  const b = attach(Pickup, coin, { radius: 1, points: 3 }, w);
  b.update(0.016);
  assert.equal(coin.object3d.visible, true);
  player.object3d.position.x = 0.5;
  b.update(0.016); b.update(0.016);
  assert.equal(coin.object3d.visible, false);
  assert.deepEqual(w.emitted, [['score', 3]], 'scored exactly once');
});

test('Pickup with a missing collector does nothing', () => {
  const coin = fakeEntity('coin');
  const w = fakeWorld([coin]);
  attach(Pickup, coin, { collectorId: 'nobody' }, w).update(0.016);
  assert.equal(coin.object3d.visible, true);
  assert.equal(w.emitted.length, 0);
});

test('Health starts full (runtime state, authored max untouched)', () => {
  const h = attach(Health, fakeEntity(), { max: 50 }, fakeWorld());
  assert.equal(h.current, 50);
  h.current -= 10;
  assert.equal(h.params.max, 50);
});

test('MoveTo heads to the tapped point, snaps on arrival, keeps Y', () => {
  const e = fakeEntity('player', [0, 0, 0]);
  const w = fakeWorld([e]);
  const m = attach(MoveTo, e, { speed: 2 }, w);
  m.update(0.1);
  assert.equal(e.object3d.position.x, 0, 'idle without a target');
  w.emit('moveTo', [3, 9, 4]);                // 5 m away; Y of the tap is ignored
  m.update(0.5);                              // 1 m along the 3-4-5 line
  near(e.object3d.position.x, 0.6);
  near(e.object3d.position.z, 0.8);
  assert.equal(e.object3d.position.y, 0);
  near(e.object3d.rotation.y, Math.atan2(3, 4));
  run(m, 10, 0.5);
  assert.deepEqual([e.object3d.position.x, e.object3d.position.z], [3, 4]);
  assert.equal(m.target, null);
});

test('Animator picks idle / walk / run from actual speed', () => {
  const e = fakeEntity();
  const played = [];
  e.anim = { play: n => played.push(n) };
  const a = attach(Animator, e, { runSpeed: 4 }, fakeWorld());
  a.update(0.1);                              // still
  e.object3d.position.x += 0.2; a.update(0.1); // 2 m/s
  e.object3d.position.z += 0.6; a.update(0.1); // 6 m/s
  assert.deepEqual(played, ['Idle', 'Walking', 'Running']);
  a.update(0);                                // dt 0 is ignored
  assert.equal(played.length, 3);
});

test('Animator without a model animator is a no-op', () => {
  const a = attach(Animator, fakeEntity(), {}, fakeWorld());
  assert.doesNotThrow(() => a.update(0.1));
});
