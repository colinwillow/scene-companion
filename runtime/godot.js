// Export a scene to Godot 4 (.tscn text). Pure: no three, no fs — tools/export-godot.mjs does the reading and writing.
// Both engines are Y-up and right-handed and glTF imports the same in each, so a transform carries straight across.
// What carries: entities as Node3D (children nested), models as instanced GLB scenes at their in-game size, primitives as
// MeshInstance3D + a StandardMaterial3D, lights, Solids as StaticBody3D + BoxShape3D, the background / ambient, a camera.
// What does not (yet): behaviors run as JS here — they ride along as node metadata (`sc_behaviors`, JSON) for a Godot
// script to read. (Godot 4 cannot read Draco meshes; the exporter decodes those files, tools/undraco.mjs.)

const D2R = Math.PI / 180;
const f = v => { const r = Math.round(v * 1e5) / 1e5; return Object.is(r, -0) ? '0' : String(r); };
const gstr = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
const color = (hex, a = 1) => { const n = parseInt(String(hex || '#ffffff').replace('#', '').padEnd(6, 'f').slice(0, 6), 16);
  return `Color(${f(((n >> 16) & 255) / 255)}, ${f(((n >> 8) & 255) / 255)}, ${f((n & 255) / 255)}, ${f(a)})`; };
export const nodeName = id => String(id).replace(/[.:@/"%]/g, '_') || 'node';

// Row-major 3×3 for three's Euler XYZ (degrees) times a scale: M = Rx · Ry · Rz · S.
export function basis(rotDeg = [0, 0, 0], scale = [1, 1, 1]) {
  const [x, y, z] = rotDeg.map(d => d * D2R), cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  const R = [[cy * cz, -cy * sz, sy], [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy], [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy]];
  const s = Array.isArray(scale) ? scale : [scale, scale, scale];
  return R.map(row => row.map((v, j) => v * s[j]));
}
export const transform3D = (B, o = [0, 0, 0]) => `Transform3D(${[...B.flat(), ...o].map(f).join(', ')})`;
// A light at `pos` aiming at `target`: Godot lights shine down their -Z.
export function lookBasis(pos, target = [0, 0, 0]) {
  let fx = target[0] - pos[0], fy = target[1] - pos[1], fz = target[2] - pos[2]; const l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
  const z = [-fx, -fy, -fz], up = Math.abs(fy) > 0.99 ? [0, 0, 1] : [0, 1, 0];
  let x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]]; const lx = Math.hypot(...x); x = x.map(v => v / lx);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
}

