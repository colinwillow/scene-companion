import test from 'node:test';
import assert from 'node:assert/strict';
import { motionsBase, motionUrl, entityMotions, searchMotions, addMotion, checkMotions } from '../runtime/motions.js';

const index = { motions: [
  { stem: 'Box_Jump', name: 'Box Jump', description: 'Jumping Onto A Box', tags: ['jump'], duration: 2.1, loopDiff: 90, travel: 1 },
  { stem: 'Breathing_Idle', name: 'Breathing Idle', description: 'Breathing Idle', tags: ['idle'], duration: 9.9, loopDiff: 0, travel: 0 },
  { stem: 'Bboy_Uprock', name: 'Bboy Uprock', description: 'Breakdance Uprock', tags: ['dance'], duration: 3, loopDiff: 2, travel: 0 },
] };

test('motion urls come from settings.motions with a default', () => {
  assert.equal(motionsBase({}), './motions/');
  assert.equal(motionsBase({ motions: 'http://x/lib' }), 'http://x/lib/');
  assert.equal(motionUrl('./motions/', 'Box_Jump'), './motions/clips/Box_Jump.glb');
});

test('entityMotions merges character + entity, drops bad stems', () => {
  assert.deepEqual(entityMotions({ motions: ['A', 'B'] }, { motions: ['B', 'C', '../evil', 3] }), ['A', 'B', 'C']);
  assert.deepEqual(entityMotions(null, {}), []);
});

test('searchMotions matches every word across name, description and tags', () => {
  assert.deepEqual(searchMotions(index, 'breakdance').map(m => m.stem), ['Bboy_Uprock']);
  assert.deepEqual(searchMotions(index, 'idle breathing').map(m => m.stem), ['Breathing_Idle']);
  assert.equal(searchMotions(index, '').length, 3);
  assert.match(searchMotions(index, 'idle')[0].sub, /loop/);
  assert.equal(searchMotions(index, '', 1).length, 1);
});

test('addMotion + checkMotions', () => {
  const d = {};
  assert.equal(addMotion(d, 'Box_Jump'), true);
  assert.equal(addMotion(d, 'Box_Jump'), false);
  assert.equal(addMotion(d, 'bad stem'), false);
  assert.deepEqual(d.motions, ['Box_Jump']);
  assert.deepEqual(checkMotions(['ok_1']), []);
  assert.equal(checkMotions('x').length, 1);
  assert.equal(checkMotions(['a/b']).length, 1);
});

test('search_motions / add_motion commands', async () => {
  const { runCommand } = await import('../runtime/commands.js');
  const data = { entities: [{ id: 'hero', position: [0, 0, 0] }] };
  assert.throws(() => runCommand(data, 'search_motions', { query: 'jump' }, {}), /not connected/);
  const ctx = { motions: index };
  assert.equal(runCommand(data, 'search_motions', { query: 'jump' }, ctx).result[0].stem, 'Box_Jump');
  const r = runCommand(data, 'add_motion', { id: 'hero', stem: 'Box_Jump' }, ctx);
  assert.equal(r.changed, true);
  assert.deepEqual(data.entities[0].motions, ['Box_Jump']);
  assert.equal(data.entities[0].animation, 'Box_Jump');
  assert.throws(() => runCommand(data, 'add_motion', { id: 'hero', stem: 'Nope' }, ctx), /not in the motion library/);
});
