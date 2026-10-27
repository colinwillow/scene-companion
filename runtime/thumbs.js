// Thumbnail studio maths + paths. Pure (no three/DOM): thumbs.html renders, tools/thumbs.mjs writes the files.

export const TURNTABLE_FRAMES = 8;
const VIEW_YAW = 35, VIEW_PITCH = 18;   // degrees: a three-quarter view from slightly above, like a store icon

// Camera for an item's bounding box: the whole box fits the square frame with a small margin.
// min/max: [x, y, z]; fov: vertical degrees; turn: extra yaw (turntable frames). → { position, target }
export function framing(min, max, fov, turn = 0) {
  const c = [0, 1, 2].map(i => (min[i] + max[i]) / 2);
  const r = Math.max(0.05, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
  const dist = (r / Math.sin((fov * Math.PI) / 360)) * 1.04;
  const yaw = ((VIEW_YAW + turn) * Math.PI) / 180, pitch = (VIEW_PITCH * Math.PI) / 180;
  const position = [c[0] + dist * Math.cos(pitch) * Math.sin(yaw), c[1] + dist * Math.sin(pitch), c[2] + dist * Math.cos(pitch) * Math.cos(yaw)];
  return { position: position.map(v => Math.round(v * 1e4) / 1e4), target: c };
}

// Square crop around the union of pixel bounds ([{ x0, y0, x1, y1 } | null]) with a margin, kept inside the image
// (side `full` px). → { x, y, s } or null when nothing is visible
export function cropSquare(bounds, full, margin = 0.08) {
  const b = bounds.filter(Boolean);
  if (!b.length) return null;
  const x0 = Math.min(...b.map(r => r.x0)), y0 = Math.min(...b.map(r => r.y0)), x1 = Math.max(...b.map(r => r.x1)), y1 = Math.max(...b.map(r => r.y1));
  const side = Math.min(full, Math.ceil(Math.max(x1 - x0 + 1, y1 - y0 + 1) * (1 + 2 * margin)));
  const clamp = v => Math.max(0, Math.min(full - side, Math.round(v)));
  return { x: clamp((x0 + x1 + 1) / 2 - side / 2), y: clamp((y0 + y1 + 1) / 2 - side / 2), s: side };
}

// Where an item's thumbnail lives, and its key in thumbs/index.json.
export const thumbKey = item => `${item.kind}:${item.name}`;
export const thumbPath = (item, turntable = false) => `./thumbs/${item.kind}/${item.name}${turntable ? '.turntable' : ''}.png`;

// Everything the studio renders: every library prefab and every character file.
export function thumbItems(prefabNames = [], characterPaths = []) {
  return [
    ...characterPaths.filter(p => /\.character\.json$/.test(p)).map(path => ({ kind: 'character', name: path.split('/').pop().replace(/\.character\.json$/, ''), path })),
    ...prefabNames.map(name => ({ kind: 'prefab', name })),
  ];
}

// A pack's `thumbnails` map from the rendered index: { itemName: path } for the items the pack lists.
export function packThumbnails(pack, index) {
  const out = {};
  for (const p of pack.characters || []) { const n = p.split('/').pop().replace(/\.character\.json$/, ''); if (index[`character:${n}`]) out[n] = index[`character:${n}`]; }
  for (const n of pack.prefabs || []) if (index[`prefab:${n}`] && !out[n]) out[n] = index[`prefab:${n}`];
  return out;
}
