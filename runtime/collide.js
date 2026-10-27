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
