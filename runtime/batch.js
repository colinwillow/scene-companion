// Merge many meshes into one per material (weirdport's kitBatch): a kit building is hundreds of small meshes on a handful of
// materials, and every one is a draw call (twice, with shadows). Pure JS — every three class comes from the meshes' own
// constructors. Positions and normals are baked into `root`'s local space; each source mesh keeps its vertex RANGE in the merged
// buffer, so a breakable wall can still be collapsed chunk by chunk after it is batched.
//
//   const batches = mergeMeshes(root, meshes)  → [{ mesh, ranges: Map(sourceMesh → { start, count }) }]
//   (the merged meshes are made but not added; the caller adds them to `root` and hides the sources)
export function mergeMeshes(root, meshes) {
  root.updateMatrixWorld?.(true);
  const inv = root.matrixWorld.clone().invert(), groups = new Map();
  for (const m of meshes) {
    const g = m.geometry, names = Object.keys(g.attributes).sort();
    if (!g.attributes.position || Array.isArray(m.material)) continue;
    const key = `${m.material.uuid}|${names.map(n => `${n}${g.attributes[n].itemSize}`).join(',')}`;
    (groups.get(key) || groups.set(key, { material: m.material, names, list: [] }).get(key)).list.push(m);
  }
  const out = [];
  for (const { material, names, list } of groups.values()) {
    const sample = list[0].geometry, BA = sample.attributes.position.constructor;
    let nv = 0, ni = 0;
    for (const m of list) { nv += m.geometry.attributes.position.count; ni += m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count; }
    const arrays = Object.fromEntries(names.map(n => [n, new Float32Array(nv * sample.attributes[n].itemSize)])), index = new Uint32Array(ni), ranges = new Map();
    let v0 = 0, i0 = 0;
    const V = list[0].position.constructor;
    for (const m of list) {
      const g = m.geometry, n = g.attributes.position.count, M = inv.clone().multiply(m.matrixWorld), N = M.clone(), e = N.elements;
      e[12] = e[13] = e[14] = 0;                       // directions: no translation (uniform scale, so no inverse-transpose)
      const p = new V();
      for (const name of names) {
        const a = g.attributes[name], k = a.itemSize, dst = arrays[name];
        for (let i = 0; i < n; i++) {
          if (name === 'position') { p.set(a.getX(i), a.getY(i), a.getZ(i)).applyMatrix4(M); dst[(v0 + i) * 3] = p.x; dst[(v0 + i) * 3 + 1] = p.y; dst[(v0 + i) * 3 + 2] = p.z; }
          else if (name === 'normal') { p.set(a.getX(i), a.getY(i), a.getZ(i)).applyMatrix4(N).normalize(); dst[(v0 + i) * 3] = p.x; dst[(v0 + i) * 3 + 1] = p.y; dst[(v0 + i) * 3 + 2] = p.z; }
          else for (let c = 0; c < k; c++) dst[(v0 + i) * k + c] = c === 0 ? a.getX(i) : c === 1 ? a.getY(i) : c === 2 ? a.getZ(i) : a.getW(i);
        }
      }
      if (g.index) for (let t = 0; t < g.index.count; t++) index[i0 + t] = g.index.getX(t) + v0;
      else for (let t = 0; t < n; t++) index[i0 + t] = t + v0;
      ranges.set(m, { start: v0, count: n });
      v0 += n; i0 += g.index ? g.index.count : n;
    }
    const geo = new sample.constructor();
    for (const name of names) geo.setAttribute(name, new BA(arrays[name], sample.attributes[name].itemSize));
    geo.setIndex(new BA(index, 1));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    const mesh = new list[0].constructor(geo, material);
    mesh.castShadow = list.some(m => m.castShadow); mesh.receiveShadow = list.some(m => m.receiveShadow);
    mesh.name = `batch:${material.name || 'material'}`; mesh.userData.batch = true;
    out.push({ mesh, ranges });
  }
  return out;
}
