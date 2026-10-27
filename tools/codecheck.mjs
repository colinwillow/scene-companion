// Finds authored placement hardcoded in code (the scene file owns placement).
// Pure string scanning, no three, so the validator and tests can share it.

// Drop // and /* */ comments but keep strings, so commented-out code doesn't count.
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
            .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

const NUM = String.raw`-?\d+(\.\d+)?`;
const RULES = [
  { re: new RegExp(String.raw`\.(position|scale)\.set\(\s*${NUM}`), why: 'set() with literal numbers' },
  { re: new RegExp(String.raw`\.(position|scale)\.[xyz]\s*=(?!=)\s*${NUM}\s*[;,)\n]`), why: 'assigned a literal number' },
  { re: new RegExp(String.raw`\.(position|scale)\.fromArray\(\s*\[\s*${NUM}`), why: 'fromArray() with literal numbers' },
  { re: new RegExp(String.raw`\.(position|scale)\.copy\(\s*new\s+(THREE\.)?Vector3\(\s*${NUM}`), why: 'copied from a literal Vector3' },
];

// Returns [{ line, text, why }] for every suspicious line. Lines about the camera are allowed
// (the camera isn't an authored entity).
export function findHardcoded(src) {
  const out = [];
  stripComments(src).split('\n').forEach((text, i) => {
    if (/\bcam(era)?\b|\bcamPos\b/i.test(text)) return;
    for (const r of RULES) if (r.re.test(text)) { out.push({ line: i + 1, text: text.trim(), why: r.why }); break; }
  });
  return out;
}

// Game code that creates meshes is probably placing objects that belong in the scene file.
// A debug/UI overlay that isn't a scene object can opt out with a `// sc:overlay` comment on that line.
export function findSpawnedMeshes(src) {
  const out = [], raw = src.split('\n');
  stripComments(src).split('\n').forEach((text, i) => {
    if (/sc:overlay/.test(raw[i] || '')) return;
    if (/new\s+(THREE\.)?(Mesh|SkinnedMesh|InstancedMesh|Sprite)\s*\(/.test(text)) out.push({ line: i + 1, text: text.trim() });
  });
  return out;
}
