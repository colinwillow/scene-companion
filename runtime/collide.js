// Collision queries for behaviors (docs/ENGINE.md #4). Pure JS — no three, no DOM — so behaviors stay portable.
// Shapes come from Solid behaviors: their `box()` (axis-aligned, optionally a ramp), `shape` (box | sphere | capsule),
// `rotated` (a box turned by the entity's yaw) and `layer`. Vectors are plain [x, y, z] arrays.
//
//   raycast(solids, origin, dir, { maxDist, layers, ignore })        → nearest hit or null
//   sweep(solids, origin, dir, radius, { maxDist, layers, ignore })  → a sphere moved along dir: first hit or null
//   overlap(solids, center, radius, { layers, ignore })              → every solid touching that sphere
// A hit is { solid, id, point: [x,y,z], normal: [x,y,z], distance }.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Ray vs axis-aligned box (slab test), box grown by `r` on every side (a sweep's Minkowski box). → { t, normal } | null
export function rayBox(o, d, b, maxDist = Infinity, r = 0) {
  let tmin = 0, tmax = maxDist, axis = -1, sign = 0;
  const lo = [b.minX - r, b.minY - r, b.minZ - r], hi = [b.maxX + r, b.maxY + r, b.maxZ + r];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) { if (o[i] < lo[i] || o[i] > hi[i]) return null; continue; }
    let t1 = (lo[i] - o[i]) / d[i], t2 = (hi[i] - o[i]) / d[i], s = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (axis < 0) return { t: 0, normal: norm([-d[0], -d[1], -d[2]]), inside: true };   // started inside
  const normal = [0, 0, 0]; normal[axis] = sign;
  return { t: tmin, normal };
}

// Ray vs sphere. → { t, normal } | null
export function raySphere(o, d, c, r, maxDist = Infinity) {
  const oc = sub(o, c), b = dot(oc, d), cc = dot(oc, oc) - r * r;
  if (cc <= 0) return { t: 0, normal: norm([-d[0], -d[1], -d[2]]), inside: true };
  const disc = b * b - cc; if (disc < 0) return null;
  const t = -b - Math.sqrt(disc); if (t < 0 || t > maxDist) return null;
  return { t, normal: norm(sub([o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t], c)) };
}

// Ray vs vertical capsule (segment a→b, radius r). Sampled closest-approach: exact for the cylinder, spheres for the caps.
export function rayCapsule(o, d, a, b, r, maxDist = Infinity) {
  let best = null;
  for (const cap of [a, b]) { const h = raySphere(o, d, cap, r, maxDist); if (h && (!best || h.t < best.t)) best = h; }
  // infinite cylinder around the vertical axis, clipped to a.y..b.y
  const ox = o[0] - a[0], oz = o[2] - a[2], A = d[0] * d[0] + d[2] * d[2];
  if (A > 1e-12) {
    const B = ox * d[0] + oz * d[2], C = ox * ox + oz * oz - r * r, disc = B * B - A * C;
    if (disc >= 0) {
      const t = (-B - Math.sqrt(disc)) / A, y = o[1] + d[1] * t;
      if (t >= 0 && t <= maxDist && y >= Math.min(a[1], b[1]) && y <= Math.max(a[1], b[1]) && (!best || t < best.t))
        best = { t, normal: norm([ox + d[0] * t, 0, oz + d[2] * t]) };
    }
  }
  return best;
}

