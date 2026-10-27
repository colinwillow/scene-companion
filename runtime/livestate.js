// The game → editor half of the live link: a running game reports FPS, errors and where the selected
// object really is. Pure (no three/DOM) so it's testable in node and usable by the MCP server later.

// Frames-per-second over a sliding window of `window` seconds.
export function createFpsMeter(window = 1) {
  let frames = 0, time = 0, fps = 0;
  return {
    tick(dt) {
      frames++; time += dt;
      if (time >= window) { fps = frames / time; frames = 0; time = 0; }
      return fps;
    },
    get fps() { return fps; },
  };
}

const r3 = v => Math.round(v * 1000) / 1000;

// Message the game sends to the editor. `errors` are new since the last report (capped so a spam loop can't flood).
export function buildState(world, { url, fps = 0, errors = [], selectedId = null, draws = null, tris = null } = {}) {
  const ent = selectedId ? world.getEntity(selectedId) : null;
  const o = ent?.object3d;
  return {
    type: 'state', url, fps: Math.round(fps), errors: errors.slice(0, 5).map(String),
    ...(draws != null ? { draws, tris, solids: (world.solids || []).length } : {}),
    selected: o ? { id: selectedId, position: [r3(o.position.x), r3(o.position.y), r3(o.position.z)], visible: o.visible !== false } : null,
  };
}

// Short text for the editor's LIVE badge.
export function describeState(s, errorCount = 0, budget = BUDGETS.web) {
  if (!s) return '● LIVE';
  const parts = ['● LIVE', `${s.fps} fps`];
  if (s.draws != null) parts.push(`${s.draws} draws${overBudget(s, budget).length ? ' ⚠' : ''}`);
  if (errorCount) parts.push(`${errorCount} error${errorCount > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

// Same scene file? Pages may name it './scenes/x.json' or 'scenes/x.json'.
export const sameScene = (a, b) => !!a && !!b && a.replace(/^\.\//, '') === b.replace(/^\.\//, '');

// Per-tier frame budgets (docs/ENGINE.md #15): a phone holds about this much before frames drop. A scene can set its own in
// settings.budget ({ draws, tris }). Draws count every pass (shadows and post render the scene again).
export const BUDGETS = { web: { draws: 300, tris: 500000 }, ultra: { draws: 1500, tris: 3000000 } };
// What is over: → ['draws 412 > 300', …] (empty when inside the budget)
export function overBudget(stats, budget = BUDGETS.web) {
  const out = [];
  if (stats?.draws > budget.draws) out.push(`draws ${stats.draws} > ${budget.draws}`);
  if (stats?.tris > budget.tris) out.push(`tris ${Math.round(stats.tris / 1000)}k > ${Math.round(budget.tris / 1000)}k`);
  return out;
}
