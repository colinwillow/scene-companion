// Nested entities, spawn/destroy/find (runtime/tree.js + World), and editing/commands/livepatch on nested scenes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../runtime/World.js';
import { Behavior } from '../runtime/Behavior.js';
import { registerBehavior } from '../runtime/registry.js';
import { allEntities, findEntity, descendantIds, matchesQuery, spawnId, mergeTags } from '../runtime/tree.js';
import { duplicateEntity, deleteEntity, addEntity } from '../runtime/editing.js';
import { runCommand } from '../runtime/commands.js';
import { applyScene } from '../runtime/livepatch.js';
import '../behaviors/index.js';

globalThis.window ??= { devicePixelRatio: 1 };
const fakeRenderer = () => ({ shadowMap: {}, setPixelRatio() {}, toneMappingExposure: 1 });
const box = { variants: { web: { primitive: 'box', size: [1, 1, 1] } } };

// A behavior that spawns a prefab once and counts updates (runtime-only spawns from pure JS).
class Spawner extends Behavior {
  static schema = { prefab: { type: 'string', default: 'pip' } };
  start() { this.n = 0; this.made = this.world.spawn(this.params.prefab, { position: [0, 2, 0], parent: this.entity.id, tags: ['pip'] }); }
  update() { this.n++; }
}
registerBehavior('Spawner', Spawner);   // test-only (each test file runs in its own process)

const scene = () => ({
  settings: { look: 'toon' },
  assets: { box },
  prefabs: {
    pip: { asset: box, tags: ['small'] },
    goblin: { asset: box, tags: ['enemy'], children: [{ id: 'blade', asset: box, position: [0.5, 1, 0], children: [{ id: 'glow', asset: box }] }] },
  },
  entities: [
    { id: 'cart', asset: 'box', position: [10, 0, 0], tags: ['vehicle'], children: [
      { id: 'wheel', asset: 'box', position: [1, 0, 0], children: [{ id: 'bolt', asset: 'box', position: [0, 0.5, 0] }] },
    ] },
    { id: 'goblin_01', prefab: 'goblin', position: [0, 0, 5] },
    { id: 'goblin_02', prefab: 'goblin', position: [3, 0, 5], tags: ['boss'], children: [{ id: 'hat', asset: 'box', position: [0, 2, 0] }] },
  ],
});

async function load(data = scene()) { const w = new World(fakeRenderer()); await w.load(data); return w; }

test('tree helpers: find, flatten, subtree, queries, ids, tags', () => {
  const d = scene();
  assert.deepEqual(allEntities(d).map(e => e.id), ['cart', 'wheel', 'bolt', 'goblin_01', 'goblin_02', 'hat']);
  const hit = findEntity(d, 'bolt');
  assert.equal(hit.parent.id, 'wheel'); assert.equal(hit.depth, 2);
  assert.deepEqual(descendantIds(d.entities[0]), ['wheel', 'bolt']);
  assert.ok(matchesQuery({ tags: ['enemy'], position: [0, 0, 0] }, 'enemy'));
  assert.ok(matchesQuery({ tags: ['enemy'], prefab: 'goblin', position: [1, 0, 0] }, { tag: 'enemy', near: [0, 0, 0], radius: 1.5 }));
  assert.ok(!matchesQuery({ tags: [], position: [5, 0, 0] }, { near: [0, 0, 0], radius: 1 }));
  assert.equal(spawnId(new Set(['coin_s1']), 'coin'), 'coin_s2');
  const seq = {}; spawnId(new Set(), 'coin', seq); assert.equal(spawnId(new Set(), 'coin', seq), 'coin_s2', 'never reuses a destroyed id');
  assert.deepEqual(mergeTags(['a', 'b'], ['b', 'c', '']), ['a', 'b', 'c']);
});

test('World builds children under their parent (local transforms) and prefab children per instance', async () => {
  const w = await load();
  const bolt = w.getEntity('bolt'), wheel = w.getEntity('wheel');
  assert.equal(bolt.object3d.parent, wheel.object3d);
  assert.deepEqual(bolt.object3d.getWorldPosition(new (await import('three')).Vector3()).toArray(), [11, 0.5, 0], 'cart 10 + wheel 1 + bolt 0.5 up');
  assert.deepEqual([wheel.parent, wheel.depth, w.getEntity('cart').children], ['cart', 1, ['wheel']]);
  for (const g of ['goblin_01', 'goblin_02']) {
    assert.ok(w.getEntity(`${g}_blade`)?.inherited, `${g} has its own blade`);
    assert.equal(w.getEntity(`${g}_glow`)?.parent, `${g}_blade`, 'grandchildren are prefixed too');
  }
  assert.ok(w.getEntity('hat') && w.getEntity('goblin_02_blade'), 'instance children add to the prefab\'s');
  assert.deepEqual(w.getEntity('goblin_02').tags, ['enemy', 'boss']);
  assert.deepEqual(w.find('enemy').map(e => e.id), ['goblin_01', 'goblin_02']);
  assert.deepEqual(w.find({ tag: 'enemy', near: [3, 0, 5], radius: 1 }).map(e => e.id), ['goblin_02']);
});

