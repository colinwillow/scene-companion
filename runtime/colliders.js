// Colliders from a collision GLB (Colin's export naming, as in weirdport): every mesh named bld_* / solid_* / prop_* /
// deck_* / ground_* / road_* / ramp_* (an optional col_ in front) becomes a Solid. Pure JS — World reads the GLB with
// three and hands this the points; the CollisionMesh behavior turns the result into Solids.
//
//   bld_ solid_ prop_    walls and blocks: a box, turned to fit (the yaw that gives the smallest footprint)
//   deck_ ground_ road_  floors: the same box (thin ones get a minimum thickness)
//   ramp_                a ramp when it lines up with x or z (its top rises toward the high end), else a box
//   climb_ nav_ room_ marker_ fx_ … and anything else: skipped (not solid)

export const COLLIDER_KINDS = { bld: 'wall', solid: 'wall', prop: 'wall', deck: 'floor', ground: 'floor', road: 'floor', ramp: 'ramp' };
const MIN_THICK = 0.05, DEG = Math.PI / 180;

export function colliderKind(name) {
  const n = String(name || '').toLowerCase().replace(/^col_/, '');
  return COLLIDER_KINDS[n.split('_')[0]] || null;
}

// points: flat [x, y, z, x, y, z, …] in the collision file's space. → { c: [x,y,z], size: [sx, sy, sz], yaw }
// size is in the box's own frame (x across, z along); yaw turns it about +y like an entity's rotation.y.
export function fitBox(points) {
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < points.length; i += 3) { minY = Math.min(minY, points[i]); maxY = Math.max(maxY, points[i]); }
  let best = null;
  for (let a = 0; a < 90; a++) {                 // 1° steps over a quarter turn cover every orientation of a box
    const yaw = a * DEG, C = Math.cos(yaw), S = Math.sin(yaw);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < points.length; i += 3) {
      const x = points[i], z = points[i + 2], lx = C * x - S * z, lz = S * x + C * z;   // into the box frame (entity yaw convention)
      if (lx < x0) x0 = lx; if (lx > x1) x1 = lx; if (lz < z0) z0 = lz; if (lz > z1) z1 = lz;
    }
    const area = (x1 - x0) * (z1 - z0);
    if (!best || area < best.area - 1e-9) best = { area, yaw, x0, x1, z0, z1 };
  }
  const { yaw, x0, x1, z0, z1 } = best, C = Math.cos(yaw), S = Math.sin(yaw);
  const lx = (x0 + x1) / 2, lz = (z0 + z1) / 2;
  return { c: [C * lx + S * lz, (minY + maxY) / 2, -S * lx + C * lz], size: [x1 - x0, Math.max(maxY - minY, MIN_THICK), z1 - z0], yaw: Math.abs(yaw) < 1e-9 ? 0 : yaw };
}

// A ramp's high end, for a ramp lined up with the axes: '+x' | '-x' | '+z' | '-z', or null (flat, or turned).
export function rampDirection(points, box) {
  const q = box.yaw / (Math.PI / 2);
  if (Math.abs(q - Math.round(q)) > 2 / 90) return null;                    // not square to the axes: Solid ramps can't turn freely
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < points.length; i += 3) { x0 = Math.min(x0, points[i]); x1 = Math.max(x1, points[i]); z0 = Math.min(z0, points[i + 2]); z1 = Math.max(z1, points[i + 2]); }
  const top = (axis, lo, hi, end) => {                                       // highest point within the last 15% at one end
    let m = -Infinity; const band = (hi - lo) * 0.15;
    for (let i = 0; i < points.length; i += 3) { const v = points[i + axis]; if (end ? v >= hi - band : v <= lo + band) m = Math.max(m, points[i + 1]); }
    return m;
  };
  const dx = top(0, x0, x1, true) - top(0, x0, x1, false), dz = top(2, z0, z1, true) - top(2, z0, z1, false);
  const h = box.size[1];
  if (Math.max(Math.abs(dx), Math.abs(dz)) < h * 0.4) return null;
  return Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? '+x' : '-x') : (dz > 0 ? '+z' : '-z');
}

// meshes: [{ name, points }] → [{ name, kind, c, size, yaw, slope }] ready for Solid params
// (a ramp's size is along its slope first, the way Solid reads it at its snapped yaw).
export function fitColliders(meshes) {
  const out = [];
  for (const { name, points } of meshes) {
    const kind = colliderKind(name);
    if (!kind || !points?.length) continue;
    const box = fitBox(points);
    if (kind === 'ramp') {
      const dir = rampDirection(points, box);
      if (dir) {
        let ex = 0, ez = 0;     // world extents
        { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (let i = 0; i < points.length; i += 3) { x0 = Math.min(x0, points[i]); x1 = Math.max(x1, points[i]); z0 = Math.min(z0, points[i + 2]); z1 = Math.max(z1, points[i + 2]); } ex = x1 - x0; ez = z1 - z0; box.c[0] = (x0 + x1) / 2; box.c[2] = (z0 + z1) / 2; }
        const q = ['+x', '-z', '-x', '+z'].indexOf(dir);
        out.push({ name, kind, c: box.c, size: [dir[1] === 'x' ? ex : ez, box.size[1], dir[1] === 'x' ? ez : ex], yaw: q * Math.PI / 2, slope: true });
        continue;
      }
    }
    out.push({ name, kind, ...box, slope: false });
  }
  return out;
}

// One collider placed by its owner's transform (position, yaw, uniform scale) → world centre, size, yaw.
export function placeCollider(col, pos, yaw, scale = 1) {
  const C = Math.cos(yaw), S = Math.sin(yaw), [x, y, z] = col.c.map(v => v * scale);
  return { c: [pos[0] + C * x + S * z, pos[1] + y, pos[2] - S * x + C * z], size: col.size.map(v => v * scale), yaw: col.yaw + yaw };
}
