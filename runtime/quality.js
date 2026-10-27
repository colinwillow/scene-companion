// The quality gate (SPEC §7e): is a model fit for a phone and for the shared library? Pure — `info` is tools/inventory.mjs
// glbInfo() of the file; the rules are Colin's house rules (CLAUDE.md, library/): files under ~20 MB, Draco, WebP/KTX2,
// 512–2K textures, one-sided closed shells, no BLEND skins, Mixamo rigs. → [{ level: 'fail' | 'warn', msg, fix }]
export const BUDGET = { mb: 20, mbWarn: 10, tris: { character: [40000, 80000], model: [50000, 150000], animated: [40000, 80000] } };

export function qualityReport(info, { kb = 0, thumb = null, role = '' } = {}) {
  const out = [], add = (level, msg, fix) => out.push({ level, msg, fix });
  if (!info) { add('fail', 'not a readable GLB', 'Re-export as glTF binary (.glb).'); return out; }
  const mb = kb / 1024;
  if (mb > BUDGET.mb) add('fail', `${mb.toFixed(1)} MB — over the ${BUDGET.mb} MB limit`, 'Draco the meshes, WebP/KTX2 the textures, drop unused clips.');
  else if (mb > BUDGET.mbWarn) add('warn', `${mb.toFixed(1)} MB — heavy for a phone`, 'Draco + WebP usually halves it.');
  const [tw, tf] = BUDGET.tris[info.kind] || BUDGET.tris.model;
  if (info.tris > tf) add('fail', `${info.tris.toLocaleString()} triangles — over ${tf.toLocaleString()}`, 'Decimate it (Blender: Decimate modifier), or bake detail into the texture.');
  else if (info.tris > tw) add('warn', `${info.tris.toLocaleString()} triangles — a lot for a phone`, 'Decimate if it is used more than once on screen.');
  if (!info.draco && !info.meshopt && info.tris > 5000) add('warn', 'meshes not compressed', 'Export with Draco (or `gltf-transform draco`).');
  if (info.images && !info.webp && !info.ktx2 && kb > 1024) add('warn', `${info.images} PNG/JPEG texture(s)`, 'WebP (`gltf-transform webp`) for the download, KTX2 for phone memory when there are many.');
  if (info.doubleSided && info.tris > 2000) add('warn', 'materials are doubleSided', 'Tripo/generated exports set this; a closed shell wants one side (frontSide: true, or untick it in Blender).');
  if (info.blend) add('warn', 'a material uses alpha BLEND', 'A blended skin sorts against itself; use OPAQUE (or MASK for hair cards).');
  if (info.kind === 'character') {
    if (!info.mixamo) add('warn', 'rig is not Mixamo-named', 'Behaviors find bones by mixamorig_* names (rename, or rig with Mixamo/ARP).');
    if (!info.clips.length) add('warn', 'no animation clips', 'Bake idle / walk / run / jump at least (or use the motion library).');
  }
  if ((role === 'character' || role === 'prefab') && !thumb) add('warn', 'no library thumbnail', 'Run `npm run thumbs`.');
  return out;
}
export const passes = report => !report.some(r => r.level === 'fail');
