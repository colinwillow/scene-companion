import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Behavior } from '../runtime/Behavior.js';
import { getBehavior, behaviorNames } from '../runtime/registry.js';
import { Spin, Bob, Patrol, Pickup, Health, MoveTo, Animator, PlayerController } from '../behaviors/index.js';
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
  assert.deepEqual(w.emitted, [['pickup', 'coin'], ['score', 3]], 'scored exactly once');
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

test('Animator plays jump while airborne on a PlayerController, then fall clip if set', async () => {
  const { PlayerController } = await import('../behaviors/index.js');
  const e = fakeEntity();
  const played = [];
  e.anim = { play: (n, o) => played.push(n) };
  const pc = Object.assign(Object.create(PlayerController.prototype), { grounded: true, vy: 0 });
  e.behaviors.push(pc);
  const a = attach(Animator, e, { fallClip: 'Fall', airDelay: 0.1 }, fakeWorld());
  a.update(0.05);                                   // grounded, still
  pc.grounded = false; pc.vy = 5; a.update(0.05);   // take-off
  pc.vy = -1; a.update(0.05);                       // falling, airborne 0.1 s
  pc.grounded = true; pc.vy = 0; a.update(0.05);    // landed
  pc.grounded = false; a.update(0.05);              // tiny drop: under airDelay → stays on ground clip
  assert.deepEqual(played, ['Idle', 'Jump', 'Fall', 'Idle', 'Idle']);
});

test('Animator plays a land clip on touch-down, a hard one for big falls, then resumes', async () => {
  const { PlayerController } = await import('../behaviors/index.js');
  const e = fakeEntity();
  const played = [];
  e.anim = { play: (n, o) => played.push(o?.speed && o.speed !== 1 ? `${n}@${o.speed}` : n) };
  const pc = Object.assign(Object.create(PlayerController.prototype), { grounded: true, vy: 0 });
  e.behaviors.push(pc);
  const a = attach(Animator, e, { jumpClip: 'Flip', jumpRate: 1.3, landClip: 'Soft', landTime: 0.2, hardLandClip: 'Hard', hardLandSpeed: 10, hardLandTime: 0.4 }, fakeWorld());
  pc.grounded = false; pc.vy = 5; a.update(0.05);   // take-off
  pc.vy = -8; a.update(0.05);                       // falling at 8 m/s
  pc.grounded = true; pc.vy = 0; a.update(0.05);    // soft land
  a.update(0.1);                                    // still holding
  a.update(0.1);                                    // 0.25 s > landTime → idle
  pc.grounded = false; pc.vy = -15; a.update(0.2);  // big fall
  pc.grounded = true; pc.vy = 0; a.update(0.05);    // hard land
  e.object3d.position.x += 0.3; a.update(0.1);      // moving doesn't cut a hard land
  a.update(0.3);
  assert.deepEqual(played, ['Flip@1.3', 'Flip@1.3', 'Soft', 'Idle', 'Flip@1.3', 'Hard', 'Idle']);
});

test('Animator: moving cuts a soft land short; no land clip = straight to locomotion', async () => {
  const { PlayerController } = await import('../behaviors/index.js');
  const e = fakeEntity(), played = [];
  e.anim = { play: n => played.push(n) };
  const pc = Object.assign(Object.create(PlayerController.prototype), { grounded: false, vy: -5 });
  e.behaviors.push(pc);
  const a = attach(Animator, e, { landClip: 'Soft', landTime: 1, airDelay: 0 }, fakeWorld());
  a.update(0.05);                                              // airborne (jump pose)
  pc.grounded = true; e.object3d.position.x += 0.3; a.update(0.1); // land while running at 3 m/s
  e.object3d.position.x += 0.3; a.update(0.1);
  assert.deepEqual(played, ['Jump', 'Soft', 'Walking']);
  const e2 = fakeEntity(), p2 = [];
  e2.anim = { play: n => p2.push(n) };
  const pc2 = Object.assign(Object.create(PlayerController.prototype), { grounded: false, vy: -5 });
  e2.behaviors.push(pc2);
  const b = attach(Animator, e2, { airDelay: 0 }, fakeWorld());
  b.update(0.05); pc2.grounded = true; b.update(0.05);
  assert.deepEqual(p2, ['Jump', 'Idle']);
});

test('Animator slows a PlayerController during a hard landing only, then restores it', async () => {
  const { PlayerController } = await import('../behaviors/index.js');
  const e = fakeEntity();
  e.anim = { play() {} };
  const pc = Object.assign(Object.create(PlayerController.prototype), { grounded: false, vy: -20 });
  e.behaviors.push(pc);
  const a = attach(Animator, e, { landClip: 'Soft', hardLandClip: 'Hard', hardLandSpeed: 10, hardLandTime: 0.3, hardLandMove: 0.25, airDelay: 0 }, fakeWorld());
  a.update(0.05);
  pc.grounded = true; pc.vy = 0; a.update(0.05);
  assert.equal(e.moveScale, 0.25);
  a.update(0.2); assert.equal(e.moveScale, 0.25);
  a.update(0.1); assert.equal(e.moveScale, 1);
  pc.grounded = false; pc.vy = -5; a.update(0.05); pc.grounded = true; pc.vy = 0; a.update(0.05);   // soft land
  assert.equal(e.moveScale, 1);
  pc.grounded = false; pc.vy = -20; a.update(0.05); pc.grounded = true; pc.vy = 0; a.update(0.05);  // hard again…
  pc.grounded = false; pc.vy = 7; a.update(0.05);                                                   // …jump cancels it
  assert.equal(e.moveScale, 1);
});

