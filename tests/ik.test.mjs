import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ik2 } from '../runtime/ik.js';

function arm() {   // shoulder at the origin, upper arm 0.3 along +x, forearm 0.25 bent toward −z
  const root = new THREE.Group(), up = new THREE.Bone(), mid = new THREE.Bone(), end = new THREE.Bone();
  mid.position.set(0.3, 0, 0); end.position.set(0.25, 0, 0); mid.rotation.y = 0.6;
  root.add(up); up.add(mid); mid.add(end); root.updateMatrixWorld(true);
  return { root, up, mid, end, wp: o => o.getWorldPosition(new THREE.Vector3()) };
}

test('ik2 puts the hand on a reachable target and keeps the bone lengths', () => {
  const { up, mid, end, wp } = arm(), target = new THREE.Vector3(0.25, 0.2, -0.15);
  assert.ok(ik2(up, mid, end, target, 1));
  assert.ok(wp(end).distanceTo(target) < 1e-4, `hand ${wp(end).toArray().map(v => v.toFixed(3))}`);
  assert.ok(Math.abs(wp(up).distanceTo(wp(mid)) - 0.3) < 1e-6 && Math.abs(wp(mid).distanceTo(wp(end)) - 0.25) < 1e-6);
});

test('ik2: out of reach → arm straight toward it; w=0 → the pose unchanged', () => {
  const a = arm(), far = new THREE.Vector3(0, 0, -5); ik2(a.up, a.mid, a.end, far, 1);
  const dir = a.wp(a.end).normalize(); assert.ok(dir.dot(new THREE.Vector3(0, 0, -1)) > 0.999, 'reaching straight at it');
  const b = arm(), before = b.wp(b.end); ik2(b.up, b.mid, b.end, new THREE.Vector3(0.1, 0.4, 0), 0);
  assert.ok(b.wp(b.end).distanceTo(before) < 1e-6);
});
