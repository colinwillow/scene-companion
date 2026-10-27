// Sprites and sprite sheets: pure helpers (no three, no DOM). A sheet is a grid of equal frames, read left to right,
// top to bottom; frame 0 is the top-left cell. An asset variant
//   { sprite: './assets/sprites/blob/blob.png', frames: [cols, rows], size: [w, h] metres, pixel: true,
//     clips: { idle: [0, 1, 3], run: [2, 5, 10], jump: [6, 6, 1], fall: { from: 7, to: 7, fps: 1 } } }
// draws a camera-facing quad standing on the entity's origin; SpriteAnimator plays the clips by role.

// A clip as [from, to, fps] or { from, to, fps, loop }: → { from, to, fps, loop } with from ≤ to and fps > 0.
export function normClip(c) {
  const [from, to, fps, loop] = Array.isArray(c) ? c : [c?.from, c?.to, c?.fps, c?.loop];
  const a = Math.max(0, Math.floor(+from || 0)), b = Math.max(a, Math.floor(to ?? a));
  return { from: a, to: b, fps: +fps > 0 ? +fps : 8, loop: loop !== false };
}
export function normClips(clips = {}) {
  const out = {};
  for (const [k, c] of Object.entries(clips)) out[k] = normClip(c);
  return out;
}

// The frame a clip shows `t` seconds in: loops, or holds its last frame.
export function clipFrame(clip, t) {
  const n = clip.to - clip.from + 1, i = Math.floor(Math.max(0, t) * clip.fps);
  return clip.from + (clip.loop ? i % n : Math.min(i, n - 1));
}

// Texture offset / repeat for frame i of a cols × rows sheet (UV v runs bottom to top, so row 0 is v = 1 - 1/rows).
export function frameUV(i, cols, rows) {
  const c = i % cols, r = Math.floor(i / cols) % rows;
  return { offset: [c / cols, 1 - (r + 1) / rows], repeat: [1 / cols, 1 / rows] };
}

// Slice a sheet: given its pixel size and EITHER a frame size in pixels or a grid, → { cols, rows, frameW, frameH, count }.
export function sliceSheet(w, h, { frame, grid } = {}) {
  const [cols, rows] = grid || [Math.max(1, Math.floor(w / frame[0])), Math.max(1, Math.floor(h / (frame[1] ?? frame[0])))];
  return { cols, rows, frameW: w / cols, frameH: h / rows, count: cols * rows };
}

// Which role a platformer body is in: air beats ground (jump while rising, fall coming down), then run if it moves.
export function spriteRole({ grounded, vy = 0, speed = 0 }, clips) {
  const has = k => clips[k] && k;
  if (!grounded) return (vy > 0 ? has('jump') : has('fall')) || has('jump') || has('fall') || has('idle') || Object.keys(clips)[0];
  return (speed > 0.1 && has('run')) || has('idle') || Object.keys(clips)[0];
}
