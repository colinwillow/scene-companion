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
export function buildState(world, { url, fps = 0, errors = [], selectedId = null } = {}) {
  const ent = selectedId ? world.getEntity(selectedId) : null;
  const o = ent?.object3d;
  return {
    type: 'state', url, fps: Math.round(fps), errors: errors.slice(0, 5).map(String),
    selected: o ? { id: selectedId, position: [r3(o.position.x), r3(o.position.y), r3(o.position.z)], visible: o.visible !== false } : null,
  };
}

// Short text for the editor's LIVE badge.
export function describeState(s, errorCount = 0) {
  if (!s) return '● LIVE';
  const parts = ['● LIVE', `${s.fps} fps`];
  if (errorCount) parts.push(`${errorCount} error${errorCount > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

// Same scene file? Pages may name it './scenes/x.json' or 'scenes/x.json'.
export const sameScene = (a, b) => !!a && !!b && a.replace(/^\.\//, '') === b.replace(/^\.\//, '');
