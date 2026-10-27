// A walk grid and A* for ground-level AI (pure JS). Every Solid stamps the cells under it that a body can't walk through:
// higher than `step` over the ground and lower than `head`. Each solid only visits the cells of its own footprint, so a city
// of thousands of solids builds in milliseconds. path(from, to) → [[x, z], …] smoothed to the fewest straight legs.
import { walkShape, solidOutline } from './collide.js';

export class NavGrid {
  constructor({ cell = 0.5, radius = 0.35, step = 0.35, head = 1.8, groundY = 0, margin = 12 } = {}) {
    Object.assign(this, { cell, radius, step, head, groundY, margin });
  }
  build(solids) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; const shapes = [];
    for (const so of solids) {
      const sh = walkShape(so), o = solidOutline(so);
      if (sh.minY > this.groundY + this.head || sh.maxY <= this.groundY + this.step) continue;   // overhead, or low enough to step on
      const r = Math.hypot(o.half[0], o.half[2]) + this.radius;
      shapes.push({ sh, x0: o.c[0] - r, x1: o.c[0] + r, z0: o.c[2] - r, z1: o.c[2] + r });
      x0 = Math.min(x0, o.c[0] - r); x1 = Math.max(x1, o.c[0] + r); z0 = Math.min(z0, o.c[2] - r); z1 = Math.max(z1, o.c[2] + r);
    }
    if (!shapes.length) { x0 = z0 = -1; x1 = z1 = 1; }
    this.ox = x0 - this.margin; this.oz = z0 - this.margin;
    this.w = Math.ceil((x1 - x0 + 2 * this.margin) / this.cell); this.h = Math.ceil((z1 - z0 + 2 * this.margin) / this.cell);
    this.block = new Uint8Array(this.w * this.h);
    for (const s of shapes) {
      const [i0, j0] = this.cellOf(s.x0, s.z0), [i1, j1] = this.cellOf(s.x1, s.z1);
      for (let j = Math.max(0, j0); j <= Math.min(this.h - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(this.w - 1, i1); i++) {
        if (this.block[j * this.w + i]) continue;
        const [x, z] = this.centre(i, j);
        if (s.sh.topNear(x, z, this.radius) > this.groundY + this.step) this.block[j * this.w + i] = 1;
      }
    }
    this.count = solids.length;
    return this;
  }
  cellOf(x, z) { return [Math.floor((x - this.ox) / this.cell), Math.floor((z - this.oz) / this.cell)]; }
  centre(i, j) { return [this.ox + (i + 0.5) * this.cell, this.oz + (j + 0.5) * this.cell]; }
  free(i, j) { return i < 0 || j < 0 || i >= this.w || j >= this.h || !this.block[j * this.w + i]; }   // off the grid is open ground
  // a straight walk between two points crosses no blocked cell
  clear([ax, az], [bx, bz]) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / (this.cell * 0.5)));
    for (let k = 0; k <= n; k++) { const [i, j] = this.cellOf(ax + (bx - ax) * k / n, az + (bz - az) * k / n); if (!this.free(i, j)) return false; }
    return true;
  }
  // nearest free cell to a blocked one (a target standing against a wall)
  nearestFree(i, j, R = 8) {
    if (this.free(i, j)) return [i, j];
    for (let r = 1; r <= R; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++)
      if (Math.max(Math.abs(di), Math.abs(dj)) === r && this.free(i + di, j + dj)) return [i + di, j + dj];
    return null;
  }
  path(from, to, { maxNodes = 20000 } = {}) {
    if (this.clear(from, to)) return [to];
    let s = this.nearestFree(...this.cellOf(...from)), g = this.nearestFree(...this.cellOf(...to));
    if (!s || !g) return null;
    const key = (i, j) => `${i},${j}`, open = new Map(), came = new Map(), cost = new Map();
    const hfun = (i, j) => { const dx = Math.abs(i - g[0]), dz = Math.abs(j - g[1]); return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz); };
    open.set(key(...s), { i: s[0], j: s[1], f: hfun(...s) }); cost.set(key(...s), 0);
    let found = null, n = 0;
    while (open.size && n++ < maxNodes) {
      let cur = null; for (const v of open.values()) if (!cur || v.f < cur.f) cur = v;
      const ck = key(cur.i, cur.j); open.delete(ck);
      if (cur.i === g[0] && cur.j === g[1]) { found = cur; break; }
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const i = cur.i + di, j = cur.j + dj; if (!this.free(i, j)) continue;
        if (di && dj && (!this.free(cur.i + di, cur.j) || !this.free(cur.i, cur.j + dj))) continue;   // no cutting a corner
        const nk = key(i, j), c = cost.get(ck) + (di && dj ? 1.4142 : 1);
        if (c < (cost.get(nk) ?? Infinity)) { cost.set(nk, c); came.set(nk, ck); open.set(nk, { i, j, f: c + hfun(i, j) }); }
      }
    }
    if (!found) return null;
    const cells = []; for (let k = key(found.i, found.j); k; k = came.get(k)) cells.unshift(k.split(',').map(Number));
    const pts = [from, ...cells.slice(1, -1).map(([i, j]) => this.centre(i, j)), to];
    const out = []; let a = pts[0], i = 0;                    // string-pull: from each corner, the farthest point in a clear line
    while (i < pts.length - 1) { let k = pts.length - 1; while (k > i + 1 && !this.clear(a, pts[k])) k--; out.push(pts[k]); a = pts[k]; i = k; }
    return out;
  }
}
