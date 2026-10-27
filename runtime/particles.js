// A pooled particle system for game pages: two Points draws (additive and soft), every particle a slot in a ring buffer, sizes
// in world metres (gl_PointSize from the framebuffer height and the lens). Behaviors never touch it — they emit `fx` requests
// (Emitter); the page calls particles.burst(req) and particles.update(dt, camera).
import * as THREE from 'three';
import { FX } from './fxpresets.js';

const VERT = `attribute float aSize; attribute vec4 aColor; uniform float uPx; varying vec4 vColor;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vColor = aColor; gl_PointSize = aSize * uPx / max(0.001, -mv.z); gl_Position = projectionMatrix * mv; }`;
const FRAG = `varying vec4 vColor; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0; if (r > 1.0) discard; gl_FragColor = vec4(vColor.rgb, vColor.a * (1.0 - r) * (1.0 - r)); }`;

function pool(n, additive) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
  const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uPx: { value: 400 } }, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 10; pts.userData.noLook = true;
  return { pts, n, next: 0, p: [] };
}

export function createParticles(scene, { max = 1500 } = {}) {
  const pools = { add: pool(max, true), soft: pool(max, false) };
  scene.add(pools.add.pts, pools.soft.pts);
  const rnd = (a, b) => a + Math.random() * (b - a), col = new THREE.Color(), col2 = new THREE.Color(), defs = { ...FX };
  return {
    define(name, def) { defs[name] = def; },   // a library preset (assets/fx/<name>.fx.json) or one being edited
    async loadLibrary(url = './assets/fx/index.json') { try { const list = await (await fetch(url)).json(); for (const n of list) defs[n] = await (await fetch(`./assets/fx/${n}.fx.json`)).json(); } catch {} },
    // { preset, at: [x, y, z], dir: [x, y, z] (optional bias), count, scale, color }
    burst({ preset = 'sparks', at, dir = null, count, scale = 1, color = null } = {}) {   // preset: a name, or the definition itself
      if (typeof preset === 'object') { const F = preset; preset = '__inline'; defs.__inline = F; }
      const F = defs[preset]; if (!F || !at) return 0;
      const P = F.add ? pools.add : pools.soft, n = Math.round((count ?? F.count) * 1);
      col.set(color || F.color[0]); col2.set(F.color[1] || F.color[0]);
      for (let i = 0; i < n; i++) {
        const k = P.next; P.next = (P.next + 1) % P.n;
        const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, s = rnd(...F.speed) * scale, h = Math.sqrt(1 - u * u) * F.spread;
        const v = [Math.cos(a) * h * s, (u * F.spread * 0.5 + F.up / Math.max(1, F.speed[1])) * s, Math.sin(a) * h * s];
        if (dir) { v[0] += dir[0] * s; v[1] += dir[1] * s; v[2] += dir[2] * s; }
        const t = Math.random();
        P.p[k] = { x: at[0], y: at[1], z: at[2], v, age: 0, life: rnd(...F.life), size: rnd(...F.size) * scale, F,
          r: col.r + (col2.r - col.r) * t, g: col.g + (col2.g - col.g) * t, b: col.b + (col2.b - col.b) * t };
      }
      return n;
    },
    update(dt, camera, renderer) {
      const h = renderer?.domElement?.height || 800, px = h / (2 * Math.tan((camera.fov || 55) * Math.PI / 360));
      for (const P of Object.values(pools)) {
        const pos = P.pts.geometry.attributes.position, sz = P.pts.geometry.attributes.aSize, c = P.pts.geometry.attributes.aColor;
        P.pts.material.uniforms.uPx.value = px;
        for (let k = 0; k < P.n; k++) {
          const q = P.p[k];
          if (!q || q.age >= q.life) { sz.array[k] = 0; continue; }
          q.age += dt; const F = q.F, d = Math.exp(-F.drag * dt);
          q.v[0] *= d; q.v[2] *= d; q.v[1] = q.v[1] * d - F.grav * dt;
          q.x += q.v[0] * dt; q.y += q.v[1] * dt; q.z += q.v[2] * dt;
          const t = Math.min(1, q.age / q.life);
          pos.array[k * 3] = q.x; pos.array[k * 3 + 1] = q.y; pos.array[k * 3 + 2] = q.z;
          sz.array[k] = q.size * (1 + (F.grow - 1) * t);
          c.array[k * 4] = q.r; c.array[k * 4 + 1] = q.g; c.array[k * 4 + 2] = q.b; c.array[k * 4 + 3] = (F.alpha ?? 1) * (1 - t);
        }
        pos.needsUpdate = sz.needsUpdate = c.needsUpdate = true;
      }
    },
    live() { let n = 0; for (const P of Object.values(pools)) for (const q of P.p) if (q && q.age < q.life) n++; return n; },
    dispose() { for (const P of Object.values(pools)) { P.pts.removeFromParent(); P.pts.geometry.dispose(); P.pts.material.dispose(); } },
  };
}
