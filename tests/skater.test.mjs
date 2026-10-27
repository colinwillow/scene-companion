import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../runtime/World.js';
import '../behaviors/index.js';

globalThis.window ??= { devicePixelRatio: 1 };
const fakeRenderer = () => ({ shadowMap: {}, setPixelRatio() {}, toneMappingExposure: 1 });
// a half pipe: two quarter pipes 3.2 m tall (radius 3.2), 85°, facing each other across 6 m of flat
const qp = { variants: { web: { primitive: 'quarterpipe', pivot: 'bottom', size: [4, 3.2, 8], sweep: 85 } } };
const scene = (skater = {}) => ({ settings: { look: 'baked' }, assets: { qp, body: { variants: { web: { primitive: 'box', size: [0.4, 1.7, 0.4] } } } },
  entities: [
    { id: 'west', asset: 'qp', position: [-5, 0, 0], rotation: [0, 180, 0], behaviors: [{ type: 'Surface', params: { maxSlope: 88, cell: 1 } }] },
    { id: 'east', asset: 'qp', position: [5, 0, 0], behaviors: [{ type: 'Surface', params: { maxSlope: 88, cell: 1 } }] },
    { id: 'player', asset: 'body', position: [0, 0, 0], rotation: [0, 90, 0], behaviors: [{ type: 'Skater', params: skater }] }] });
async function run(data, seconds, each) {
  const w = new World(fakeRenderer()); await w.load(data); w.input = { move: [0, 0], jump: false };
  const sk = w.getEntity('player').behaviors[0];
  for (let i = 0; i < seconds * 60; i++) { sk.update(1 / 60); each?.(w, sk, i); }
  return { w, sk, p: w.getEntity('player').object3d.position };
}

test('rolling across the half pipe: up a wall, back down, up the other — gravity along the surface does it', async () => {
  let maxY = 0, maxX = -1e9, minX = 1e9, crossings = 0, last = 0;
  await run(scene(), 12, (w, sk, i) => {
    if (i === 0) sk.v = [10, 0, 0];                    // a push east at 10 m/s (climbs v²/2g = 2.5 m), then hands off
    const p = w.getEntity('player').object3d.position;
    maxY = Math.max(maxY, p.y); maxX = Math.max(maxX, p.x); minX = Math.min(minX, p.x);
    const side = Math.sign(p.x); if (side && side !== last) { crossings++; last = side; }
  });
  assert.ok(maxY > 0.85 * 2.5, `climbed close to v²/2g, peak ${maxY.toFixed(2)} m`);
  assert.ok(maxX < 9 && minX > -9, `stayed in the pipe (x ${minX.toFixed(1)}..${maxX.toFixed(1)})`);
  assert.ok(crossings >= 4, `swung back and forth, ${crossings} crossings`);
});

test('fast enough to leave the vert lip: the air comes straight back down into the pipe', async () => {
  let air = false, landedIn = null, vert = 0;
  const { w } = await run(scene(), 6, (w, sk, i) => {
    if (i === 0) { sk.v = [14, 0, 0]; w.on('vertair', () => vert++); }
    if (!sk.grounded) air = true;
    if (air && sk.grounded && landedIn === null) landedIn = w.getEntity('player').object3d.position.x;
  });
  assert.ok(vert >= 1, 'left a vert face');
  assert.ok(landedIn !== null && landedIn < 7.2, `came back down into the pipe, landed at x=${landedIn?.toFixed(2)}`);
});

test('pushing builds speed on the flat; a tap ollies', async () => {
  const { sk, w } = await run(scene(), 0.01);
  w.input.move = [1, 0];
  for (let i = 0; i < 40; i++) sk.update(1 / 60);
  const sp = Math.hypot(...sk.v); assert.ok(sp > 3, `pushed to ${sp.toFixed(2)} m/s`);
  w.input.move = [0, 0]; w.input.jump = true; sk.update(1 / 60);
  assert.equal(sk.grounded, false); assert.ok(sk.v[1] > 5);
});

