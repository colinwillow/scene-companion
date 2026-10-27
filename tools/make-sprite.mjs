#!/usr/bin/env node
// Draws the test sprite sheet (assets/sprites/blob/blob.png): a little green alien, 32 px frames on a 4 × 2 grid —
//   0-1 idle (a bob), 2-5 run (legs swapping, a lean), 6 jump (stretched, legs tucked), 7 fall (squashed, arms up).
// A stand-in so 2D works before real art; node's own zlib writes the PNG.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const F = 32, COLS = 4, ROWS = 2, W = F * COLS, H = F * ROWS, px = new Uint8Array(W * H * 4);
const C = { body: [94, 214, 120], dark: [40, 120, 70], eye: [255, 255, 255], pupil: [20, 24, 40], tip: [255, 210, 80] };
function dot(fx, fy, x, y, c) {
  x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= F || y >= F) return;
  const i = ((fy * F + y) * W + fx * F + x) * 4; px.set([...c, 255], i);
}
function ellipse(fx, fy, cx, cy, rx, ry, c) { for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) if ((x / rx) ** 2 + (y / ry) ** 2 <= 1) dot(fx, fy, cx + x, cy + y, c); }
function line(fx, fy, x0, y0, x1, y1, c) { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2 || 1; for (let i = 0; i <= n; i++) dot(fx, fy, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, c); }
// one frame: bob (px up), body stretch, lean (px right at the top), leg phase or pose
function frame(n, { bob = 0, sx = 1, sy = 1, lean = 0, legs = [0, 0], arms = 0 }) {
  const fx = n % COLS, fy = Math.floor(n / COLS), cy = 18 - bob, rx = Math.round(8 * sx), ry = Math.round(8 * sy);
  for (const [k, d] of [[-1, legs[0]], [1, legs[1]]]) line(fx, fy, 16 + k * 3, cy + ry - 2, 16 + k * 3 + d, 30 - Math.max(0, -d) * 0.3 - (legs.tuck || 0), C.dark);
  ellipse(fx, fy, 16 + lean / 2, cy, rx, ry, C.body);
  if (arms) for (const k of [-1, 1]) line(fx, fy, 16 + k * rx, cy, 16 + k * (rx + 3), cy - arms, C.dark);
  line(fx, fy, 16 + lean, cy - ry, 18 + lean, cy - ry - 5, C.dark); dot(fx, fy, 18 + lean, cy - ry - 6, C.tip); dot(fx, fy, 19 + lean, cy - ry - 6, C.tip);
  ellipse(fx, fy, 19 + lean, cy - 2, 2, 2, C.eye); dot(fx, fy, 20 + lean, cy - 2, C.pupil);   // facing right
}
frame(0, {}); frame(1, { bob: 1, sy: 1.05 });
frame(2, { lean: 2, legs: [-4, 3] }); frame(3, { lean: 2, bob: 1, legs: [0, 0] }); frame(4, { lean: 2, legs: [3, -4] }); frame(5, { lean: 2, bob: 1, legs: [0, 0] });
frame(6, { bob: 3, sx: 0.85, sy: 1.15, legs: Object.assign([-1, 1], { tuck: 3 }), arms: 4 }); frame(7, { sx: 1.15, sy: 0.9, legs: [-3, 3], arms: 6 });

const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const raw = Buffer.alloc((W * 4 + 1) * H); for (let y = 0; y < H; y++) Buffer.from(px.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr.set([8, 6, 0, 0, 0], 8);
const out = process.argv[2] || 'assets/sprites/blob/blob.png';
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`wrote ${out} (${W}×${H}, ${COLS}×${ROWS} frames of ${F} px)`);
