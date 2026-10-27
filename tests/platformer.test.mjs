import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Solid, PlayerController, Chase, Stompable, Health } from '../behaviors/index.js';
import { fakeEntity, fakeWorld, attach, run } from './fakes.js';

function setup({ solids = [], params = {} } = {}) {
  const player = fakeEntity('player', [0, 0, 0]);
  const ents = [player];
  const w = fakeWorld(ents);
  w.input = { move: [0, 0], jump: false };
  for (const [id, pos, size] of solids) { const e = fakeEntity(id, pos); ents.push(e); attach(Solid, e, { size }, w); }
  const health = new Health(player, { max: 3 }, w); player.behaviors.push(health); health.start();
  const pc = attach(PlayerController, player, params, w);
  return { w, player, pc, health, p: player.object3d.position };
}

test('Solid box honours anchor', () => {
  const w = fakeWorld();
  const a = attach(Solid, fakeEntity('a', [0, 1, 0]), { size: [2, 1, 2] }, w);
  const b = attach(Solid, fakeEntity('b', [0, 1, 0]), { size: [2, 1, 2], anchor: 'center' }, w);
  assert.deepEqual([a.box().minY, a.box().maxY], [1, 2]);
  assert.deepEqual([b.box().minY, b.box().maxY], [0.5, 1.5]);
  assert.equal(w.solids.length, 2);
  b.destroy();
  assert.equal(w.solids.length, 1);
});

test('player walks with input and stays on the ground', () => {
  const { w, p } = setup();
  w.input.move = [1, 0];
  run(w.getEntity('player').behaviors[1], 60);
  assert.ok(Math.abs(p.x - 5) < 1e-6, `x=${p.x}`);
  assert.equal(p.y, 0);
});

test('entity.moveScale scales walking speed (Animator sets it during hard landings)', () => {
  const { w, player, pc, p } = setup();
  w.input.move = [1, 0]; player.moveScale = 0.2;
  run(pc, 60);
  assert.ok(Math.abs(p.x - 1) < 1e-6, `x=${p.x}`);
});

test('jump goes up and lands back; jump input is consumed', () => {
  const { w, pc, p } = setup();
  w.input.jump = true;
  pc.update(1 / 60);
  assert.equal(w.input.jump, false);
  assert.ok(pc.vy > 0);
  let maxY = 0;
  for (let i = 0; i < 120; i++) { pc.update(1 / 60); maxY = Math.max(maxY, p.y); }
  assert.ok(maxY > 1 && maxY < 1.5, `apex ${maxY}`);       // v²/2g = 7.5²/44 ≈ 1.28
  assert.equal(p.y, 0);
  assert.equal(pc.grounded, true);
});

test('lands on top of a solid and is blocked by its side', () => {
  const { w, pc, p } = setup({ solids: [['box', [2, 0, 0], [2, 1, 2]]] });   // box x 1..3, y 0..1
  w.input.move = [1, 0];
  run(pc, 60);
  assert.ok(p.x <= 1 - 0.35 + 1e-6, `stopped at side, x=${p.x}`);
  // jump onto it
  w.input.jump = true;
  let landedOnTop = false;
  for (let i = 0; i < 90 && !landedOnTop; i++) { pc.update(1 / 60); landedOnTop = pc.grounded && p.y === 1; }
  assert.ok(landedOnTop, `never stood on the box (x=${p.x}, y=${p.y})`);
  assert.ok(p.x > 1);
});

test('falling below killY respawns and costs health', () => {
  const { w, pc, p, health } = setup({ params: { groundY: -100, killY: -5 } });
  const events = [];
  w.on('respawn', () => events.push('respawn'));
  run(pc, 50);                         // falls 5 m in ~0.67 s
  assert.deepEqual(events, ['respawn']);
  assert.equal(health.current, 2);
});

test('hurt is ignored while invulnerable; game over at zero', () => {
  const { w, pc, health } = setup();
  const over = [];
  w.on('gameover', () => over.push(1));
  w.emit('hurt', 1); w.emit('hurt', 1);
  assert.equal(health.current, 2);
  run(pc, 80);                         // 1.33 s > 1.2 s invulnerability
  w.emit('hurt', 2);
  assert.equal(health.current, 0);
  assert.deepEqual(over, [1]);
});

test('Chase follows inside radius and returns home outside', () => {
  const target = fakeEntity('player', [3, 0, 0]);
  const e = fakeEntity('enemy', [0, 0, 0]);
  const w = fakeWorld([target, e]);
  const c = attach(Chase, e, { radius: 5, speed: 1 }, w);
  run(c, 60);
  assert.ok(Math.abs(e.object3d.position.x - 1) < 1e-6);
  target.object3d.position.x = 50;
  run(c, 120);
  assert.ok(Math.abs(e.object3d.position.x) < 0.06, `home, x=${e.object3d.position.x}`);
});

