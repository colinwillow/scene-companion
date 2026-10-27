import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCommand, COMMANDS } from '../runtime/commands.js';
import { Spin, Bob, Patrol } from '../behaviors/index.js';

const ctx = {
  schemas: { Spin: Spin.schema, Bob: Bob.schema, Patrol: Patrol.schema },
  prefabs: { coin: { asset: 'coin', behaviors: [{ type: 'Spin', params: { speed: 2 } }, { type: 'Bob' }] } },
};
const scene = () => ({ settings: {}, assets: { crate: {}, coin: {} }, prefabs: { coin: './prefabs/coin.prefab.json' },
  entities: [{ id: 'crate_01', asset: 'crate', position: [0, 0, 0] }, { id: 'coin_01', prefab: 'coin', position: [1, 1, 0] }] });

test('list and get resolve prefab behaviors', () => {
  const d = scene();
  const { result } = runCommand(d, 'list_entities', {}, ctx);
  assert.deepEqual(result[1], { id: 'coin_01', prefab: 'coin', position: [1, 1, 0], behaviors: ['Spin', 'Bob'] });
  assert.equal(runCommand(d, 'list_entities', { filter: 'crate' }, ctx).result.length, 1);
  assert.equal(runCommand(d, 'get_entity', { id: 'coin_01' }, ctx).result.resolved.behaviors[0].params.speed, 2);
  assert.ok(runCommand(d, 'list_library', {}, ctx).result.behaviors.Spin.speed);
});

test('spawn, move, delete', () => {
  const d = scene();
  assert.equal(runCommand(d, 'spawn', { prefab: 'coin', position: [2, 0.5, 3] }, ctx).result.id, 'coin_02');
  assert.equal(runCommand(d, 'spawn', { asset: 'crate', id: 'big_crate' }, ctx).result.id, 'big_crate');
  runCommand(d, 'move', { id: 'big_crate', position: [1, 2, 3.33333], rotation: [0, 90, 0] }, ctx);
  assert.deepEqual(d.entities.at(-1).position, [1, 2, 3.333]);
  runCommand(d, 'delete', { id: 'crate_01' }, ctx);
  assert.ok(!d.entities.some(e => e.id === 'crate_01'));
});

test('behaviors: attach, set_param, remove (prefab ones via removeBehaviors), with schema checks', () => {
  const d = scene();
  runCommand(d, 'attach_behavior', { id: 'crate_01', type: 'Spin', params: { speed: 3 } }, ctx);
  runCommand(d, 'set_param', { id: 'crate_01', type: 'Spin', key: 'speed', value: -2 }, ctx);
  assert.deepEqual(d.entities[0].behaviors, [{ type: 'Spin', params: { speed: -2 } }]);
  runCommand(d, 'set_param', { id: 'coin_01', type: 'Bob', key: 'height', value: 1 }, ctx);   // override on a prefab instance
  assert.deepEqual(d.entities[1].behaviors, [{ type: 'Bob', params: { height: 1 } }]);
  runCommand(d, 'remove_behavior', { id: 'coin_01', type: 'Spin' }, ctx);
  assert.deepEqual(d.entities[1].removeBehaviors, ['Spin']);
  runCommand(d, 'attach_behavior', { id: 'coin_01', type: 'Spin' }, ctx);
  assert.equal(d.entities[1].removeBehaviors, undefined);
  runCommand(d, 'remove_behavior', { id: 'crate_01', type: 'Spin' }, ctx);
  assert.equal(d.entities[0].behaviors, undefined);
});

test('bad input throws a helpful error and changes nothing', () => {
  const d = scene(), before = JSON.stringify(d);
  const bad = [
    ['move', { id: 'nope', position: [0, 0, 0] }, /No entity "nope"/],
    ['move', { id: 'crate_01', position: [0, 0] }, /position must be/],
    ['spawn', { prefab: 'ghost' }, /No prefab "ghost"/],
    ['spawn', { asset: 'crate', id: 'coin_01' }, /taken/],
    ['attach_behavior', { id: 'crate_01', type: 'Fly' }, /Unknown behavior "Fly"/],
    ['attach_behavior', { id: 'coin_01', type: 'Spin' }, /already has Spin/],
    ['attach_behavior', { id: 'crate_01', type: 'Spin', params: { speed: 99 } }, /between -10 and 10/],
    ['set_param', { id: 'crate_01', type: 'Spin', key: 'speed', value: 1 }, /has no Spin/],
    ['set_param', { id: 'coin_01', type: 'Spin', key: 'spd', value: 1 }, /no param "spd"/],
    ['set_param', { id: 'coin_01', type: 'Patrol', key: 'pointA', value: 1 }, /has no Patrol/],
    ['launch', {}, /Unknown command/],
  ];
  for (const [op, args, re] of bad) assert.throws(() => runCommand(d, op, args, ctx), re, op);
  assert.equal(JSON.stringify(d), before);
});

test('every command is marked as mutating or not', () => {
  for (const [n, c] of Object.entries(COMMANDS)) assert.equal(typeof c.mutates, 'boolean', n);
});
