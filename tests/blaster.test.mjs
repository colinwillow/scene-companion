import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Blaster, Projectile, Solid } from '../behaviors/index.js';

function worldWith() {
  const ents = new Map(), said = [];
  const world = { input: {}, solids: [], entities: ents, emitted: said, emit: (...a) => said.push(a), getEntity: id => ents.get(id),
    raycast(o, d, opts) { return null; }, destroy(id) { ents.delete(id); said.push(['destroyed', id]); } };
  world.spawn = async (prefab, { position }) => {
    const o = new THREE.Group(); o.position.set(...position);
    const e = { id: `bolt${ents.size}`, object3d: o, behaviors: [] }; e.behaviors.push(new Projectile(e, {}, world)); e.behaviors[0].start();
    ents.set(e.id, e); return e;
  };
  return world;
}

test('Blaster: held fire charges, release fires a bolt along the camera aim, sized by the charge; a tap is a fumble', async () => {
  const world = worldWith(), me = { id: 'player', object3d: new THREE.Group() }; world.entities.set('player', me);
  const b = new Blaster(me, {}, world); b.start();
  world.input.fire = true; for (let i = 0; i < 3; i++) b.update(1 / 60);
  world.input.fire = false; b.update(1 / 60);
  assert.ok(world.emitted.some(a => a[0] === 'fumble'), 'a flick of the trigger is not a shot');
  world.input.fire = true; world.input.aim = [1, 0]; for (let i = 0; i < 90; i++) b.update(1 / 60);
  world.input.fire = false; b.update(1 / 60);
  await new Promise(r => setTimeout(r, 0));
  const bolt = [...world.entities.values()].find(e => e.id.startsWith('bolt')), pr = bolt.behaviors[0];
  assert.ok(Math.abs(bolt.object3d.position.y - 1.1) < 1e-9, 'from chest height (no gun named)');
  assert.ok(pr.shot.vel[0] > 43 && Math.abs(pr.shot.vel[2]) < 1e-9, 'along the aim at 44 m/s');
  assert.ok(Math.abs(bolt.object3d.scale.x - 1.9) < 1e-9 && Math.abs(pr.shot.blast - 2.2) < 1e-9, 'full charge: the big ball');
});

test('Projectile: flies until it meets a Solid, then a blast there and it is gone; a body in the way is struck', () => {
  const world = worldWith();
  world.raycast = (o, d, { maxDist }) => { const t = (5 - o[0]) / d[0]; return t >= 0 && t <= maxDist ? { point: [5, o[1], o[2]], distance: t } : null; };   // a wall at x = 5
  const o = new THREE.Group(); o.position.set(0, 1, 0); const e = { id: 'b', object3d: o }; world.entities.set('b', e);
  const pr = new Projectile(e, {}, world); pr.start(); pr.launch({ vel: [44, 0, 0], size: 0.5, blast: 1, damage: 2, owner: 'player' });
  for (let i = 0; i < 30 && !pr.gone; i++) pr.update(1 / 60);
  const bl = world.emitted.find(a => a[0] === 'blast');
  assert.deepEqual(bl.slice(1), [5, 1, 0, 1, 2]); assert.ok(!world.entities.has('b'));
  const w2 = worldWith(), dummy = { id: 'dummy', behaviors: [{ constructor: { hittable: true } }], object3d: new THREE.Group() }; dummy.object3d.position.set(3, 0, 0);
  w2.entities.set('dummy', dummy); const o2 = new THREE.Group(); o2.position.set(0, 1, 0); const e2 = { id: 'b2', object3d: o2 }; w2.entities.set('b2', e2);
  const p2 = new Projectile(e2, {}, w2); p2.start(); p2.launch({ vel: [44, 0, 0], size: 0.5, blast: 1, damage: 2, owner: 'player' });
  for (let i = 0; i < 30 && !p2.gone; i++) p2.update(1 / 60);
  assert.ok(w2.emitted.some(a => a[0] === 'struck' && a[2] === 'dummy'));
});

test('Blaster auto: held = a small bolt every `rate`; while aiming (and `hold` after) he faces the aim', async () => {
  const world = worldWith(), me = { id: 'player', object3d: new THREE.Group() }; world.entities.set('player', me);
  const b = new Blaster(me, { auto: true, rate: 0.1 }, world); b.start();
  world.input.fire = true; world.input.aim = [1, 0];
  for (let i = 0; i < 60; i++) b.update(1 / 60);
  await new Promise(r => setTimeout(r, 0));
  const bolts = [...world.entities.keys()].filter(k => k.startsWith('bolt')).length;
  assert.ok(bolts >= 9 && bolts <= 11, `about 10 shots in a second (${bolts})`);
  assert.ok(Math.abs(me.aimYaw - Math.PI / 2) < 1e-9, 'facing +x, the aim');
  world.input.fire = false; for (let i = 0; i < 30; i++) b.update(1 / 60);
  assert.equal(me.aimYaw, null, 'let go: back to facing where he runs');
});

test('Disguise: a DNA bolt of mine on a body wears its asset; X (revert) or `duration` puts him back; DNA bolts do not hurt', async () => {
  const calls = [], handlers = {}, me = { id: 'player', object3d: new THREE.Group() };
  const world = { input: {}, on: (n, f) => { handlers[n] = f; }, emit() {}, getEntity: id => id === 'sk' ? { id: 'sk', prefab: 'skeleton', data: {} } : me,
    wear: async (id, asset) => { calls.push([id, asset]); me.worn = asset ? {} : null; return true; } };
  const { Disguise } = await import('../behaviors/index.js');
  const d = new Disguise(me, { duration: 1 }, world); d.start();
  handlers.dna('someone-else', 'sk'); await new Promise(r => setTimeout(r, 0)); assert.equal(calls.length, 0);
  handlers.dna('player', 'sk'); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(calls, [['player', 'skeleton']]);
  for (let i = 0; i < 70; i++) d.update(1 / 60);
  assert.deepEqual(calls.at(-1), ['player', null], 'back after `duration`');
  const w2 = worldWith(), o = new THREE.Group(); o.position.set(0, 1, 0); const e = { id: 'b', object3d: o }; w2.entities.set('b', e);
  const dummy = { id: 'dummy', behaviors: [{ constructor: { hittable: true } }], object3d: new THREE.Group() }; dummy.object3d.position.set(2, 0, 0); w2.entities.set('dummy', dummy);
  const p = new Projectile(e, {}, w2); p.start(); p.launch({ vel: [44, 0, 0], size: 0.5, blast: 1, damage: 2, owner: 'player', dna: true });
  for (let i = 0; i < 30 && !p.gone; i++) p.update(1 / 60);
  assert.ok(w2.emitted.some(a => a[0] === 'dna' && a[2] === 'dummy')); assert.ok(!w2.emitted.some(a => a[0] === 'struck' || a[0] === 'blast'));
});