test('Animator jumpHold lets a flip finish before the fall clip cuts in; a bounce restarts it', async () => {
  const { PlayerController } = await import('../behaviors/index.js');
  const e = fakeEntity(), played = [];
  e.anim = { play: n => played.push(n) };
  const pc = Object.assign(Object.create(PlayerController.prototype), { grounded: true, vy: 0 });
  e.behaviors.push(pc);
  const a = attach(Animator, e, { jumpClip: 'Flip', fallClip: 'Fall', jumpHold: 0.5 }, fakeWorld());
  pc.grounded = false; pc.vy = 5; a.update(0.2);   // take-off
  pc.vy = -1; a.update(0.2);                       // apex passed at 0.2 s: flip keeps playing
  a.update(0.2);                                   // 0.4 s
  a.update(0.2);                                   // 0.6 s ≥ hold → fall
  pc.vy = 4; a.update(0.1);                        // stomp bounce → flip again
  pc.vy = -1; a.update(0.1);
  assert.deepEqual(played, ['Flip', 'Flip', 'Flip', 'Fall', 'Flip', 'Flip']);
});

test('Pickup emits pickup before score', () => {
  const coin = fakeEntity('coin'), player = fakeEntity('player');
  const w = fakeWorld([coin, player]);
  attach(Pickup, coin, {}, w).update();
  assert.deepEqual(w.emitted.map(x => x[0]), ['pickup', 'score']);
});

test('Squash wobbles scale around the authored scale on events and settles back exactly', async () => {
  const { Squash } = await import('../behaviors/index.js');
  const e = fakeEntity(); e.object3d.scale = { x: 2, y: 2, z: 2 };
  const w = fakeWorld([e]);
  const s = attach(Squash, e, { amount: 0.2, duration: 0.2 }, w);
  w.emit('land');
  s.update(0.01);
  assert.ok(e.object3d.scale.y < 2 && e.object3d.scale.x > 2, 'squashed');
  run(s, 30);
  assert.deepEqual([e.object3d.scale.x, e.object3d.scale.y, e.object3d.scale.z], [2, 2, 2]);
  w.emit('jump'); s.update(0.01);
  assert.ok(e.object3d.scale.y > 2, 'stretched');
});

test('Footsteps emits a step per stride while walking on the ground only', async () => {
  const { Footsteps, PlayerController } = await import('../behaviors/index.js');
  const e = fakeEntity('player');
  const w = fakeWorld([e]); w.input = { move: [1, 0] };
  const pc = Object.assign(Object.create(PlayerController.prototype), { grounded: true });
  e.behaviors.push(pc);
  const f = attach(Footsteps, e, { stride: 0.5, runStride: 0.5 }, w);
  for (let i = 0; i < 20; i++) { e.object3d.position.x += 0.1; f.update(0.1); }   // 2 m
  assert.equal(w.emitted.filter(x => x[0] === 'step').length, 4);
  pc.grounded = false;
  for (let i = 0; i < 20; i++) { e.object3d.position.x += 0.1; f.update(0.1); }
  assert.equal(w.emitted.filter(x => x[0] === 'step').length, 4, 'no steps in the air');
});

test('Animator plays doubleJumpClip (restarted) on an air jump, then falls after its hold', () => {
  const e = fakeEntity('p');
  const played = [];
  e.anim = { play: (n, o) => played.push(o?.restart ? n + '!' : n) };
  const pc = { grounded: true, vy: 0, jumpCount: 0, airJumpCount: 0 };
  Object.setPrototypeOf(pc, PlayerController.prototype);
  e.behaviors.push(pc);
  const a = attach(Animator, e, { jumpClip: 'Up', doubleJumpClip: 'Flip', doubleJumpHold: 0.2, fallClip: 'Fall' }, fakeWorld());
  a.update(1 / 60);                                                    // idle
  Object.assign(pc, { grounded: false, vy: 5, jumpCount: 1 }); a.update(1 / 60);   // jump
  Object.assign(pc, { vy: -1 }); a.update(1 / 60);                    // falling → Fall
  Object.assign(pc, { vy: 6, jumpCount: 2, airJumpCount: 1 }); a.update(1 / 60);  // air jump → Flip (restart)
  Object.assign(pc, { vy: -1 }); a.update(0.1);                        // still inside the hold → Flip
  a.update(0.15);                                                      // past the hold → Fall
  Object.assign(pc, { grounded: true, vy: 0, airJumpCount: 0 }); a.update(1 / 60);
  assert.deepEqual(played, ['Idle', 'Up', 'Fall', 'Flip!', 'Flip', 'Fall', 'Idle']);
});
