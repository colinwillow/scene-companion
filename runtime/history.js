// Undo / redo for scene data, as whole-scene snapshots (scenes are small JSON). Pure, no three/DOM.
//   history.record(data, key?)  — call BEFORE changing data. Same key within `coalesceMs` = one undo step
//                                 (so dragging a slider is one step, not fifty).
//   history.undo(data) / redo(data) — rewrite data in place; return true if something changed.
export class History {
  constructor({ limit = 100, coalesceMs = 800, now = () => Date.now() } = {}) {
    Object.assign(this, { limit, coalesceMs, now, past: [], future: [], lastKey: null, lastAt: 0 });
  }
  record(data, key = null) {
    const t = this.now();
    if (key && key === this.lastKey && t - this.lastAt < this.coalesceMs) { this.lastAt = t; return; }
    this.past.push(JSON.stringify(data));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.lastKey = key; this.lastAt = t;
  }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  undo(data) { return this.#step(data, this.past, this.future); }
  redo(data) { return this.#step(data, this.future, this.past); }
  #step(data, from, to) {
    if (!from.length) return false;
    to.push(JSON.stringify(data));
    replaceContents(data, JSON.parse(from.pop()));
    this.lastKey = null;
    return true;
  }
}

// Keep the same object (the editor and game hold references to it), swap what's inside.
export function replaceContents(target, source) {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, source);
}
