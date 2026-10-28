// Engine exports, the part every engine shares (pure: no three, no fs). A resolved scene becomes a flat list of nodes in
// three's space; each engine then converts the handedness / up axis / units its own way (toUnity here, Unreal next).
// Models are placed exactly as the World places them: `height` → scaled to that height with the feet on the origin,
// else `scale`, then `offset`.

const D2R = Math.PI / 180;
// three's Euler XYZ (degrees) → quaternion [x, y, z, w]
export function quatXYZ([ax = 0, ay = 0, az = 0] = []) {
  const [c1, c2, c3] = [ax, ay, az].map(a => Math.cos(a * D2R / 2)), [s1, s2, s3] = [ax, ay, az].map(a => Math.sin(a * D2R / 2));
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}
const vec3 = s => (Array.isArray(s) ? s : [s ?? 1, s ?? 1, s ?? 1]);

// → [{ name, parent (index or -1), pos, quat, scale, model?, primitive?, light?, solids[], behaviors }]
export function flatNodes(entities, { measure = () => null } = {}) {
  const out = [], files = new Set();
  const walk = (e, parent) => {
    const n = { name: e.id, parent, pos: e.position || [0, 0, 0], quat: quatXYZ(e.rotation), scale: vec3(e.scale), solids: [], behaviors: e.behaviors || [] };
    const v = e.variant;
    if (e.light) n.light = { type: e.light.type, color: e.light.color || '#ffffff', intensity: e.light.intensity ?? null, distance: e.light.distance ?? null, angle: e.light.angle ?? null, shadows: e.light.shadows };
    else if (v?.glb) {
      const m = measure(v.glb), k = v.height && m?.height ? v.height / m.height : null, off = v.offset || [0, 0, 0];
      n.model = { file: v.glb.replace(/^\.\//, ''), scale: k ? [k, k, k] : vec3(v.scale), offset: [off[0], (k ? -m.minY * k : 0) + off[1], off[2]] };
      files.add(n.model.file);
    } else if (v && (v.primitive || v.size) && !v.sprite) {
      const s = v.size || [1, 1, 1];
      n.primitive = { kind: v.primitive || 'box', size: s, color: v.color || '#cccccc', lift: v.pivot === 'bottom' && v.primitive !== 'plane' ? s[1] / 2 : 0 };
    }
    for (const b of n.behaviors) if (b.type === 'Solid') { const s = b.params?.size || [1, 1, 1]; n.solids.push({ center: [0, b.params?.anchor === 'center' ? 0 : s[1] / 2, 0], size: s }); }
    const i = out.push(n) - 1;
    for (const c of e.children || []) walk(c, i);
  };
  for (const e of entities) walk(e, -1);
  return { nodes: out, files: [...files] };
}

// Unity is left-handed, Y-up, metres. Its glTF importer (glTFast) mirrors X to get there, so a placement mirrors X the same
// way: position (-x, y, z), rotation (x, -y, -z, w). One function, so if a test in Unity says it is the other axis, it is one edit.
export const unityPos = ([x, y, z]) => [-x, y, z];
export const unityQuat = ([x, y, z, w]) => [x, -y, -z, w];
export function toUnity({ nodes }) {
  return nodes.map(n => ({ ...n, pos: unityPos(n.pos), quat: unityQuat(n.quat),
    ...(n.model ? { model: { ...n.model, offset: unityPos(n.model.offset) } } : {}),
    solids: n.solids.map(s => ({ center: unityPos(s.center), size: s.size })),
    behaviors: JSON.stringify(n.behaviors) }));
}
