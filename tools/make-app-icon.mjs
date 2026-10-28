#!/usr/bin/env node
// A placeholder app icon (desktop/src-tauri/icons/icon.png, 512²): the editor's orange with a white play/cube mark.
// Replace it with real art any time: `npx tauri icon art.png` in desktop/ makes every size from one square image.
import { writeFileSync } from 'node:fs';
import { encodePNG } from './png.mjs';
const S = 512, px = new Uint8Array(S * S * 4);
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const i = (y * S + x) * 4, cx = x - S / 2, cy = y - S / 2;
  const r = 96, inside = Math.max(Math.abs(cx), Math.abs(cy)) < S / 2 - 8 && Math.hypot(Math.max(Math.abs(cx) - (S / 2 - 8 - r), 0), Math.max(Math.abs(cy) - (S / 2 - 8 - r), 0)) < r;
  if (!inside) continue;
  const t = y / S; px.set([255, 138 - 40 * t, 61 - 20 * t, 255], i);                          // orange, a touch darker at the bottom
  const tri = cx > -70 && cx < 110 && Math.abs(cy) < (110 - cx) * 0.62;                        // a white play triangle
  if (tri) px.set([255, 255, 255, 255], i);
}
writeFileSync('desktop/src-tauri/icons/icon.png', encodePNG(px, S, S));
console.log('wrote desktop/src-tauri/icons/icon.png');
