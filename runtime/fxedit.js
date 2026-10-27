// The VFX workspace's sliders (pure): which preset fields are editable and their ranges; `pair` is the index into a [min, max].
export const PRESET_FIELDS = [
  { key: 'count', label: 'Count', min: 1, max: 80, step: 1, def: 10 },
  { key: 'speed', pair: 0, label: 'Speed min', min: 0, max: 20, step: 0.1, def: 1 }, { key: 'speed', pair: 1, label: 'Speed max', min: 0, max: 20, step: 0.1, def: 3 },
  { key: 'up', label: 'Up', min: -5, max: 10, step: 0.1, def: 1 },
  { key: 'spread', label: 'Spread', min: 0, max: 2, step: 0.05, def: 1 },
  { key: 'life', pair: 0, label: 'Life min', min: 0.05, max: 5, step: 0.05, def: 0.3 }, { key: 'life', pair: 1, label: 'Life max', min: 0.05, max: 5, step: 0.05, def: 0.6 },
  { key: 'size', pair: 0, label: 'Size min', min: 0.01, max: 2, step: 0.01, def: 0.1 }, { key: 'size', pair: 1, label: 'Size max', min: 0.01, max: 2, step: 0.01, def: 0.2 },
  { key: 'grow', label: 'Grow', min: 0, max: 6, step: 0.1, def: 1 },
  { key: 'grav', label: 'Gravity', min: -10, max: 30, step: 0.1, def: 0 },
  { key: 'drag', label: 'Drag', min: 0, max: 10, step: 0.1, def: 1 },
  { key: 'alpha', label: 'Opacity', min: 0, max: 1, step: 0.05, def: 1 },
];
// A preset as saved: only the known fields, min ≤ max in each pair, numbers rounded, colours as hex strings.
export function cleanPreset(p) {
  const out = { add: !!p.add };
  for (const f of PRESET_FIELDS) {
    if (f.pair === 1) continue;
    const r = v => Math.round(Math.max(f.min, Math.min(f.max, +v)) * 1000) / 1000;
    if (f.pair === 0) { const [a, b] = (Array.isArray(p[f.key]) ? p[f.key] : [p[f.key], p[f.key]]).map(r); out[f.key] = [Math.min(a, b), Math.max(a, b)]; }
    else if (p[f.key] !== undefined) out[f.key] = r(p[f.key]);
  }
  out.color = (Array.isArray(p.color) ? p.color : [p.color]).slice(0, 2).map(String);
  return out;
}