// entities: RESOLVED entities ({ id, position, rotation, scale, variant, light, behaviors, children }) — prefabs merged and
// each model variant already picked by the caller. measure(glbPath) → { minY, height } of the model as authored, or null.
// → { tscn, files: [every asset path the scene needs], draco: [] } (draco filled by the caller, which can read the files).
export function toTscn(entities, { name = 'Scene', settings = {}, measure = () => null } = {}) {
  const ext = [], sub = [], nodes = [], files = new Set();
  const extId = path => { let i = ext.findIndex(e => e.path === path); if (i < 0) { ext.push({ path, id: `${ext.length + 1}_res` }); i = ext.length - 1; files.add(path); } return ext[i].id; };
  const subRes = (type, props) => { const id = `${type}_${sub.length + 1}`; sub.push({ type, id, props }); return `SubResource("${id}")`; };
  const res = p => 'res://' + String(p).replace(/^\.\//, '');
  const node = (nm, type, parent, props = {}, extra = '') => nodes.push({ nm, type, parent, props, extra });
  const mat = v => subRes('StandardMaterial3D', { albedo_color: color(v.color || '#cccccc', v.opacity ?? 1), roughness: f(v.roughness ?? 0.8), metallic: f(v.metalness ?? 0),
    ...(v.emissive && v.emissive !== '#000000' ? { emission_enabled: 'true', emission: color(v.emissive) } : {}), ...(v.opacity < 1 ? { transparency: '1' } : {}) });
  let player = null;

  const walk = (e, parent) => {
    const nm = nodeName(e.id), here = parent === '.' ? nm : `${parent}/${nm}`, P = e.position || [0, 0, 0];
    if (e.id === 'player') player = P;
    if (e.light) {
      const L = e.light, t = L.type;
      if (t === 'hemisphere' || t === 'ambient') { ambient.push(L); return; }
      const type = t === 'directional' ? 'DirectionalLight3D' : t === 'spot' ? 'SpotLight3D' : 'OmniLight3D';
      const props = { transform: transform3D(t === 'point' ? basis() : lookBasis(P, t === 'spot' ? [P[0], P[1] - 1, P[2]] : [0, 0, 0]), P),
        light_color: color(L.color || '#ffffff'), light_energy: f(t === 'directional' ? (L.intensity ?? 2) / 2 : (L.intensity ?? 20) / 15),
        ...(t === 'directional' ? { shadow_enabled: L.shadows === false ? 'false' : 'true' } : {}),
        ...(t === 'point' ? { omni_range: f(L.distance ?? 10) } : {}), ...(t === 'spot' ? { spot_range: f(L.distance ?? 15), spot_angle: f(L.angle ?? 35) } : {}) };
      node(nm, type, parent, props); return;
    }
    const props = { transform: transform3D(basis(e.rotation, e.scale ?? 1), P) };
    if (e.behaviors?.length) props['metadata/sc_behaviors'] = gstr(JSON.stringify(e.behaviors));
    node(nm, 'Node3D', parent, props);
    const v = e.variant;
    if (v?.glb) {
      const m = measure(v.glb), k = v.height && m?.height ? v.height / m.height : Array.isArray(v.scale) ? 1 : (v.scale ?? 1);
      const ks = Array.isArray(v.scale) && !v.height ? v.scale : [k, k, k], off = v.offset || [0, 0, 0];
      const oy = (v.height && m ? -m.minY * k : 0) + off[1];
      nodes.push({ nm: 'model', type: null, parent: here, props: { transform: transform3D(basis([0, 0, 0], ks), [off[0], oy, off[2]]) }, instance: extId(res(v.glb)) });
    } else if (v?.sprite) {
      extId(res(v.sprite));       // copied along; a Sprite3D wiring of the sheet is left to the Godot side for now
    } else if (v?.primitive || (v && !v.light && v.size)) {
      const s = v.size || [1, 1, 1], kind = v.primitive || 'box';
      const mesh = kind === 'sphere' ? subRes('SphereMesh', { radius: f(s[0] / 2), height: f(s[0]) })
        : kind === 'cylinder' ? subRes('CylinderMesh', { top_radius: f(s[0] / 2), bottom_radius: f(s[0] / 2), height: f(s[1]) })
        : kind === 'capsule' ? subRes('CapsuleMesh', { radius: f(s[0] / 2), height: f(s[1]) })
        : kind === 'plane' ? subRes('PlaneMesh', { size: `Vector2(${f(s[0])}, ${f(s[2])})` })
        : subRes('BoxMesh', { size: `Vector3(${f(s[0])}, ${f(s[1])}, ${f(s[2])})` });   // ramps / quarter pipes come out as their box
      const lift = v.pivot === 'bottom' && kind !== 'plane' ? s[1] / 2 : 0;
      node('mesh', 'MeshInstance3D', here, { transform: transform3D(basis(), [0, lift, 0]), mesh, 'surface_material_override/0': mat(v), ...(v.castShadow === false ? { cast_shadow: '0' } : {}) });
    }
    if (v?.glb) files.add(res(v.glb));
    const solids = (e.behaviors || []).filter(b => b.type === 'Solid');
    solids.forEach((b, i) => {
      const s = b.params?.size || [1, 1, 1], cy = b.params?.anchor === 'center' ? 0 : s[1] / 2, body = `collider${solids.length > 1 ? i + 1 : ''}`;
      node(body, 'StaticBody3D', here, {});
      node('shape', 'CollisionShape3D', `${here}/${body}`, { transform: transform3D(basis(), [0, cy, 0]), shape: subRes('BoxShape3D', { size: `Vector3(${f(s[0])}, ${f(s[1])}, ${f(s[2])})` }) });
    });
    for (const c of e.children || []) walk(c, here);
  };
  const ambient = [];
  for (const e of entities) walk(e, '.');

  // the world: background colour or a procedural sky, the hemisphere/ambient light, and a camera behind the player
  const amb = ambient[0];
  const env = subRes('Environment', {
    ...(settings.sky ? { background_mode: '2', sky: subRes('Sky', { sky_material: subRes('ProceduralSkyMaterial', {}) }) } : { background_mode: '1', background_color: color(settings.background || '#202833') }),
    ambient_light_source: '2', ambient_light_color: color(amb?.color || '#ffffff'), ambient_light_energy: f(amb ? (amb.intensity ?? 1) * 0.6 : 0.4),
    tonemap_mode: '2', ...(settings.fog ? { fog_enabled: 'true', fog_light_color: color(settings.fogColor || settings.background || '#c9d6e3') } : {}) });
  node('WorldEnvironment', 'WorldEnvironment', '.', { environment: env });
  const at = player || [0, 0, 0], camPos = settings.camera2d ? [at[0], at[1] + 1.5, at[2] + 30] : [at[0], at[1] + 3.5, at[2] + 7];
  node('Camera3D', 'Camera3D', '.', { transform: transform3D(lookBasis(camPos, [at[0], at[1] + 1.3, at[2]]), camPos), current: 'true', ...(settings.camera2d ? { fov: f(settings.camera2d.fov ?? 20) } : {}) });

  const head = `[gd_scene load_steps=${ext.length + sub.length + 1} format=3]\n`;
  const extTxt = ext.map(e => `[ext_resource type="PackedScene" path="${e.path}" id="${e.id}"]`).join('\n');
  // sub resources must come before the ones that use them: Sky before Environment — they were pushed inner-first already
  const subTxt = sub.map(s => `[sub_resource type="${s.type}" id="${s.id}"]\n` + Object.entries(s.props).map(([k, v]) => `${k} = ${v}`).join('\n')).join('\n\n');
  const nodeTxt = [`[node name="${nodeName(name)}" type="Node3D"]`, ...nodes.map(n =>
    `[node name="${n.nm}"${n.type ? ` type="${n.type}"` : ''} parent="${n.parent}"${n.instance ? ` instance=ExtResource("${n.instance}")` : ''}]\n` +
    Object.entries(n.props).map(([k, v]) => `${k} = ${v}`).join('\n'))].join('\n\n');
  return { tscn: [head, extTxt, subTxt, nodeTxt].filter(Boolean).join('\n\n') + '\n', files: [...files].map(p => p.replace('res://', '')) };
}
