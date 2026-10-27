// An object's heading about +Y, read correctly whatever form its Euler is in. Once a rotation has been through a quaternion
// (the fixed-step interpolation slerps every moving entity), three reads a yaw past 90° back as (π, π − yaw, π) — so
// `rotation.y` alone is the mirror image of the heading. Pure (no three).
export function yawOf(o) {
  const r = o?.rotation; if (!r) return 0;
  return Math.abs(r.x) > Math.PI / 2 && Math.abs(r.z) > Math.PI / 2 ? Math.PI - r.y : r.y;
}
