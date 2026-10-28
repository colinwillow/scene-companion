// Extensions: installable, versioned packages of behaviors. Pure (no three, no DOM, no fetch) so the validator, the World
// and a future sandbox share it.
//   extensions/<id>/extension.json  { id, name, version, engine: "^0.9.0", entry: "index.js", behaviors: ["Wobble"],
//                                     permissions: [], description }
//   the entry:  export default function register({ Behavior, define, helpers }) { define('Wobble', class extends Behavior {…}) }
// The entry imports NOTHING — it is handed what it may use — so it can run in a sandbox later (part 2) unchanged.
// A scene turns one on with  "extensions": ["wobble", "trail-plus@^1.2.0"].

export const PERMISSIONS = {
  network: 'talk to servers (fetch, WebSocket)',
  storage: 'save on the device (localStorage, IndexedDB)',
  dom: 'touch the page outside the game (document, window)',
};
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
export const parseVersion = v => { const m = SEMVER.exec(String(v || '').trim()); return m ? m.slice(1).map(Number) : null; };
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// Does `version` satisfy `range`? "*", "1.2.3", "^1.2.3", "~1.2.3", ">=1.2.3", "<2.0.0", and space-separated AND of those.
export function satisfies(version, range = '*') {
  const v = parseVersion(version); if (!v) return false;
  return String(range).trim().split(/\s+/).every(part => {
    if (part === '*' || part === '') return true;
    const m = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(part), op = m[1] || '=', r = parseVersion(m[2]);
    if (!r) return false;
    const c = cmp(v, r);
    switch (op) {
      case '=': return c === 0;
      case '>=': return c >= 0; case '>': return c > 0; case '<=': return c <= 0; case '<': return c < 0;
      case '~': return c >= 0 && v[0] === r[0] && v[1] === r[1];
      case '^': return c >= 0 && (r[0] > 0 ? v[0] === r[0] : r[1] > 0 ? v[0] === 0 && v[1] === r[1] : cmp(v, r) === 0);
    }
    return false;
  });
}
// "trail-plus@^1.2.0" → { id: 'trail-plus', range: '^1.2.0' }
export const parseRef = ref => { const [id, range = '*'] = String(ref).split('@'); return { id, range }; };

// Problems with a manifest → [{ level: 'error'|'warn', msg }]
export function checkManifest(m, { engine } = {}) {
  const out = [], err = msg => out.push({ level: 'error', msg }), warn = msg => out.push({ level: 'warn', msg });
  if (!m || typeof m !== 'object') return [{ level: 'error', msg: 'not a JSON object' }];
  if (!/^[a-z0-9][a-z0-9-]*$/.test(m.id || '')) err('id: lowercase letters, digits and -');
  if (!m.name) warn('no name');
  if (!parseVersion(m.version)) err('version: x.y.z');
  if (!m.engine) err('engine: the range of Scene Companion it works with, e.g. "^0.9.0"');
  else if (engine && !satisfies(engine, m.engine)) err(`needs engine ${m.engine}, this is ${engine}`);
  if (!/^[\w./-]+\.js$/.test(m.entry || '') || /\.\./.test(m.entry || '')) err('entry: a .js file inside the extension');
  if (!Array.isArray(m.behaviors) || !m.behaviors.length) err('behaviors: the names it defines');
  else for (const b of m.behaviors) if (!/^[A-Z][A-Za-z0-9]*$/.test(b)) err(`behavior name "${b}": PascalCase`);
  if (m.sandbox !== undefined && typeof m.sandbox !== 'boolean') err('sandbox: true or false');
  for (const p of m.permissions || []) if (!PERMISSIONS[p]) err(`unknown permission "${p}" (known: ${Object.keys(PERMISSIONS).join(', ')})`);
  return out;
}

// What the source reaches for. Permissions it needs (and must declare); things never allowed in an extension.
const NEEDS = { network: /\b(fetch|XMLHttpRequest|WebSocket|EventSource)\b/, storage: /\b(localStorage|sessionStorage|indexedDB)\b/, dom: /\b(document|window|navigator)\s*\./ };
const NEVER = [[/\beval\s*\(/, 'eval()'], [/\bnew\s+Function\s*\(/, 'new Function()'], [/\bimport\s*\(/, 'import() of other code'], [/^\s*import\s/m, 'import statements (use what register() is handed)'], [/\bfrom\s+['"]three['"]/, 'three (behaviors stay renderer-free)']];
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');   // comments may mention anything
export function scanSource(src) {
  const code = strip(String(src || ''));
  return { needs: Object.keys(NEEDS).filter(k => NEEDS[k].test(code)), never: NEVER.filter(([re]) => re.test(code)).map(([, what]) => what) };
}
export function checkSource(manifest, src) {
  const { needs, never } = scanSource(src), have = new Set(manifest?.permissions || []), out = [];
  for (const n of needs) if (!have.has(n)) out.push({ level: 'error', msg: `uses ${n} (${PERMISSIONS[n]}) without declaring "permissions": ["${n}"]` });
  for (const w of never) out.push({ level: 'error', msg: `uses ${w}, which an extension may not` });
  if (!/export\s+default\s+function|export\s+default\s*\(/.test(strip(src))) out.push({ level: 'error', msg: 'the entry must `export default function register({ Behavior, define })`' });
  return out;
}
