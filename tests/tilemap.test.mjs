import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tileCells, tileRuns, runBox, cellCentre, cellAt, paintCell, mapSize } from '../runtime/tilemap.js';

const rows = ['..##', '....', '###.#'];
const legend = { '#': { frame: 1 }, '~': { solid: false, color: '#38f' } };

test('cells and solid runs', () => {
  const cells = tileCells(rows, legend);
  assert.equal(cells.length, 6);
  assert.deepEqual(tileRuns(cells), [{ r: 0, c0: 2, c1: 3 }, { r: 2, c0: 0, c1: 2 }, { r: 2, c0: 4, c1: 4 }]);
  assert.equal(tileRuns(tileCells(['~~#'], legend)).length, 1);   // water is drawn, not solid
});

test('side view: the bottom row sits on the origin, rows go up', () => {
  assert.deepEqual(cellCentre(0, 2, 3), [0.5, 0.5, 0]);
  assert.deepEqual(cellCentre(3, 0, 3, { cell: 2 }), [7, 5, 0]);
  assert.deepEqual(runBox({ r: 2, c0: 0, c1: 2 }, 3, { depth: 3 }), { c: [1.5, 0.5, 0], size: [3, 1, 3] });
  assert.deepEqual(cellCentre(1, 1, 3, { plane: 'top' }), [1.5, 0.5, 1.5]);
});

test('cellAt and painting never move tiles that are there', () => {
  assert.deepEqual(cellAt(2.5, 0.2, 0, 3), { c: 2, r: 2 });
  assert.deepEqual(cellAt(0.5, 3.5, 0, 3), { c: 0, r: -1 });       // above the top: paint adds a row
  assert.equal(cellAt(-0.5, 0.5, 0, 3), null);
  assert.equal(cellAt(0.5, -0.5, 0, 3), null);
  const up = paintCell(rows, 0, -1, '#');
  assert.deepEqual(up, ['#', '..##', '....', '###.#']);
  assert.deepEqual(cellCentre(0, 3, mapSize(up).nRows), cellCentre(0, 2, 3));   // the ground row did not move
  assert.deepEqual(paintCell(rows, 6, 1, '#'), ['..##', '......#', '###.#']);
  assert.deepEqual(paintCell(rows, 4, 2, '.'), ['..##', '....', '###']);
});
