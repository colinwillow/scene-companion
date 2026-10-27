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
