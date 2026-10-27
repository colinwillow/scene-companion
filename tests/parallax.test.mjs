import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Parallax } from '../behaviors/index.js';
import { fakeEntity, fakeWorld, attach } from './fakes.js';

test('Parallax copies a fraction of the camera\'s move, on the axes asked for', () => {
  const e = fakeEntity('hill', [10, 2, -30]), w = fakeWorld([e]);
  const b = attach(Parallax, e, { follow: 0.5 }, w);
  b.update(0.016);                                   // no view yet: stays put
  w.view = { pos: [0, 5, 20] }; b.update(0.016);
  w.view = { pos: [8, 9, 20] }; b.update(0.016);
  assert.deepEqual([e.object3d.position.x, e.object3d.position.y], [14, 2]);   // x moved 4 (half of 8), y left alone
  const s = attach(Parallax, fakeEntity('sky', [0, 0, 0]), { follow: 1, axes: 'xy' }, w);
  s.update(0); w.view = { pos: [10, 12, 20] }; s.update(0);
  assert.deepEqual([s.entity.object3d.position.x, s.entity.object3d.position.y], [2, 3]);
});