test('Stompable: side touch hurts, landing on top defeats', () => {
  const { w, pc, p, health } = setup();
  const enemy = fakeEntity('enemy', [0.5, 0, 0]);
  const st = attach(Stompable, enemy, { height: 1, points: 2 }, w);
  const scores = []; w.on('score', s => scores.push(s));
  st.update(0.016);
  assert.equal(health.current, 2, 'side touch hurts');
  pc.hurtTimer = 0;
  p.y = 0.8; pc.vy = -3;               // coming down on its head
  st.update(0.016);
  assert.equal(enemy.object3d.visible, false);
  assert.deepEqual(scores, [2]);
  assert.ok(pc.vy > 0, 'bounced');
  st.update(0.016);
  assert.deepEqual(scores, [2], 'only once');
});

test('Stompable: defeatClip plays the fall, then hides; Chase stands down', () => {
  const { w, pc, p } = setup();
  const enemy = fakeEntity('enemy', [0.5, 0, 0]);
  const played = [];
  enemy.anim = { clips: ['idle', 'fall'], play: (n, o) => played.push([n, o?.once]) };
  const chase = attach(Chase, enemy, { radius: 10, speed: 2 }, w);
  const st = attach(Stompable, enemy, { height: 1, defeatClip: 'fall', hideAfter: 0.5 }, w);
  p.y = 0.8; pc.vy = -3;
  st.update(0.016);
  assert.deepEqual(played, [['fall', true]]);
  assert.equal(enemy.object3d.visible, true, 'still showing the fall');
  const x = enemy.object3d.position.x; chase.update(0.1);
  assert.equal(enemy.object3d.position.x, x, 'defeated enemy stops chasing');
  run(st, 40);
  assert.equal(enemy.object3d.visible, false, 'hidden after hideAfter');
});

test('player rides a moving platform', () => {
  const { pc, p, w } = setup({ solids: [['plat', [0, 1, 0], [2, 0.5, 2]]] });
  p.y = 1.5; pc.update(1 / 60);                     // land on top
  assert.equal(pc.grounded, true);
  const plat = w.solids[0].entity.object3d.position;
  for (let i = 0; i < 30; i++) { plat.x += 0.02; plat.y += 0.01; pc.update(1 / 60); }
  assert.ok(Math.abs(p.x - 0.6) < 0.03, `x=${p.x}`);   // carried sideways (≤ one frame behind)
  assert.ok(Math.abs(p.y - (plat.y + 0.5)) < 0.02, `y=${p.y}`);
  assert.equal(pc.grounded, true);
});

test('landing after a real fall emits land', () => {
  const { pc, p, w } = setup();
  p.y = 2; run(pc, 60);
  assert.ok(w.emitted.some(([n]) => n === 'land'));
});

test('moving the player or a chaser live updates spawn / home', () => {
  const { pc, p } = setup();
  p.x = 3; p.y = 1; pc.onMoved();
  assert.deepEqual(pc.spawn, [3, 1, 0]);
  const w = fakeWorld([fakeEntity('player', [0, 0, 0])]);
  const e = fakeEntity('c', [1, 0, 1]); const c = attach(Chase, e, {}, w);
  e.object3d.position.x = 9; c.onMoved();
  assert.deepEqual(c.home, [9, 1]);
});

test('airJumps: one double jump per airtime, speed set not added, given back on landing', () => {
  const { w, pc, p } = setup({ params: { airJumps: 1, airJumpSpeed: 6 } });
  const jumps = []; w.on?.('airjump', n => jumps.push(n));
  w.input.jump = true; run(pc, 30);                      // first jump, ~0.5 s: past the apex, falling
  assert.ok(pc.vy < 0 && !pc.grounded);
  w.input.jump = true; run(pc, 1);
  assert.ok(Math.abs(pc.vy - (6 - 22 / 60)) < 1e-6, `vy=${pc.vy}`);  // set to 6 then one step of gravity
  assert.equal(pc.airJumpCount, 1); assert.equal(pc.jumpCount, 2);
  const vy = pc.vy; w.input.jump = true; run(pc, 1);   // no third jump
  assert.ok(pc.vy < vy);
  run(pc, 120);
  assert.ok(pc.grounded && p.y === 0); assert.equal(pc.airJumpCount, 0);
  w.input.jump = true; run(pc, 20); w.input.jump = true; run(pc, 1);
  assert.equal(pc.airJumpCount, 1, 'double jump works again after landing');
});

test('airJumps default 0: no jumping in mid-air', () => {
  const { w, pc } = setup();
  w.input.jump = true; run(pc, 30);
  w.input.jump = true; run(pc, 1);
  assert.ok(pc.vy < 0); assert.equal(pc.airJumpCount, 0);
});

