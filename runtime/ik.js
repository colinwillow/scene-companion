// Two-bone IK (zap's ik2, the game's leg/arm solve): reach `end` toward `target` by turning `up` and `mid`, the bend kept in the
// plane the limb already has (so an elbow stays an elbow). `w` blends from the pose (0) to the full reach (1). No three import:
// vectors and quaternions are made from the bones' own classes. Bones must have up-to-date world matrices.
export function ik2(up, mid, end, target, w = 1) {
  const V = up.position.constructor, Q = up.quaternion.constructor;
  const A = up.getWorldPosition(new V()), B = mid.getWorldPosition(new V()), C = end.getWorldPosition(new V());
  const a = A.distanceTo(B), b = B.distanceTo(C), T = C.clone().lerp(target, w);
  const d = T.clone().sub(A), dl = Math.max(1e-5, Math.min(d.length(), (a + b) * 0.999)), n = d.normalize();
  const x = (a * a - b * b + dl * dl) / (2 * dl), h = Math.sqrt(Math.max(0, a * a - x * x));
  const pole = B.clone().sub(A); pole.addScaledVector(n, -pole.dot(n)); if (pole.lengthSq() < 1e-12) return false;
  const knee = A.clone().addScaledVector(n, x).addScaledVector(pole.normalize(), h), foot = A.clone().addScaledVector(n, dl);
  const q = new Q(), q2 = new Q();
  const setW = (bone, from, to) => {
    bone.getWorldQuaternion(q); q2.setFromUnitVectors(from.normalize(), to.normalize()).multiply(q);
    bone.parent.getWorldQuaternion(q).invert(); bone.quaternion.copy(q.multiply(q2)); bone.updateMatrixWorld(true);
  };
  setW(up, B.clone().sub(A), knee.clone().sub(A));
  mid.getWorldPosition(B); end.getWorldPosition(C); setW(mid, C.clone().sub(B), foot.clone().sub(B));
  return true;
}
