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

test('batch runs several edits as one all-or-nothing change; set_animation sets or clears', async () => {
  const { runCommand, sceneFromTemplate } = await import('../runtime/commands.js');
  const data = { assets: { crate: {} }, prefabs: {}, entities: [] };
  const ctx = { schemas: { Spin: { speed: { type: 'number', default: 1, min: 0, max: 10 } } } };
  const { result } = runCommand(data, 'batch', { calls: [
    { tool: 'spawn', args: { asset: 'crate', id: 'a', position: [1, 0, 0] } },
    { tool: 'attach_behavior', args: { id: 'a', type: 'Spin', params: { speed: 2 } } },
    { tool: 'set_animation', args: { id: 'a', clip: 'Idle' } },
  ] }, ctx);
  assert.equal(result.length, 3);
  assert.equal(data.entities[0].animation, 'Idle');
  assert.throws(() => runCommand(data, 'batch', { calls: [
    { tool: 'spawn', args: { asset: 'crate', id: 'b' } },
    { tool: 'set_param', args: { id: 'b', type: 'Spin', key: 'speed', value: 1 } },
  ] }, ctx), /batch call 2 \(set_param\)/);
  assert.equal(data.entities.length, 1, 'failed batch changed nothing');
  runCommand(data, 'set_animation', { id: 'a', clip: null }, ctx);
  assert.equal(data.entities[0].animation, undefined);
  const base = { settings: { look: 'pbr' }, assets: { g: {} }, prefabs: { p: 'x' }, entities: [{ id: 'sun', light: { type: 'directional' } }, { id: 'ground', asset: 'g' }, { id: 'coin_01' }] };
  const fresh = sceneFromTemplate(base, ['ground']);
  assert.deepEqual(fresh.entities.map(e => e.id), ['sun', 'ground']);
  assert.equal(fresh.settings.look, 'pbr');
  assert.throws(() => sceneFromTemplate(base, ['nope']), /no nope/);
});

test('sceneForSave drops unused prefabs; sceneFromTemplate drops the template route', async () => {
  const { sceneForSave, sceneFromTemplate } = await import('../runtime/commands.js');
  const scene = { prefabs: { coin: './c.json', rock: './r.json' }, entities: [{ id: 'a', prefab: 'coin' }, { id: 'b' }] };
  const { data, dropped } = sceneForSave(scene);
  assert.deepEqual(Object.keys(data.prefabs), ['coin']);
  assert.deepEqual(dropped, ['rock']);
  assert.ok(scene.prefabs.rock, 'input untouched');
  assert.deepEqual(sceneForSave({ prefabs: { rock: 'r' }, entities: [] }).data.prefabs, {});
  const fresh = sceneFromTemplate({ settings: { look: 'toon', route: ['x'], routeKnownIssue: 'y' }, entities: [] });
  assert.deepEqual(fresh.settings, { look: 'toon' });
});

test('spawn adds a prefab from prefabs/ (ctx.library) to the scene; later batch calls resolve it', async () => {
  const { runCommand } = await import('../runtime/commands.js');
  const data = { assets: {}, prefabs: { coin: './prefabs/coin.prefab.json' }, entities: [] };
  const ctx = { schemas: { Spin: { speed: { type: 'number', default: 1, min: 0, max: 10 } } }, prefabs: { coin: {} },
                library: { stone: { asset: 'x', behaviors: [{ type: 'Spin' }] } } };
  assert.throws(() => runCommand(data, 'spawn', { prefab: 'nope' }, ctx), /in prefabs\//);
  runCommand(data, 'batch', { calls: [
    { tool: 'spawn', args: { prefab: 'stone', id: 'stone_01' } },
    { tool: 'set_param', args: { id: 'stone_01', type: 'Spin', key: 'speed', value: 3 } },   // needs the prefab's Spin
  ] }, ctx);
  assert.equal(data.prefabs.stone, './prefabs/stone.prefab.json');
  assert.equal(data.prefabs.coin, './prefabs/coin.prefab.json');
  assert.equal(data.entities[0].prefab, 'stone');
  const before = structuredClone(data);
  assert.throws(() => runCommand(data, 'batch', { calls: [{ tool: 'spawn', args: { prefab: 'stone' } }, { tool: 'spawn', args: {} }] }, { library: {} }));
  assert.deepEqual(data, before, 'failed batch leaves the scene untouched');
});

test('add_light / set_light: lights through commands, validated', () => {
  const data = { entities: [{ id: 'crate_01', asset: 'crate' }], assets: { crate: {} } };
  const { result } = runCommand(data, 'add_light', { type: 'spot', position: [1, 0, 1], intensity: 80, angle: 20 });
  assert.equal(result.id, 'spot_light_01'); assert.deepEqual(result.position, [1, 4, 1]);
  assert.equal(result.light.intensity, 80); assert.equal(result.light.angle, 20);
  assert.throws(() => runCommand(data, 'add_light', { type: 'laser' }), /type must be/);
  assert.throws(() => runCommand(data, 'add_light', { type: 'point', angle: 3 }), /no "angle"/);
  runCommand(data, 'set_light', { id: 'spot_light_01', values: { color: '#ff0000', shadows: true } });
  assert.equal(data.entities.at(-1).light.color, '#ff0000'); assert.equal(data.entities.at(-1).light.shadows, true);
  assert.throws(() => runCommand(data, 'set_light', { id: 'spot_light_01', values: { color: 'red' } }), /colour/);
  assert.throws(() => runCommand(data, 'set_light', { id: 'crate_01', values: { intensity: 1 } }), /isn't a light/);
});
