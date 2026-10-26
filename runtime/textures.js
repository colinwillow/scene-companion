// Procedural textures, generated on a canvas so scenes look good with zero downloads.
// Asset variants can say  "texture": "grass" | "dirt" | "stone" | "sand"  and "repeat": 12.
import * as THREE from 'three';

const PALETTES = {
  grass: ['#3f6b35', '#4f7d3c', '#5f8f45', '#6d9a4c', '#3a5f30'],
  dirt:  ['#6b4f36', '#7a5b3f', '#5c4330', '#86684a', '#4f3a29'],
  stone: ['#6f7378', '#7e8287', '#5f6368', '#8c9095', '#55595d'],
  sand:  ['#cdb88f', '#d8c59c', '#c2ab80', '#e0cfa8', '#b89f74'],
};

// Small deterministic value noise, layered into octaves.
function makeNoise(seed = 1) {
  const p = new Uint8Array(512);
  let s = seed;
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];
  const fade = t => t * t * (3 - 2 * t);
  const hash = (x, y) => p[p[x & 255] + (y & 255)] / 255;
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = fade(x - xi), yf = fade(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

const cache = new Map();

export function proceduralTexture(kind, repeat = 8, size = 512) {
  const key = `${kind}:${repeat}:${size}`;
  if (cache.has(key)) return cache.get(key);
  const pal = (PALETTES[kind] || PALETTES.grass).map(c => new THREE.Color(c));
  const noise = makeNoise(kind.length * 977);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const col = new THREE.Color();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // Tileable: sample noise on a torus-ish wrap by blending edges.
    const u = x / size, v = y / size;
    let n = 0, amp = 0.55, freq = 4;
    for (let o = 0; o < 5; o++) {
      const s = (fx, fy) => noise(fx * freq, fy * freq);
      const wrapped = s(u, v) * (1 - u) * (1 - v) + s(u - 1, v) * u * (1 - v) + s(u, v - 1) * (1 - u) * v + s(u - 1, v - 1) * u * v;
      n += wrapped * amp; amp *= 0.5; freq *= 2;
    }
    const t = Math.min(0.999, Math.max(0, n)) * (pal.length - 1);
    const i = Math.floor(t);
    col.copy(pal[i]).lerp(pal[i + 1], t - i);
    const k = (y * size + x) * 4;
    img.data[k] = col.r * 255; img.data[k + 1] = col.g * 255; img.data[k + 2] = col.b * 255; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  cache.set(key, tex);
  return tex;
}