test('the move brain: idle still, push clip pushing (hard when fast), roll pose coasting, air clip flying', async () => {
  const { w, sk } = await run(scene(), 0.01);
  const clips = ['idle_normal', 'idle_arms_behind_back', 'blade_casual_forward', 'blade_hard_forward', 'in_air', 'blade_casual_backward', 'idle_backward'];
  const e = w.getEntity('player'); e.anim = { clips, play: n => (e.anim.current = n) };
  sk.update(1 / 60); assert.equal(e.anim.current, 'idle_normal');
  w.input.move = [1, 0]; for (let i = 0; i < 30; i++) sk.update(1 / 60); assert.equal(e.anim.current, 'blade_casual_forward');
  sk.v = [14, 0, 0]; sk.update(1 / 60); assert.equal(e.anim.current, 'blade_hard_forward');
  w.input.move = [0, 0]; sk.update(1 / 60); assert.equal(e.anim.current, 'idle_arms_behind_back');
  w.input.jump = true; sk.update(1 / 60); assert.equal(e.anim.current, 'in_air');
});

test('fakie: rolling backwards plays her backward clips, the model turned a half turn so her nose leads', async () => {
  const { w, sk } = await run(scene(), 0.01);
  const e = w.getEntity('player'); e.anim = { clips: ['idle_normal', 'idle_arms_behind_back', 'blade_casual_forward', 'blade_casual_backward', 'idle_backward', 'in_air'], play: n => (e.anim.current = n) };
  sk.heading = Math.PI / 2; sk.v = [-4, 0, 0];      // facing +x, rolling −x
  for (let i = 0; i < 5; i++) sk.update(1 / 60);
  assert.equal(sk.fakie, true); assert.equal(e.anim.current, 'idle_backward');
  w.input.move = [-1, 0]; for (let i = 0; i < 20; i++) sk.update(1 / 60);   // push toward the leading (back) end
  assert.equal(e.anim.current, 'blade_casual_backward'); assert.ok(sk.v[0] < -4.2, `pushed fakie, vx=${sk.v[0].toFixed(2)}`);
  assert.equal(sk.lastFlip, Math.PI);
});

// a flat rail 1 m up along x (x −3..3), and a skater above it
const railScene = (rot = [0, 0, 0]) => ({ settings: { look: 'baked' }, assets: { body: { variants: { web: { primitive: 'box', size: [0.4, 1.7, 0.4] } } } },
  entities: [
    { id: 'rail', position: [0, 1, 0], rotation: rot, behaviors: [{ type: 'Rail', params: { length: 6 } }] },
    { id: 'player', asset: 'body', position: [-2, 2, 0.3], behaviors: [{ type: 'Skater' }] }] });

test('grind: dropping onto a rail along it catches it; she slides to the end and flies off with her speed', async () => {
  const sides = []; let left = null;
  const { sk } = await run(railScene(), 3, (w, s, i) => {
    if (i === 0) { s.grounded = false; s.v = [6, 0, -0.5]; w.on('grind', (_, side) => sides.push(side)); }
    if (s.grind) left = w.getEntity('player').object3d.position.x;
  });
  assert.deepEqual(sides, ['left'], 'caught once; heading +x her right is +z (−fz, fx), so drifting −z is a LEFT-side grind');
  assert.ok(left > 2.9, `rode it to the end (last x on the rail ${left?.toFixed(2)})`);
  assert.equal(sk.grind, null);
});

test('grind: crossing a rail square is a jump over it, not a grind', async () => {
  let caught = false;
  await run({ ...railScene(), entities: railScene().entities.map(e => e.id === 'player' ? { ...e, position: [0, 2, -1] } : e) }, 2, (w, s, i) => {
    if (i === 0) { s.grounded = false; s.v = [0, 0, 5]; }
    if (s.grind) caught = true;
  });
  assert.equal(caught, false);
});

