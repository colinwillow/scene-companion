#!/usr/bin/env node
// Draws the stand-in tile sheet (assets/sprites/tiles/tiles.png): four 16 px tiles in a row —
//   0 grass over dirt, 1 dirt, 2 brick, 3 stone. Pixel noise from a hash, so a re-run makes the same file.
import { writeFileSync } from 'node:fs';
import { encodePNG } from './png.mjs';

const T = 16, N = 4, W = T * N, H = T, px = new Uint8Array(W * H * 4);
const hash = (x, y, k) => { let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const put = (t, x, y, [r, g, b], j = 0) => { const n = 1 + (hash(x, y, t) - 0.5) * j; px.set([r * n, g * n, b * n, 255].map(v => Math.max(0, Math.min(255, v | 0))), (y * W + t * T + x) * 4); };
const DIRT = [150, 104, 64], GRASS = [92, 186, 84], BRICK = [178, 86, 60], MORTAR = [214, 196, 170], STONE = [128, 134, 146];
for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
  const edge = 3 + Math.round(hash(x, 0, 9) * 2);                                   // grass hangs a ragged 3-5 px
  put(0, x, y, y < edge ? GRASS : DIRT, 0.25);
  put(1, x, y, DIRT, 0.25);
  const row = Math.floor(y / 4), off = row % 2 ? 4 : 0;                              // bricks 8 × 4, every other row offset
  put(2, x, y, y % 4 === 3 || (x + off) % 8 === 7 ? MORTAR : BRICK, 0.15);
  put(3, x, y, x === 0 || y === 0 || (x === 8 && y > 7) || y === 8 ? STONE.map(v => v * 0.7) : STONE, 0.2);
}
const out = process.argv[2] || 'assets/sprites/tiles/tiles.png';
writeFileSync(out, encodePNG(px, W, H));
console.log(`wrote ${out} (${N} tiles of ${T} px)`);
