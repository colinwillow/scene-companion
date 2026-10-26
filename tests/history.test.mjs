import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History } from '../runtime/history.js';

test('undo and redo restore earlier states in place', () => {
  const h = new History();
  const data = { entities: [{ id: 'a', position: [0, 0, 0] }] };
  const ref = data;
  h.record(data); data.entities[0].position = [1, 0, 0];
  h.record(data); data.entities.push({ id: 'b' });
  assert.equal(h.undo(data), true);
  assert.equal(data, ref, 'same object');
  assert.deepEqual(data.entities.map(e => e.id), ['a']);
  assert.equal(h.undo(data), true);
  assert.deepEqual(data.entities[0].position, [0, 0, 0]);
  assert.equal(h.undo(data), false);
  h.redo(data); h.redo(data);
  assert.deepEqual(data.entities.map(e => e.id), ['a', 'b']);
  assert.equal(h.redo(data), false);
});

test('a new edit clears redo', () => {
  const h = new History(), d = { v: 1 };
  h.record(d); d.v = 2;
  h.undo(d);
  h.record(d); d.v = 3;
  assert.equal(h.canRedo, false);
});

test('same key within the window coalesces into one step', () => {
  let t = 0;
  const h = new History({ now: () => t, coalesceMs: 500 }), d = { v: 0 };
  for (let i = 1; i <= 5; i++) { h.record(d, 'slider'); d.v = i; t += 100; }
  t += 1000;
  h.record(d, 'slider'); d.v = 9;
  h.undo(d); assert.equal(d.v, 5);
  h.undo(d); assert.equal(d.v, 0);
  assert.equal(h.canUndo, false);
});

test('history is capped', () => {
  const h = new History({ limit: 3 }), d = { v: 0 };
  for (let i = 1; i <= 10; i++) { h.record(d); d.v = i; }
  assert.equal(h.past.length, 3);
});
