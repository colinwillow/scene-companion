// Ribbon trails for game pages (Roller Girl's TRAIL): every trail in ONE mesh — a camera-facing ribbon through the last `life`
// seconds of a point, widest at the head and tapering to nothing, fading out. Behaviors emit `trail` samples each frame
// ({ key, at, width, life, color, strength }); the page calls trails.add(sample) and trails.update(camera).
import * as THREE from 'three';

export function createTrails(scene, { maxQuads = 3000 } = {}) {
  const pos = new Float32Array(maxQuads * 6 * 3), col = new Float32Array(maxQuads * 6 * 4);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 11; mesh.userData.noLook = true; scene.add(mesh);
  const lines = new Map(), c = new THREE.Color();
  let clock = 0;
  return {
    add({ key, at, width = 0.12, life = 0.22, color = '#e8fbff', strength = 1 }) {
      let L = lines.get(key); if (!L) lines.set(key, L = { s: [] });
      L.width = width; L.life = life; L.color = color;
      L.s.push({ p: at, t: clock, k: Math.max(0, Math.min(1, strength)) });
    },
    update(dt, camera) {
      clock += dt; let q = 0;
      const eye = camera.position;
      for (const [key, L] of lines) {
        L.s = L.s.filter(s => clock - s.t < L.life);
        if (!L.s.length) { lines.delete(key); continue; }
        c.set(L.color);
        for (let i = 1; i < L.s.length && q < maxQuads; i++) {
          const a = L.s[i - 1], b = L.s[i];
          const side = (s, n) => {            // half-width vector across the ribbon, facing the camera
            const dx = n.p[0] - s.p[0], dy = n.p[1] - s.p[1], dz = n.p[2] - s.p[2], ex = eye.x - s.p[0], ey = eye.y - s.p[1], ez = eye.z - s.p[2];
            let x = dy * ez - dz * ey, y = dz * ex - dx * ez, z = dx * ey - dy * ex; const l = Math.hypot(x, y, z) || 1;
            const w = L.width * 0.5 * s.k * (1 - (clock - s.t) / L.life); return [x / l * w, y / l * w, z / l * w];
          };
          const sa = side(a, b), sb = side(b, b === L.s.at(-1) ? { p: [b.p[0] * 2 - a.p[0], b.p[1] * 2 - a.p[1], b.p[2] * 2 - a.p[2]] } : L.s[i + 1]);
          const fa = (1 - (clock - a.t) / L.life) * a.k, fb = (1 - (clock - b.t) / L.life) * b.k;
          const v = [[a, sa, 1, fa], [a, sa, -1, fa], [b, sb, 1, fb], [b, sb, 1, fb], [a, sa, -1, fa], [b, sb, -1, fb]];
          let k = q * 6;
          for (const [s, sd, sg, f] of v) { pos.set([s.p[0] + sd[0] * sg, s.p[1] + sd[1] * sg, s.p[2] + sd[2] * sg], k * 3); col.set([c.r, c.g, c.b, f * 0.85], k * 4); k++; }
          q++;
        }
      }
      g.setDrawRange(0, q * 6); g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = true;
      return q;
    },
    live() { return lines.size; },
    dispose() { mesh.removeFromParent(); g.dispose(); m.dispose(); },
  };
}
