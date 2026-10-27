// Generator plug-ins: pure helpers, no network, no DOM. A generator is a file in generators/ (*.gen.mjs) exporting
//   { id, label, kind: 'image'|'model', fields: { name: { required?, default?, options?, max? } }, run(input, ctx) }
// The dev server loads them, checks a request with checkGenInput, and calls run; run returns { bytes, ext } (or { dry })
// and the server saves it under assets/generated/. Keys never reach the browser: run reads them from the server's env.
export const GEN_ID = /^[a-z0-9_-]+$/;

// Is this module a usable generator? Returns a list of problems (empty = fine).
export function genProblems(g) {
  const p = [];
  if (!g || typeof g !== 'object') return ['not an object'];
  if (!GEN_ID.test(g.id || '')) p.push('id: lowercase letters, digits, - or _');
  if (!g.label) p.push('label missing');
  if (!['image', 'model'].includes(g.kind)) p.push("kind must be 'image' or 'model'");
  if (!g.fields || typeof g.fields !== 'object') p.push('fields missing');
  if (typeof g.run !== 'function') p.push('run(input, ctx) missing');
  return p;
}

// Fill defaults, drop unknown fields, check required / options / max length. → { ok, input, errors }
export function checkGenInput(g, raw = {}) {
  const input = {}, errors = [];
  for (const [k, f] of Object.entries(g.fields || {})) {
    let v = raw[k] ?? f.default;
    if (typeof v === 'string') v = v.trim();
    if (v === undefined || v === '') { if (f.required) errors.push(`${k} is required`); continue; }
    if (f.options && !f.options.includes(v)) { errors.push(`${k}: one of ${f.options.join(', ')}`); continue; }
    if (f.max && String(v).length > f.max) { errors.push(`${k}: at most ${f.max} characters`); continue; }
    input[k] = v;
  }
  return { ok: !errors.length, input, errors };
}

// What the editor shows: everything but run.
export const genSummary = g => ({ id: g.id, label: g.label, kind: g.kind, fields: g.fields, needs: g.needs || null });

// A file name from the prompt: words → slug, numbered past what is already taken.
export function genFileName(prompt, ext, taken = []) {
  const slug = String(prompt || 'generated').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'generated';
  const have = new Set(taken); let n = 1;
  while (have.has(`${slug}_${n}.${ext}`)) n++;
  return `${slug}_${n}.${ext}`;
}
