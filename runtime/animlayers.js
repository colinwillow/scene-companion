// Animation layers + frame events: the pure parts (no three), shared by World's animator and its tests.

// Default body split for Mixamo rigs: the upper layer is mixamorig_Spine and everything under it (arms, head);
// the lower layer is everything else (hips, legs, root). A character.json can override: "masks": { "upper": ["mixamorig_Spine1"] }.
export const DEFAULT_MASK_ROOTS = { upper: ['mixamorig_Spine'] };

// bones: [{ name, parent }] (parent = name or null). → { upper: Set, lower: Set } of bone names.
export function bodyMasks(bones, roots = DEFAULT_MASK_ROOTS.upper) {
  const kids = new Map();
  for (const b of bones) if (b.parent) (kids.get(b.parent) || kids.set(b.parent, []).get(b.parent)).push(b.name);
  const upper = new Set(), stack = [...roots];
  while (stack.length) { const n = stack.pop(); if (upper.has(n)) continue; upper.add(n); stack.push(...(kids.get(n) || [])); }
  const lower = new Set(bones.map(b => b.name).filter(n => !upper.has(n)));
  return { upper, lower };
}

// Which of a clip's events fired between two playback times. `wrapped` = the clip looped in between (now < prev).
// events: [{ t: seconds, name, …extra }]. Events exactly at `prev` fired last tick, so the window is (prev, now].
// Returns the event objects (extra fields ride along, e.g. { name: 'foot', foot: 'L' }).
export function eventsCrossed(events, prev, now, wrapped = false) {
  if (!events?.length) return [];
  return events.filter(e => (wrapped ? (e.t > prev || e.t <= now) : (e.t > prev && e.t <= now)));
}

// Validator: character.json `events` and `masks`.
export function checkLayers(ch, clips) {
  const out = [];
  if (ch.events !== undefined) {
    if (typeof ch.events !== 'object' || Array.isArray(ch.events)) out.push('events must be { clipName: [{ t, name }] }');
    else for (const [clip, list] of Object.entries(ch.events)) {
      if (clips && !clips.includes(clip) && !(ch.motions || []).includes(clip)) out.push(`events: clip "${clip}" isn't in the model or its motions`);
      if (!Array.isArray(list) || list.some(e => !(e?.t >= 0) || typeof e?.name !== 'string' || !e.name)) out.push(`events.${clip}: each event needs t (seconds ≥ 0) and a name`);
    }
  }
  if (ch.masks !== undefined && (typeof ch.masks !== 'object' || !Array.isArray(ch.masks.upper) || !ch.masks.upper.every(s => typeof s === 'string')))
    out.push('masks must be { upper: ["boneName", …] }');
  return out;
}
