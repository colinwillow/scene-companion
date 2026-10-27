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

// Clip variants (the timeline's "Save variant"): a new named clip cut from an existing one, without touching the file.
//   { from: 'run_fwd', start: 0.1, end: 0.9, rate: 1.2, mask: 'upper' }   (all but `from` optional)
// They live on the entity (`clips` in the scene file) or on the character (`clips` in character.json). A masked
// variant only carries that part's bones — play it on the upper layer (a base clip missing bones T-poses them).
export function mergeClipVariants(character, entity) { return { ...(character?.clips || {}), ...(entity?.clips || {}) }; }
export function mergeEvents(character, entity) {
  const out = {};
  for (const src of [character?.events, entity?.events]) for (const [clip, list] of Object.entries(src || {})) out[clip] = [...(out[clip] || []), ...list].sort((a, b) => a.t - b.t);
  return out;
}
export function checkClipVariants(clips, available) {
  if (clips === undefined) return [];
  if (!clips || typeof clips !== 'object' || Array.isArray(clips)) return ['clips must be { name: { from, start, end, rate, mask } }'];
  const out = [];
  for (const [name, v] of Object.entries(clips)) {
    if (!/^[A-Za-z0-9_ -]+$/.test(name)) out.push(`clip variant "${name}": use letters, digits, _ - or spaces`);
    if (!v || typeof v.from !== 'string') { out.push(`clip variant "${name}" needs "from"`); continue; }
    if (available && !available.includes(v.from)) out.push(`clip variant "${name}": "${v.from}" isn't a clip of this model`);
    if (v.start !== undefined && !(v.start >= 0)) out.push(`clip variant "${name}": start is seconds ≥ 0`);
    if (v.end !== undefined && !(v.end > (v.start || 0))) out.push(`clip variant "${name}": end must be after start`);
    if (v.rate !== undefined && !(v.rate > 0)) out.push(`clip variant "${name}": rate must be > 0`);
    if (v.mask !== undefined && v.mask !== null && !['upper', 'lower'].includes(v.mask)) out.push(`clip variant "${name}": mask is upper or lower`);
  }
  return out;
}
