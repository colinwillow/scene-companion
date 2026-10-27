import test from 'node:test';
import assert from 'node:assert/strict';
import { Melee, Stompable } from '../behaviors/index.js';
import { fakeEntity, fakeWorld, attach, run } from './fakes.js';

test('Melee: a flick strikes what is in front (upper layer), not behind; cooldown; Stompable goes down', () => {
  const hero = fakeEntity('hero', [0, 0, 0]), front = fakeEntity('front', [1, 0, 0]), back = fakeEntity('back', [-1, 0, 0]);
  const played = [];
  hero.roles = { attack: 'slash' };
  hero.anim = { clips: ['slash'], play: (n, o) => played.push([n, o.layer, o.once]) };
  const w = fakeWorld([hero, front, back]); w.input = { move: [0, 0], attack: null };
  const sf = attach(Stompable, front, { targetId: 'nobody' }, w), sb = attach(Stompable, back, { targetId: 'nobody' }, w);
  const m = attach(Melee, hero, { hitDelay: 0.1, cooldown: 0.5 }, w);
  const struck = []; w.on('struck', (by, id) => struck.push(`${by}>${id}`));
  w.input.attack = [1, 0];
  m.update(1 / 60);
  assert.deepEqual(played, [['slash', 'upper', true]]);
  assert.ok(Math.abs(hero.object3d.rotation.y - Math.PI / 2) < 1e-9, 'turned to face +x');
  assert.deepEqual(struck, [], 'impact waits for hitDelay');
  run(m, 10);
  assert.deepEqual(struck, ['hero>front']);
  assert.equal(sf.defeated, true); assert.notEqual(sb.defeated, true);
  w.input.attack = [-1, 0]; m.update(1 / 60);
  assert.equal(played.length, 1, 'still cooling down');
  run(m, 40); w.input.attack = [-1, 0]; m.update(1 / 60); run(m, 10);
  assert.deepEqual(struck, ['hero>front', 'hero>back']);
});

test('Melee combo: presses during a swing chain through the list; a pause starts it over', () => {
  const hero = fakeEntity('hero', [0, 0, 0]), played = [];
  hero.anim = { clips: ['a', 'b', 'c'], play: n => played.push(n) };
  const w = fakeWorld([hero]); w.input = { move: [0, 0], attack: null };
  const m = attach(Melee, hero, { combo: 'a, b, c', cooldown: 0.3, comboWindow: 0.4, hitDelay: 0 }, w);
  w.input.attack = [0, 1]; m.update(1 / 60);
  w.input.attack = [0, 1]; m.update(1 / 60);          // pressed during the swing: kept
  run(m, 20);                                          // fires when the cooldown ends
  w.input.attack = [0, 1]; run(m, 20);
  assert.deepEqual(played, ['a', 'b', 'c']);
  run(m, 120); w.input.attack = [0, 1]; m.update(1 / 60);
  assert.equal(played.at(-1), 'a', 'after a pause the chain starts over');
});

test('Melee lock-on: turns to the nearest foe in the cone and lunges at it', () => {
  const hero = fakeEntity('hero', [0, 0, 0]), foe = fakeEntity('foe', [2, 0, 1]), far = fakeEntity('far', [0, 0, -3]);
  const w = fakeWorld([hero, foe, far]); w.input = { move: [0, 0], attack: null };
  attach(Stompable, foe, { targetId: 'nobody' }, w); attach(Stompable, far, { targetId: 'nobody' }, w);
  const m = attach(Melee, hero, { lockOn: 90, lockRange: 3.5, hitDelay: 0 }, w);
  const locked = []; w.on('lockon', (_, id) => locked.push(id));
  w.input.attack = [1, 0]; m.update(1 / 60);
  assert.deepEqual(locked, ['foe']);
  assert.ok(Math.abs(hero.object3d.rotation.y - Math.atan2(2, 1)) < 1e-9, 'faces the foe, not the flick');
  w.input.attack = null;
});

test('Melee in the air: the air clip on the whole body, a slam down, the Animator held off', async () => {
  const { PlayerController } = await import('../behaviors/index.js');
  const hero = fakeEntity('hero', [0, 3, 0]), played = [];
  hero.anim = { clips: ['slash', 'air_slash'], play: (n, o) => played.push([n, o.layer]) };
  const w = fakeWorld([hero]); w.input = { move: [0, 0], attack: null, jump: false };
  const pc = attach(PlayerController, hero, {}, w); pc.grounded = false;
  const m = attach(Melee, hero, { clip: 'slash', airClip: 'air_slash', slam: 14, hitDelay: 0 }, w);
  w.input.attack = [0, 1]; m.update(1 / 60);
  assert.deepEqual(played, [['air_slash', 'base']]); assert.equal(pc.vy, -14); assert.ok(hero.animHold > 0);
});
