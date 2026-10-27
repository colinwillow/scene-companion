// A triangle floor (Roller Girl's TRI / triAdd / groundAt): every up-facing triangle of a mesh, bucketed in a grid, answers
// "how high is the surface at (x, z), and which way does it face" — so a ramp, a bowl or a hill made in Blender is walked
// and skated as drawn, not as a box. Faces steeper than `maxSlope` are not floors (walls stay Solids). Pure JS, no three.
//
//   const g = new TriGrid({ cell: 2, maxSlope: 60 });
//   g.add(ax, ay, az, bx, by, bz, cx, cy, cz)  (any winding; up-facing is decided by the normal's sign)
//   g.groundAt(x, z, below = Infinity)  → { y, n: [nx, ny, nz] } of the highest surface at or under `below`, or null
export class TriGrid {
  constructor({ cell = 2, maxSlope = 60 } = {}) {
    this.cell = cell; this.minNy = Math.cos(maxSlope * Math.PI / 180);
    this.tris = []; this.cells = new Map();
    this.min = [Infinity, Infinity, Infinity]; this.max = [-Infinity, -Infinity, -Infinity];
  }
  key(i, j) { return i * 73856093 ^ j * 19349663; }
  add(ax, ay, az, bx, by, bz, cx, cy, cz) {
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay), ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az), nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const l = Math.hypot(nx, ny, nz); if (l < 1e-12) return false;
    nx /= l; ny /= l; nz /= l;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }      // either winding: a floor is a floor
    if (ny < this.minNy) return false;                   // too steep to stand on: a wall, not a floor
    const t = { a: [ax, ay, az], b: [bx, by, bz], c: [cx, cy, cz], n: [nx, ny, nz] }, k = this.tris.push(t) - 1;
    const x0 = Math.min(ax, bx, cx), x1 = Math.max(ax, bx, cx), z0 = Math.min(az, bz, cz), z1 = Math.max(az, bz, cz);
    for (let i = Math.floor(x0 / this.cell); i <= Math.floor(x1 / this.cell); i++)
      for (let j = Math.floor(z0 / this.cell); j <= Math.floor(z1 / this.cell); j++) {
        const kk = this.key(i, j); (this.cells.get(kk) || this.cells.set(kk, []).get(kk)).push(k);
      }
    for (const [v, w] of [[ax, 0], [ay, 1], [az, 2], [bx, 0], [by, 1], [bz, 2], [cx, 0], [cy, 1], [cz, 2]]) { this.min[w] = Math.min(this.min[w], v); this.max[w] = Math.max(this.max[w], v); }
    return true;
  }
  // Every triangle of a flat position array ([x,y,z, …], optionally indexed), already in world space. → how many were floors.
  addPositions(pos, index) {
    let n = 0; const P = i => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const count = index ? index.length : pos.length / 3;
    for (let t = 0; t + 2 < count; t += 3) {
      const [i, j, k] = index ? [index[t], index[t + 1], index[t + 2]] : [t, t + 1, t + 2];
      if (this.add(...P(i), ...P(j), ...P(k))) n++;
    }
    return n;
  }
  groundAt(x, z, below = Infinity) {
    const list = this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))); if (!list) return null;
    let best = null;
    for (const k of list) {
      const { a, b, c, n } = this.tris[k];
      // barycentric in plan (x, z)
      const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]); if (Math.abs(d) < 1e-12) continue;
      const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d, v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d, w = 1 - u - v;
      const e = -1e-7; if (u < e || v < e || w < e) continue;
      const y = u * a[1] + v * b[1] + w * c[1];
      if (y <= below + 1e-6 && (!best || y > best.y)) best = { y, n };
    }
    return best;
  }
}

// World-space positions of a three Object3D's meshes, without importing three: walks the tree and applies each mesh's
// matrixWorld (column-major elements) by hand. → [{ name, pos: Float32Array, index: Uint32Array|null }]
export function meshTriangles(root, filter = () => true) {
  const out = [];
  root.updateMatrixWorld?.(true);
  root.traverse?.(o => {
    if (!o.isMesh || o.isSkinnedMesh || !o.geometry?.attributes?.position || !filter(o)) return;
    const src = o.geometry.attributes.position, m = o.matrixWorld.elements, pos = new Float32Array(src.count * 3);
    for (let i = 0; i < src.count; i++) {
      const x = src.getX(i), y = src.getY(i), z = src.getZ(i);
      pos[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
      pos[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      pos[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    out.push({ name: o.name, pos, index: o.geometry.index ? o.geometry.index.array : null });
  });
  return out;
}