// Ray vs a ramp (box whose top rises along `slope`: '+x' | '-x' | '+z' | '-z'). Box test, then the sloped face.
function rayRamp(o, d, b, maxDist, r) {
  const hit = rayBox(o, d, b, maxDist, r); if (!hit) return null;
  const ax = b.slope[1] === 'x' ? 0 : 2, up = b.slope[0] === '+';
  const lo = ax ? b.minZ : b.minX, hi = ax ? b.maxZ : b.maxX, h = b.maxY - b.minY;
  const topAt = p => { const f = Math.min(1, Math.max(0, (p[ax] - lo) / (hi - lo || 1))); return b.minY + h * (up ? f : 1 - f) + r; };
  const at = t => [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  if (at(hit.t)[1] <= topAt(at(hit.t)) + 1e-6) return hit;      // entered through a side under the slope
  // march to the slope surface (it's a plane; a few bisection steps are plenty for gameplay queries)
  const diag = Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) + 2 * r;   // longest path through the box
  let t0 = hit.t, t1 = Math.min(hit.t + diag, maxDist), found = false;
  const step = (t1 - t0) / 32;
  for (let t = t0; t <= t1; t += step || 1) { const p = at(t); if (p[1] <= topAt(p)) { t1 = t; found = true; break; } t0 = t; }
  if (!found) return null;
  for (let i = 0; i < 20; i++) { const m = (t0 + t1) / 2; if (at(m)[1] <= topAt(at(m))) t1 = m; else t0 = m; }
  const run = (hi - lo) || 1, n = ax ? [0, run, up ? -h : h] : [up ? -h : h, run, 0];
  return { t: t1, normal: norm(n) };
}

