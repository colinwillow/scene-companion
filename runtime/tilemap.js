// Tilemaps: pure helpers (no three). A map is rows of text, TOP row first, one character per cell ('.' or ' ' = empty);
// the legend says what each character is: { '#': { frame: 0, solid: true }, '~': { color: '#3af', solid: false } }.
// Side view (plane 'side'): columns run along +x, rows go UP in y, the cells are `depth` deep in z around the entity.
// Top view (plane 'top'): columns along +x, rows along +z (row 0 farthest, -z), one cell tall.
export const EMPTY = new Set(['.', ' ']);

// Every filled cell: { c, r, key, solid, frame, color } (r counted from the top row).
export function tileCells(rows = [], legend = {}) {
  const out = [];
  rows.forEach((row, r) => [...row].forEach((key, c) => {
    if (EMPTY.has(key)) return;
    const L = legend[key] || {};
    out.push({ c, r, key, solid: L.solid !== false, frame: L.frame ?? 0, color: L.color || null });
  }));
  return out;
}

// Solid cells merged into horizontal runs per row: [{ r, c0, c1 }] (inclusive) — one collider per run, not per tile.
export function tileRuns(cells) {
  const byRow = new Map();
  for (const t of cells) if (t.solid) (byRow.get(t.r) || byRow.set(t.r, []).get(t.r)).push(t.c);
  const runs = [];
  for (const [r, cs] of byRow) {
    cs.sort((a, b) => a - b);
    let c0 = cs[0], prev = cs[0];
    for (const c of cs.slice(1).concat(Infinity)) { if (c === prev + 1) { prev = c; continue; } runs.push({ r, c0, c1: prev }); c0 = prev = c; }
  }
  return runs.sort((a, b) => a.r - b.r || a.c0 - b.c0);
}

// Where cell (c, r) sits, relative to the entity: its centre. The map's bottom-left (side) / far-left (top) corner is the origin.
export function cellCentre(c, r, nRows, { cell = 1, depth = 1, plane = 'side' } = {}) {
  return plane === 'top' ? [(c + 0.5) * cell, 0.5 * cell, (r + 0.5) * cell]
    : [(c + 0.5) * cell, (nRows - 1 - r + 0.5) * cell, 0];
}
// A run as a box: { c: centre (relative), size }.
export function runBox(run, nRows, opts = {}) {
  const { cell = 1, depth = 1, plane = 'side' } = opts, n = run.c1 - run.c0 + 1;
  const a = cellCentre(run.c0, run.r, nRows, opts);
  return { c: [a[0] + (n - 1) * cell / 2, a[1], a[2]], size: plane === 'top' ? [n * cell, cell, cell] : [n * cell, cell, depth] };
}
// The cell under a point (relative to the entity). In side view r can be negative (above the top row) — painting there adds
// rows on top, which keeps the bottom row (the ground) where it is. → null when it is outside what painting could reach.
export function cellAt(x, y, z, nRows, { cell = 1, plane = 'side' } = {}) {
  const c = Math.floor(x / cell), r = plane === 'top' ? Math.floor(z / cell) : nRows - 1 - Math.floor(y / cell);
  if (c < 0 || r >= (plane === 'top' ? Infinity : nRows) || (plane === 'top' && r < 0)) return null;
  return { c, r };
}
// Paint one cell (key '.' erases) → new rows. Grows right, and on top (r < 0) or below (top view) as needed; trailing
// empties are trimmed. Nothing ever moves a tile that is already there.
export function paintCell(rows, c, r, key) {
  if (c < 0) return rows.slice();
  const out = rows.slice();
  while (r < 0) { out.unshift(''); r++; }
  while (out.length <= r) out.push('');
  const row = out[r].padEnd(c + 1, '.');
  out[r] = (row.slice(0, c) + key + row.slice(c + 1)).replace(/\.+$/, '');
  return out;
}
export const mapSize = rows => ({ nRows: rows.length, nCols: Math.max(0, ...rows.map(r => r.length)) });