test('grind: a tilted rail is a down rail — she speeds up on it; a tap ollies off', async () => {
  let peak = 0, sk0;
  await run(railScene([0, 0, -15]), 0.9, (w, s, i) => {      // tilted: the +x end lower
    sk0 = s; if (i === 0) { s.grounded = false; s.v = [3, 0, 0]; }
    if (s.grind) peak = Math.max(peak, s.grind.speed);
  });
  assert.ok(peak > 4, `sped up down the rail, ${peak.toFixed(2)} m/s`);
  const { sk, w } = await run(railScene(), 0.3, (w, s, i) => { if (i === 0) { s.grounded = false; s.v = [3, 0, 0]; } });
  assert.ok(sk.grind, 'grinding'); w.input.jump = true; sk.update(1 / 60);
  assert.equal(sk.grind, null); assert.ok(sk.v[1] > 5, 'popped off');
});

test('flips: a flick up in the air front-flips her, timed to land round; too little air is no flip', async () => {
  const { w, sk } = await run(railScene(), 0.01);
  const e = w.getEntity('player'), o = e.object3d; sk.grind = null;
  o.position.set(10, 0, 0); sk.grounded = true; sk.v = [0, 0, 0]; sk.heading = 0;
  const done = []; w.on('landtrick', (_, k) => done.push(k));
  w.input.jump = true; sk.update(1 / 60);                     // ollie (8 m/s → ~0.8 s of air)
  w.input.trick = [0, -1]; sk.update(1 / 60);
  assert.equal(sk.flip?.kind, 'front');
  let maxTurn = 0;
  for (let i = 0; i < 120 && !sk.grounded; i++) {
    sk.update(1 / 60);
    const up = new (o.position.constructor)(0, 1, 0).applyQuaternion(o.quaternion);
    maxTurn = Math.max(maxTurn, Math.acos(Math.max(-1, Math.min(1, up.y))));
  }
  assert.ok(sk.grounded, 'landed'); assert.ok(maxTurn > 3, `went upside down, ${maxTurn.toFixed(2)} rad`);
  assert.deepEqual(done, ['front'], 'landed it round');
  sk.v = [0, 1, 0]; sk.grounded = false; o.position.y = 0.05;
  w.input.trick = [0, -1]; sk.update(1 / 60); assert.equal(sk.flip, null, 'no air left: no flip');
});

test('ground left flick: up = boost (a stroke of +8 m/s, once per cooldown), down = skid stop, sideways = swivel to fakie', async () => {
  const { w, sk } = await run(railScene(), 0.01);
  const o = w.getEntity('player').object3d; o.position.set(20, 0, 0); sk.grind = null; sk.grounded = true; sk.heading = Math.PI / 2; sk.v = [5, 0, 0];
  w.input.trick = [0, -1]; for (let i = 0; i < 40; i++) sk.update(1 / 60);
  assert.ok(sk.v[0] > 12, `boosted 5 → ${sk.v[0].toFixed(2)} m/s`);
  const v1 = sk.v[0]; w.input.trick = [0, -1]; for (let i = 0; i < 10; i++) sk.update(1 / 60);
  assert.ok(sk.v[0] <= v1 + 0.01, 'a second flick inside the cooldown does nothing');
  w.input.trick = [1, 0]; sk.update(1 / 60);
  for (let i = 0; i < 10; i++) sk.update(1 / 60);
  assert.ok(sk.v[0] > 10 && sk.fakie, 'swivelled: same travel, rolling fakie');
  w.input.trick = [0, 1]; for (let i = 0; i < 40; i++) sk.update(1 / 60);
  assert.ok(Math.hypot(...sk.v) < 0.5, `skidded to a stop, ${Math.hypot(...sk.v).toFixed(2)} m/s`);
});
