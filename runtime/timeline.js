// Animation timeline helpers (pure): frame rate from a clip's keys, frame numbers, and the camera pose for a
// front / side / top look at a character. The editor's ▶ Timeline panel uses these.

// fps from any track's key spacing (Colin's exports are 24, the motion library 30). Falls back to 30.
export function clipFps(tracks) {
  for (const t of tracks || []) {
    const times = t.times; if (!times || times.length < 3) continue;
    const dt = times[2] - times[1];
    if (dt > 1e-4) return Math.round(1 / dt);
  }
  return 30;
}
export const frameAt = (t, fps) => Math.round(t * fps);
export const frameCount = (duration, fps) => Math.max(1, Math.round(duration * fps));
export const readout = (t, duration, fps) => `${t.toFixed(2)} s · frame ${frameAt(t, fps)} / ${frameCount(duration, fps)} (${fps} fps)`;

// center [x,y,z] of the character, yaw (its rotation.y — characters face +Z in their own frame), size (its height, m),
// view 'front' | 'side' | 'top' → camera position [x,y,z] to look at center from.
export function viewPose(center, yaw, size, view) {
  const d = Math.max(1.5, size * 2.2), fx = Math.sin(yaw), fz = Math.cos(yaw);
  if (view === 'top') return [center[0] + fx * 0.01, center[1] + d * 1.2, center[2] + fz * 0.01];
  if (view === 'side') return [center[0] + fz * d, center[1] + size * 0.1, center[2] - fx * d];   // its left side… (+X is his left)
  return [center[0] + fx * d, center[1] + size * 0.1, center[2] + fz * d];                       // front: where it faces
}
