// Motion library (retarget-anims / the Forge): pure helpers, no three, no DOM.
// The library is Colin's Mixamo clips on Y Bot. They are NEVER committed here (Mixamo's terms: no redistributing raw
// clips, and this repo is public) — the dev server serves a local checkout at /motions/ (SC_MOTIONS or ../retarget-anims/library),
// scenes store only clip STEMS, and the World retargets each one onto the character at load (runtime/retarget.js).
export const MOTION_STEM = /^[A-Za-z0-9_]+$/;

export const motionsBase = settings => (settings?.motions ?? './motions/').replace(/\/?$/, '/');
export const motionUrl = (base, stem) => `${base}clips/${stem}.glb`;

// Every motion stem an entity asks for: its character.json's `motions`, then the entity's own (no duplicates).
export function entityMotions(character, entity) {
  return [...new Set([...(character?.motions || []), ...(entity?.motions || [])])].filter(s => typeof s === 'string' && MOTION_STEM.test(s));
}

// Search the library index ({motions:[{stem,name,description,tags,duration,loopDiff,travel}]}) by words in name/description/tags.
export function searchMotions(index, q, limit = 40) {
  const list = index?.motions || [];
  const words = (q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const hits = !words.length ? list : list.filter(m => {
    const hay = `${m.name} ${m.description || ''} ${(m.tags || []).join(' ')} ${m.stem}`.toLowerCase();
    return words.every(w => hay.includes(w));
  });
  return hits.slice(0, limit).map(m => ({ stem: m.stem, name: m.name, sub: [m.description, `${(+m.duration || 0).toFixed(1)}s`,
    m.loopDiff !== undefined && m.loopDiff < 5 ? 'loop' : '', m.travel > 0.2 ? 'moves' : '', ...(m.tags || []).slice(0, 3)].filter(Boolean).join(' · ') }));
}

// Add a motion to an entity's authored data (returns true if it changed). Pure: the editor records undo around it.
export function addMotion(data, stem) {
  if (!MOTION_STEM.test(stem || '')) return false;
  const list = (data.motions ||= []);
  if (list.includes(stem)) return false;
  list.push(stem); return true;
}

// Validator: an entity/character `motions` field.
export function checkMotions(motions) {
  if (motions === undefined) return [];
  if (!Array.isArray(motions)) return ['motions must be a list of motion-library stems'];
  return motions.filter(s => typeof s !== 'string' || !MOTION_STEM.test(s)).map(s => `motion "${s}" is not a library stem (letters, digits, _)`);
}