// The shape a Solid presents to queries.
export function shapeOf(solid) {
  const b = solid.box(), P = solid.params || {}, kind = P.shape || 'box';
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, cz = (b.minZ + b.maxZ) / 2;
  if (kind === 'sphere') return { kind, c: [cx, cy, cz], r: Math.min(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) / 2 };
  if (kind === 'capsule') { const r = Math.min(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
    return { kind, a: [cx, b.minY + r, cz], b: [cx, Math.max(b.minY + r, b.maxY - r), cz], r }; }
  const yaw = P.rotated ? (solid.entity?.object3d?.rotation?.y || 0) : 0;
  if (yaw && !b.slope) {   // turned box: un-turned extents, centred, and the yaw
    const [sx, sy, sz] = P.size || [1, 1, 1];
    return { kind: 'obb', c: [cx, cy, cz], half: [sx / 2, sy / 2, sz / 2], yaw };
  }
  return { kind: b.slope ? 'ramp' : 'box', box: b };
}

function hitShape(s, o, d, maxDist, r) {
  switch (s.kind) {
    case 'sphere': return raySphere(o, d, s.c, s.r + r, maxDist);
    case 'capsule': return rayCapsule(o, d, s.a, s.b, s.r + r, maxDist);
    case 'ramp': return rayRamp(o, d, s.box, maxDist, r);
    case 'obb': {   // rotate the ray into the box's frame, test there, rotate the normal back
      const c = Math.cos(-s.yaw), sn = Math.sin(-s.yaw), rel = sub(o, s.c);
      const lo = [c * rel[0] + sn * rel[2], rel[1], -sn * rel[0] + c * rel[2]], ld = [c * d[0] + sn * d[2], d[1], -sn * d[0] + c * d[2]];
      const h = rayBox(lo, ld, { minX: -s.half[0], maxX: s.half[0], minY: -s.half[1], maxY: s.half[1], minZ: -s.half[2], maxZ: s.half[2] }, maxDist, r);
      if (!h) return null;
      const C = Math.cos(s.yaw), S = Math.sin(s.yaw), n = h.normal;
      return { ...h, normal: [C * n[0] + S * n[2], n[1], -S * n[0] + C * n[2]] };
    }
    default: return rayBox(o, d, s.box, maxDist, r);
  }
}

const allowed = (solid, { layers, ignore } = {}) => {
  const id = solid.entity?.id;
  if (ignore && (Array.isArray(ignore) ? ignore.includes(id) : ignore === id)) return false;
  return !layers || layers.includes(solid.params?.layer || 'default');
};

function cast(solids, origin, dir, radius, opts = {}) {
  const d = norm(dir), maxDist = opts.maxDist ?? 100;
  let best = null;
  for (const s of solids) {
    if (!allowed(s, opts)) continue;
    const h = hitShape(shapeOf(s), origin, d, maxDist, radius);
    if (h && (!best || h.t < best.distance)) best = { solid: s, id: s.entity?.id, distance: h.t, normal: h.normal,
      point: [origin[0] + d[0] * h.t - h.normal[0] * radius, origin[1] + d[1] * h.t - h.normal[1] * radius, origin[2] + d[2] * h.t - h.normal[2] * radius] };
  }
  return best;
}

export const raycast = (solids, origin, dir, opts) => cast(solids, origin, dir, 0, opts);
export const sweep = (solids, origin, dir, radius, opts) => cast(solids, origin, dir, Math.max(0, radius), opts);

export function overlap(solids, center, radius, opts = {}) {
  const out = [];
  for (const s of solids) {
    if (!allowed(s, opts)) continue;
    const sh = shapeOf(s);
    let dist;
    if (sh.kind === 'sphere') dist = len(sub(center, sh.c)) - sh.r;
    else if (sh.kind === 'capsule') { const y = Math.min(Math.max(center[1], sh.a[1]), sh.b[1]); dist = len(sub(center, [sh.a[0], y, sh.a[2]])) - sh.r; }
    else if (sh.kind === 'obb') {
      const c = Math.cos(-sh.yaw), sn = Math.sin(-sh.yaw), rel = sub(center, sh.c), l = [c * rel[0] + sn * rel[2], rel[1], -sn * rel[0] + c * rel[2]];
      dist = len(l.map((v, i) => Math.max(Math.abs(v) - sh.half[i], 0)));
    } else { const b = sh.box; dist = len([Math.max(b.minX - center[0], 0, center[0] - b.maxX), Math.max(b.minY - center[1], 0, center[1] - b.maxY), Math.max(b.minZ - center[2], 0, center[2] - b.maxZ)]); }
    if (dist <= radius) out.push({ solid: s, id: s.entity?.id });
  }
  return out;
}

// Is the straight line from a to b clear of solids? (line of sight)
export function lineClear(solids, a, b, opts = {}) {
  const d = sub(b, a), dist = len(d); if (dist < 1e-6) return true;
  return !raycast(solids, a, d, { ...opts, maxDist: dist - 1e-4 });
}

// ---- walking (PlayerController): what a body standing at (x, z) sees of a solid, for every shape.
// Height of a box/ramp's top at (x, z): maxY for boxes, along the incline for ramps.
export function topAt(b, x, z) {
  if (!b.slope) return b.maxY;
  const c = (v, lo, hi) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  const t = { '+x': c(x, b.minX, b.maxX), '-x': 1 - c(x, b.minX, b.maxX), '+z': c(z, b.minZ, b.maxZ), '-z': 1 - c(z, b.minZ, b.maxZ) }[b.slope];
  return b.minY + t * (b.maxY - b.minY);
}

// → { minY, maxY, sloped, ref, near(x, z), out(x, z, r), top(x, z), topNear(x, z, r) }
//   near: the closest point of the footprint (plan view) and whether (x, z) is inside it
//   out:  for a point inside, the shortest move that puts a circle of radius r just outside
//   top:  the surface height at a point inside the footprint; topNear: the highest surface under a circle (−∞: none)
//   sloped: walkable curve or incline — stepped up onto (STEP_UP) instead of blocking like a box's side
//   ref: a point that moves with the solid (riding moving platforms)
export function walkShape(solid) {
  const s = shapeOf(solid);
  if (s.kind === 'box' || s.kind === 'ramp') {
    const b = s.box, R = b.slope ? b : null;
    const inFoot = (x, z, r) => { const cx = Math.max(b.minX, Math.min(x, b.maxX)), cz = Math.max(b.minZ, Math.min(z, b.maxZ)); return (x - cx) ** 2 + (z - cz) ** 2 < r * r; };
    return { minY: b.minY, maxY: b.maxY, sloped: !!R, ref: [b.minX, b.maxY, b.minZ], box: b,
      near: (x, z) => { const cx = Math.max(b.minX, Math.min(x, b.maxX)), cz = Math.max(b.minZ, Math.min(z, b.maxZ)); return { cx, cz, inside: cx === x && cz === z }; },
      out: (x, z, r) => [[b.minX - r - x, 0], [b.maxX + r - x, 0], [0, b.minZ - r - z], [0, b.maxZ + r - z]].sort((p, q) => Math.hypot(...p) - Math.hypot(...q))[0],
      top: (x, z) => topAt(b, x, z),
      topNear: (x, z, r) => inFoot(x, z, r) ? topAt(b, x, z) : -Infinity };
  }
  if (s.kind === 'obb') {
    const [hx, hy, hz] = s.half, C = Math.cos(s.yaw), S = Math.sin(s.yaw);
    const toL = (x, z) => { const dx = x - s.c[0], dz = z - s.c[2]; return [C * dx - S * dz, S * dx + C * dz]; };   // world → box frame
    const toW = (lx, lz) => [s.c[0] + C * lx + S * lz, s.c[2] - S * lx + C * lz];
    const maxY = s.c[1] + hy;
    return { minY: s.c[1] - hy, maxY, sloped: false, ref: [s.c[0], maxY, s.c[2]],
      near: (x, z) => { const [lx, lz] = toL(x, z), cx = Math.max(-hx, Math.min(lx, hx)), cz = Math.max(-hz, Math.min(lz, hz)); const [wx, wz] = toW(cx, cz); return { cx: wx, cz: wz, inside: cx === lx && cz === lz }; },
      out: (x, z, r) => { const [lx, lz] = toL(x, z); const [ox, oz] = [[-hx - r - lx, 0], [hx + r - lx, 0], [0, -hz - r - lz], [0, hz + r - lz]].sort((p, q) => Math.hypot(...p) - Math.hypot(...q))[0]; return [C * ox + S * oz, -S * ox + C * oz]; },
      top: () => maxY,
      topNear: (x, z, r) => { const [lx, lz] = toL(x, z), cx = Math.max(-hx, Math.min(lx, hx)), cz = Math.max(-hz, Math.min(lz, hz)); return (lx - cx) ** 2 + (lz - cz) ** 2 < r * r ? maxY : -Infinity; } };
  }
  // sphere and (vertical) capsule: a round footprint of radius R; the top is a dome over the centre / upper cap
  const R = s.r, cx0 = s.kind === 'sphere' ? s.c[0] : s.a[0], cz0 = s.kind === 'sphere' ? s.c[2] : s.a[2];
  const capY = s.kind === 'sphere' ? s.c[1] : s.b[1], minY = (s.kind === 'sphere' ? s.c[1] : s.a[1]) - R;
  const dome = d => d < R ? capY + Math.sqrt(R * R - d * d) : -Infinity;
  return { minY, maxY: capY + R, sloped: true, ref: [cx0, capY + R, cz0],
    near: (x, z) => { const dx = x - cx0, dz = z - cz0, d = Math.hypot(dx, dz); return d < R ? { cx: x, cz: z, inside: true } : { cx: cx0 + dx / d * R, cz: cz0 + dz / d * R, inside: false }; },
    out: (x, z, r) => { const dx = x - cx0, dz = z - cz0, d = Math.hypot(dx, dz) || 1e-9, k = (R + r) / d - 1; return d < 1e-6 ? [R + r, 0] : [dx * k, dz * k]; },
    top: (x, z) => Math.max(dome(Math.hypot(x - cx0, z - cz0)), capY),
    topNear: (x, z, r) => dome(Math.max(0, Math.hypot(x - cx0, z - cz0) - r)) };
}