test('ramps: walk up a slope without jumping, stay on it going down, turned ramps follow rotation', async () => {
  const { topAt } = await import('../behaviors/index.js');
  const { w, pc, p } = setup();
  const ramp = fakeEntity('ramp', [2, 0, 0]); w.entities?.set?.('ramp', ramp);
  attach(Solid, ramp, { size: [2, 1, 2], slope: true }, w);              // rises from x=1 (0 m) to x=3 (1 m)
  const b = w.solids[0].box();
  assert.equal(topAt(b, 1, 0), 0); assert.equal(topAt(b, 2, 0), 0.5); assert.equal(topAt(b, 3, 0), 1);
  w.input.move = [1, 0];
  run(pc, 30);                                                           // 2.5 m in: x = 2.5 → on the ramp
  assert.ok(pc.grounded, 'walked up, still grounded');
  assert.ok(Math.abs(p.y - topAt(b, p.x, p.z)) < 0.1, `y=${p.y} at x=${p.x}`);
  w.input.move = [-1, 0]; let air = 0;
  for (let i = 0; i < 18; i++) { run(pc, 1); if (!pc.grounded) air++; }   // back down
  assert.equal(air, 0, 'never leaves the slope going down');
  ramp.object3d.rotation.y = Math.PI / 2;                                // now rises toward -z, footprint swapped
  assert.equal(w.solids[0].box().slope, '-z');
});

// ---- walking against turned boxes, spheres and capsules (runtime/collide.js walkShape)
function shaped(params, pos = [3, 0, 0], yaw = 0, pcParams = {}) {
  const r = setup({ params: pcParams });
  const e = fakeEntity('thing', pos); e.object3d.rotation.y = yaw;
  attach(Solid, e, params, r.w);
  return r;
}

test('a turned box blocks along its turned face, not its old axis-aligned one', () => {
  // 1 m thick, 4 m long along z; turned 90° it runs along x (x 1..5) — walking +x meets its end at x=1
  const { w, pc, p } = shaped({ size: [1, 2, 4], rotated: true }, [3, 0, 0], Math.PI / 2);
  w.input.move = [1, 0]; run(pc, 120);
  assert.ok(Math.abs(p.x - (1 - 0.35)) < 1e-6, `stopped by the turned end, x=${p.x}`);
  const { w: w2, pc: pc2, p: p2 } = shaped({ size: [1, 2, 4] }, [3, 0, 0], Math.PI / 2);   // not rotated: the upright box (x 2.5..3.5)
  w2.input.move = [1, 0]; run(pc2, 120);
  assert.ok(Math.abs(p2.x - (2.5 - 0.35)) < 1e-6, `upright box, x=${p2.x}`);
  const d = shaped({ size: [1, 2, 4], rotated: true }, [3, 0, 0], Math.PI / 4);   // 45°: slides along the diagonal face
  d.w.input.move = [1, 0]; run(d.pc, 30);
  assert.ok(Math.abs(d.p.z) > 0.05 && d.p.x < 2.6, `deflected along the face, z=${d.p.z.toFixed(3)}`);
});

test('a turned box can be stood on', () => {
  const { pc, p } = shaped({ size: [2, 1, 2], rotated: true }, [0, 0, 0], 0.6);
  p.y = 1.5; run(pc, 60);
  assert.ok(Math.abs(p.y - 1) < 1e-6 && pc.grounded, `y=${p.y}`);
});

test('a sphere: blocks from the side, can be stood on its top', () => {
  const { w, pc, p } = shaped({ size: [2, 2, 2], shape: 'sphere', anchor: 'center' }, [3, 1, 0]);   // R 1, centre y 1
  w.input.move = [1, 0]; run(pc, 120);
  assert.ok(p.x <= 2 - 0.35 + 1e-3 && p.x > 1.5, `stopped at the sphere, x=${p.x.toFixed(3)}`);
  const s = shaped({ size: [2, 2, 2], shape: 'sphere', anchor: 'center' }, [0, 1, 0]);
  s.p.y = 2.5; run(s.pc, 60);
  assert.ok(Math.abs(s.p.y - 2) < 1e-6 && s.pc.grounded, `on top, y=${s.p.y}`);
});

test('a capsule (a pillar) blocks with a round side', () => {
  const { w, pc, p } = shaped({ size: [1, 4, 1], shape: 'capsule' }, [3, 0, 0.3]);   // R 0.5, a little off the walking line
  w.input.move = [1, 0];
  let closest = Infinity;
  for (let i = 0; i < 120; i++) { pc.update(1 / 60); closest = Math.min(closest, Math.hypot(p.x - 3, p.z - 0.3)); }
  assert.ok(closest > 0.85 - 1e-3 && closest < 0.9, `kept at its radius + mine, closest ${closest.toFixed(3)}`);
  assert.ok(p.z < -0.1 && p.x > 3, `slid round it, ended at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`);
});

test('plane: side pins z, ignores the stick\'s up/down, and a wall only pushes along x', () => {
  // a wall thin in z (0.4 m) right in his path: free movement would slip out sideways in z; on the plane he stops in x
  const { w, pc, p } = setup({ solids: [['wall', [2, 0, 0.1], [1, 3, 0.4]]], params: { plane: 'side' } });
  w.input.move = [0.7, 0.7];
  run(pc, 120);
  assert.equal(p.z, 0);
  assert.ok(Math.abs(p.x - (1.5 - 0.35)) < 1e-6, `x=${p.x}`);   // wall face (2 - 0.5) minus his radius
  const free = setup({ params: {} }); free.w.input.move = [0, 1]; run(free.pc, 30);
  assert.ok(free.p.z > 1, 'free plane still moves in z');
});