test('spawn (from a behavior, under a parent) and destroy (whole subtree); scene data untouched', async () => {
  const d = scene();
  d.entities.push({ id: 'nest', asset: 'box', behaviors: [{ type: 'Spawner', params: { prefab: 'pip' } }] });
  const before = JSON.stringify(d);
  const w = await load(d);
  const pip = await w.getEntity('nest').behaviors[0].made;
  assert.equal(pip.id, 'pip_s1'); assert.ok(pip.spawned); assert.equal(pip.parent, 'nest');
  assert.deepEqual(pip.tags, ['small', 'pip']);
  assert.equal(pip.object3d.parent, w.getEntity('nest').object3d);
  const g = await w.spawn('goblin', { position: [0, 0, -4] });
  assert.equal(g.id, 'goblin_s1'); assert.ok(w.getEntity('goblin_s1_blade'), 'spawned prefab brings its children');
  const events = []; w.on('destroyed', id => events.push(id));
  assert.ok(w.destroy('goblin_s1'));
  assert.deepEqual(events, ['goblin_s1_glow', 'goblin_s1_blade', 'goblin_s1']);
  assert.ok(!w.getEntity('goblin_s1_blade') && g.object3d.parent === null);
  w.destroy('wheel');
  assert.deepEqual(w.getEntity('cart').children, []);
  assert.ok(!w.getEntity('bolt'));
  w.update(0.016);   // destroyed entities don't update; nothing throws
  assert.equal(JSON.stringify(d), before, 'spawns never touch the scene file');
  await assert.rejects(w.spawn('pip', { parent: 'nope' }), /no parent/);
});

test('editing + commands + livepatch work on nested entities', () => {
  const d = scene();
  const copy = duplicateEntity(d, 'wheel', [0, 0, 1]);
  assert.equal(copy.id, 'wheel_01'); assert.equal(copy.children[0].id, 'bolt_01', 'children get fresh ids');
  assert.deepEqual(d.entities[0].children.map(c => c.id), ['wheel', 'wheel_01'], 'copy sits next to the original');
  assert.ok(deleteEntity(d, 'bolt_01'));
  assert.equal(d.entities[0].children[1].children, undefined, 'empty children list removed');
  assert.equal(addEntity(d, { asset: 'box' }).id, 'box_01');
  assert.throws(() => runCommand(d, 'spawn', { asset: 'box', position: [0, 0, 0], id: 'bolt' }), /taken/);
  const list = runCommand(d, 'list_entities', {}).result;
  assert.equal(list.find(e => e.id === 'bolt').parent, 'wheel');
  const next = structuredClone(d); findEntity(next, 'bolt').entity.position = [0, 1, 0];
  const w = { getEntity: id => (id === 'bolt' ? { object3d: { position: {}, rotation: {}, scale: {} }, behaviors: [] } : null), prefabs: {} };
  assert.equal(applyScene(w, d, next), 'patched', 'moving a child patches in place');
  const moved = structuredClone(d); const b = findEntity(moved, 'bolt'); b.list.splice(b.index, 1); moved.entities.push(b.entity);
  assert.equal(applyScene(w, d, moved), 'rebuild', 're-parenting rebuilds');
});

test('Spawner: one every interval, at most `max` alive, lifetime removes them, total stops it', async () => {
  const { Spawner } = await import('../behaviors/index.js');
  const { fakeEntity, fakeWorld, attach } = await import('./fakes.js');
  const w = fakeWorld(); let n = 0; const spawned = [], destroyed = [];
  w.spawn = async (prefab, o) => { const id = `${prefab}_s${++n}`; spawned.push([id, o]); return { id }; };
  w.destroy = id => { destroyed.push(id); w.emit('destroyed', id); return true; };
  const s = attach(Spawner, fakeEntity('fountain', [5, 0, 0]), { prefab: 'coin', interval: 1, max: 2, lifetime: 2.5, total: 3 }, w);
  const tick = async t => { for (let i = 0; i < t * 10; i++) { s.update(0.1); await Promise.resolve(); await Promise.resolve(); } };
  await tick(1.05);
  assert.deepEqual(spawned.map(x => x[0]), ['coin_s1']);
  assert.deepEqual(spawned[0][1].position, [5, 1, 0], 'offset from the spawner, in the world');
  await tick(1);
  assert.equal(spawned.length, 2);
  await tick(1);
  assert.equal(spawned.length, 2, 'max 2 alive');
  await tick(1);
  assert.ok(destroyed.includes('coin_s1'), 'lifetime ran out');
  await tick(3);
  assert.equal(spawned.length, 3, 'total 3, then it stops');
  assert.ok(w.emitted.some(e => e[0] === 'spawn' && e[2] === 'fountain'));
  const a = attach(Spawner, fakeEntity('cart'), { prefab: 'pip', interval: 0.1, attach: true, tag: 'pip' }, w);
  a.update(0.2); await Promise.resolve();
  assert.deepEqual(spawned.at(-1)[1], { position: [0, 1, 0], parent: 'cart', tags: ['pip'] }, 'attached: local offset + parent');
});
