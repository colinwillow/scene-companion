// Third-person camera helpers. Pure math (no three), so it's testable in node and reusable by any game page.

// Distance along a ray (origin o, unit direction d) to the first axis-aligned box it enters, or Infinity.
export function rayBox(o, d, b) {
  let t0 = 0, t1 = Infinity;
  for (const [oa, da, lo, hi] of [[o[0], d[0], b.minX, b.maxX], [o[1], d[1], b.minY, b.maxY], [o[2], d[2], b.minZ, b.maxZ]]) {
    if (Math.abs(da) < 1e-9) { if (oa < lo || oa > hi) return Infinity; continue; }
    let a = (lo - oa) / da, c = (hi - oa) / da;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

// How far the camera may sit from `focus` along unit direction `dir` (pointing from focus to camera)
// without ending up inside a solid or under the floor. Boxes the focus itself is inside are ignored.
export function clipCamera(focus, dir, dist, boxes = [], { pad = 0.25, minDist = 0.8, floorY = null } = {}) {
  let best = dist;
  for (const b of boxes) {
    const inside = focus[0] > b.minX && focus[0] < b.maxX && focus[1] > b.minY && focus[1] < b.maxY && focus[2] > b.minZ && focus[2] < b.maxZ;
    if (inside) continue;
    const grown = { minX: b.minX - pad, maxX: b.maxX + pad, minY: b.minY - pad, maxY: b.maxY + pad, minZ: b.minZ - pad, maxZ: b.maxZ + pad };
    const t = rayBox(focus, dir, grown);
    if (t < best) best = t;
  }
  if (floorY !== null && dir[1] < -1e-6) best = Math.min(best, (floorY + pad - focus[1]) / dir[1]);
  return Math.max(minDist, Math.min(dist, best));
}
