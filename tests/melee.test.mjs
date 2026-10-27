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
