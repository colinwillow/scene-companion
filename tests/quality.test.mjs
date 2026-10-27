import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qualityReport, passes } from '../runtime/quality.js';

const base = { kind: 'model', tris: 3000, draco: true, webp: true, images: 1, doubleSided: false, blend: false, mixamo: false, clips: [] };
test('quality gate: a clean model passes with nothing to say; heavy, uncompressed, two-sided and blended ones are told what to fix', () => {
  assert.deepEqual(qualityReport(base, { kb: 300 }), []);
  const heavy = qualityReport({ ...base, tris: 200000 }, { kb: 25 * 1024 });
  assert.equal(passes(heavy), false); assert.ok(heavy.every(r => r.fix));
  const msgs = qualityReport({ ...base, draco: false, doubleSided: true, blend: true, tris: 9000 }, { kb: 500 }).map(r => r.msg);
  assert.ok(msgs.includes('meshes not compressed') && msgs.includes('materials are doubleSided') && msgs.some(m => /BLEND/.test(m)));
  const ch = qualityReport({ ...base, kind: 'character', mixamo: false, clips: [] }, { kb: 500, role: 'character', thumb: null }).map(r => r.msg);
  assert.ok(ch.includes('rig is not Mixamo-named') && ch.includes('no animation clips') && ch.includes('no library thumbnail'));
});
