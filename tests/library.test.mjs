import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libraryGroups, filterNames } from '../runtime/library.js';

test('libraryGroups sorts prefabs and scene assets into characters and props', () => {
  const prefabs = {
    skeleton: { asset: {}, animation: 'idle', behaviors: [{ type: 'Chase' }] },
    rock: { asset: {}, behaviors: [{ type: 'Solid' }] },
    guard: { asset: {}, behaviors: [{ type: 'Patrol' }] },
    coin: { asset: {}, behaviors: [{ type: 'Spin' }, { type: 'Pickup' }] },
  };
  const scene = { assets: { ground: {}, player: {}, crate: {} }, entities: [{ id: 'player', asset: 'player', behaviors: [{ type: 'Animator' }] }, { id: 'c', asset: 'crate' }] };
  const g = libraryGroups(prefabs, scene);
  assert.deepEqual(g.characters, [{ kind: 'prefab', name: 'guard' }, { kind: 'prefab', name: 'skeleton' }, { kind: 'asset', name: 'player' }]);
  assert.deepEqual(g.props, [{ kind: 'prefab', name: 'coin' }, { kind: 'prefab', name: 'rock' }, { kind: 'asset', name: 'crate' }]);
  assert.deepEqual(filterNames(g.props, 'RO'), [{ kind: 'prefab', name: 'rock' }]);
  assert.deepEqual(filterNames(['Idle', 'Run', 'run_fast'], 'run'), ['Run', 'run_fast']);
});
