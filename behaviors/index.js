// Every behavior is registered here. Keep behaviors free of `three` imports.
import { registerBehavior } from '../runtime/registry.js';
import { WHEN, compare } from '../runtime/reactions.js';
import { Behavior } from '../runtime/Behavior.js';
import { roleClip } from '../runtime/character.js';
import { topAt, walkShape } from '../runtime/collide.js';
import { mergeMeshes } from '../runtime/batch.js';
import { NavGrid } from '../runtime/nav.js';
import { placeCollider } from '../runtime/colliders.js';
import { ik2 } from '../runtime/ik.js';
import { yawOf } from '../runtime/yaw.js';
import { clipFrame, spriteRole } from '../runtime/sprites.js';
import { TriGrid, meshTriangles } from '../runtime/trimesh.js';
export { yawOf };
export { topAt };

// Face a heading. Writing rotation.y alone is wrong once the rotation has been through a quaternion (interpolation,
// slerp): a yaw past 90° reads back as (π, π − yaw, π), and setting only .y under that x/z turns him to π − yaw (mirrored).
// So a flipped Euler is normalised first; a small authored tilt is kept.
export function setYaw(o, yaw, roll, pitch) {
  const r = o.rotation;
  if (Math.abs(r.x) > Math.PI / 2 || Math.abs(r.z) > Math.PI / 2) { r.x = 0; r.z = 0; }
  r.y = yaw;
  if (roll !== undefined) r.z = roll;
  if (pitch !== undefined) r.x = pitch;
}

export class Spin extends Behavior {
  static schema = {
    speed: { type: 'number', default: 1, min: -10, max: 10, step: 0.1 },  // radians/sec around Y
  };
  update(dt) { const o = this.entity.object3d; setYaw(o, yawOf(o) + this.params.speed * dt); }
}

export class Bob extends Behavior {
  static schema = {
    height: { type: 'number', default: 0.3, min: 0, max: 3, step: 0.05 },
    speed:  { type: 'number', default: 2,   min: 0, max: 10, step: 0.1 },
  };
  start() { this.baseY = this.entity.object3d.position.y; }
  onMoved() { this.baseY = this.entity.object3d.position.y; }
  update(dt, t) {
    this.entity.object3d.position.y = this.baseY + Math.sin(t * this.params.speed) * this.params.height;
  }
}

export class Patrol extends Behavior {
  static schema = {
    pointA: { type: 'vec3', default: [-3, 0, 0] },
    pointB: { type: 'vec3', default: [3, 0, 0] },
    speed:  { type: 'number', default: 2, min: 0, max: 10, step: 0.1 },  // metres/sec
    faceDirection: { type: 'boolean', default: true },
  };
  start() { this.toB = true; }
  update(dt) {
    if (this.entity.dormant) return;
    const p = this.entity.object3d.position;
    const target = this.toB ? this.params.pointB : this.params.pointA;
    const dx = target[0] - p.x, dz = target[2] - p.z;
    const dist = Math.hypot(dx, dz);
    const step = this.params.speed * dt;
    if (dist <= step) { this.toB = !this.toB; return; }
    p.x += (dx / dist) * step;
    p.z += (dz / dist) * step;
    if (this.params.faceDirection) setYaw(this.entity.object3d, Math.atan2(dx, dz));
  }
}

export class Pickup extends Behavior {
  static schema = {
    radius: { type: 'number', default: 1.2, min: 0.1, max: 5, step: 0.1 },
    collectorId: { type: 'string', default: 'player' },
    points: { type: 'number', default: 1, min: 0, max: 100, step: 1 },
  };
  update() {
    const collector = this.world.getEntity(this.params.collectorId);
    if (!collector || this.collected) return;
    const a = this.entity.object3d.position, b = collector.object3d.position;
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < this.params.radius) {
      this.collected = true;
      this.entity.object3d.visible = false;
      this.world.emit('pickup', this.entity.id);
      this.world.emit('score', this.params.points);
    }
  }
}

export class Health extends Behavior {
  static schema = {
    max: { type: 'number', default: 100, min: 1, max: 1000, step: 1 },
  };
  start() { this.current = this.params.max; }   // runtime state, not authored
}

// Moves toward points sent with world.emit('moveTo', [x, y, z]) — e.g. tap-to-move.
export class MoveTo extends Behavior {
  static schema = {
    speed: { type: 'number', default: 5, min: 0, max: 20, step: 0.5 },
  };
  start() { this.world.on('moveTo', p => (this.target = p)); }
  update(dt) {
    if (!this.target) return;
    const p = this.entity.object3d.position;
    const dx = this.target[0] - p.x, dz = this.target[2] - p.z;
    const dist = Math.hypot(dx, dz), step = this.params.speed * dt;
    if (dist <= step) { p.x = this.target[0]; p.z = this.target[2]; this.target = null; return; }
    p.x += (dx / dist) * step; p.z += (dz / dist) * step;
    setYaw(this.entity.object3d, Math.atan2(dx, dz));
  }
}

// Picks idle / walk / run clips from how fast the entity is actually moving.
// With a PlayerController on the same entity it also plays jump / fall clips while airborne.
export class Animator extends Behavior {
  static schema = {
    // Clip params: '' = the character's role clip (character.json), a name = override for this entity, 'none' = no clip
    idleClip: { type: 'string', default: '' },
    walkClip: { type: 'string', default: '' },
    runClip:  { type: 'string', default: '' },
    runSpeed: { type: 'number', default: 4, min: 0.5, max: 15, step: 0.5 },  // m/s where walk becomes run
    jumpClip: { type: 'string', default: '' },       // played once on take-off
    jumpRate: { type: 'number', default: 1, min: 0.25, max: 3, step: 0.05 },  // playback speed of jumpClip (fit a flip to the air time)
    jumpHold: { type: 'number', default: 0, min: 0, max: 2, step: 0.05 },     // s the jump clip plays before fallClip may cut in (0 = at the apex)
    doubleJumpClip: { type: 'string', default: '' }, // played once on an air jump (PlayerController airJumps; none set = replay the jump clip)
    doubleJumpRate: { type: 'number', default: 1, min: 0.25, max: 3, step: 0.05 },
    doubleJumpHold: { type: 'number', default: 0, min: 0, max: 2, step: 0.05 }, // like jumpHold, for the air jump
    fallClip: { type: 'string', default: '' },       // looped when falling a while (none set = hold the jump pose)
    airDelay: { type: 'number', default: 0.12, min: 0, max: 1, step: 0.02 },  // s off the ground before air clips (skips tiny drops)
    landClip: { type: 'string', default: '' },       // played once on touch-down (none set = straight back to idle/walk/run)
    landTime: { type: 'number', default: 0.3, min: 0, max: 2, step: 0.05 },   // s the land clip holds before locomotion resumes
    hardLandClip:  { type: 'string', default: '' },  // for big falls (none set = the land clip)
    hardLandSpeed: { type: 'number', default: 12, min: 1, max: 40, step: 0.5 }, // m/s downward at impact that counts as hard
    hardLandTime:  { type: 'number', default: 0.7, min: 0, max: 3, step: 0.05 },
    hardLandMove:  { type: 'number', default: 0.2, min: 0, max: 1, step: 0.05 },  // move speed × this during a hard landing (jump still cancels it)
  };
  start() { const p = this.entity.object3d.position; this.last = [p.x, p.z]; this.air = 0; this.fallV = 0; this.landing = 0; }
  update(dt) {
    const anim = this.entity.anim; if (!anim || dt <= 0 || this.entity.defeated) return;
    const p = this.entity.object3d.position, R = this.entity.roles, A = this.params;
    const P = { ...A, idleClip: roleClip(A.idleClip, 'idle', R), walkClip: roleClip(A.walkClip, 'walk', R), runClip: roleClip(A.runClip, 'run', R),
      jumpClip: roleClip(A.jumpClip, 'jump', R), doubleJumpClip: roleClip(A.doubleJumpClip, 'doubleJump', R), fallClip: roleClip(A.fallClip, 'fall', R),
      landClip: roleClip(A.landClip, 'land', R), hardLandClip: roleClip(A.hardLandClip, 'hardLand', R) };
    const speed = Math.hypot(p.x - this.last[0], p.z - this.last[1]) / dt;
    this.last = [p.x, p.z];
    const pc = this.entity.behaviors.find(b => b instanceof PlayerController);
    if (this.entity.animHold > 0) { this.entity.animHold -= dt; if (pc && !pc.grounded) { this.airborne = true; this.fallV = Math.max(0, -pc.vy); } return; }
    if (this.entity.mover) {                                // a wall run (…) owns the body: its clip, then the air clips when it lets go
      const mc = this.entity.mover.clip && roleClip('', this.entity.mover.clip, R) || this.entity.mover.clip;
      if (mc) anim.play(mc, { fade: 0.1 });
      this.airborne = true; this.air = P.airDelay; this.landing = 0; this.sinceJump = 1e9; this.double = false;
      return;
    }
    if (pc && !pc.grounded) {
      const rising = pc.vy > 0;
      this.air += dt; this.landing = 0; this.entity.moveScale = 1; this.sinceJump = rising && !(this.prevVy > 0) ? 0 : (this.sinceJump ?? 1e9) + dt;   // take-off or a stomp bounce
      this.prevVy = pc.vy;
      const airJump = pc.airJumpCount > 0 && pc.jumpCount !== this.seenJump;   // a new jump that happened in the air
      this.seenJump = pc.jumpCount;
      if (airJump) { this.sinceJump = 0; this.double = true; this.restart = true; }
      if (rising || this.airborne || this.air >= P.airDelay) {
        this.airborne = true; this.fallV = Math.max(0, -pc.vy);
        const clip = this.double ? P.doubleJumpClip || P.jumpClip : P.jumpClip;
        const hold = this.double ? P.doubleJumpHold : P.jumpHold, rate = this.double ? P.doubleJumpRate : P.jumpRate;
        if (!rising && P.fallClip && this.sinceJump >= hold) anim.play(P.fallClip, { fade: 0.25 });
        else if (clip) anim.play(clip, { once: true, fade: 0.1, speed: rate, restart: this.restart });
        this.restart = false;
        return;
      }
    } else {
      if (this.airborne) {                                   // just touched down after a real jump/fall
        const hard = this.fallV >= P.hardLandSpeed;
        const clip = (hard && P.hardLandClip) || P.landClip;
        if (clip) { anim.play(clip, { once: true, fade: 0.08 }); this.landing = hard ? P.hardLandTime : P.landTime; this.hardLanding = hard; }
        if (hard && clip) this.entity.moveScale = P.hardLandMove;
      }
      this.air = 0; this.airborne = false; this.prevVy = 0; this.double = false; this.seenJump = pc?.jumpCount;
    }
    if (this.landing > 0) {
      this.landing -= dt;
      if (!this.hardLanding && speed > 0.5) this.landing = Math.min(this.landing, 0.05);  // moving cuts a soft land short
      if (this.landing > 0) return;
      this.entity.moveScale = 1;
    }
    anim.play(speed < 0.1 ? P.idleClip : speed < P.runSpeed ? P.walkClip : P.runClip);
  }
}

// ---- Platformer kit: our own tiny collider (axis-aligned boxes), no physics library needed.

// A box other things can stand on and bump into. Axis-aligned unless `rotated`; `shape` sphere / capsule makes it round.
// anchor "bottom" = the entity's origin is the box's bottom centre (Kenney models), "center" = primitives.
export class Solid extends Behavior {
  static schema = {
    size:   { type: 'vec3', default: [1, 1, 1] },        // metres
    anchor: { type: 'string', default: 'bottom' },        // bottom | center
    slope:  { type: 'boolean', default: false },          // a ramp: the top rises from nothing to size.y along the model's +x
    shape:  { type: 'string', default: 'box' },           // box | sphere | capsule — what raycasts/sweeps see (runtime/collide.js)
    rotated: { type: 'boolean', default: false },         // follow the entity's yaw (a turned box), for walking and queries
    layer:  { type: 'string', default: 'default' },       // collision layer: queries can ask for some layers only
  };
  start() { (this.world.solids ||= []).push(this); }
  destroy() { const s = this.world.solids; if (s) s.splice(s.indexOf(this), 1); }
  box() {
    const p = this.entity.object3d.position;
    let [sx, sy, sz] = this.params.size, slope;
    if (this.params.slope) {        // ramps follow the entity's turn, snapped to 90°: +x, -z, -x, +z
      const q = ((Math.round(yawOf(this.entity.object3d) / (Math.PI / 2)) % 4) + 4) % 4;
      slope = ['+x', '-z', '-x', '+z'][q];
      if (q % 2) [sx, sz] = [sz, sx];
    }
    const y0 = this.params.anchor === 'center' ? p.y - sy / 2 : p.y;
    return { minX: p.x - sx / 2, maxX: p.x + sx / 2, minY: y0, maxY: y0 + sy, minZ: p.z - sz / 2, maxZ: p.z + sz / 2, slope };
  }
}

// The Solids of a collision GLB (an asset's `collision`, Colin's bld_ / deck_ / ramp_ naming, runtime/colliders.js).
// World adds this behavior itself when the entity's model has a collision file; `colliders` are fitted at load, in the
// model's own space, and placed here by the entity's position, yaw and scale (again whenever the entity is moved).
export class CollisionMesh extends Behavior {
  static schema = {
    colliders: { type: 'hidden', default: [] },
    layer: { type: 'string', default: 'default' },
  };
  start() { this.solids = []; this.place(); }
  place() {
    const W = this.world, all = (W.solids ||= []);
    for (const s of this.solids) { const i = all.indexOf(s); if (i >= 0) all.splice(i, 1); }
    const o = this.entity.object3d, pos = [o.position.x, o.position.y, o.position.z], k = o.scale?.x ?? 1;
    this.solids = this.params.colliders.map((col, i) => {
      const { c, size, yaw } = placeCollider(col, pos, yawOf(o), k);
      const s = Object.create(Solid.prototype);    // a Solid with no entity of its own: queries see it, walking stands on it
      s.world = W; s.params = { size, anchor: 'center', slope: !!col.slope, shape: 'box', rotated: !col.slope, layer: this.params.layer };
      s.entity = { id: `${this.entity.id}#${col.name || i}`, owner: this.entity.id, object3d: { position: { x: c[0], y: c[1], z: c[2] }, rotation: { x: 0, y: yaw, z: 0 } } };
      return s;
    });
    all.push(...this.solids);
  }
  onMoved() { this.place(); }
  destroy() { const all = this.world.solids || []; for (const s of this.solids || []) { const i = all.indexOf(s); if (i >= 0) all.splice(i, 1); } this.solids = []; }
}

const STEP_UP = 0.35;

// The floor height under (x, z) at or below `below`: every Surface, Solid top, and the flat `groundY`. Shared by the skater and FootIK.
export function groundUnder(world, x, z, below, groundY = 0) {
  let best = { y: groundY, n: [0, 1, 0] };
  for (const sf of world.surfaces || []) { const g = sf.groundAt(x, z, below); if (g && g.y > best.y) best = g; }
  for (const so of world.solids || []) { const t = walkShape(so).topNear(x, z, 0.1); if (t <= below && t > best.y) best = { y: t, n: [0, 1, 0] }; }
  return best;
}

// Feet on the ground (Roller Girl's FOOTIK): after the pose, while he/she is on the ground, the model is dropped until the
// LOWER sole touches the floor under it (at most `maxDrop`, raised at most `maxRaise`), and the other leg is reached down with
// two-bone IK when its sole is within `near` of its own floor (further off is a stride or a trick — left alone). Eased.
// The sole is the ankle minus its height above the soles in the first grounded pose (measured, never typed).
export class FootIK extends Behavior {
  static schema = {
    maxDrop:  { type: 'number', default: 0.25, min: 0, max: 1, step: 0.01 },
    maxRaise: { type: 'number', default: 0.06, min: 0, max: 0.5, step: 0.01 },
    near:     { type: 'number', default: 0.16, min: 0, max: 1, step: 0.01 },
    ease:     { type: 'number', default: 0.05, min: 0.005, max: 1, step: 0.005 },   // s half-life of the drop
  };
  start() { this.legs = null; this.off = 0; }
  grounded() {
    const b = this.entity.behaviors.find(x => x instanceof Skater || x instanceof PlayerController);
    return b ? (b instanceof Skater ? b.grounded && !b.grind : b.grounded) && !this.entity.mover : true;
  }
  lateUpdate(dt) {
    const e = this.entity, o = e.object3d, model = o.children?.[0]; if (!model) return;
    if (!this.legs) {
      const g = n => o.getObjectByName?.(`mixamorig_${n}`);
      const L = { up: g('LeftUpLeg'), mid: g('LeftLeg'), foot: g('LeftFoot') }, R = { up: g('RightUpLeg'), mid: g('RightLeg'), foot: g('RightFoot') };
      if (!L.foot || !R.foot) { this.legs = []; return; }
      this.legs = [L, R]; this.baseY = model.position.y;
    }
    if (!this.legs.length) return;
    const P = this.params, V = o.position.constructor, k = 1 - Math.pow(0.5, dt / P.ease);
    let want = 0;
    if (this.grounded()) {
      model.position.y = this.baseY + this.off; o.updateMatrixWorld(true);
      const rootY = o.position.y, gY = this.entity.behaviors.find(x => x instanceof PlayerController)?.params.groundY ?? this.entity.behaviors.find(x => x instanceof Skater)?.params.groundY ?? 0;
      const soles = this.legs.map(L => {
        const a = L.foot.getWorldPosition(new V());
        if (L.ankle === undefined) {   // first grounded pose: the ankle's height over the soles — the LOWER ankle's, for both (a pose may lift one)
          const ys = this.legs.map(l => l.foot.getWorldPosition(new V()).y - rootY - this.off);
          for (const l of this.legs) l.ankle = Math.max(0.02, Math.min(...ys));
        }
        const s = a.y - L.ankle, fl = groundUnder(this.world, a.x, a.z, s + 0.5, gY).y;
        return { L, a, s, fl, gap: s - fl };
      });
      const low = soles.reduce((m, x) => x.gap < m.gap ? x : m);
      want = Math.max(-P.maxDrop, Math.min(P.maxRaise, this.off - low.gap));
      this.off += (want - this.off) * k;
      model.position.y = this.baseY + this.off; o.updateMatrixWorld(true);
      for (const x of soles) {                                  // the other foot: reach it down to its own floor if it is close
        if (x === low) continue;
        const a = x.L.foot.getWorldPosition(new V()), gap = (a.y - x.L.ankle) - x.fl;
        if (gap > 0.005 && gap < P.near) ik2(x.L.up, x.L.mid, x.L.foot, new V(a.x, a.y - gap, a.z), 1);
      }
    } else { this.off += (0 - this.off) * k; model.position.y = this.baseY + this.off; }
  }
}

// A grind rail (Roller Girl's railPath, straight for now): the bar runs along this object's local X, `length` long, through its
// origin — so turning or TILTING the object in the editor makes a down rail. Skaters catch it from the air (Skater).
export class Rail extends Behavior {
  static schema = { length: { type: 'number', default: 4, min: 0.5, max: 50, step: 0.1 } };
  start() { (this.world.rails ||= []).push(this); }
  destroy() { const l = this.world.rails; if (l) { const i = l.indexOf(this); if (i >= 0) l.splice(i, 1); } }
  ends() {   // world-space ends [a, b]
    const o = this.entity.object3d, V = o.position.constructor, h = this.params.length / 2;
    o.updateMatrixWorld?.(true);
    const a = o.localToWorld ? o.localToWorld(new V(-h, 0, 0)) : null, b = o.localToWorld ? o.localToWorld(new V(h, 0, 0)) : null;
    if (a) return [[a.x, a.y, a.z], [b.x, b.y, b.z]];
    const y = yawOf(o), c = Math.cos(y), sn = -Math.sin(y), p = o.position;     // a plain object (tests): yaw only
    return [[p.x - c * h, p.y, p.z - sn * h], [p.x + c * h, p.y, p.z + sn * h]];
  }
}

// SKATING (Roller Girl's stepGround / stepAir, docs/rollergirl-extraction.md) — a whole controller for a skater, used INSTEAD of
// a PlayerController. Her velocity lives in the frame of the SURFACE she is on: the wheels roll freely along it, the edges bite
// across it (a grip-limited carve), and gravity's component along the surface is what slows her up a transition and gives it
// back on the way down — so a half pipe is just the flat at an angle. Pushing (stick ahead) strokes her up to `top`; rolling
// drag is tiny, so a pipe swings for a long time. Off a lip she flies; off anything steeper than `vertAt` her speed out over the
// coping is taken away (the vert lock), so a vert air comes straight back down the same wall. Landings keep the speed along the
// face she lands on. Tap = ollie. Floors: every Surface (set `maxSlope` near 88 on ramps she rides), Solid tops, and `groundY`.
export class Skater extends Behavior {
  static schema = {
    gravity: { type: 'number', default: 20, min: 1, max: 60, step: 1 },
    push:    { type: 'number', default: 7.4, min: 0, max: 30, step: 0.1 },    // m/s² while the stick pushes ahead
    top:     { type: 'number', default: 22, min: 1, max: 50, step: 0.5 },     // m/s a push takes her to
    roll:    { type: 'number', default: 0.04, min: 0, max: 2, step: 0.01 },   // rolling drag, 1/s
    brake:   { type: 'number', default: 3, min: 0, max: 20, step: 0.1 },      // 1/s with the stick pulled back
    grip:    { type: 'number', default: 40, min: 1, max: 200, step: 1 },      // m/s²: the most sideways the edges can turn her
    turn:    { type: 'number', default: 10, min: 0.5, max: 30, step: 0.5 },   // rad/s turning when slow…
    turnFast:{ type: 'number', default: 3.3, min: 0.2, max: 20, step: 0.1 },  // …and at speed
    turnRef: { type: 'number', default: 14, min: 1, max: 40, step: 1 },       // m/s where the turn rate has come down to turnFast
    ollie:   { type: 'number', default: 8, min: 0, max: 25, step: 0.5 },      // m/s up on a tap
    vertAt:  { type: 'number', default: 65, min: 30, max: 89, step: 1 },      // degrees: leaving steeper than this = a vert air (comes back in)
    inward:  { type: 'number', default: 0.6, min: 0, max: 5, step: 0.1 },     // m/s back into the pipe on a vert air
    step:    { type: 'number', default: 0.4, min: 0, max: 2, step: 0.05 },    // m she can roll up onto (a kerb)
    groundY: { type: 'number', default: 0, min: -50, max: 50, step: 0.1 },
    killY:   { type: 'number', default: -20, min: -200, max: 0, step: 1 },
    // the move brain — clip names default to the alien skater's (a missing clip falls back to the character's roles)
    idleClip: { type: 'string', default: 'idle_normal' },             // standing still
    rollClip: { type: 'string', default: 'idle_arms_behind_back' },   // rolling with the thumb off (her r158 roll pose)
    pushClip: { type: 'string', default: 'blade_casual_forward' },    // pushing…
    hardClip: { type: 'string', default: 'blade_hard_forward' },      // …and pushing fast
    hardAt:   { type: 'number', default: 12, min: 0, max: 50, step: 0.5 },   // m/s where the push turns hard
    rateRef:  { type: 'number', default: 9, min: 1, max: 40, step: 0.5 },    // m/s at which a push clip plays at 1×
    airClip:  { type: 'string', default: 'in_air' },
    backPush: { type: 'string', default: 'blade_casual_backward' },   // fakie (her backward clips face backwards: the model is turned for them)
    backRoll: { type: 'string', default: 'idle_backward' },
    backIdle: { type: 'string', default: 'idle_backward' },
    idleBelow:{ type: 'number', default: 0.4, min: 0, max: 5, step: 0.05 },  // m/s: slower is standing
    fakieAt:  { type: 'number', default: 1, min: 0, max: 5, step: 0.1 },     // m/s backwards that counts as fakie
    // grinds (Rail): caught from the air within `catchR` of the bar, not crossing it squarer than `minCos`
    catchR:   { type: 'number', default: 0.6, min: 0.05, max: 3, step: 0.05 },
    minCos:   { type: 'number', default: 0.35, min: 0, max: 1, step: 0.05 },
    grindDrag:{ type: 'number', default: 0.08, min: 0, max: 3, step: 0.01 },
    ledges:   { type: 'boolean', default: false },   // every Solid box's top edge is grindable (found ledges)
    ledgeMin: { type: 'number', default: 0.2, min: 0, max: 5, step: 0.05 },   // m over the ground: lower edges are kerbs, not ledges
    tuckClip: { type: 'string', default: 'tuck' },       // held during a flip
    // the left flick ON THE GROUND (her r80/r84 map): up = boost, down = skid stop, sideways = swivel to fakie and back
    boost:    { type: 'number', default: 8, min: 0, max: 30, step: 0.5 },      // m/s added, spread over boostTime (a stroke, not a jolt)
    boostTime:{ type: 'number', default: 0.45, min: 0.05, max: 2, step: 0.05 },
    boostCap: { type: 'number', default: 36, min: 1, max: 80, step: 1 },
    boostCool:{ type: 'number', default: 1.1, min: 0, max: 5, step: 0.05 },
    stopTime: { type: 'number', default: 0.4, min: 0.05, max: 3, step: 0.05 }, // s a skid stop takes from any speed
    flipShare:{ type: 'number', default: 0.85, min: 0.3, max: 1, step: 0.05 },   // the flip takes this share of the air she has left
    grindLeft: { type: 'string', default: 'grind_left' },
    grindRight:{ type: 'string', default: 'grind_right' },
  };
  // Ready-made sets of params (an agent or the editor writes them into the scene; nothing reads them at run time).
  // board: Shred World's skateboard (SK8 in colinwillow/city @797e32b) with Colin's board clips — 10 m/s in about a second,
  // settling near 20, the c169 ollie (3.97 m), a board that coasts like a vehicle.
  static presets = {
    board: {
      push: 9, top: 20, roll: 0.052, brake: 1.5, grip: 30, ollie: 12.6, fakieAt: 2.2,
      idleClip: 'skate_idol_standing', rollClip: 'skate_idol_standing', pushClip: 'skate_push_standing', hardClip: 'skate_push_crouch',
      hardAt: 14, rateRef: 8, airClip: 'skate_ollie_air', backPush: '', backRoll: '', backIdle: '',
      tuckClip: 'skate_ollie_air', grindLeft: 'skate_idol_crouch', grindRight: 'skate_idol_crouch', ledges: true,
    },
  };
  start() {
    const o = this.entity.object3d, p = o.position;
    this.v = [0, 0, 0]; this.n = [0, 1, 0]; this.grounded = true; this.heading = yawOf(o); this.spawn = [p.x, p.y, p.z];
    this.airT = 0; this.pushing = false; this.lift = 0; this.along = 0; this.fakie = false;
  }
  onMoved() { const p = this.entity.object3d.position; this.spawn = [p.x, p.y, p.z]; this.v = [0, 0, 0]; }
  // the floor under (x, z) at or below `below`: { y, n } — Surfaces, Solid tops, the flat ground
  floor(x, z, below) { return groundUnder(this.world, x, z, below, this.params.groundY); }
  update(dt) {
    if (dt <= 0 || this.entity.defeated) return;
    this.railCoolT = Math.max(0, (this.railCoolT || 0) - dt);
    const P = this.params, o = this.entity.object3d, p = o.position, input = this.world.input || {}, move = input.move || [0, 0];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], mag = Math.hypot(move[0], move[1]);
    const v = this.v;
    if (this.grind) { this.stepGrind(dt, input); return this.pose(dt); }
    if (input.trick) { const t = input.trick; input.trick = null; if (!this.grounded) this.startFlip(t); else this.groundTrick(t); }
    this.boostCoolT = Math.max(0, (this.boostCoolT || 0) - dt);
    if (this.flip) this.flip.t += dt;
    if (input.jump) {
      input.jump = false;
      if (this.grounded) { const k = P.ollie; v[0] += this.n[0] * k * 0.3; v[1] += k; v[2] += this.n[2] * k * 0.3; this.leave(); this.world.emit('jump'); }
    }
    if (this.grounded) {
      const n = this.n;
      // the surface frame: F = her heading laid on the surface, R across it
      let F = [Math.sin(this.heading), 0, Math.cos(this.heading)]; const fn = dot(F, n); F = [F[0] - n[0] * fn, F[1] - n[1] * fn, F[2] - n[2] * fn];
      const fl = Math.hypot(...F) || 1; F = F.map(c => c / fl);
      const R = [F[1] * n[2] - F[2] * n[1], F[2] * n[0] - F[0] * n[2], F[0] * n[1] - F[1] * n[0]];
      let along = dot(v, F), lat = dot(v, R);
      // gravity along the surface (slows her up a transition, gives it back on the way down)
      along += -P.gravity * F[1] * dt; lat += -P.gravity * R[1] * dt;
      // steer: turn the heading toward the stick (camera-relative world dir), slower at speed
      const sp = Math.hypot(along, lat), rate = P.turn + (P.turnFast - P.turn) * Math.min(1, sp / P.turnRef);
      let ahead = 0;
      if (mag > 0.2) {
        const want = Math.atan2(move[0], move[1]), lead = along < -0.5 ? this.heading + Math.PI : this.heading;   // rolling backwards: steer the leading end
        let d = want - lead; d = Math.atan2(Math.sin(d), Math.cos(d));
        this.heading += Math.max(-rate * dt, Math.min(rate * dt, d)) * Math.min(1, mag * 1.5);
        ahead = Math.cos(d) * mag;
      }
      // the edges: what is across the wheels is turned onto them, at most `grip` m/s² — the rest is a slide
      const g = P.grip * dt; lat = Math.abs(lat) <= g ? 0 : lat - Math.sign(lat) * g;
      // push / brake / roll
      this.pushing = ahead > 0.35;                       // pushing along the LEADING end — forward, or backwards in fakie
      if (this.pushing) along = along < -0.5 ? Math.max(-P.top, along - P.push * ahead * dt) : Math.min(P.top, along + P.push * ahead * dt);
      if (ahead < -0.35) along *= Math.exp(-P.brake * -ahead * dt);
      along *= Math.exp(-P.roll * dt); lat *= Math.exp(-P.roll * dt);
      if (this.boostT > 0) {                              // a half-sine stroke: the whole `boost` arrives over boostTime
        const u0 = 1 - this.boostT / P.boostTime; this.boostT = Math.max(0, this.boostT - dt); const u1 = 1 - this.boostT / P.boostTime;
        const add = P.boost * (Math.cos(Math.PI * u0) - Math.cos(Math.PI * u1)) / 2, dir = along < -0.5 ? -1 : 1;
        along = dir > 0 ? Math.min(P.boostCap, along + add) : Math.max(-P.boostCap, along - add);
      }
      if (this.stopT > 0) { this.stopT -= dt; along *= Math.exp(-6 / P.stopTime * dt); lat *= Math.exp(-6 / P.stopTime * dt); if (Math.hypot(along, lat) < 0.3) { along = lat = 0; this.stopT = 0; } }
      // rolling backwards up and back down a wall: she rides it fakie (heading stays; the clip follows later)
      // rebuild in the NEW frame (the heading may have turned)
      let F2 = [Math.sin(this.heading), 0, Math.cos(this.heading)]; const f2n = dot(F2, n); F2 = [F2[0] - n[0] * f2n, F2[1] - n[1] * f2n, F2[2] - n[2] * f2n];
      const f2l = Math.hypot(...F2) || 1; F2 = F2.map(c => c / f2l);
      const R2 = [F2[1] * n[2] - F2[2] * n[1], F2[2] * n[0] - F2[0] * n[2], F2[0] * n[1] - F2[1] * n[0]];
      for (let i = 0; i < 3; i++) v[i] = F2[i] * along + R2[i] * lat;
      this.along = along;
      // move, then find the surface again
      const nx = p.x + v[0] * dt, ny = p.y + v[1] * dt, nz = p.z + v[2] * dt;
      const g2 = this.floor(nx, nz, Math.max(ny, p.y) + P.step);
      const vn = dot(v, g2.n);
      if (g2.y < ny - Math.max(0.05, Math.hypot(...v) * dt * 0.5) || vn > 0.5) {   // the surface fell away / turned away: airborne
        p.x = nx; p.y = ny; p.z = nz; this.leave(); return this.pose(dt);
      }
      p.x = nx; p.z = nz; p.y = g2.y; this.n = g2.n;
      const vn2 = dot(v, this.n); for (let i = 0; i < 3; i++) v[i] -= this.n[i] * vn2;   // keep her on it
    } else {
      this.airT += dt;
      v[1] -= P.gravity * dt;
      if (mag > 0.2) { const want = Math.atan2(move[0], move[1]); let d = want - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d)); this.heading += Math.max(-4 * dt, Math.min(4 * dt, d)); }
      const ny = p.y + v[1] * dt, nx = p.x + v[0] * dt, nz = p.z + v[2] * dt;
      if (this.catchRail(p, [nx, ny, nz])) return this.pose(dt);
      const g = this.floor(nx, nz, p.y + 0.05);
      if (v[1] <= 0 && ny <= g.y) {                // touch down: keep the speed along the face
        p.x = nx; p.z = nz; p.y = g.y; this.n = g.n; this.grounded = true;
        const vn = dot(v, g.n); for (let i = 0; i < 3; i++) v[i] -= g.n[i] * vn;
        if (this.airT > 0.25) this.world.emit('land');
        if (this.flip) { if (this.flip.t >= this.flip.dur * 0.8) this.world.emit('landtrick', this.entity.id, this.flip.kind); this.flip = null; }   // short of round: the pose eases out of what is left
        this.airT = 0;
      } else { p.x = nx; p.y = ny; p.z = nz; }
    }
    // walls: Solid sides push her out and take the speed into them
    for (const sh of (this.world.solids || []).map(walkShape)) {
      if (p.y >= sh.top(p.x, p.z) - P.step || p.y + 1.6 <= sh.minY) continue;
      const { cx, cz, inside } = sh.near(p.x, p.z), r = 0.3, dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
      if (!inside && d >= r) continue;
      let ux, uz; if (!inside && d > 1e-6) { ux = dx / d; uz = dz / d; p.x = cx + ux * r; p.z = cz + uz * r; }
      else { const [ox, oz] = sh.out(p.x, p.z, r); p.x += ox; p.z += oz; const l = Math.hypot(ox, oz) || 1; ux = ox / l; uz = oz / l; }
      const into = v[0] * ux + v[2] * uz; if (into < 0) { v[0] -= ux * into * 1.3; v[2] -= uz * into * 1.3; }
    }
    if (p.y < P.killY) { [p.x, p.y, p.z] = this.spawn; this.v = [0, 0, 0]; this.grounded = true; this.n = [0, 1, 0]; this.world.emit('respawn'); }
    this.pose(dt);
  }
  // the left flick on the ground: up = BOOST, down = a skid STOP, sideways = SWIVEL (her body turns 180, her travel does not —
  // the same line, the other way up: fakie ↔ forward)
  groundTrick([fx, fy]) {
    const P = this.params;
    if (Math.abs(fy) >= Math.abs(fx) && fy < 0) {
      if (this.boostCoolT > 0) return;
      if (Math.hypot(...this.v) < 1) { this.v[0] += Math.sin(this.heading) * 0.6; this.v[2] += Math.cos(this.heading) * 0.6; }   // a direction to go in
      this.boostT = P.boostTime; this.boostCoolT = P.boostCool; this.world.emit('boost', this.entity.id); this.world.emit('trick', this.entity.id, 'BOOST');
    } else if (Math.abs(fy) >= Math.abs(fx)) { this.stopT = P.stopTime; this.world.emit('stop', this.entity.id); }
    else { this.heading += Math.PI; this.world.emit('trick', this.entity.id, 'SWIVEL'); }
  }
  // FLIPS (her FLIPP / startFlip): a left flick in the air — up a front flip, down a back flip, sideways a 360 — timed to the
  // air she has LEFT (flipShare of the time to come back down), so a late flick is quick and an early one takes its time. Too
  // little air is no flip at all, never a guaranteed bail. One at a time.
  startFlip([fx, fy]) {
    if (this.flip || this.grind) return;
    const P = this.params, p = this.entity.object3d.position, g = P.gravity, vy = this.v[1];
    const floor = this.floor(p.x, p.z, p.y).y, fall = Math.max(0, p.y - floor);
    const tAir = (vy + Math.sqrt(vy * vy + 2 * g * fall)) / g, dur = tAir * P.flipShare;
    if (dur < 0.35) return;
    const kind = Math.abs(fy) >= Math.abs(fx) ? (fy < 0 ? 'front' : 'back') : (fx > 0 ? 'spinR' : 'spinL');
    this.flip = { kind, t: 0, dur };
    this.world.emit('trick', this.entity.id, kind === 'front' ? 'FRONT FLIP' : kind === 'back' ? 'BACK FLIP' : '360');
  }
  // the extra turn a flip adds to her pose: about her own left axis (+X: a front flip pitches the nose down) or her up axis
  flipQ(Q, V) {
    const F = this.flip; if (!F) return null;
    const u = Math.min(1, F.t / F.dur), e = u * u * (3 - 2 * u), a = 2 * Math.PI * e;
    return F.kind === 'front' ? new Q().setFromAxisAngle(new V(1, 0, 0), a) : F.kind === 'back' ? new Q().setFromAxisAngle(new V(1, 0, 0), -a)
      : new Q().setFromAxisAngle(new V(0, 1, 0), F.kind === 'spinR' ? -a : a);
  }
  // GRINDS. Caught on the way down: the frame's path (from → to) passes the bar's top within catchR in plan, at a glancing angle.
  catchRail(p, to) {
    const P = this.params, v = this.v; if (v[1] > 2) return false;
    for (const rail of P.ledges ? [...(this.world.rails || []), ...this.foundLedges()] : this.world.rails || []) {
      if (rail === this.lastRail && this.railCoolT > 0) continue;
      const [a, b] = rail.ends(), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d); if (L < 1e-6) continue;
      const u = d.map(c => c / L), hsp = Math.hypot(v[0], v[2]);
      const along = (v[0] * u[0] + v[2] * u[2]) / (Math.hypot(u[0], u[2]) || 1);
      if (hsp > 1 && Math.abs(along) / hsp < P.minCos) continue;          // crossing it square: a jump over, not a grind
      // the nearest point on the bar to where she will be, in plan
      const t = Math.max(0, Math.min(L, ((to[0] - a[0]) * u[0] + (to[2] - a[2]) * u[2]) / ((u[0] ** 2 + u[2] ** 2) || 1)));
      const q = [a[0] + u[0] * t, a[1] + u[1] * t, a[2] + u[2] * t];
      if (Math.hypot(to[0] - q[0], to[2] - q[2]) > P.catchR) continue;
      if (!(p.y >= q[1] - 0.1 && to[1] <= q[1] + 0.35)) continue;          // her feet come down through the bar's top
      const dir = Math.sign(v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) || 1;
      const right = [-u[2] * dir, u[0] * dir], drift = v[0] * right[0] + v[2] * right[1];   // her right is (-fz, fx)
      this.grind = { rail, a, u, L, t, dir, speed: Math.max(1.5, Math.abs(v[0] * u[0] + v[1] * u[1] + v[2] * u[2])), side: drift >= 0 ? 'right' : 'left' };
      this.grounded = false; this.heading = Math.atan2(u[0] * dir, u[2] * dir); this.flip = null;
      [p.x, p.y, p.z] = q;
      this.world.emit('grind', this.entity.id, this.grind.side);
      return true;
    }
    return false;
  }
  // Found ledges (Shred World: "every box's top edge is a rail"): the top edges of every Solid box at least `ledgeMin` over the
  // ground, as rail-shaped objects ({ ends() }). Kept per solid while it stays put, so the cooldown after a grind still knows it.
  foundLedges() {
    const cache = (this.ledgeCache ||= new Map()), out = [], P = this.params;
    for (const solid of this.world.solids || []) {
      const sh = walkShape(solid), key = `${sh.ref.join()}|${sh.maxY}`;
      let c = cache.get(solid);
      if (!c || c.key !== key) cache.set(solid, c = { key, edges: (sh.edges || []).filter(([a]) => a[1] - P.groundY >= P.ledgeMin).map(([a, b]) => ({ ledge: true, ends: () => [a, b] })) });
      out.push(...c.edges);
    }
    return out;
  }
  stepGrind(dt, input) {
    const G = this.grind, P = this.params, p = this.entity.object3d.position;
    if (input.jump) {                                   // ollie off the rail
      input.jump = false; const k = G.speed * G.dir; this.v = [G.u[0] * k, G.u[1] * k + P.ollie, G.u[2] * k];
      this.endGrind(); this.world.emit('jump'); return;
    }
    G.speed += -P.gravity * G.u[1] * G.dir * dt;          // a down rail speeds her up, an up rail slows her
    G.speed *= Math.exp(-P.grindDrag * dt);
    if (G.speed <= 0.2) { const k = 0.2 * G.dir; this.v = [G.u[0] * k, 0, G.u[2] * k]; this.endGrind(); return; }   // stalled: tipped off
    G.t += G.speed * G.dir * dt;
    const k = G.speed * G.dir; this.v = [G.u[0] * k, G.u[1] * k, G.u[2] * k];
    if (G.t < 0 || G.t > G.L) { this.endGrind(); return; }   // off the end with her speed
    p.x = G.a[0] + G.u[0] * G.t; p.y = G.a[1] + G.u[1] * G.t; p.z = G.a[2] + G.u[2] * G.t;
  }
  endGrind() { this.lastRail = this.grind.rail; this.railCoolT = 0.3; this.grind = null; this.grounded = false; this.airT = 0; this.n = [0, 1, 0]; }
  // leaving the ground: off a face steeper than vertAt, the speed out over the lip goes (she comes back down the same wall)
  leave() {
    const n = this.n, P = this.params, v = this.v, h = Math.hypot(n[0], n[2]);
    if (h > 1e-6 && Math.acos(Math.min(1, n[1])) > P.vertAt * Math.PI / 180) {
      const ix = n[0] / h, iz = n[2] / h, out = -(v[0] * ix + v[2] * iz);   // n's level part points back INTO the pipe
      if (out > 0) { v[0] += ix * out; v[2] += iz * out; }
      v[0] += ix * P.inward; v[2] += iz * P.inward;
      this.world.emit('vertair', this.entity.id);
    }
    this.grounded = false; this.airT = 0; this.n = [0, 1, 0];
  }
  // the move brain (her MOVES / girlAnimMoves, simplified): which clip, how fast, and which way the model faces
  moves() {
    const P = this.params, sp = Math.hypot(...this.v), a = this.entity.anim, has = c => c && a?.clips.includes(c);
    const R = this.entity.roles, pick = (...cs) => cs.find(has) || '';
    // fakie: rolling backwards past `fakieAt` (out of it again past +fakieAt — hysteresis, so a stop does not flicker)
    if (this.grounded) { if (this.along < -P.fakieAt) this.fakie = true; else if (this.along > P.fakieAt) this.fakie = false; }
    const back = this.fakie && has(P.backPush);   // only with backward clips; otherwise fakie plays the forward ones
    let clip, rate = 1;
    if (this.grind) return { clip: pick(this.grind.side === 'right' ? P.grindRight : P.grindLeft, P.airClip), rate: 1, flip: 0 };
    if (!this.grounded) clip = this.flip && /front|back/.test(this.flip.kind) ? pick(P.tuckClip, P.airClip) : pick(P.airClip, roleClip('', 'jump', R));
    else if (sp < P.idleBelow) clip = back ? pick(P.backIdle, P.idleClip) : pick(P.idleClip, roleClip('', 'idle', R));
    else if (this.pushing) {
      clip = back ? P.backPush : sp > P.hardAt ? pick(P.hardClip, roleClip('', 'run', R)) : pick(P.pushClip, roleClip('', 'walk', R));
      rate = Math.max(0.55, Math.min(1.35, sp / P.rateRef));
    } else clip = back ? pick(P.backRoll, P.backIdle, P.rollClip) : pick(P.rollClip, P.idleClip, roleClip('', 'idle', R));
    // her backward clips are authored facing backwards: turn the model a half turn so her nose still leads
    const flip = back && clip && /_backward$/.test(clip) ? Math.PI : 0;
    return { clip, rate, flip };
  }
  pose(dt) {
    const o = this.entity.object3d, n = this.grounded ? this.n : [0, 1, 0], Q = o.quaternion.constructor, V = o.position.constructor;
    const m = this.moves();
    const tilt = new Q().setFromUnitVectors(new V(0, 1, 0), new V(n[0], n[1], n[2])), yaw = new Q().setFromAxisAngle(new V(0, 1, 0), this.heading + m.flip);
    const want = tilt.multiply(yaw), fq = this.flipQ(Q, V);
    const snap = m.flip !== (this.lastFlip ?? 0); this.lastFlip = m.flip;
    if (fq) o.quaternion.copy(want.multiply(fq));        // a flip is driven exactly, no easing
    else if (snap) o.quaternion.copy(want); else o.quaternion.slerp(want, 1 - Math.exp(-(this.grounded ? 14 : 6) * dt));
    const a = this.entity.anim; if (!a || this.entity.animHold > 0 || !m.clip) return;
    a.play(m.clip, { fade: 0.2 });
    a.action?.()?.setEffectiveTimeScale?.(m.rate);
    this.clip = m.clip;
  }
}

// Trick points (Roller Girl's SCORE, THPS's shape): every trick in one line goes into a COMBO; once she has been on the ground
// `bankAfter` s it is BANKED × the number of tricks (≤ multMax); a respawn LOSES it. Listens to the Skater's events on this entity
// (trick / landtrick / grind / vertair, held grinds tick). Totals go into world variables (`total`, `combo` names) so Reactions
// and the HUD can read them; each trick pops up through 'hud'.
export class TrickScore extends Behavior {
  static schema = {
    flip: { type: 'number', default: 100, min: 0, max: 1000, step: 5 },     // a flip landed round
    spin: { type: 'number', default: 50, min: 0, max: 1000, step: 5 },      // a 360
    boost:{ type: 'number', default: 10, min: 0, max: 1000, step: 5 },
    grind:{ type: 'number', default: 10, min: 0, max: 1000, step: 5 },      // the catch…
    grindTick: { type: 'number', default: 5, min: 0, max: 100, step: 1 },   // …and every half second on it
    vert: { type: 'number', default: 25, min: 0, max: 1000, step: 5 },      // a vert air
    bankAfter: { type: 'number', default: 0.6, min: 0, max: 5, step: 0.05 },
    multMax:   { type: 'number', default: 8, min: 1, max: 20, step: 1 },
    total: { type: 'string', default: 'score' },   // world variable names
    combo: { type: 'string', default: 'combo' },
  };
  start() {
    this.c = 0; this.n = 0; this.ground = 0; this.tick = 0;
    const me = this.entity.id, W = this.world; W.vars ||= {}; W.vars[this.params.total] ??= 0; W.vars[this.params.combo] = 0;
    W.on('trick', (id, name) => { if (id !== me) return; if (name === 'BOOST') this.add('BOOST', this.params.boost); });
    W.on('landtrick', (id, kind) => { if (id === me) this.add(kind === 'front' ? 'FRONT FLIP' : kind === 'back' ? 'BACK FLIP' : DeckTricks.KINDS[kind] ? kind.toUpperCase() : '360', /front|back/.test(kind) || DeckTricks.KINDS[kind] ? this.params.flip : this.params.spin); });
    W.on('grind', (id, side) => { if (id === me) this.add(side === 'right' ? 'RIGHT GRIND' : 'LEFT GRIND', this.params.grind); });
    W.on('vertair', id => { if (id === me) this.add('VERT AIR', this.params.vert); });
    W.on('respawn', () => this.lose());
  }
  add(name, pts, quiet) {
    if (!(pts > 0)) return;
    this.c += pts; this.ground = 0; this.world.vars[this.params.combo] = this.c;
    if (quiet) return;
    this.n++; this.world.emit('hud', `+${pts} ${name}`, 0.9); this.world.emit('trickpoints', this.entity.id, name, pts);
  }
  bank() {
    if (!this.c) return;
    const m = Math.max(1, Math.min(this.n, this.params.multMax)), got = this.c * m;
    this.world.vars[this.params.total] = (this.world.vars[this.params.total] || 0) + got;
    this.world.emit('hud', `${m > 1 ? `×${m}  ` : ''}+${got}`, 1.4); this.world.emit('score', got);
    this.c = 0; this.n = 0; this.world.vars[this.params.combo] = 0;
  }
  lose() { if (this.c) this.world.emit('hud', 'BAILED', 1.2); this.c = 0; this.n = 0; if (this.world.vars) this.world.vars[this.params.combo] = 0; }
  update(dt) {
    const sk = this.entity.behaviors.find(b => b instanceof Skater); if (!sk) return;
    if (sk.grind) { if ((this.tick += dt) >= 0.5) { this.tick -= 0.5; this.add('GRIND', this.params.grindTick, true); } this.ground = 0; return; }
    this.tick = 0;
    if (sk.grounded) { if ((this.ground += dt) >= this.params.bankAfter) this.bank(); } else this.ground = 0;
  }
}

// A walkable SURFACE made of this object's own triangles (Roller Girl's triangle floor, runtime/trimesh.js): ramps, bowls, hills
// and stairs from Blender are stood on as drawn, not as boxes. Faces steeper than `maxSlope` are not floors (give walls a Solid).
// PlayerController (and later the Skater) stands on every Surface in world.surfaces. Rebuilt when the object is moved.
export class Surface extends Behavior {
  static schema = {
    maxSlope: { type: 'number', default: 60, min: 5, max: 89, step: 1 },   // degrees: steeper is a wall, not a floor
    cell:     { type: 'number', default: 2, min: 0.25, max: 20, step: 0.25 },
  };
  start() { this.build(); (this.world.surfaces ||= []).push(this); }
  destroy() { const l = this.world.surfaces; if (l) { const i = l.indexOf(this); if (i >= 0) l.splice(i, 1); } }
  onMoved() { this.build(); }
  build() {
    this.grid = new TriGrid({ cell: this.params.cell, maxSlope: this.params.maxSlope });
    this.count = 0;
    for (const m of meshTriangles(this.entity.object3d, o => o.name !== '__outline')) this.count += this.grid.addPositions(m.pos, m.index);
  }
  groundAt(x, z, below) { return this.grid.groundAt(x, z, below); }
}

// Hang this object on a named bone of another entity's model — a katana in the goblin's hand, a hat on a head. The prop
// is authored in that bone's frame (Colin's weapons are built round `weapon_root_right`), so it parents with identity;
// `unit` sizes it in the world (metres per prop unit, whatever the rig's own scale) — 0 keeps it at the bone's scale.
export class Mount extends Behavior {
  static schema = {
    target: { type: 'string', default: '' },                    // entity id ('' = my parent in the scene)
    bone:   { type: 'string', default: 'weapon_root_right' },   // bone / node name in its model
    unit:   { type: 'number', default: 0, min: 0, max: 1, step: 0.0001 },
    offset: { type: 'vec3', default: [0, 0, 0] },               // nudge in the bone's frame (prop units)
    turn:   { type: 'vec3', default: [0, 0, 0] },               // degrees, in the bone's frame
  };
  start() {
    const o = this.entity.object3d, id = this.params.target || this.entity.parent, t = id && this.world.getEntity?.(id);
    const bone = t?.object3d?.getObjectByName?.(this.params.bone);
    if (!bone) { this.world.emit?.('warn', `Mount: no bone "${this.params.bone}" on ${id || '(no target)'}`); return; }
    this.home = this.home || o.parent; this.bone = bone;
    bone.add(o);
    const [ox, oy, oz] = this.params.offset, [rx, ry, rz] = this.params.turn.map(d => d * Math.PI / 180);
    o.position.set(ox, oy, oz); o.rotation.set(rx, ry, rz);
    if (this.params.unit > 0) {
      t.object3d.updateMatrixWorld?.(true);
      const e = bone.matrixWorld.elements, ws = Math.hypot(e[0], e[1], e[2]) || 1;
      o.scale.x = o.scale.y = o.scale.z = this.params.unit / ws;
    }
  }
  destroy() { if (this.bone && this.home && this.entity.object3d.parent === this.bone) this.home.add(this.entity.object3d); }
}

// A skateboard under the rider (Shred World's BOARD, docs/shredworld-extraction.md). Put this on the board entity, a CHILD of
// the rider: the board turns and tilts with him for free. It sizes the deck to `length` metres along its own long axis (local Z,
// as Colin's skateboard.glb is built), sets the wheels on the rider's floor, and raises the rider's model by the deck's top
// (`lift` -1 = measured off the board; Shred World typed 0.11). Everything is measured off the geometry, so any board fits.
export class Deck extends Behavior {
  static schema = {
    length: { type: 'number', default: 0.8, min: 0.1, max: 3, step: 0.01 },     // m nose to tail (Shred World's BOARD.len)
    lift:   { type: 'number', default: -1, min: -1, max: 1, step: 0.01 },       // m the rider stands up; -1 = the measured deck top
  };
  // the model's extents in its own frame (mesh bounding boxes through the node chain, no three import) → { min, max } or null
  static extents(model) {
    let min = null, max = null;
    model.updateMatrixWorld?.(true);
    model.traverse?.(m => {
      if (!m.isMesh || !m.geometry?.attributes?.position) return;
      m.geometry.boundingBox || m.geometry.computeBoundingBox();
      const M = m.matrix.clone(); for (let q = m.parent; q && q !== model; q = q.parent) M.premultiply(q.matrix);
      const b = m.geometry.boundingBox, V = b.min.constructor;
      for (let i = 0; i < 8; i++) {
        const c = new V(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(M);
        if (!min) { min = c.clone(); max = c.clone(); } else { min.min(c); max.max(c); }
      }
    });
    return min && { min: [min.x, min.y, min.z], max: [max.x, max.y, max.z] };
  }
  start() {
    const o = this.entity.object3d, model = o.children.find(c => !c.userData?.entityId); if (!model) return;
    const e = Deck.extents(model); if (!e) { this.world.emit?.('warn', 'Deck: the board has no mesh'); return; }
    const k = this.params.length / Math.max(1e-6, e.max[2] - e.min[2]);
    model.scale.setScalar(k);
    model.position.x = -k * (e.min[0] + e.max[0]) / 2; model.position.z = -k * (e.min[2] + e.max[2]) / 2;
    model.position.y = -k * e.min[1];                                   // wheels on the floor
    this.top = k * (e.max[1] - e.min[1]);
    const rider = this.world.getEntity?.(this.entity.parent)?.object3d, rm = rider?.children.find(c => !c.userData?.entityId);
    if (!rm) return;
    this.riderModel = rm; rm.userData.deckHome ??= rm.position.y;
    rm.position.y = rm.userData.deckHome + (this.params.lift >= 0 ? this.params.lift : this.top);
  }
  destroy() { const rm = this.riderModel; if (rm?.userData.deckHome !== undefined) rm.position.y = rm.userData.deckHome; }
}

// Board tricks as pure geometry (Shred World's TRICK, docs/shredworld-extraction.md): on the board entity (beside `Deck`), a right
// flick while the rider's Skater is in the air spins the deck under him — the flick read against his heading: forward = KICKFLIP
// (a roll about the deck's long axis), back = 360 FLIP (roll and a full yaw), sideways = a 360 SHOVE-IT that way (yaw only).
// He holds his air pose; the board does the work about its own middle. Touch down more than `land` of the way round and it is
// landed ('landtrick' — TrickScore counts it); less and it is a BAIL ('bail': TrickScore loses the combo, the board snaps back).
export class DeckTricks extends Behavior {
  static schema = {
    flip:  { type: 'number', default: 18, min: 1, max: 60, step: 0.5 },    // rad/s of roll: a kickflip in about 0.35 s
    shove: { type: 'number', default: 16, min: 1, max: 60, step: 0.5 },    // rad/s of yaw: a 360 shove in about 0.39 s
    land:  { type: 'number', default: 0.8, min: 0, max: 1, step: 0.05 },   // share of the way round that still lands
    mid:   { type: 'number', default: 0.07, min: 0, max: 1, step: 0.01 },   // m: the height the board turns about (its middle)
  };
  static KINDS = { kickflip: [1, 0], '360 flip': [1, 1], 'shove-it': [0, 1] };   // [roll turns, yaw turns]
  rider() { const r = this.world.getEntity?.(this.entity.parent); return r && r.behaviors?.find(b => b instanceof Skater); }
  start() { this.trick = null; const o = this.entity.object3d; this.homeQ = o.quaternion.clone(); this.homeP = o.position.clone(); }
  update(dt) {
    const sk = this.rider(), input = this.world.input || {}, a = input.attack; if (!sk) return;
    if (a && !sk.grounded && !sk.grind && !this.trick) {
      input.attack = null;
      const h = sk.heading, fwd = a[0] * Math.sin(h) + a[1] * Math.cos(h), side = a[0] * -Math.cos(h) + a[1] * Math.sin(h);   // his right is (-fz, fx)
      const kind = Math.abs(fwd) >= Math.abs(side) ? (fwd >= 0 || (!a[0] && !a[1]) ? 'kickflip' : '360 flip') : 'shove-it';
      this.trick = { kind, t: 0, sign: kind === 'shove-it' ? Math.sign(side) || 1 : 1 };
      this.world.emit('trick', sk.entity.id, kind.toUpperCase());
    }
    const T = this.trick; if (!T) return;
    T.t += dt;
    const [nr, ny] = DeckTricks.KINDS[T.kind], P = this.params, done = Math.min(1, Math.max(nr ? T.t * P.flip / (2 * Math.PI) : 0, ny ? T.t * P.shove / (2 * Math.PI) : 0));
    T.u = done;
    if (sk.grounded || sk.grind) {                       // touched down: landed or bailed
      if (done >= P.land) this.world.emit('landtrick', sk.entity.id, T.kind);
      else { this.world.emit('bail', sk.entity.id, T.kind); sk.entity.behaviors?.find(b => b instanceof TrickScore)?.lose(); }
      this.trick = null; T.u = 0;
    }                                                  // round in the air: held there (a full turn = square again) until he lands
  }
  lateUpdate() {
    const o = this.entity.object3d, T = this.trick, Q = o.quaternion.constructor, V = o.position.constructor;
    if (!this.homeQ) return;
    if (!T) { o.quaternion.copy(this.homeQ); o.position.copy(this.homeP); return; }
    const [nr, ny] = DeckTricks.KINDS[T.kind], k = T.u * 2 * Math.PI;
    const q = this.homeQ.clone().multiply(new Q().setFromAxisAngle(new V(0, 1, 0), ny * k * T.sign)).multiply(new Q().setFromAxisAngle(new V(0, 0, 1), nr * k));
    o.quaternion.copy(q);
    const up = new V(0, this.params.mid, 0);           // turn about the deck's middle, not its wheels
    o.position.copy(this.homeP).add(up.clone().applyQuaternion(this.homeQ)).sub(up.applyQuaternion(q));
  }
  destroy() { if (this.homeQ) { this.entity.object3d.quaternion.copy(this.homeQ); this.entity.object3d.position.copy(this.homeP); } }
}

// weirdport's breakable walls (kitBlast / kitKill / kitFlood, docs/weirdport-walls-extraction.md), on a building whose export
// carries Colin's `wallB_*` pieces: every node with a `chunks` table (extras, a JSON string) is a wall of chunks. Each live
// chunk is a turned box in `world.solids` (his boxes are Blender Z-up: (x, y, z) → (x, z, −y), then the wall's own matrix).
// A world `blast(x, y, z, r, dmg)` (Melee emits one where it hits) damages every chunk it reaches, `dmgScale` × dmg against his
// hp 20. A dead chunk's triangles collapse to its own centre (zero area: nothing to draw) and its collider goes; then a flood
// from the ANCHORED chunks through `nb` finds what is left hanging, which falls a moment later, staggered, so a hole spreads.
export class Breakables extends Behavior {
  static schema = {
    dmgScale: { type: 'number', default: 12, min: 0, max: 100, step: 0.5 },   // weirdport's KIT.dmg: game damage → his hp
    fall:     { type: 'number', default: 0.28, min: 0, max: 3, step: 0.01 },  // s an orphaned chunk hangs before it goes
    cool:     { type: 'number', default: 0.15, min: 0, max: 2, step: 0.01 },  // s a chunk ignores further hits (one blast, one hit)
    debris:   { type: 'number', default: 24, min: 0, max: 200, step: 1 },     // most flying pieces at once (0 = none)
    throw:    { type: 'number', default: 3.5, min: 0, max: 20, step: 0.1 },   // m/s a piece leaves away from the blast
    life:     { type: 'number', default: 2.2, min: 0.2, max: 10, step: 0.1 },  // s before a piece is gone
    batch:    { type: 'boolean', default: true },   // merge the walls per material (draw calls), each wall keeping its vertex range
  };
  start() {
    this.walls = []; this.solids = []; this.flying = [];
    const o = this.entity.object3d; o.updateMatrixWorld?.(true);
    const nodes = []; o.traverse?.(n => { if (n.userData?.chunks) nodes.push(n); });
    for (const node of nodes) {
      let recs; try { recs = JSON.parse(node.userData.chunks); } catch { continue; }
      const meshes = []; node.traverse(m => { if (m.isMesh && m.geometry?.attributes?._chunk) meshes.push(m); });
      const Q = node.quaternion.constructor, V = node.position.constructor;
      const wq = node.getWorldQuaternion(new Q()), ws = node.getWorldScale(new V()), yaw = 2 * Math.atan2(wq.y, wq.w);
      const W = { node, meshes, chunks: [], byId: new Map(), cloned: false };
      for (const r of recs) {
        const b = r.box, lo = [Math.min(b[0], b[3]), Math.min(b[2], b[5]), Math.min(-b[1], -b[4])], hi = [Math.max(b[0], b[3]), Math.max(b[2], b[5]), Math.max(-b[1], -b[4])];
        const lc = lo.map((v, i) => (v + hi[i]) / 2), c = node.localToWorld(new V(...lc)), size = [(hi[0] - lo[0]) * ws.x, (hi[1] - lo[1]) * ws.y, (hi[2] - lo[2]) * ws.z];
        const ch = { id: r.id, hp: r.hp || 20, hp0: r.hp || 20, anchored: !!r.anchored, nb: r.nb || [], lc, c: [c.x, c.y, c.z], r: Math.hypot(...size) / 2, dead: false, fall: 0, coolT: 0, wall: W };
        const sol = Object.create(Solid.prototype);      // a Solid with no entity of its own (CollisionMesh's pattern)
        sol.world = this.world; sol.params = { size, anchor: 'center', slope: false, shape: 'box', rotated: true, layer: 'default' };
        sol.entity = { id: `${this.entity.id}#${node.name}:${r.id}`, owner: this.entity.id, chunk: ch, object3d: { position: { x: c.x, y: c.y, z: c.z }, rotation: { x: 0, y: yaw, z: 0 } } };
        ch.solid = sol; W.chunks.push(ch); W.byId.set(ch.id, ch); this.solids.push(sol);
      }
      this.walls.push(W);
    }
    (this.world.solids ||= []).push(...this.solids);
    if (this.params.batch) this.batchWalls();
    this.world.on?.('blast', (x, y, z, r, dmg) => this.blast(x, y, z, r, dmg));
  }
  // the walls merged per material; a wall's chunks are then collapsed inside its own RANGE of the merged buffer (kitBatch)
  batchWalls() {
    const o = this.entity.object3d, meshes = this.walls.flatMap(W => W.meshes).filter(m => !m.isSkinnedMesh);
    if (meshes.length < 2) return;
    this.batches = mergeMeshes(o, meshes);
    for (const b of this.batches) { o.add(b.mesh); b.orig = b.mesh.geometry.attributes.position.array.slice(); }
    for (const m of meshes) m.visible = false;
    const V = o.position.constructor;
    for (const W of this.walls) {
      W.ranges = [];
      for (const b of this.batches) for (const m of W.meshes) { const r = b.ranges.get(m); if (r) W.ranges.push({ b, ...r }); }
      for (const c of W.chunks) { const v = o.worldToLocal(new V(...c.c)); c.rc = [v.x, v.y, v.z]; }
    }
  }
  get alive() { return this.walls.reduce((n, W) => n + W.chunks.filter(c => !c.dead).length, 0); }
  blast(x, y, z, r = 0.5, dmg = 1) {
    const D = dmg * this.params.dmgScale; let hit = 0; if (D <= 0) return 0;
    this.lastBlast = [x, y, z];
    for (const W of this.walls) {
      let wh = 0;
      for (const c of W.chunks) {
        if (c.dead || c.coolT > 0) continue;
        if (Math.hypot(c.c[0] - x, c.c[1] - y, c.c[2] - z) > r + c.r) continue;
        c.hp -= D; c.coolT = this.params.cool; wh++;
        if (c.hp <= 0) this.kill(c, true);
      }
      if (wh) { hit += wh; this.flood(W); }
    }
    return hit;
  }
  kill(c, loud) {
    if (c.dead) return false;
    const W = c.wall; c.dead = true;
    if (loud && this.params.debris > 0) this.throwPiece(c, this.lastBlast);   // lifted out BEFORE the collapse destroys its triangles
    if (W.ranges) {                                    // batched: collapse inside this wall's ranges of the merged buffers
      for (const R of W.ranges) {
        const g = R.b.mesh.geometry, pos = g.attributes.position, ch = g.attributes._chunk; if (!ch) continue;
        for (let i = R.start, e = R.start + R.count; i < e; i++) if (Math.round(ch.getX(i)) === c.id) pos.setXYZ(i, c.rc[0], c.rc[1], c.rc[2]);
        pos.needsUpdate = true;
      }
    } else if (!W.cloned) { W.cloned = true; for (const m of W.meshes) { m.userData.kGeo = m.geometry; m.geometry = m.geometry.clone(); } }   // the mesh is SHARED by several walls
    if (!W.ranges) for (const m of W.meshes) {
      const pos = m.geometry.attributes.position, ch = m.geometry.attributes._chunk; let touched = false;
      for (let i = 0; i < ch.count; i++) if (Math.round(ch.getX(i)) === c.id) { pos.setXYZ(i, c.lc[0], c.lc[1], c.lc[2]); touched = true; }
      if (touched) pos.needsUpdate = true;
    }
    const all = this.world.solids || [], i = all.indexOf(c.solid); if (i >= 0) all.splice(i, 1);
    this.world.emit('chunk', this.entity.id, W.node.name, c.id, loud ? 1 : 0, ...c.c);
    return true;
  }
  // weirdport's kitDebrisChunk: the chunk's own triangles (a copy of the wall's geometry indexed down to them, re-centred on the
  // chunk) thrown out away from the blast with a spin, falling, gone after `life`. Made with the wall mesh's own constructors.
  throwPiece(c, from) {
    const W = c.wall, scene = this.world.scene; if (!scene) return;
    while (this.flying.length >= this.params.debris) this.dropPiece(this.flying[0]);
    const V = W.node.position.constructor, Q = W.node.quaternion.constructor, at = W.node.localToWorld(new V(...c.lc));
    const away = from ? new V(at.x - from[0], 0, at.z - from[2]) : new V(); if (away.lengthSq() < 1e-6) away.set(Math.random() - 0.5, 0, Math.random() - 0.5); away.normalize();
    for (const m of W.meshes) {
      const g = m.geometry, ch = g.attributes._chunk, idx = [], src = g.index;
      const tris = src ? src.count / 3 : ch.count / 3;
      for (let t = 0; t < tris; t++) {
        const a = src ? src.getX(t * 3) : t * 3, b = src ? src.getX(t * 3 + 1) : t * 3 + 1, d = src ? src.getX(t * 3 + 2) : t * 3 + 2;
        if (Math.round(ch.getX(a)) === c.id && Math.round(ch.getX(b)) === c.id && Math.round(ch.getX(d)) === c.id) idx.push(a, b, d);
      }
      if (!idx.length) continue;
      const pg = g.clone(); pg.setIndex(idx); pg.translate(-c.lc[0], -c.lc[1], -c.lc[2]);
      const piece = new m.constructor(pg, m.material);
      piece.position.copy(at); W.node.getWorldQuaternion(piece.quaternion); W.node.getWorldScale(piece.scale);
      piece.castShadow = true; scene.add(piece);
      const k = this.params.throw * (0.6 + Math.random() * 0.8);
      this.flying.push({ piece, v: [away.x * k, 1.5 + Math.random() * 2, away.z * k], axis: new V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), rate: 4 + Math.random() * 6, q: new Q(), t: this.params.life });
    }
  }
  dropPiece(f) { f.piece.parent?.remove(f.piece); f.piece.geometry.dispose?.(); this.flying.splice(this.flying.indexOf(f), 1); }
  // weirdport's kitRestore: a kill run backwards — the chunk's vertices back from the wall as authored, its collider back in
  restore(wallName, id) {
    const W = this.walls.find(w => w.node.name === wallName), c = W?.byId.get(id); if (!c?.dead) return false;
    c.dead = false; c.fall = 0; c.hp = c.hp0;
    if (W.ranges) for (const R of W.ranges) {
      const g = R.b.mesh.geometry, pos = g.attributes.position, ch = g.attributes._chunk, O = R.b.orig; if (!ch) continue;
      for (let i = R.start, e = R.start + R.count; i < e; i++) if (Math.round(ch.getX(i)) === c.id) pos.setXYZ(i, O[i * 3], O[i * 3 + 1], O[i * 3 + 2]);
      pos.needsUpdate = true;
    }
    if (!W.ranges) for (const m of W.meshes) {
      const O = m.userData.kGeo?.attributes.position, pos = m.geometry.attributes.position, ch = m.geometry.attributes._chunk; if (!O) continue;
      for (let i = 0; i < ch.count; i++) if (Math.round(ch.getX(i)) === c.id) pos.setXYZ(i, O.getX(i), O.getY(i), O.getZ(i));
      pos.needsUpdate = true;
    }
    if (!(this.world.solids ||= []).includes(c.solid)) this.world.solids.push(c.solid);
    this.world.emit('repair', this.entity.id, wallName, id);
    return true;
  }
  flood(W) {
    const live = W.chunks.filter(c => !c.dead), seen = new Set(), q = live.filter(c => c.anchored);
    for (const c of q) seen.add(c.id);
    while (q.length) for (const id of q.pop().nb) { const n = W.byId.get(id); if (n && !n.dead && !seen.has(id)) { seen.add(id); q.push(n); } }
    let n = 0; for (const c of live) if (!seen.has(c.id) && !c.fall) c.fall = this.params.fall * (1 + n++ * 0.35);
  }
  update(dt) {
    for (const f of [...this.flying]) {                // the pieces in the air
      f.v[1] -= 9.8 * dt; f.piece.position.x += f.v[0] * dt; f.piece.position.y += f.v[1] * dt; f.piece.position.z += f.v[2] * dt;
      f.piece.quaternion.multiply(f.q.setFromAxisAngle(f.axis, f.rate * dt));
      if ((f.t -= dt) <= 0 || f.piece.position.y < -5) this.dropPiece(f);
    }
    for (const W of this.walls) {
      let fell = false;
      for (const c of W.chunks) {
        if (c.coolT > 0) c.coolT -= dt;
        if (c.dead || !c.fall) continue;
        if ((c.fall -= dt) <= 0) { this.kill(c, true); fell = true; }
      }
      if (fell) this.flood(W);                         // a chunk falling can orphan the one above it
    }
  }
  destroy() {
    for (const f of [...(this.flying || [])]) this.dropPiece(f);
    for (const b of this.batches || []) { b.mesh.removeFromParent(); b.mesh.geometry.dispose?.(); }
    if (this.batches?.length) for (const W of this.walls || []) for (const m of W.meshes) m.visible = true;
    this.batches = [];
    const all = this.world.solids || []; for (const s of this.solids || []) { const i = all.indexOf(s); if (i >= 0) all.splice(i, 1); }
    for (const W of this.walls || []) if (W.cloned) for (const m of W.meshes) if (m.userData.kGeo) { m.geometry.dispose?.(); m.geometry = m.userData.kGeo; delete m.userData.kGeo; }   // Stop: the wall as authored
  }
}

// weirdport's moving parts (KPARTS / kitPartStep, docs/weirdport-walls-extraction.md) on a building from his kit: every node
// with `door` / `breakable` extras. NO BUTTON OPENS A DOOR — a hinged door swings AWAY from whoever walks into it (his
// open_min/max ±100°) and shuts again a moment after they have gone; the wide `rollup` rolls up; the roof `hatch` opens for
// someone underneath it; `glass` (and a door, shutter or lid with its hp gone) breaks on a `blast`. Each part's `col_*` child is
// its collider (hidden), a turned box in `world.solids` while the part is shut. `who` is the entity that opens things.
export class KitParts extends Behavior {
  static schema = {
    who:      { type: 'string', default: 'player' },
    doorNear: { type: 'number', default: 1.35, min: 0.2, max: 5, step: 0.05 },   // m from the door's middle that opens it
    shutNear: { type: 'number', default: 2.4, min: 0.2, max: 8, step: 0.1 },     // the roll-up's reach
    hatchNear:{ type: 'number', default: 1.2, min: 0.2, max: 5, step: 0.05 },    // m in plan under the lid
    shutAfter:{ type: 'number', default: 1.4, min: 0, max: 10, step: 0.1 },      // s after they have gone before it closes
    rate:     { type: 'number', default: 5.5, min: 0.5, max: 30, step: 0.5 },    // how fast it swings (1/s)
    dmgScale: { type: 'number', default: 12, min: 0, max: 100, step: 0.5 },
    hatchSign:{ type: 'number', default: 1, min: -1, max: 1, step: 2 },          // flip if the lid lifts the wrong way
    batchGlass: { type: 'boolean', default: true },   // all the panes as one mesh per material; a broken pane collapses its range
  };
  start() {
    this.parts = []; const o = this.entity.object3d; o.updateMatrixWorld?.(true);
    o.traverse?.(n => {
      const e = n.userData || {}, kind = e.door === 'hinged' ? 'door' : e.door === 'rollup' ? 'rollup' : e.door === 'hatch' ? 'hatch' : e.breakable === 'glass' ? 'glass' : '';
      if (!kind) return;
      const col = n.children.find(c => c.userData?.collider && c.geometry);
      if (col) { col.userData.wasVisible ??= col.visible; col.visible = false; }
      const P = { node: n, kind, col, hp: (e.hp || (kind === 'glass' ? 5 : 40)), dead: false, a: 0, dir: 0, away: 9,
                  min: e.open_min_deg ?? -100, max: e.open_max_deg ?? (kind === 'hatch' ? 110 : 100), home: { ry: n.rotation.y, rx: n.rotation.x, sy: n.scale.y }, solid: null };
      this.parts.push(P); this.place(P, true);
    });
    if (this.params.batchGlass) {
      const panes = this.parts.filter(P => P.kind === 'glass'), meshes = [];
      for (const P of panes) { P.meshes = []; P.node.traverse(m => { if (m.isMesh && !m.isSkinnedMesh && m !== P.col && !m.userData?.collider) { P.meshes.push(m); meshes.push(m); } }); }
      if (meshes.length > 1) {
        this.glass = mergeMeshes(o, meshes);
        for (const b of this.glass) o.add(b.mesh);
        for (const m of meshes) m.visible = false;
        for (const P of panes) P.ranges = this.glass.flatMap(b => P.meshes.map(m => b.ranges.get(m) && { b, ...b.ranges.get(m) }).filter(Boolean));
      }
    }
    this.world.on?.('blast', (x, y, z, r, dmg) => this.blast(x, y, z, r, dmg));
  }
  // the part's collider as a turned box from its col_ child, in world.solids only while the part is shut
  place(P, shut) {
    const all = (this.world.solids ||= []);
    if (P.solid) { const i = all.indexOf(P.solid); if (i >= 0) all.splice(i, 1); P.solid = null; }
    if (!P.col || !shut || P.dead) return;
    const g = P.col.geometry; g.boundingBox || g.computeBoundingBox();
    const V = P.col.position.constructor, Q = P.col.quaternion.constructor, b = g.boundingBox;
    P.node.updateMatrixWorld?.(true);
    const c = P.col.localToWorld(new V((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2)), ws = P.col.getWorldScale(new V()), wq = P.col.getWorldQuaternion(new Q());
    const sol = Object.create(Solid.prototype);
    sol.world = this.world; sol.params = { size: [(b.max.x - b.min.x) * ws.x, (b.max.y - b.min.y) * ws.y, (b.max.z - b.min.z) * ws.z], anchor: 'center', slope: false, shape: 'box', rotated: true, layer: 'default' };
    sol.entity = { id: `${this.entity.id}#${P.node.name}`, owner: this.entity.id, part: P, object3d: { position: { x: c.x, y: c.y, z: c.z }, rotation: { x: 0, y: 2 * Math.atan2(wq.y, wq.w), z: 0 } } };
    P.solid = sol; all.push(sol);
    P.c = [c.x, c.y, c.z]; P.r = Math.hypot(...sol.params.size) / 2;
  }
  blast(x, y, z, r = 0.5, dmg = 1) {
    let hit = 0;
    for (const P of this.parts) {
      if (P.dead || !P.c || Math.hypot(P.c[0] - x, P.c[1] - y, P.c[2] - z) > r + P.r) continue;
      P.hp -= dmg * this.params.dmgScale; hit++;
      if (P.hp <= 0) { P.dead = true; P.node.visible = false; this.collapse(P); this.place(P, false); this.world.emit(P.kind === 'glass' ? 'shatter' : 'broken', this.entity.id, P.node.name, ...P.c); }
    }
    return hit;
  }
  // a batched pane: its vertices all onto its first one (zero-area triangles, nothing drawn)
  collapse(P) {
    for (const R of P.ranges || []) {
      const pos = R.b.mesh.geometry.attributes.position, x = pos.getX(R.start), y = pos.getY(R.start), z = pos.getZ(R.start);
      for (let i = R.start; i < R.start + R.count; i++) pos.setXYZ(i, x, y, z);
      pos.needsUpdate = true;
    }
  }
  update(dt) {
    const who = this.world.getEntity?.(this.params.who)?.object3d?.position; if (!who) return;
    const S = this.params, k = Math.min(1, S.rate * dt);
    for (const P of this.parts) {
      if (P.dead || P.kind === 'glass' || !P.c) continue;
      const dh = Math.hypot(who.x - P.c[0], who.z - P.c[2]), dy = who.y + 0.9 - P.c[1];
      let near, target;
      if (P.kind === 'door') {
        near = dh < S.doorNear && Math.abs(dy) < 1.6;
        if (near && !P.dir) {                             // swing AWAY: which side of the wall (its parent's +Z) is he on?
          const e = P.node.parent.matrixWorld.elements, m = P.node.matrixWorld.elements;
          P.dir = ((who.x - m[12]) * e[8] + (who.z - m[14]) * e[10]) >= 0 ? 1 : -1;   // weirdport's kitSide: + side → open_max
        }
        target = near || P.away < S.shutAfter ? (P.dir > 0 ? P.max : P.min) : 0;
      } else if (P.kind === 'rollup') { near = dh < S.shutNear && Math.abs(dy) < 2; target = near || P.away < S.shutAfter ? 1 : 0; }
      else { near = dh < S.hatchNear && who.y < P.c[1] && P.c[1] - who.y < 3.4; target = near || P.away < S.shutAfter ? P.max : 0; }
      P.away = near ? 0 : P.away + dt;
      if (!near && P.away >= S.shutAfter && P.kind === 'door' && Math.abs(P.a) < 2) P.dir = 0;
      const a0 = P.a; P.a += (target - P.a) * k;
      if (Math.abs(P.a - a0) < 1e-4) continue;
      if (P.kind === 'door') P.node.rotation.y = P.home.ry + P.a * Math.PI / 180;
      else if (P.kind === 'rollup') P.node.scale.y = P.home.sy * Math.max(0.03, 1 - P.a);
      else P.node.rotation.x = P.home.rx - S.hatchSign * P.a * Math.PI / 180;
      const open = P.kind === 'rollup' ? P.a > 0.1 : Math.abs(P.a) > 10;
      if (open !== !!P.open) { P.open = open; this.place(P, !open); }   // the doorway is clear while it stands open
    }
  }
  destroy() {
    for (const b of this.glass || []) { b.mesh.removeFromParent(); b.mesh.geometry.dispose?.(); }
    for (const P of this.parts || []) for (const m of P.meshes || []) m.visible = true;
    this.glass = [];
    for (const P of this.parts || []) {
      this.place(P, false); P.node.visible = true; P.node.rotation.y = P.home.ry; P.node.rotation.x = P.home.rx; P.node.scale.y = P.home.sy;
      if (P.col && P.col.userData.wasVisible !== undefined) P.col.visible = P.col.userData.wasVisible;
    }
  }
}

// Zap's blaster (WEAP / fireBolt, docs/zap-blaster-extraction.md): while `world.input.fire` is held (the right pad pushed UP —
// play.html's four-gate trigger) the shot CHARGES over `chargeT`; letting go fires a bolt (the `projectile` prefab, spawned
// at the gun) along the camera's bearing (`world.input.aim`) — under `minChg` it is a fumble and nothing fires. The charge
// sets the ball's size, its blast radius and its damage. `gun` is the held weapon's entity (the muzzle is its far end along
// the aim, measured); '' = `height` up from his feet.
export class Blaster extends Behavior {
  static schema = {
    projectile: { type: 'string', default: 'bolt' },        // prefab id with a Projectile behavior
    gun:        { type: 'string', default: '' },            // the weapon entity (a Mount child)
    height:     { type: 'number', default: 1.1, min: 0, max: 3, step: 0.05 },
    chargeT:    { type: 'number', default: 1.15, min: 0.05, max: 5, step: 0.05 },
    minChg:     { type: 'number', default: 0.1, min: 0, max: 1, step: 0.01 },
    speed:      { type: 'number', default: 44, min: 1, max: 200, step: 1 },        // m/s: slow enough to SEE
    size0:      { type: 'number', default: 0.45, min: 0.05, max: 5, step: 0.05 },  // m across, a fumble…
    size1:      { type: 'number', default: 1.9, min: 0.05, max: 5, step: 0.05 },   // …to a full charge (zap's ball0/ball1)
    blast0:     { type: 'number', default: 0.5, min: 0, max: 10, step: 0.1 },
    blast1:     { type: 'number', default: 2.2, min: 0, max: 10, step: 0.1 },
    damage0:    { type: 'number', default: 1, min: 0, max: 100, step: 0.5 },
    damage1:    { type: 'number', default: 3, min: 0, max: 100, step: 0.5 },
    auto:       { type: 'boolean', default: false },       // zap's AUTO mode: held = rapid fire of small bolts
    dna:        { type: 'boolean', default: false },       // zap's DNA mode: the bolt SAMPLES the body it hits (a Disguise wears it)
    rate:       { type: 'number', default: 0.12, min: 0.03, max: 1, step: 0.01 },   // s between auto shots
    aimClip:    { type: 'string', default: 'idle_rifle' }, // upper body while the trigger is held (and `hold` after a shot)
    shootClip:  { type: 'string', default: 'shoot' },      // upper body on each shot
    hold:       { type: 'number', default: 0.3, min: 0, max: 3, step: 0.05 },        // s the aim pose stays after a shot
  };
  start() { this.chg = 0; this.charging = false; this.autoT = 0; this.poseT = 0; this.posed = false; }
  // the upper body: the sighted pose while aiming, the shot on each release; he turns to the aim (PlayerController reads aimYaw)
  pose(dt, aiming) {
    const a = this.entity.anim, P = this.params, aim = this.world.input?.aim;
    this.poseT = aiming ? P.hold : Math.max(0, this.poseT - dt);
    const on = aiming || this.poseT > 0;
    this.entity.aimYaw = on && aim && (aim[0] || aim[aim.length - 1]) ? Math.atan2(aim[0], aim[aim.length - 1]) : null;
    if (!a) return;
    this.shotT = Math.max(0, (this.shotT || 0) - dt);
    if (on && !this.posed && this.shotT <= 0 && a.clips.includes(P.aimClip)) { a.play(P.aimClip, { layer: 'upper', fade: 0.12 }); this.posed = true; }
    else if (!on && this.posed) { a.stop('upper', { fade: 0.2 }); this.posed = false; }
  }
  shotPose() { const a = this.entity.anim, P = this.params; if (a?.clips.includes(P.shootClip)) { a.play(P.shootClip, { layer: 'upper', once: true, fade: 0.05, restart: true }); this.posed = false; this.shotT = 0.25; } this.poseT = P.hold; }
  muzzle() {
    const o = this.entity.object3d, g = this.params.gun && this.world.getEntity?.(this.params.gun)?.object3d;
    if (g?.getWorldPosition) {
      // the MUZZLE is the gun's far end along the mount's −X (zap: the tip marker is NOT the muzzle), measured off its mesh once
      const V = o.position.constructor, model = g.children.find(c => !c.userData?.entityId);
      if (model && this.muzzleLocal === undefined) { const e = Deck.extents(model); this.muzzleLocal = e ? [e.min[0], (e.min[1] + e.max[1]) / 2, (e.min[2] + e.max[2]) / 2] : null; }
      const v = model && this.muzzleLocal ? model.localToWorld(new V(...this.muzzleLocal)) : g.getWorldPosition(new V());
      return [v.x, Math.max(v.y, o.position.y + this.params.height * 0.75), v.z];   // never from his knees
    }
    return [o.position.x, o.position.y + this.params.height, o.position.z];
  }
  update(dt) {
    const input = this.world.input || {}, P = this.params;
    this.pose(dt, !!input.fire);
    if (P.auto) {                                       // rapid fire: a small bolt every `rate` while held
      if (!input.fire) { this.autoT = 0; return; }
      if ((this.autoT -= dt) <= 0) { this.autoT = P.rate; this.fire(0); this.shotPose(); }
      return;
    }
    if (input.fire) { this.charging = true; this.chg = Math.min(1, this.chg + dt / P.chargeT); return; }
    if (!this.charging) return;
    const c = this.chg; this.charging = false; this.chg = 0;
    if (c < P.minChg) { this.world.emit('fumble', this.entity.id); return; }
    this.fire(c); this.shotPose();
  }
  destroy() { this.entity.aimYaw = null; }
  fire(c) {
    const P = this.params, o = this.entity.object3d, a = this.world.input?.aim, yaw = yawOf(o);
    let d = a && (a[0] || a[a.length - 1]) ? (a.length === 3 ? a : [a[0], 0, a[1]]) : [Math.sin(yaw), 0, Math.cos(yaw)];
    const l = Math.hypot(...d) || 1; d = d.map(v => v / l);
    const at = this.muzzle(), lerp = (x, y) => x + (y - x) * c;
    const shot = { vel: d.map(v => v * P.speed), size: lerp(P.size0, P.size1), blast: lerp(P.blast0, P.blast1), damage: lerp(P.damage0, P.damage1), owner: this.entity.id, dna: P.dna };
    this.world.emit('shoot', this.entity.id, c);
    return this.world.spawn?.(P.projectile, { position: at }).then(e => {
      const pr = e.behaviors.find(b => b instanceof Projectile); if (!pr) return e;
      pr.launch(shot); e.object3d.scale.setScalar(shot.size); return e;
    });
  }
}

// A bolt in flight (zap's stepBolts / boltHit): straight along `vel` until it meets a Solid, the ground or a body, then a
// `blast(x, y, z, r, dmg)` there (walls break, glass shatters) and 'struck' on every body inside it; gone after `life`.
export class Projectile extends Behavior {
  static schema = {
    life:    { type: 'number', default: 2.4, min: 0.1, max: 20, step: 0.1 },
    gravity: { type: 'number', default: 0, min: 0, max: 40, step: 0.5 },
    groundY: { type: 'number', default: 0, min: -50, max: 50, step: 0.1 },
  };
  start() { this.t = 0; this.shot = this.shot || null; }
  launch(shot) { this.shot = shot; this.t = 0; }
  update(dt) {
    const S = this.shot; if (!S || this.gone) return;
    const p = this.entity.object3d.position, P = this.params; this.t += dt;
    S.vel[1] -= P.gravity * dt;
    const step = Math.hypot(...S.vel) * dt, d = S.vel.map(v => v / (Math.hypot(...S.vel) || 1)), from = [p.x, p.y, p.z];
    const hit = this.world.raycast?.(from, d, { maxDist: step });
    let at = hit ? hit.point : [p.x + S.vel[0] * dt, p.y + S.vel[1] * dt, p.z + S.vel[2] * dt];
    if (!hit && at[1] <= P.groundY) at = [at[0], P.groundY, at[2]];
    // a body in the way: anything hittable within the ball's radius of where it now is
    let body = null;
    for (const e of this.world.entities?.values?.() || []) {
      if (e.id === S.owner || e.defeated || !e.behaviors?.some(b => b instanceof Stompable || b.constructor.hittable)) continue;
      const q = e.object3d.position; if (Math.hypot(q.x - at[0], q.z - at[2]) < S.size / 2 + 0.4 && at[1] > q.y - 0.2 && at[1] < q.y + 2.2) { body = e; break; }
    }
    p.x = at[0]; p.y = at[1]; p.z = at[2];
    if (hit || body || at[1] <= P.groundY || this.t >= P.life) this.burst(at, this.t < P.life || !!hit, body);
  }
  burst(at, loud, body) {
    const S = this.shot; this.gone = true;
    if (S.dna) { if (body) this.world.emit('dna', S.owner, body.id); }      // a DNA bolt samples, it does not hurt
    else if (loud) {
      this.world.emit('blast', at[0], at[1], at[2], S.blast, S.damage);
      for (const e of this.world.entities?.values?.() || []) {
        if (e.id === S.owner || e.defeated || !e.behaviors?.some(b => b instanceof Stompable || b.constructor.hittable)) continue;
        const q = e.object3d.position; if (Math.hypot(q.x - at[0], q.y + 1 - at[1], q.z - at[2]) <= S.blast + 0.5) this.world.emit('struck', S.owner, e.id, S.damage);
      }
    }
    this.world.destroy?.(this.entity.id);
  }
}

// Zap's DNA gun (MORPH / morphGo, docs/zap-blaster-extraction.md): when a DNA bolt this entity fired hits a body ('dna'), he
// WEARS that body — its model, clips and roles (World.wear) — and keeps his own collider, speeds and behaviors. `revert` in the
// input (key X), or `duration` seconds (0 = until reverted), puts him back. Anything mounted on his own bones (the gun) is set
// aside with his model and comes back with it.
export class Disguise extends Behavior {
  static schema = {
    duration: { type: 'number', default: 30, min: 0, max: 600, step: 1 },
  };
  start() { this.t = 0; this.world.on?.('dna', (owner, target) => { if (owner === this.entity.id) this.sample(target); }); }
  async sample(target) {
    const t = this.world.getEntity?.(target); if (!t) return;
    const asset = typeof t.data?.asset === 'string' ? t.data.asset : t.prefab || t.data?.prefab;
    if (asset && await this.world.wear?.(this.entity.id, asset)) { this.t = this.params.duration; this.as = target; this.world.emit('disguise', this.entity.id, target); }
  }
  update(dt) {
    const input = this.world.input || {};
    if (!this.entity.worn) return;
    if (input.revert || (this.params.duration > 0 && (this.t -= dt) <= 0)) { input.revert = false; this.world.wear?.(this.entity.id, null); this.world.emit('revert', this.entity.id); }
  }
  destroy() { if (this.entity.worn) this.world.wear?.(this.entity.id, null); }
}

// The INTACT walls of Colin's generated kit buildings (weirdport's buildKit): a root with `cells` ([[x, y], …] 3 m cells) and
// `heights` ({"x,y": floors}) extras is walled from those numbers — his export bakes no collider for a wall — one turned box per
// exposed cell edge per floor, on the building's frame (a cell spans local x 3x..3x+3, z −3y−3..−3y; origin at the front-left
// corner). A side whose wall is a chunked `wallB_*` piece is left to `Breakables` (its chunks are the collider, and they break).
export class KitWalls extends Behavior {
  static schema = {
    thick: { type: 'number', default: 0.25, min: 0.02, max: 1, step: 0.01 },   // m, inside the footprint
  };
  start() {
    this.solids = []; const o = this.entity.object3d; o.updateMatrixWorld?.(true);
    const roots = []; o.traverse?.(n => { if (n.userData?.cells && n.userData?.heights) roots.push(n); });
    for (const R of roots) {
      let cells, H; try { cells = JSON.parse(R.userData.cells); H = JSON.parse(R.userData.heights); } catch { continue; }
      const bay = R.userData.bay_m || 3, fl = R.userData.floor_m || 3, V = R.position.constructor, Q = R.quaternion.constructor;
      const yaw = (q => 2 * Math.atan2(q.y, q.w))(R.getWorldQuaternion(new Q())), h = (x, y) => H[`${x},${y}`] || 0;
      const chunked = []; R.traverse(n => { if (n.userData?.chunks) chunked.push([n.localToWorld(new V(0, 0, 0)), n.localToWorld(new V(bay / (n.getWorldScale(new V()).x || 1), 0, 0))]); });   // a wallB_ piece runs one bay along its +x
      const T = this.params.thick;
      for (const [x, y] of cells) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const top = h(x, y), low = h(x + dx, y + dy); if (top <= low) continue;
        // the edge in the building's frame: two corners, and the inward normal
        const x0 = bay * x, x1 = bay * (x + 1), z0 = -bay * y, z1 = -bay * (y + 1);
        const [a, b] = dx === 1 ? [[x1, z0], [x1, z1]] : dx === -1 ? [[x0, z0], [x0, z1]] : dy === 1 ? [[x0, z1], [x1, z1]] : [[x0, z0], [x1, z0]];
        for (let f = low; f < top; f++) {
          const ca = R.localToWorld(new V(a[0], f * fl, a[1])), cb = R.localToWorld(new V(b[0], f * fl, b[1]));
          const at = (p, q) => Math.hypot(p.x - q.x, p.z - q.z) < 0.3 && Math.abs(p.y - q.y) < 0.5;
          if (chunked.some(([p0, p1]) => (at(p0, ca) && at(p1, cb)) || (at(p0, cb) && at(p1, ca)))) continue;   // a breakable wall is there
          const inX = -dx * T / 2, inZ = dy * T / 2;      // half the thickness, into the cell
          const c = R.localToWorld(new V((a[0] + b[0]) / 2 + inX, (f + 0.5) * fl, (a[1] + b[1]) / 2 + inZ));
          const size = dx ? [T, fl, bay] : [bay, fl, T];
          const sol = Object.create(Solid.prototype);
          sol.world = this.world; sol.params = { size, anchor: 'center', slope: false, shape: 'box', rotated: true, layer: 'default' };
          sol.entity = { id: `${this.entity.id}#${R.name}:${x},${y}:${dx},${dy}:${f}`, owner: this.entity.id, object3d: { position: { x: c.x, y: c.y, z: c.z }, rotation: { x: 0, y: yaw, z: 0 } } };
          this.solids.push(sol);
        }
      }
    }
    (this.world.solids ||= []).push(...this.solids);
  }
  destroy() { const all = this.world.solids || []; for (const s of this.solids || []) { const i = all.indexOf(s); if (i >= 0) all.splice(i, 1); } this.solids = []; }
}

// Batch a model's STATIC meshes per material at Play (weirdport's kitBatch: his test row went 1,505 draws → 84). Skipped, so they
// keep working: skinned meshes, breakable walls (`chunks` — Breakables batches those itself, keeping each wall's vertex range),
// moving parts (`door` / `breakable`), colliders (`col_*`), anything hidden or marked `noBatch`, and other entities. Stop puts the
// original meshes back.
export class Batch extends Behavior {
  static schema = {};
  start() {
    const o = this.entity.object3d, list = [];
    const skip = n => n !== o && (n.userData?.entityId || n.userData?.chunks || n.userData?.door || (n.userData?.breakable && n.userData.breakable !== 'ac_unit') || n.userData?.collider || n.userData?.noBatch || /^col_/.test(n.name || '') || n.visible === false);
    const walk = n => { if (skip(n)) return; if (n.isMesh && !n.isSkinnedMesh && !n.userData?.batch) list.push(n); for (const c of n.children || []) walk(c); };
    walk(o);
    this.sources = list.length > 1 ? list : [];
    this.batches = this.sources.length ? mergeMeshes(o, this.sources) : [];
    for (const b of this.batches) o.add(b.mesh);
    for (const m of this.sources) m.visible = false;
    this.world.emit?.('batched', this.entity.id, this.sources.length, this.batches.length);
  }
  destroy() {
    for (const b of this.batches || []) { b.mesh.removeFromParent(); b.mesh.geometry.dispose?.(); }
    for (const m of this.sources || []) m.visible = true;
    this.batches = []; this.sources = [];
  }
}

// Where a world event happened, from its arguments: events that are a position (blast: x, y, z, r, dmg) start with it, events
// about something (chunk: id, wall, n, loud, x, y, z) end with it. null when there is no position.
export function eventPos(args) {
  const num = v => typeof v === 'number';
  if (args.length >= 3 && args.slice(0, 3).every(num)) return args.slice(0, 3);
  if (args.length >= 3 && args.slice(-3).every(num)) return args.slice(-3);
  return null;
}

// Particles on an entity (pure: it emits `fx` requests; the page draws them with runtime/particles.js): a burst every time a world
// event fires (`on`: 'chunk' → dust, 'shatter' → glass, 'blast' → sparks …; `mine` keeps it to events about this entity), placed
// where the event happened; or, with `on` '' and a `rate`, a steady stream from the entity (smoke from a chimney). Presets are in
// runtime/fxpresets.js (sparks, dust, smoke, glow, glass).
export class Emitter extends Behavior {
  static schema = {
    preset: { type: 'string', default: 'sparks' },
    on:     { type: 'string', default: '' },
    mine:   { type: 'boolean', default: true },
    count:  { type: 'number', default: 0, min: 0, max: 200, step: 1 },           // 0 = the preset's own
    scale:  { type: 'number', default: 1, min: 0.1, max: 10, step: 0.1 },         // size and speed
    rate:   { type: 'number', default: 0, min: 0, max: 200, step: 1 },           // per second, for a stream (`on` '')
    height: { type: 'number', default: 0, min: -5, max: 20, step: 0.1 },          // m up from the entity, when it is the source
    color:  { type: 'string', default: '' },                                       // '' = the preset's
    while:  { type: 'string', default: '' },   // stream only while this is true: "Behavior.prop" on this entity, or "entity:Behavior.prop" (Skater.grind, player:Blaster.charging)
  };
  // the `while` condition: a behavior's property, here or on another entity
  active() {
    const w = this.params.while; if (!w) return true;
    const [eid, path] = w.includes(':') ? w.split(':') : [null, w], [cls, prop] = path.split('.');
    const e = eid ? this.world.getEntity?.(eid) : this.entity, b = e?.behaviors?.find(x => x.constructor.name === cls);
    return !!(b && b[prop]);
  }
  start() {
    const P = this.params; this.acc = 0;
    if (P.on) this.world.on?.(P.on, (...a) => { if (!P.mine || a[0] === this.entity.id || typeof a[0] !== 'string') this.emit(eventPos(a), P.count || undefined); });
  }
  here() { const p = this.entity.object3d?.position; if (!p) return null; const v = this.entity.object3d.getWorldPosition ? this.entity.object3d.getWorldPosition(new p.constructor()) : p; return [v.x, v.y + this.params.height, v.z]; }
  emit(at, count) { const P = this.params; at = at || this.here(); if (at) this.world.emit('fx', { preset: P.preset, at, count, scale: P.scale, color: P.color || null }); }
  update(dt) {
    const P = this.params; if (P.on || !P.rate) return;
    if (!this.active()) { this.acc = 0; return; }
    this.acc += P.rate * dt; const n = Math.floor(this.acc);
    if (n > 0) { this.acc -= n; this.emit(null, n); }
  }
}

// A ribbon trail off bones (Roller Girl's blade and hand trails; a katana's swing): after the animation, each named bone's world
// position is sampled and sent as a `trail` (the page draws them, runtime/trails.js). It shows with SPEED — from nothing at
// `minSpeed` to full at `fullSpeed` (m/s of the point itself), so a standing skater has none and a fast carve or a swing streaks.
export class Trail extends Behavior {
  static schema = {
    bones:     { type: 'string', default: 'mixamorig_LeftToeBase, mixamorig_RightToeBase' },   // comma list ('' = the entity)
    life:      { type: 'number', default: 0.22, min: 0.05, max: 2, step: 0.01 },
    width:     { type: 'number', default: 0.12, min: 0.01, max: 2, step: 0.01 },
    color:     { type: 'string', default: '#e8fbff' },
    minSpeed:  { type: 'number', default: 6, min: 0, max: 50, step: 0.5 },
    fullSpeed: { type: 'number', default: 14, min: 0.1, max: 80, step: 0.5 },
  };
  start() { this.pts = null; this.last = new Map(); }
  lateUpdate(dt) {
    if (dt <= 0) return;
    const o = this.entity.object3d, P = this.params;
    if (!this.pts) {
      const names = P.bones.split(',').map(x => x.trim()).filter(Boolean);
      this.pts = names.length ? names.map(n => o.getObjectByName?.(n)).filter(Boolean) : [o];
    }
    const V = o.position.constructor;
    for (const b of this.pts) {
      const p = b.getWorldPosition(new V()), at = [p.x, p.y, p.z], prev = this.last.get(b); this.last.set(b, at);
      if (!prev) continue;
      const v = Math.hypot(at[0] - prev[0], at[1] - prev[1], at[2] - prev[2]) / dt, k = (v - P.minSpeed) / Math.max(1e-6, P.fullSpeed - P.minSpeed);
      if (k > 0.01) this.world.emit('trail', { key: `${this.entity.id}:${b.name || 'root'}`, at, width: P.width, life: P.life, color: P.color, strength: Math.min(1, k) });
    }
  }
}

// Read a HUD value: a world variable by name ("score"), or a behavior property on an entity ("player:Health.current",
// "Health.current" = this entity). Pure.
export function hudValue(world, self, ref) {
  if (!ref) return '';
  if (!ref.includes('.')) return world.vars?.[ref] ?? '';
  const [eid, path] = ref.includes(':') ? ref.split(':') : [null, ref], [cls, prop] = path.split('.');
  const b = (eid ? world.getEntity?.(eid) : self)?.behaviors?.find(x => x.constructor.name === cls);
  return b?.[prop] ?? b?.params?.[prop] ?? '';
}

// Text on the screen, authored in the scene (pure: it sends `hudset` when the text changes; the page draws it): a `text` with
// {names} filled from world variables or behavior properties — "{score} pts", "♥ {player:Health.current}". `corner`:
// top-left | top | top-right | bottom-left | bottom | bottom-right | center.
export class HudLabel extends Behavior {
  static schema = {
    text:   { type: 'string', default: '{score}' },
    corner: { type: 'string', default: 'top-right' },
    size:   { type: 'number', default: 22, min: 8, max: 96, step: 1 },
    color:  { type: 'string', default: '#ffffff' },
  };
  hid() { return `${this.entity.id}:label${this.entity.behaviors?.indexOf(this) ?? 0}`; }
  start() { this.last = null; this.update(0); this.world.on?.('hudrefresh', () => { this.last = null; }); }   // the page asks again once it listens
  update() {
    const P = this.params, text = P.text.replace(/\{([^}]+)\}/g, (_, r) => { const v = hudValue(this.world, this.entity, r.trim()); return typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v); });
    if (text === this.last) return; this.last = text;
    this.world.emit('hudset', { id: this.hid(), kind: 'label', text, corner: P.corner, size: P.size, color: P.color });
  }
  destroy() { this.world.emit?.('hudset', { id: this.hid(), remove: true }); }
}

// A bar on the screen (health, boost, a timer): `value` over `max` (each a number, or a reference like HudLabel's).
export class HudBar extends Behavior {
  static schema = {
    value:  { type: 'string', default: 'Health.current' },
    max:    { type: 'string', default: 'Health.max' },
    label:  { type: 'string', default: '' },
    corner: { type: 'string', default: 'top-left' },
    color:  { type: 'string', default: '#3ddc84' },
    width:  { type: 'number', default: 160, min: 40, max: 600, step: 10 },
  };
  hid() { return `${this.entity.id}:bar${this.entity.behaviors?.indexOf(this) ?? 0}`; }
  start() { this.last = null; this.update(0); this.world.on?.('hudrefresh', () => { this.last = null; }); }   // the page asks again once it listens
  update() {
    const P = this.params, num = r => { const n = +r; return Number.isFinite(n) && String(r).trim() !== '' ? n : +hudValue(this.world, this.entity, r) || 0; };
    const k = Math.max(0, Math.min(1, num(P.value) / (num(P.max) || 1))), key = k.toFixed(3);
    if (key === this.last) return; this.last = key;
    this.world.emit('hudset', { id: this.hid(), kind: 'bar', value: k, label: P.label, corner: P.corner, color: P.color, width: P.width });
  }
  destroy() { this.world.emit?.('hudset', { id: this.hid(), remove: true }); }
}

// A prompt on the screen while someone is near ("Hold ↑ to shoot", "Grind the rail!"): `text` at the bottom while `who` is
// within `radius` of this entity, gone when they leave. Pure: `hudset` in, `hudset` remove out.
export class HudPrompt extends Behavior {
  static schema = {
    text:   { type: 'string', default: 'Hello!' },
    who:    { type: 'string', default: 'player' },
    radius: { type: 'number', default: 3, min: 0.5, max: 50, step: 0.5 },
    corner: { type: 'string', default: 'bottom' },
  };
  start() { this.on = false; this.world.on?.('hudrefresh', () => { if (this.on) { this.on = false; } }); }
  update() {
    const w = this.world.getEntity?.(this.params.who)?.object3d?.position, p = this.entity.object3d?.position; if (!w || !p) return;
    const inside = Math.hypot(w.x - p.x, w.z - p.z) <= this.params.radius && Math.abs(w.y - p.y) < 4;
    if (inside === this.on) return; this.on = inside;
    this.world.emit('hudset', inside ? { id: this.entity.id + ':prompt', kind: 'label', text: this.params.text, corner: this.params.corner, size: 20, color: '#ffffff' } : { id: this.entity.id + ':prompt', remove: true });
  }
  destroy() { this.world.emit?.('hudset', { id: this.entity.id + ':prompt', remove: true }); }
}

// A checkpoint: when `who` comes within `radius`, this becomes where they respawn (every behavior of theirs that keeps a `spawn`:
// PlayerController, Skater), `checkpoint` (a world variable) names it, and 'checkpoint' fires (the page saves progress then).
// Loading a save that names this checkpoint puts them here at the start.
export class Checkpoint extends Behavior {
  static schema = {
    who:    { type: 'string', default: 'player' },
    radius: { type: 'number', default: 2.5, min: 0.5, max: 30, step: 0.5 },
    text:   { type: 'string', default: 'Checkpoint!' },    // '' = no message
  };
  start() {
    this.done = false;
    this.resume = this.world.vars?.checkpoint === this.entity.id;   // a saved game resumes here (on the first frame, once every spawn is set)
  }
  here() { const p = this.entity.object3d.position; return [p.x, p.y, p.z]; }
  claim(silent) {
    const who = this.world.getEntity?.(this.params.who); if (!who) return;
    const at = this.here(); this.done = true;
    for (const b of who.behaviors || []) if (Array.isArray(b.spawn)) b.spawn = [...at];
    (this.world.vars ||= {}).checkpoint = this.entity.id;
    if (silent) { const p = who.object3d.position; p.x = at[0]; p.y = at[1]; p.z = at[2]; return; }
    if (this.params.text) this.world.emit('hud', this.params.text, 1.5);
    this.world.emit('checkpoint', who.id, this.entity.id, ...at);
  }
  update() {
    if (this.resume) { this.resume = false; this.claim(true); return; }
    if (this.done) return;
    const w = this.world.getEntity?.(this.params.who)?.object3d?.position, p = this.entity.object3d.position; if (!w) return;
    if (Math.hypot(w.x - p.x, w.z - p.z) <= this.params.radius && Math.abs(w.y - p.y) < 3) this.claim(false);
  }
}

// The camera, authored in the scene (pure data the play page reads every frame — `pickRig`). `follow`: behind the target at
// `distance`, looking at `height` above it, tilted `pitch` degrees, the right stick orbiting it; `fixed`: from THIS entity's
// position, looking at the target (a security-cam room, a side-on stretch). With a `zone` (m), the rig only takes over while the
// target is within it of this entity; the active rig with the highest `priority` wins. Shakes on `shakeOn` (a world event).
export class CameraRig extends Behavior {
  static schema = {
    mode:     { type: 'string', default: 'follow' },        // follow | fixed | rail
    path:     { type: 'string', default: '' },              // rail: "x,y,z; x,y,z; …" — the camera slides along it, kept nearest the target
    target:   { type: 'string', default: 'player' },
    distance: { type: 'number', default: 7, min: 1, max: 60, step: 0.5 },
    height:   { type: 'number', default: 1.3, min: 0, max: 10, step: 0.1 },
    pitch:    { type: 'number', default: 20, min: -30, max: 85, step: 1 },     // degrees down
    fov:      { type: 'number', default: 60, min: 20, max: 110, step: 1 },
    lag:      { type: 'number', default: 8, min: 1, max: 40, step: 0.5 },      // how fast it catches up (1/s)
    zone:     { type: 'number', default: 0, min: 0, max: 200, step: 0.5 },     // 0 = everywhere
    priority: { type: 'number', default: 0, min: -10, max: 10, step: 1 },
    shakeOn:  { type: 'string', default: '' },                                   // e.g. 'blast'
    shake:    { type: 'number', default: 0.25, min: 0, max: 3, step: 0.05 },
  };
  start() {
    (this.world.cameraRigs ||= []).push(this);
    if (this.params.shakeOn) this.world.on?.(this.params.shakeOn, () => this.world.emit('shake', this.params.shake, 0.3));
  }
  destroy() { const l = this.world.cameraRigs; if (l) { const i = l.indexOf(this); if (i >= 0) l.splice(i, 1); } }
  // rail: the point of the path nearest the target (in plan), or null
  railPoint([tx, , tz]) {
    if (this.pathSrc !== this.params.path) { this.pathSrc = this.params.path; this.pts = String(this.params.path).split(';').map(t => t.split(',').map(Number)).filter(a => a.length === 3 && a.every(Number.isFinite)); }
    const P = this.pts; if (!P.length) return null; if (P.length === 1) return P[0];
    let best = null, bd = Infinity;
    for (let i = 0; i + 1 < P.length; i++) {
      const [ax, ay, az] = P[i], [bx, by, bz] = P[i + 1], dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((tx - ax) * dx + (tz - az) * dz) / L)), x = ax + dx * t, z = az + dz * t, d = (x - tx) ** 2 + (z - tz) ** 2;
      if (d < bd) { bd = d; best = [x, ay + (by - ay) * t, z]; }
    }
    return best;
  }
  active() {
    if (!this.params.zone) return true;
    const t = this.world.getEntity?.(this.params.target)?.object3d?.position, p = this.entity.object3d?.position;
    return !!(t && p && Math.hypot(t.x - p.x, t.z - p.z) <= this.params.zone);
  }
}
// The rig in charge this frame (or null: the page's own camera)
export function pickRig(world) {
  let best = null;
  for (const r of world.cameraRigs || []) if (r.active() && (!best || r.params.priority >= best.params.priority)) best = r;
  return best;
}

// A sound (a file) on an entity: at Play (`on` '') — usually a loop, like an engine or a fountain — or every time a world event
// fires (`on` 'shoot', 'chunk', 'shatter', 'land' …; with `mine`, only the events about THIS entity, i.e. whose first argument is
// its id). Spatial sounds come from where the event happened (its last three numbers, when it ends in a position) or from the
// entity, and fall off with distance past `ref` metres. Pure: it emits an `audio` request; the game page plays it (runtime/audio.js).
export class AudioSource extends Behavior {
  static schema = {
    clip:     { type: 'string', default: '' },                                    // a sound file, e.g. ./assets/audio/colin/blaster_sound_01.mp3
    on:       { type: 'string', default: '' },                                    // world event that plays it ('' = at Play)
    mine:     { type: 'boolean', default: true },                                 // only events about this entity
    loop:     { type: 'boolean', default: false },
    volume:   { type: 'number', default: 1, min: 0, max: 2, step: 0.05 },
    pitch:    { type: 'number', default: 1, min: 0.25, max: 4, step: 0.05 },
    pitchVar: { type: 'number', default: 0.06, min: 0, max: 1, step: 0.01 },     // ± random, so a repeated sound is not a machine gun of one
    spatial:  { type: 'boolean', default: true },
    ref:      { type: 'number', default: 4, min: 0.1, max: 100, step: 0.5 },     // m before it starts to fall off
    bus:      { type: 'string', default: 'sfx' },                                 // sfx | music
  };
  start() {
    const P = this.params; if (!P.clip) return;
    this.key = P.loop ? `${this.entity.id}:${P.clip}` : null;
    if (!P.on) { this.play([]); return; }
    this.world.on?.(P.on, (...a) => { if (!P.mine || a[0] === this.entity.id || typeof a[0] !== 'string') this.play(a); });
  }
  play(args) {
    const P = this.params, tail = eventPos(args);
    const p = this.entity.object3d?.position, r = (this.world.rng?.() ?? Math.random()) * 2 - 1;
    this.world.emit('audio', { url: P.clip, volume: P.volume, pitch: P.pitch * (1 + P.pitchVar * r), loop: P.loop, bus: P.bus, ref: P.ref, key: this.key,
      at: P.spatial ? (tail || (p ? [p.x, p.y, p.z] : null)) : null, follow: P.spatial && !tail && P.loop ? this.entity.id : null });
  }
  destroy() { if (this.key) this.world.emit?.('audiostop', this.key); }
}

// Ledge grab (zap's LEDGE, docs/goblin-extraction.md): falling past the top edge of a block with the stick pushed INTO it
// catches the lip — he hangs (`hangClip`). Tap: climb up over it (`climbClip`) and stand on top. Stick pulled away: let go.
// Every distance is a share of his height (the PlayerController's `height`), so it fits any body.
export class Ledge extends Behavior {
  static schema = {
    hangClip:  { type: 'string', default: 'ledge_hang_idle' },
    climbClip: { type: 'string', default: 'ledge_hang_to_get_up_over_ledge' },
    climbTime: { type: 'number', default: 1.0, min: 0.2, max: 3, step: 0.05 },   // s from hanging to standing on top
    hang:  { type: 'number', default: 0.86, min: 0.3, max: 1.5, step: 0.01 },    // × height: his feet hang this far under the lip
    out:   { type: 'number', default: 0.17, min: 0, max: 0.6, step: 0.01 },      // × height: his body sits this far off the face
    band:  { type: 'number', default: 0.3, min: 0.05, max: 1, step: 0.01 },      // × height: how far off his hands the lip may be
    reach: { type: 'number', default: 0.5, min: 0, max: 2, step: 0.05 },         // m off the face (beyond his radius) that still grabs
    want:  { type: 'number', default: 0.35, min: 0, max: 1, step: 0.05 },        // stick INTO the face needed (0 = grab anything)
    inset: { type: 'number', default: 0.4, min: 0.1, max: 1.5, step: 0.05 },     // × height: how far onto the top a climb sets him
    tall:  { type: 'number', default: 0.9, min: 0, max: 5, step: 0.05 },         // m: a block shorter than this is a kerb, not a ledge
  };
  start() { this.pc = this.entity.behaviors.find(b => b instanceof PlayerController); this.hold = null; this.coolT = 0; this.clip = this.params.hangClip; }
  destroy() { if (this.entity.mover === this) this.entity.mover = null; }
  h() { return this.pc?.params.height ?? 1.75; }
  r() { return this.pc?.params.radius ?? 0.35; }
  find(move) {
    const p = this.entity.object3d.position, P = this.params, H = this.h(), mag = Math.hypot(move[0], move[1]);
    let best = null;
    for (const solid of this.world.solids || []) {
      if ((solid.params?.shape && solid.params.shape !== 'box') || solid.params?.slope) continue;
      const sh = walkShape(solid), lip = sh.maxY;
      if (sh.maxY - sh.minY < P.tall || Math.abs(lip - p.y - P.hang * H) > P.band * H) continue;
      const { cx, cz, inside } = sh.near(p.x, p.z); if (inside) continue;
      const d = Math.hypot(p.x - cx, p.z - cz); if (d < 1e-6 || d > this.r() + P.reach || (best && d >= best.d)) continue;
      const nx = (p.x - cx) / d, nz = (p.z - cz) / d;
      if (P.want > 0 && (mag < 0.2 || -(move[0] * nx + move[1] * nz) / mag < P.want)) continue;   // only when he asks for it
      // headroom: nothing solid standing on the lip where he would climb to
      const ux = cx - nx * P.inset * H, uz = cz - nz * P.inset * H;
      if ((this.world.solids || []).some(o => o !== solid && walkShape(o).topNear(ux, uz, this.r()) > lip + 0.1 && walkShape(o).minY < lip + H)) continue;
      best = { solid, shape: sh, d, nx, nz, cx, cz, lip };
    }
    return best;
  }
  update(dt) {
    this.coolT = Math.max(0, this.coolT - dt);
    const pc = this.pc; if (!pc || dt <= 0) return;
    const o = this.entity.object3d, p = o.position, P = this.params, H = this.h(), input = this.world.input || {}, move = input.move || [0, 0];
    const L = this.hold;
    if (!L) {
      if (this.entity.mover || pc.grounded || pc.vy > 0 || this.coolT > 0 || this.entity.defeated) return;
      const W = this.find(move); if (!W) return;
      this.hold = { ...W, t: 0, climb: -1 };
      p.x = W.cx + W.nx * (this.r() * 0.5 + P.out * H); p.z = W.cz + W.nz * (this.r() * 0.5 + P.out * H); p.y = W.lip - P.hang * H;
      setYaw(o, Math.atan2(-W.nx, -W.nz), 0);
      this.clip = P.hangClip; this.entity.mover = this; pc.vy = 0; pc.carry = null;
      this.world.emit('ledge', this.entity.id);
      return;
    }
    L.t += dt;
    if (L.climb < 0) {
      if (input.jump) { input.jump = false; L.climb = 0; L.from = [p.x, p.y, p.z]; L.to = [L.cx - L.nx * P.inset * H, L.lip, L.cz - L.nz * P.inset * H]; this.clip = P.climbClip; this.world.emit('climb', this.entity.id); return; }
      if (L.t > 0.25 && move[0] * L.nx + move[1] * L.nz > 0.62) { this.let(); return; }   // pulled away: let go
      return;
    }
    // climbing: up to the lip first, then over it
    L.climb = Math.min(1, L.climb + dt / P.climbTime);
    const ease = x => x * x * (3 - 2 * x), up = ease(Math.min(1, L.climb / 0.6)), over = ease(Math.max(0, (L.climb - 0.4) / 0.6));
    p.y = L.from[1] + (L.to[1] - L.from[1]) * up;
    p.x = L.from[0] + (L.to[0] - L.from[0]) * over; p.z = L.from[2] + (L.to[2] - L.from[2]) * over;
    if (L.climb >= 1) { this.hold = null; this.entity.mover = null; pc.grounded = true; pc.vy = 0; pc.sinceGround = 0; pc.airJumpCount = 0; }
  }
  let() { this.hold = null; this.coolT = 0.4; if (this.entity.mover === this) this.entity.mover = null; this.pc.vy = 0; this.pc.grounded = false; this.pc.sinceGround = 1; }
}

// Vault (zap's VAULT, docs/goblin-extraction.md): TAP while moving into a low block (a hurdle: between `low` and `high` × his
// height, at most `depth` m deep) → a driven arc over it in the `clip` pose (zap's tuck: no baked motion to fight the arc),
// ending just past the far face still in the air, with his speed carried on (`out`). A tap anywhere else is still a jump.
export class Vault extends Behavior {
  static schema = {
    clip:  { type: 'string', default: 'tuck' },
    low:   { type: 'number', default: 0.25, min: 0, max: 1, step: 0.05 },     // × height: lower than this is a step
    high:  { type: 'number', default: 0.9, min: 0.2, max: 2, step: 0.05 },     // × height: higher is a wall (climb it)
    depth: { type: 'number', default: 2, min: 0.2, max: 6, step: 0.1 },        // m: deeper is a platform, not a hurdle
    reach: { type: 'number', default: 0.8, min: 0, max: 3, step: 0.05 },       // m off the face (beyond his radius)
    time:  { type: 'number', default: 0.5, min: 0.15, max: 2, step: 0.05 },    // s over the top
    clear: { type: 'number', default: 0.3, min: 0, max: 2, step: 0.05 },       // m his feet clear the top by
    beyond:{ type: 'number', default: 0.15, min: 0, max: 2, step: 0.05 },      // m past the far face where the arc lets go
    out:   { type: 'number', default: 6.5, min: 0, max: 15, step: 0.5 },       // m/s carried on after
  };
  start() {
    this.pc = this.entity.behaviors.find(b => b instanceof PlayerController); this.arc = null; this.clip = this.params.clip;
    this.onTap = move => this.tap(move); (this.entity.jumpTaps ||= []).push(this.onTap);
  }
  destroy() { if (this.entity.mover === this) this.entity.mover = null; const l = this.entity.jumpTaps, i = l ? l.indexOf(this.onTap) : -1; if (i >= 0) l.splice(i, 1); }
  tap(move) {
    const pc = this.pc, mag = Math.hypot(move[0], move[1]); if (!pc || this.arc || !pc.grounded || mag < 0.3) return false;
    const p = this.entity.object3d.position, P = this.params, H = pc.params.height, r = pc.params.radius, mx = move[0] / mag, mz = move[1] / mag;
    let best = null;
    for (const solid of this.world.solids || []) {
      if ((solid.params?.shape && solid.params.shape !== 'box') || solid.params?.slope) continue;
      const sh = walkShape(solid), top = sh.maxY - p.y;
      if (top < P.low * H || top > P.high * H || sh.minY > p.y + 0.2) continue;
      const { cx, cz, inside } = sh.near(p.x, p.z); if (inside) continue;
      const d = Math.hypot(p.x - cx, p.z - cz); if (d < 1e-6 || d > r + P.reach || (best && d >= best.d)) continue;
      const nx = (p.x - cx) / d, nz = (p.z - cz) / d; if (-(mx * nx + mz * nz) < 0.6) continue;      // heading into it
      // how deep it is along his line: march through until out the far side
      let t = 0; while (t < P.depth + 0.1 && sh.topNear(cx - nx * (t + 0.05), cz - nz * (t + 0.05), 0.01) > -Infinity) t += 0.05;
      if (t > P.depth) continue;
      best = { d, nx, nz, cx, cz, top: sh.maxY, through: t };
    }
    if (!best) return false;
    const travel = best.d + best.through + r + P.beyond;
    this.arc = { t: 0, from: [p.x, p.y, p.z], dx: -best.nx, dz: -best.nz, travel, apex: best.top + P.clear, y0: p.y };
    setYaw(this.entity.object3d, Math.atan2(-best.nx, -best.nz), 0);
    this.entity.mover = this; this.world.emit('vault', this.entity.id); this.world.emit('jump');
    return true;
  }
  update(dt) {
    const A = this.arc; if (!A || dt <= 0) return;
    const p = this.entity.object3d.position, P = this.params;
    A.t = Math.min(1, A.t + dt / P.time);
    // along: steady; up: a parabola through the apex at 45 % of the way (he is coming down as he lets go)
    const u = A.t, k = 0.45, rise = A.apex - A.y0, y = u < k ? A.y0 + rise * (1 - ((u - k) / k) ** 2) : A.y0 + rise * (1 - ((u - k) / (1 - k)) ** 2 * 0.55);
    p.x = A.from[0] + A.dx * A.travel * u; p.z = A.from[2] + A.dz * A.travel * u; p.y = y;
    if (A.t >= 1) {
      this.arc = null; if (this.entity.mover === this) this.entity.mover = null;
      const pc = this.pc; pc.grounded = false; pc.sinceGround = 1; pc.vy = -2; pc.airTime = 0.2;
      pc.carry = [A.dx * P.out, A.dz * P.out];
    }
  }
}

// A sword duelist (zap's AI samurai, DUEL.md — the readable core of it): walks up to a stand-off from `target`, and in reach
// WINDS UP (the swing clip slowed right down — the tell), then strikes (the clip at speed; a hit if you are still in reach and in
// front). Strike him DURING the wind-up and it is cancelled: he staggers and takes the hit. Otherwise your swing has a
// `guardChance` of meeting his guard (no damage, 'blocked'). `hp` hits put him down. Emits windup / hurt / blocked / interrupt.
export class Duelist extends Behavior {
  static hittable = true;   // Melee strikes and locks on to it
  static schema = {
    target:  { type: 'string', default: 'player' },
    hp:      { type: 'number', default: 5, min: 1, max: 50, step: 1 },
    speed:   { type: 'number', default: 3.5, min: 0, max: 15, step: 0.1 },
    sight:   { type: 'number', default: 14, min: 1, max: 60, step: 0.5 },     // m: further than this he waits
    standOff:{ type: 'number', default: 1.6, min: 0.5, max: 5, step: 0.1 },    // m he closes to
    reach:   { type: 'number', default: 2.1, min: 0.5, max: 6, step: 0.1 },
    arc:     { type: 'number', default: 120, min: 10, max: 360, step: 5 },
    windup:  { type: 'number', default: 0.5, min: 0, max: 3, step: 0.05 },    // s of the tell
    windRate:{ type: 'number', default: 0.25, min: 0.05, max: 1, step: 0.05 }, // the swing clip's speed during the tell
    hitAt:   { type: 'number', default: 0.25, min: 0, max: 2, step: 0.05 },   // s from the strike to the contact
    rest:    { type: 'vec3', default: [1.1, 2.2, 0] },                         // s between attacks: random in [x, y]
    damage:  { type: 'number', default: 1, min: 0, max: 10, step: 1 },
    guardChance: { type: 'number', default: 0.35, min: 0, max: 1, step: 0.05 },
    combo:   { type: 'string', default: 'katana_slash_2, katana_slash_4' },
    guardClip: { type: 'string', default: 'katana_block' },
    hitClip:   { type: 'string', default: '' },    // '' = the hit role
  };
  start() {
    this.st = 'idle'; this.t = 0; this.hpLeft = this.params.hp; this.n = 0; this.restT = this.roll();
    this.world.on('struck', (_by, id, dmg) => { if (id === this.entity.id) this.struck(dmg ?? 1); });
    this.world.on('swing', id => {               // your swing: maybe he guards it
      if (id !== this.params.target || this.entity.defeated || !['idle', 'rest'].includes(this.st)) return;
      if (this.dist() < this.params.reach + 1 && this.rng() < this.params.guardChance) this.set('guard', 0.6, this.params.guardClip, 1);
    });
  }
  rng() { return this.world.rng ? this.world.rng() : Math.random(); }
  roll() { const [a, b] = this.params.rest; return a + (b - a) * this.rng(); }
  tgt() { return this.world.getEntity?.(this.params.target); }
  dist() { const t = this.tgt(); if (!t) return Infinity; const p = this.entity.object3d.position, q = t.object3d.position; return Math.hypot(q.x - p.x, q.z - p.z); }
  play(clip, speed = 1, hold = 0) {
    const a = this.entity.anim; if (!clip || !a?.clips.includes(clip)) return;
    a.play(clip, { once: true, fade: 0.08, restart: true, speed }); this.entity.animHold = hold;
  }
  set(st, t, clip, speed = 1) { this.st = st; this.t = t; if (clip) this.play(clip, speed, t + 0.05); }
  struck(dmg) {
    const e = this.entity; if (e.defeated) return;
    if (this.st === 'guard') { this.world.emit('blocked', e.id); return; }
    const interrupted = this.st === 'windup';
    this.hpLeft -= dmg; this.world.emit('duelhit', e.id, this.hpLeft);
    if (interrupted) this.world.emit('interrupt', e.id);
    if (this.hpLeft <= 0) {
      e.defeated = true; this.st = 'down';
      const death = roleClip('', 'death', e.roles); this.play(death, 1, 99);
      this.world.emit('stomp', e.id); this.world.emit('score', 5); return;
    }
    this.set('stagger', interrupted ? 0.8 : 0.45, roleClip(this.params.hitClip, 'hit', e.roles), 1.2);
  }
  update(dt) {
    const e = this.entity, P = this.params, t = this.tgt(); if (e.defeated || !t || dt <= 0) return;
    const o = e.object3d, p = o.position, q = t.object3d.position, dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
    if (d > 1e-3 && this.st !== 'strike') setYaw(o, Math.atan2(dx, dz));            // always facing you (but committed while striking)
    this.t -= dt;
    switch (this.st) {
      case 'idle': case 'rest': {
        if (this.st === 'rest' && (this.restT -= dt) <= 0) this.st = 'idle';
        if (d > P.sight) break;
        if (d > P.standOff) { const k = Math.min(P.speed * dt, d - P.standOff); p.x += dx / d * k; p.z += dz / d * k; }
        if (this.st === 'idle' && d <= P.reach) {
          const chain = P.combo.split(',').map(c => c.trim()).filter(Boolean);
          this.clip = chain.length ? chain[this.n++ % chain.length] : roleClip('', 'attack', e.roles);
          this.set('windup', P.windup, this.clip, P.windRate); this.world.emit('windup', e.id);
        }
        break;
      }
      case 'windup': if (this.t <= 0) { this.set('strike', P.hitAt + 0.35); this.entity.animHold = P.hitAt + 0.45; this.entity.anim?.action?.()?.setEffectiveTimeScale?.(1.5); this.hitDue = P.hitAt; } break;
      case 'strike':
        if (this.hitDue > 0 && (this.hitDue -= dt) <= 0) {
          const cos = Math.cos((P.arc / 2) * Math.PI / 180), y = yawOf(o), f = (dx * Math.sin(y) + dz * Math.cos(y)) / (d || 1);
          if (d <= P.reach && f >= cos && Math.abs(q.y - p.y) < 1.5) this.world.emit('hurt', P.damage);
        }
        if (this.t <= 0) { this.st = 'rest'; this.restT = this.roll(); }
        break;
      case 'guard': case 'stagger': if (this.t <= 0) { this.st = 'rest'; this.restT = this.roll() * 0.6; } break;
    }
  }
}

// The zoom (zap's ZOOM, PARKOUR.md): HOLD the left pad in place (world.input.charge) on the ground to wind up — he slows and the
// charge builds over `time` s; let go and he dashes along his facing (or the stick) at `slow`..`fast` m/s by the charge, in the
// `clip` run, for `dash` s, then hands his speed back (it bleeds off). Under `min` of a charge it is nothing. Emits 'zoom'
// (power 0..1) — the game page widens the lens with it.
export class Zoom extends Behavior {
  static schema = {
    clip:  { type: 'string', default: 'ninja_run' },
    time:  { type: 'number', default: 1.1, min: 0.2, max: 4, step: 0.05 },    // s to a full charge
    min:   { type: 'number', default: 0.25, min: 0, max: 1, step: 0.05 },    // share of a full charge that does anything
    slow:  { type: 'number', default: 10, min: 1, max: 40, step: 0.5 },      // m/s at the smallest charge
    fast:  { type: 'number', default: 17, min: 1, max: 40, step: 0.5 },      // m/s at a full charge
    dash:  { type: 'number', default: 0.7, min: 0.1, max: 3, step: 0.05 },   // s at speed
    still: { type: 'number', default: 0.15, min: 0, max: 1, step: 0.05 },    // move speed × this while charging
  };
  start() { this.pc = this.entity.behaviors.find(b => b instanceof PlayerController); this.charge = 0; this.run = null; this.clip = this.params.clip; }
  destroy() { if (this.entity.mover === this) this.entity.mover = null; }
  update(dt) {
    const pc = this.pc, P = this.params, o = this.entity.object3d, p = o.position, input = this.world.input || {};
    if (!pc || dt <= 0) return;
    if (this.run) {
      const R = this.run; R.t += dt;
      const v = R.v * (1 - 0.35 * R.t / P.dash);
      const nx = p.x + R.dx * v * dt, nz = p.z + R.dz * v * dt;
      const hit = this.world.sweep?.([p.x, p.y + 0.5, p.z], [R.dx, 0, R.dz], pc.params.radius, { maxDist: v * dt + 0.05, ignore: this.entity.id });
      if (hit || R.t >= P.dash) { this.end(hit ? 0 : v); return; }
      p.x = nx; p.z = nz;
      return;
    }
    if (input.charge && pc.grounded && !this.entity.mover) {
      if (!this.charge) this.world.emit('charge', this.entity.id);
      this.charge = Math.min(1, this.charge + dt / P.time); this.entity.moveScale = P.still;
      return;
    }
    if (this.charge > 0) {                     // let go
      const k = this.charge; this.charge = 0; this.entity.moveScale = 1;
      if (k < P.min || !pc.grounded) return;
      const m = input.move || [0, 0], mag = Math.hypot(m[0], m[1]), y = yawOf(o);
      const dx = mag > 0.3 ? m[0] / mag : Math.sin(y), dz = mag > 0.3 ? m[1] / mag : Math.cos(y);
      this.run = { t: 0, dx, dz, v: P.slow + (P.fast - P.slow) * k };
      setYaw(o, Math.atan2(dx, dz)); this.entity.mover = this;
      this.world.emit('zoom', this.entity.id, k);
    }
  }
  end(v) { const R = this.run; this.run = null; if (this.entity.mover === this) this.entity.mover = null; if (v > 0) this.pc.carry = [R.dx * v * 0.6, R.dz * v * 0.6]; }
}

// A high bar (zap's HBAR): marks this entity as a bar to swing on — its centre is the entity's position, its axis the entity's
// local X (turn the entity to turn the bar). The HighBar behavior on the player does the swinging.
export class Bar extends Behavior {
  static schema = { length: { type: 'number', default: 2.6, min: 0.5, max: 10, step: 0.1 } };
  start() { (this.world.bars ||= []).push(this); }
  destroy() { const l = this.world.bars; if (l) { const i = l.indexOf(this); if (i >= 0) l.splice(i, 1); } }
  frame() {   // { c: [x,y,z], ax, az (along the bar), nx, nz (across it) }
    const o = this.entity.object3d, y = yawOf(o), ax = Math.cos(y), az = -Math.sin(y);
    return { c: [o.position.x, o.position.y, o.position.z], ax, az, nx: -az, nz: ax };
  }
}

// Swing on high bars (zap's HBAR): falling with his hands at a Bar catches it — he hangs (`hangClip`), a pendulum about the bar.
// The LEFT STICK pushed along the swing pumps it (a bit more each pass, then over the top: giant swings, capped at `maxW`).
// TAP lets go: he leaves along the swing's own tangent at its speed × `boost`, plus `lift`, front-flipping (`flipClip`).
export class HighBar extends Behavior {
  static schema = {
    hangClip: { type: 'string', default: 'bar_hang' },
    flipClip: { type: 'string', default: 'front_flip' },
    grabY:    { type: 'number', default: 0.45, min: 0.05, max: 2, step: 0.05 },   // m his hands may be off the bar and still catch
    grabR:    { type: 'number', default: 0.6, min: 0.05, max: 2, step: 0.05 },    // m off the bar across it
    reach:    { type: 'number', default: 1.2, min: 0.5, max: 2, step: 0.05 },     // × height: bar to feet while hanging
    gravity:  { type: 'number', default: 22, min: 1, max: 60, step: 1 },
    damp:     { type: 'number', default: 0.18, min: 0, max: 3, step: 0.01 },
    pump:     { type: 'number', default: 6, min: 0, max: 30, step: 0.5 },        // rad/s² while the stick pushes with the swing
    kick:     { type: 'number', default: 2.2, min: 0, max: 10, step: 0.1 },      // rad/s on the catch (in the way he was going)
    maxW:     { type: 'number', default: 12.5, min: 1, max: 30, step: 0.5 },     // rad/s
    boost:    { type: 'number', default: 1.5, min: 0.5, max: 3, step: 0.05 },
    lift:     { type: 'number', default: 2.5, min: 0, max: 10, step: 0.1 },
    cool:     { type: 'number', default: 0.45, min: 0, max: 3, step: 0.05 },
  };
  start() { this.pc = this.entity.behaviors.find(b => b instanceof PlayerController); this.hang = null; this.coolT = 0; this.clip = this.params.hangClip; }
  destroy() { if (this.entity.mover === this) this.entity.mover = null; if (this.hang) { const o = this.entity.object3d; setYaw(o, yawOf(o), 0, 0); o.rotation.order = 'XYZ'; this.hang = null; } }
  H() { return this.pc?.params.height ?? 1.75; }
  update(dt) {
    this.coolT = Math.max(0, this.coolT - dt);
    const pc = this.pc; if (!pc || dt <= 0 || this.entity.defeated) return;
    const P = this.params, o = this.entity.object3d, p = o.position, input = this.world.input || {}, S = this.hang;
    if (!S) {
      if (this.entity.mover || pc.grounded || pc.vy > 4 || this.coolT > 0) return;
      const hands = p.y + this.H() * 1.15;
      for (const bar of this.world.bars || []) {
        const F = bar.frame(), dx = p.x - F.c[0], dz = p.z - F.c[2], u = dx * F.ax + dz * F.az, w = dx * F.nx + dz * F.nz;
        if (Math.abs(u) > bar.params.length / 2 - 0.2 || Math.abs(w) > P.grabR || Math.abs(hands - F.c[1]) > P.grabY) continue;
        // which way he faces across the bar: the way he was moving across it, else the way he faces
        const vx = pc.carry?.[0] || 0, vz = pc.carry?.[1] || 0, vw = vx * F.nx + vz * F.nz, yaw = yawOf(o);
        const face = Math.abs(vw) > 0.4 ? Math.sign(vw) : (Math.sin(yaw) * F.nx + Math.cos(yaw) * F.nz >= 0 ? 1 : -1);
        this.hang = { bar, F, u: Math.max(-bar.params.length / 2 + 0.3, Math.min(bar.params.length / 2 - 0.3, u)), face, th: Math.asin(Math.max(-1, Math.min(1, w * face / (P.reach * this.H())))), w: P.kick };
        this.clip = P.hangClip; this.entity.mover = this; pc.vy = 0; pc.carry = null;
        o.rotation.order = 'YXZ'; setYaw(o, Math.atan2(F.nx * face, F.nz * face), 0);
        this.world.emit('barcatch', this.entity.id);
        break;
      }
      if (!this.hang) return;
    }
    const H = this.hang, F = H.F, R = P.reach * this.H(), Rm = R * 0.6;   // the swing's radius: bar to his middle
    if (input.jump) { input.jump = false; this.release(); return; }
    const move = input.move || [0, 0], fx = F.nx * H.face, fz = F.nz * H.face, along = move[0] * fx + move[1] * fz;
    let a = -(P.gravity / Rm) * Math.sin(H.th) - P.damp * H.w;
    if (Math.abs(along) > 0.2 && Math.sign(along) === Math.sign(H.w || along)) a += P.pump * along;
    H.w = Math.max(-P.maxW, Math.min(P.maxW, H.w + a * dt)); H.th += H.w * dt;
    if (H.th > Math.PI) H.th -= 2 * Math.PI; else if (H.th < -Math.PI) H.th += 2 * Math.PI;
    // feet = bar + R along (sin th forward, -cos th down); the body turns about the bar (pitch about his own X: YXZ order)
    p.x = F.c[0] + F.ax * H.u + fx * Math.sin(H.th) * R; p.z = F.c[2] + F.az * H.u + fz * Math.sin(H.th) * R; p.y = F.c[1] - Math.cos(H.th) * R;
    o.rotation.x = -H.th;
  }
  release() {
    const H = this.hang, P = this.params, o = this.entity.object3d, pc = this.pc, Rm = P.reach * this.H() * 0.6;
    const fx = H.F.nx * H.face, fz = H.F.nz * H.face, v = H.w * Rm * P.boost;    // tangent of the swing: (cos th forward, sin th up)
    this.hang = null; this.coolT = P.cool; if (this.entity.mover === this) this.entity.mover = null;
    const yaw = Math.atan2(fx, fz) + (H.w * Math.cos(H.th) < 0 ? Math.PI : 0);
    setYaw(o, yaw, 0, 0); o.rotation.order = 'XYZ';
    pc.grounded = false; pc.sinceGround = 1; pc.airTime = 0.2; pc.airJumpCount = 0;
    pc.vy = v * Math.sin(H.th) + P.lift; pc.carry = [fx * v * Math.cos(H.th), fz * v * Math.cos(H.th)];
    if (P.flipClip && this.entity.anim?.clips.includes(P.flipClip)) { this.entity.anim.play(P.flipClip, { once: true, fade: 0.05, restart: true }); this.entity.animHold = 0.7; }
    this.world.emit('jump'); this.world.emit('barrelease', this.entity.id);
  }
}

// Two hands on the sword (zap's katLeftGrip): after the pose, the left arm reaches (two-bone IK) so the left PALM lands on the
// mounted prop's handle, `at` prop units from its root (zap: 8 down the katana's grip). Only in the stance clips (`clips`), on
// the ground; it eases off for jumps, swings (an upper-layer clip), wall runs and ledges, and comes back eased.
export class HandGrip extends Behavior {
  static schema = {
    prop:  { type: 'string', default: '' },                          // the mounted prop's id ('' = my first child with a Mount)
    at:    { type: 'vec3', default: [0, -8, 0] },                     // grip point, in the prop's own units
    palm:  { type: 'number', default: 0.75, min: 0, max: 1, step: 0.05 },   // how far from wrist to finger root the palm sits
    clips: { type: 'string', default: 'katana_idle, katana_walk, katana_run, run_fast' },
    side:  { type: 'string', default: 'Left' },                       // which hand: Left | Right
    ease:  { type: 'number', default: 0.08, min: 0.01, max: 1, step: 0.01 },  // s half-life in and out
  };
  start() { this.w = 0; this.bones = null; }
  lateUpdate(dt) {
    const e = this.entity, o = e.object3d, anim = e.anim; if (!anim) return;
    if (!this.bones) {
      const S = this.params.side, g = n => o.getObjectByName?.(`mixamorig_${S}${n}`);
      const hand = g('Hand');
      this.bones = { up: g('Arm'), mid: g('ForeArm'), hand, finger: hand?.children.find(c => c.isBone && /Middle1$|Index1$/.test(c.name)) };
    }
    const B = this.bones; if (!B.up || !B.mid || !B.hand) return;
    const propId = this.params.prop || (e.children || []).find(id => this.world.getEntity?.(id)?.behaviors?.some(b => b instanceof Mount));
    const prop = propId && this.world.getEntity?.(propId); if (!prop?.object3d?.visible) return;
    const pc = e.behaviors.find(b => b instanceof PlayerController);
    const want = this.params.clips.split(',').map(x => x.trim()).includes(anim.current) && !anim.layer('upper') && !e.mover && (!pc || pc.grounded) && !e.defeated ? 1 : 0;
    this.w += (want - this.w) * (1 - Math.pow(0.5, dt / this.params.ease));
    if (this.w < 0.01) return;
    o.updateMatrixWorld(true);
    const V = o.position.constructor, [ax, ay, az] = this.params.at, target = prop.object3d.localToWorld(new V(ax, ay, az));
    if (B.finger) { const w0 = B.hand.getWorldPosition(new V()), f0 = B.finger.getWorldPosition(new V()); target.sub(f0.sub(w0).multiplyScalar(this.params.palm)); }
    ik2(B.up, B.mid, B.hand, target, this.w);
  }
}

// A tail that waves (Roller Girl's TAIL 'wave' mode, his visualizer's method): from the bone named `root` outward along the
// single child matching `match`, every bone's WORLD orientation eases toward where its parent — as drawn — would carry it rigidly,
// quickly at the root (`rootRate`) and slower toward the tip (`tipRate`, geometric by position), so her turns and hip twist run
// down the tail as a wave that dies out. No physics: an ease cannot overshoot. `maxLag` caps how far one joint may trail.
// Sub-stepped (`hz`) so it is the same wave at 20 or 120 fps.
export class TailWave extends Behavior {
  static schema = {
    root:     { type: 'string', default: 'tail' },
    match:    { type: 'string', default: '^tail' },
    rootRate: { type: 'number', default: 30, min: 1, max: 200, step: 1 },    // 1/s
    tipRate:  { type: 'number', default: 7, min: 0.5, max: 100, step: 0.5 },
    maxLag:   { type: 'number', default: 14, min: 1, max: 90, step: 1 },     // degrees per joint
    hz:       { type: 'number', default: 240, min: 30, max: 480, step: 10 },
  };
  start() { this.chain = null; this.prevRoot = null; }
  lateUpdate(dt) {
    const o = this.entity.object3d; if (!(dt > 0)) return;
    if (!this.chain) {
      const first = o.getObjectByName?.(this.params.root), re = new RegExp(this.params.match), chain = [];
      for (let b = first; b; b = b.children.find(c => c.isBone && re.test(c.name))) chain.push(b);
      this.chain = chain.map(b => ({ b, rest: b.quaternion.clone(), w: null }));
      const n = Math.max(1, chain.length - 1);
      this.chain.forEach((c, i) => { c.rate = this.params.rootRate * Math.pow(this.params.tipRate / this.params.rootRate, i / n); });
    }
    const C = this.chain; if (C.length < 2) return;
    const Q = C[0].b.quaternion.constructor, lag = this.params.maxLag * Math.PI / 180, inv = new Q(), t = new Q();
    o.updateMatrixWorld(true);
    const rootNow = C[0].b.getWorldQuaternion(new Q());
    if (!this.prevRoot) { this.prevRoot = rootNow.clone(); for (let i = 1; i < C.length; i++) C[i].w = (i === 1 ? rootNow : C[i - 1].w).clone().multiply(C[i].rest); }
    // the cascade runs INSIDE each substep, with the root's motion slid across them — eased once a frame, the fast joints near
    // the root would jump most of the way in one step at 20 fps and the wave would come out smaller (her r19 measurement)
    const steps = Math.max(1, Math.min(32, Math.ceil(dt * this.params.hz))), h = dt / steps, rootW = new Q();
    for (let s = 1; s <= steps; s++) {
      rootW.copy(this.prevRoot).slerp(rootNow, s / steps);
      for (let i = 1; i < C.length; i++) {
        t.copy(i === 1 ? rootW : C[i - 1].w).multiply(C[i].rest);
        C[i].w.slerp(t, 1 - Math.exp(-C[i].rate * h));
        if (C[i].w.angleTo(t) > lag) C[i].w.copy(t).rotateTowards(C[i].w, lag);
      }
    }
    this.prevRoot.copy(rootNow);
    for (let i = 1; i < C.length; i++) {   // back to local rotations under the parent as now drawn
      const b = C[i].b; b.parent.getWorldQuaternion(inv).invert(); b.quaternion.copy(inv.multiply(C[i].w)); b.updateMatrixWorld(true);
    }
  }
}

// Spring chains (zap's SPRINGS, the creature repo's springs()): every `hair_<k>_<j>` / `cape_<k>_<j>` bone chain on the model
// (blender-addons' chains.mjs makes them) swings on verlet springs AFTER the pose: each segment's tip keeps its momentum (`drag`
// bleeds it), is pulled back toward where the pose puts it (`stiff`), down by gravity (`grav`), held to its length, kept out of
// the body (hair: the head; cape: spheres on hips, back and legs) and never bent more than `maxBend` from rest. No three import:
// vectors and quaternions are made from the bones' own classes.
export class Dynamics extends Behavior {
  static schema = {
    hair: { type: 'vec3', default: [3.6, 0.32, 0.45] },   // stiff, drag, gravity — light and springy
    cape: { type: 'vec3', default: [1.1, 0.14, 1.6] },    // heavy and loose
    hairBend: { type: 'number', default: 0.9, min: 0, max: 3, step: 0.05 },   // rad
    capeBend: { type: 'number', default: 1.35, min: 0, max: 3, step: 0.05 },
    on: { type: 'boolean', default: true },
  };
  start() { this.segs = null; }
  init() {
    const root = this.entity.object3d; this.segs = []; this.cols = [];
    let bone; root.traverse(o => { if (o.isBone && !bone) bone = o; }); if (!bone) return;
    const V = bone.position.constructor, Q = bone.quaternion.constructor; this.V = V; this.Q = Q;
    const chains = {}, bones = {};
    root.traverse(o => { if (!o.isBone) return; bones[o.name] = o; const m = /^(hair|cape)_(\d+)_(\d+)$/.exec(o.name); if (m) ((chains[m[1] + m[2]] ||= { kind: m[1], b: [] }).b[+m[3]] = o); });
    root.updateMatrixWorld(true);
    const wp = o => o.getWorldPosition(new V());
    for (const C of Object.values(chains)) for (let j = 0; j + 1 < C.b.length; j++) {
      const b = C.b[j], c = C.b[j + 1]; if (!b || !c) continue;
      const len = wp(b).distanceTo(wp(c)); if (len < 1e-4) continue;
      const tip = wp(c);
      this.segs.push({ kind: C.kind, b, rest: b.quaternion.clone(), dir: c.position.clone().normalize(), len, cur: tip.clone(), prev: tip.clone() });
    }
    if (!this.segs.length) return;
    const head = bones.mixamorig_Head, hips = bones.mixamorig_Hips, H = head && hips ? Math.max(0.5, (wp(head).y - root.getWorldPosition(new V()).y) * 1.12) : 1.75;
    this.head = head; this.headR = 0.075 * H;
    const sph = (a, b2, r, t = 0) => { const A = bones['mixamorig_' + a], B = b2 && bones['mixamorig_' + b2]; if (A) this.cols.push({ A, B, t, r: r * H }); };
    sph('Hips', null, .13); sph('Spine1', null, .12); sph('Spine2', null, .12); sph('LeftUpLeg', 'LeftLeg', .075, .5); sph('RightUpLeg', 'RightLeg', .075, .5);
    sph('LeftLeg', 'LeftFoot', .06, .4); sph('RightLeg', 'RightFoot', .06, .4); sph('LeftUpLeg', null, .08); sph('RightUpLeg', null, .08);
    // a body sphere must never reach the cape where it hangs at rest: shrink each to just short of the nearest cape joint
    const tips = []; for (const sg of this.segs) if (sg.kind === 'cape') tips.push(wp(sg.b), sg.cur.clone());
    for (const c of this.cols) { const p = wp(c.A); if (c.B) p.lerp(wp(c.B), c.t); for (const t of tips) c.r = Math.min(c.r, p.distanceTo(t) * 0.92); }
    this.world.emit?.('dynamics', this.entity.id, this.segs.length);
  }
  lateUpdate(dt) {
    if (!this.params.on || !(dt > 0)) return;
    if (!this.segs) this.init();
    if (!this.segs.length) return;
    const V = this.V, Q = this.Q, d = Math.min(dt, 1 / 30), f = d * 60, down = new V(0, -1, 0), tmp = new V(), q = new Q(), q2 = new Q();
    const wp = o => o.getWorldPosition(new V());
    const cols = this.cols.map(c => { const p = wp(c.A); if (c.B) p.lerp(wp(c.B), c.t); return { p, r: c.r }; });
    const hc = this.head ? wp(this.head).add(new V(0, this.headR * 0.4, 0)) : null;
    for (const s of this.segs) {
      const [stiff, drag, grav] = this.params[s.kind], maxBend = s.kind === 'hair' ? this.params.hairBend : this.params.capeBend, b = s.b;
      b.parent.getWorldQuaternion(q); q.multiply(s.rest);
      const head = wp(b), restDir = s.dir.clone().applyQuaternion(q), restTip = head.clone().addScaledVector(restDir, s.len);
      if (s.cur.distanceTo(restTip) > 1.5) { s.cur.copy(restTip); s.prev.copy(restTip); }   // a teleport resets it
      const next = s.cur.clone().addScaledVector(tmp.copy(s.cur).sub(s.prev), 1 - drag)
        .addScaledVector(restDir, stiff * s.len * f * d).addScaledVector(down, grav * s.len * d * f);
      next.sub(head).setLength(s.len).add(head);
      const push = (c, r) => { const off = next.clone().sub(c), dd = off.length(); if (dd < r && dd > 1e-6) next.copy(c).addScaledVector(off.normalize(), r).sub(head).setLength(s.len).add(head); };
      if (s.kind === 'hair' && hc) push(hc, this.headR);
      if (s.kind === 'cape') for (const c of cols) push(c.p, c.r);
      s.prev.copy(s.cur); s.cur.copy(next);
      let want = next.clone().sub(head).applyQuaternion(q.clone().invert()).normalize();
      const ang = want.angleTo(s.dir); if (ang > maxBend) want = s.dir.clone().lerp(want, maxBend / ang).normalize();
      b.quaternion.copy(s.rest).multiply(q2.setFromUnitVectors(s.dir, want)); b.updateMatrixWorld(true);
    }
  }
}

// Wall run (zap's WRUN, docs/goblin-extraction.md): TAP beside a tall wall while moving along it → run along the face on a
// low arc (feet on it, body rolled off it); heading INTO it → run up the face. Tap again on the wall → kick off it (a wall
// jump, carrying some speed — onto the opposite wall with another tap). It ends at the wall's end, its top, the time
// limit or the floor, and hands the body back to the PlayerController falling. Plays the run clip ('run' role).
export class WallRun extends Behavior {
  static schema = {
    minHeight: { type: 'number', default: 1.6, min: 0.5, max: 10, step: 0.1 },   // the face rises at least this far above his feet
    minLength: { type: 'number', default: 1.2, min: 0.2, max: 10, step: 0.1 },   // a post is not a wall
    reach:     { type: 'number', default: 0.6, min: 0, max: 3, step: 0.05 },     // m from his side to the face that still counts
    speed:     { type: 'number', default: 7, min: 1, max: 20, step: 0.5 },       // m/s along the face (or his speed if faster)
    time:      { type: 'number', default: 1.1, min: 0.2, max: 5, step: 0.05 },    // s a side run lasts
    rise:      { type: 'number', default: 4, min: 0, max: 15, step: 0.5 },       // m/s up as a side run starts (a low arc)
    gravity:   { type: 'number', default: 9, min: 0, max: 40, step: 0.5 },       // m/s² he feels on the wall
    upSpeed:   { type: 'number', default: 7, min: 0, max: 20, step: 0.5 },       // m/s up a run straight up the face
    upTime:    { type: 'number', default: 0.7, min: 0.1, max: 3, step: 0.05 },
    kick:      { type: 'number', default: 6, min: 0, max: 20, step: 0.5 },       // wall jump: m/s off the face…
    jumpUp:    { type: 'number', default: 8, min: 0, max: 20, step: 0.5 },       // …and up
    keep:      { type: 'number', default: 0.8, min: 0, max: 1, step: 0.05 },     // share of the run's speed kept through a wall jump
    lean:      { type: 'number', default: 0.5, min: 0, max: 1.2, step: 0.05 },   // rad the body rolls off the wall
    cool:      { type: 'number', default: 0.35, min: 0, max: 2, step: 0.05 },    // s before the same wall can be run again
  };
  start() {
    this.pc = this.entity.behaviors.find(b => b instanceof PlayerController);
    this.run = null; this.coolT = 0; this.coolWall = null; this.clip = 'run';
    this.onTap = move => this.tap(move);
    (this.entity.jumpTaps ||= []).push(this.onTap);
  }
  destroy() { if (this.entity.mover === this) this.entity.mover = null; const l = this.entity.jumpTaps, i = l ? l.indexOf(this.onTap) : -1; if (i >= 0) l.splice(i, 1); }
  radius() { return this.pc?.params.radius ?? 0.35; }
  // the nearest tall face within reach: { solid, shape, d, nx, nz }
  find(not) {
    const p = this.entity.object3d.position, P = this.params, R = this.radius() + P.reach;
    let best = null;
    for (const solid of this.world.solids || []) {
      if (solid === not || (solid.params?.shape && solid.params.shape !== 'box') || solid.params?.slope) continue;
      const sh = walkShape(solid);
      if (sh.maxY - p.y < P.minHeight || sh.minY > p.y + 1) continue;
      const sz = solid.params?.size || [0, 0, 0]; if (Math.max(sz[0], sz[2]) < P.minLength) continue;
      const { cx, cz, inside } = sh.near(p.x, p.z); if (inside) continue;
      const d = Math.hypot(p.x - cx, p.z - cz); if (d > R || d < 1e-6 || (best && d >= best.d)) continue;
      best = { solid, shape: sh, d, nx: (p.x - cx) / d, nz: (p.z - cz) / d };
    }
    return best;
  }
  tap(move) {
    if (this.run || !this.pc || this.entity.defeated) return false;
    const o = this.entity.object3d, mag = Math.hypot(move[0], move[1]);
    const W = this.find(this.coolT > 0 ? this.coolWall : null); if (!W) return false;
    const mx = mag > 0.3 ? move[0] / mag : Math.sin(yawOf(o)), mz = mag > 0.3 ? move[1] / mag : Math.cos(yawOf(o));
    const dot = mx * W.nx + mz * W.nz;                              // < 0: heading into the wall
    if (dot < -0.7 && mag > 0.3) return this.go(W, 'up');
    if (Math.abs(dot) < 0.72 && mag > 0.3) return this.go(W, 'side', mx, mz);
    return false;
  }
  go(W, kind, mx = 0, mz = 0) {
    const p = this.entity.object3d.position, tx = -W.nz, tz = W.nx, s = mx * tx + mz * tz >= 0 ? 1 : -1;
    const k = this.radius() + 0.06 - W.d; p.x += W.nx * k; p.z += W.nz * k;   // onto the face
    this.run = { kind, W, nx: W.nx, nz: W.nz, dx: tx * s, dz: tz * s, t: 0, vy: kind === 'side' ? this.params.rise : this.params.upSpeed, v: this.params.speed };
    this.clip = 'run';
    this.entity.mover = this;
    this.world.emit('wallrun', this.entity.id, kind);
    return true;
  }
  end(push = 0, vy) {
    const R = this.run; if (!R) return;
    this.run = null; this.coolT = this.params.cool; this.coolWall = R.W.solid;
    if (this.entity.mover === this) this.entity.mover = null;
    setYaw(this.entity.object3d, yawOf(this.entity.object3d), 0);
    const pc = this.pc; if (!pc) return;
    pc.vy = vy ?? R.vy; pc.grounded = false; pc.sinceGround = 1; pc.airTime = 0.2;
    if (push) pc.carry = [R.nx * push, R.nz * push];
  }
  jump() {
    const R = this.run, P = this.params;
    if (R.kind === 'side') {
      const k = P.keep * R.v; this.end(0, P.jumpUp);
      this.pc.carry = [R.nx * P.kick + R.dx * k, R.nz * P.kick + R.dz * k];
    } else { this.end(0, P.jumpUp * 0.9); this.pc.carry = [R.nx * P.kick * 0.8, R.nz * P.kick * 0.8]; }
    this.pc.airJumpCount = 0; this.pc.jumpCount++;
    setYaw(this.entity.object3d, Math.atan2(this.pc.carry[0], this.pc.carry[1]), 0);
    this.world.emit('jump'); this.world.emit('walljump', this.entity.id);
  }
  update(dt) {
    this.coolT = Math.max(0, this.coolT - dt);
    const R = this.run; if (!R || dt <= 0) return;
    const P = this.params, o = this.entity.object3d, p = o.position, input = this.world.input || {};
    if (input.jump) { input.jump = false; this.jump(); return; }
    R.t += dt;
    if (R.kind === 'side') { p.x += R.dx * R.v * dt; p.z += R.dz * R.v * dt; R.vy -= P.gravity * dt; setYaw(o, Math.atan2(R.dx, R.dz)); }
    else { R.vy -= P.gravity * 1.3 * dt; setYaw(o, Math.atan2(-R.nx, -R.nz), 0); }
    p.y += R.vy * dt;
    // still on the face? (its end, or his feet past its top, let him go)
    const { cx, cz, inside } = R.W.shape.near(p.x, p.z), d = Math.hypot(p.x - cx, p.z - cz);
    const on = !inside && d > 1e-6 && d < this.radius() + 0.4 && ((p.x - cx) * R.nx + (p.z - cz) * R.nz) / d > 0.9 && R.W.shape.maxY - p.y > 0.9;
    if (on) { const k = this.radius() + 0.06 - d; p.x += R.nx * k; p.z += R.nz * k; }
    // the roll: head off the wall, feet on it (his right is (-fz, fx); +rotation.z leans the head to his right)
    if (R.kind === 'side') { const fx = R.dx, fz = R.dz, right = R.nx * -fz + R.nz * fx; o.rotation.z = Math.sign(right) * P.lean * Math.min(1, R.t / 0.12); }
    // the floor: a solid's top or the PlayerController's ground
    let floor = this.pc?.params.groundY ?? 0;
    for (const s of this.world.solids || []) { if (s === R.W.solid) continue; const t = walkShape(s).topNear(p.x, p.z, this.radius() * 0.9); if (t <= p.y + 0.05 && t > floor) floor = t; }
    if (R.vy < 0 && p.y <= floor) { p.y = floor; this.end(0, 0); this.pc.grounded = true; this.pc.sinceGround = 0; return; }
    if (!on) { this.end(1); return; }
    if (R.kind === 'side' ? R.t > P.time : (R.t > P.upTime || R.vy < -1)) this.end(R.kind === 'side' ? 1.5 : 1);
  }
}   // m: walk up ramps and small steps without jumping; stick to ramps on the way down

// Third-person platformer movement. Reads world.input = { move: [x, z] (world space, length ≤ 1), jump: bool }.
// The game page fills world.input (joystick, keys); this behavior never touches the DOM.
export class PlayerController extends Behavior {
  static schema = {
    speed:     { type: 'number', default: 5,  min: 0, max: 15, step: 0.5 },   // m/s
    jumpSpeed: { type: 'number', default: 7.5, min: 0, max: 20, step: 0.5 },  // m/s up
    gravity:   { type: 'number', default: 22, min: 1, max: 60, step: 1 },     // m/s²
    radius:    { type: 'number', default: 0.35, min: 0.1, max: 2, step: 0.05 },
    height:    { type: 'number', default: 1.75, min: 0.5, max: 4, step: 0.05 },
    groundY:   { type: 'number', default: 0, min: -50, max: 50, step: 0.1 },  // flat floor height
    killY:     { type: 'number', default: -15, min: -200, max: 0, step: 1 },  // fall below → respawn
    coyote:    { type: 'number', default: 0.1, min: 0, max: 0.5, step: 0.02 }, // s of grace after leaving a ledge
    invulnerable: { type: 'number', default: 1.2, min: 0, max: 5, step: 0.1 }, // s after a hit
    airJumps:  { type: 'number', default: 0, min: 0, max: 3, step: 1 },       // extra jumps in the air (1 = double jump); any landing or bounce gives them back
    airJumpSpeed: { type: 'number', default: 0, min: 0, max: 20, step: 0.5 }, // m/s up for an air jump, SET not added (0 = jumpSpeed)
    plane:     { type: 'string', default: 'free' },   // free | side: a side-scroller pins z where he starts (only x moves; he faces ±x)
  };
  start() {
    const p = this.entity.object3d.position;
    this.spawn = [p.x, p.y, p.z];        // runtime copy of the authored position
    this.vy = 0; this.grounded = true; this.sinceGround = 0; this.hurtTimer = 0; this.jumpBuffer = 0;
    this.jumpCount = 0; this.airJumpCount = 0;     // jumps so far / air jumps used this airtime (Animator reads both)
    this.health = this.entity.behaviors.find(b => b instanceof Health);
    this.world.on('bounce', s => { this.vy = (s ?? 0.7) * this.params.jumpSpeed; this.grounded = false; this.airJumpCount = 0; });
    this.world.on('hurt', dmg => this.hurt(dmg ?? 1));
  }
  onMoved() { const p = this.entity.object3d.position; this.spawn = [p.x, p.y, p.z]; this.vy = 0; }
  hurt(dmg) {
    if (this.hurtTimer > 0 || this.dead) return;
    this.hurtTimer = this.params.invulnerable;
    this.vy = this.params.jumpSpeed * 0.5; this.grounded = false;
    if (this.health) {
      this.health.current = Math.max(0, this.health.current - dmg);
      this.world.emit('health', this.health.current, this.health.params.max);
      if (this.health.current <= 0) { this.dead = true; this.world.emit('gameover'); }
    }
  }
  respawn() {
    const p = this.entity.object3d.position;
    [p.x, p.y, p.z] = this.spawn; this.vy = 0;
    this.world.emit('respawn');
  }
  overlapsXZ(b, x, z, r) {
    const cx = Math.max(b.minX, Math.min(x, b.maxX)), cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    return (x - cx) ** 2 + (z - cz) ** 2 < r * r;
  }
  update(dt) {
    if (this.dead || dt <= 0) return;
    if (this.entity.mover) { this.hurtTimer = Math.max(0, this.hurtTimer - dt); this.ride = null; return; }   // another behavior owns the body (WallRun…)
    const P = this.params, p = this.entity.object3d.position, o = this.entity.object3d;
    const input = this.world.input || {}, side = P.plane === 'side';
    const move = side ? [(input.move || [0, 0])[0], 0] : input.move || [0, 0];   // 2D side view: only x is a direction
    const all = this.world.solids || [], solids = all.map(walkShape);   // boxes, ramps, turned boxes, spheres, capsules
    // Ride moving platforms: move with whatever we stood on last frame by however much it moved since.
    if (this.ride && this.grounded) {
      const i = all.indexOf(this.ride.solid);
      if (i >= 0) { const [rx, ry, rz] = solids[i].ref; p.x += rx - this.ride.x; p.y += ry - this.ride.y; p.z += rz - this.ride.z; }
    }
    this.ride = null;
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    o.visible = this.hurtTimer <= 0 || Math.floor(this.hurtTimer * 10) % 2 === 0;   // blink while invulnerable

    // Horizontal move, then push out of any solid we're inside (side collision).
    const ms = this.entity.moveScale ?? 1;                                  // e.g. Animator slows us during a hard landing
    p.x += move[0] * P.speed * ms * dt;
    p.z += move[1] * P.speed * ms * dt;
    if (this.carry) {                                                       // momentum handed over (a wall jump's kick): fades out
      p.x += this.carry[0] * dt; p.z += this.carry[1] * dt;
      const k = Math.exp(-(this.grounded ? 8 : 1.2) * dt); this.carry = [this.carry[0] * k, this.carry[1] * k];
      if (this.entity.aimYaw == null && Math.hypot(move[0], move[1]) <= 0.05 && Math.hypot(...this.carry) > 0.5) setYaw(o, Math.atan2(this.carry[0], this.carry[1]));
      if (Math.hypot(...this.carry) < 0.05) this.carry = null;
    }
    if (this.entity.aimYaw != null) setYaw(o, this.entity.aimYaw);        // a Blaster is aiming: he faces the shot and strafes
    else if (Math.hypot(move[0], move[1]) > 0.05) setYaw(o, Math.atan2(move[0], move[1]));
    for (const b of solids) {
      if (p.y + P.height <= b.minY) continue;                               // below it
      const { cx, cz, inside } = b.near(p.x, p.z);
      // above it? (a ramp or a curved top: walk up it, STEP_UP at a time)
      if (p.y >= (inside ? b.top(p.x, p.z) : b.top(cx, cz)) - (b.sloped ? STEP_UP : 0.05)) continue;
      const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
      if (!inside && d >= P.radius) continue;
      if (side && b.box && !b.sloped) {                                     // 2D: a wall only ever pushes along x (z is the plane)
        const l = b.box.minX - P.radius - p.x, r = b.box.maxX + P.radius - p.x; p.x += Math.abs(l) < Math.abs(r) ? l : r; continue;
      }
      if (!inside && d > 1e-6) { p.x = cx + (dx / d) * P.radius; p.z = cz + (dz / d) * P.radius; }
      else { const [ox, oz] = b.out(p.x, p.z, P.radius); p.x += ox; p.z += oz; }   // centre inside: shortest way out
    }
    if (side) { p.z = this.spawn[2]; if (this.carry) this.carry[1] = 0; }   // pinned to the plane he started on (push-outs too)

    // Jump (buffered a little so an early tap still counts), with coyote time.
    // a tap may be taken by another behavior first (a wall run starts on a tap beside a wall): entity.jumpTaps
    if (input.jump) { input.jump = false; if (!(this.entity.jumpTaps || []).some(f => f(move))) this.jumpBuffer = 0.12; else if (this.entity.mover) return; }
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.sinceGround = this.grounded ? 0 : this.sinceGround + dt;
    if (this.jumpBuffer > 0 && this.sinceGround <= P.coyote && this.vy <= 0) {
      this.vy = P.jumpSpeed; this.grounded = false; this.jumpBuffer = 0; this.sinceGround = P.coyote + 1;
      this.airJumpCount = 0; this.jumpCount++;
      this.world.emit('jump');
    } else if (this.jumpBuffer > 0 && !this.grounded && this.sinceGround > P.coyote && this.airJumpCount < P.airJumps) {
      this.vy = P.airJumpSpeed || P.jumpSpeed; this.jumpBuffer = 0;      // set, not added: same height whether rising or falling
      this.airJumpCount++; this.jumpCount++;
      this.world.emit('jump'); this.world.emit('airjump', this.airJumpCount);
    }

    // Vertical: gravity, land on the highest surface under us, bump heads on ceilings.
    this.vy -= P.gravity * dt;
    const ny = p.y + this.vy * dt;
    let support = P.groundY, supportIdx = -1;
    solids.forEach((b, i) => {
      const top = b.topNear(p.x, p.z, P.radius * 0.9);
      if (top <= p.y + (b.sloped ? STEP_UP : 0.05) && top > support) { support = top; supportIdx = i; }
    });
    for (const sf of this.world.surfaces || []) {                          // triangle floors (Surface): slopes as drawn
      const g = sf.groundAt(p.x, p.z, p.y + STEP_UP);
      if (g && g.y > support) { support = g.y; supportIdx = -2; this.surfaceN = g.n; }
    }
    if (this.vy > 0) for (const b of solids) {
      if (b.minY >= p.y + P.height - 0.01 && b.minY < ny + P.height && b.topNear(p.x, p.z, P.radius * 0.9) > -Infinity) { this.vy = 0; break; }
    }
    const onRamp = supportIdx === -2 || (supportIdx >= 0 && solids[supportIdx].sloped);
    if ((ny <= support || (onRamp && this.grounded && p.y - support < STEP_UP)) && this.vy <= 0) {   // ramps: stay stuck to the slope going down
      if (!this.grounded && this.airTime > 0.15) this.world.emit('land');
      p.y = support; this.vy = 0; this.grounded = true; this.airTime = 0; this.airJumpCount = 0;
      if (supportIdx >= 0) { const [x, y, z] = solids[supportIdx].ref; this.ride = { solid: all[supportIdx], x, y, z }; }
    }
    else { p.y = this.vy === 0 && !this.grounded ? p.y : ny; this.grounded = false; this.airTime = (this.airTime || 0) + dt; }

    if (p.y < P.killY) { this.respawn(); this.hurt(1); }
  }
}

// Moves toward a target when it comes within range; drifts back home otherwise.
export class Chase extends Behavior {
  static schema = {
    targetId:   { type: 'string', default: 'player' },
    radius:     { type: 'number', default: 7, min: 0, max: 50, step: 0.5 },   // starts chasing inside this
    speed:      { type: 'number', default: 2.5, min: 0, max: 15, step: 0.1 },
    returnHome: { type: 'boolean', default: true },
    sight:      { type: 'boolean', default: false },   // only chase what it can see: a wall (Solid) in between hides the target
    eyeHeight:  { type: 'number', default: 1.5, min: 0, max: 5, step: 0.1 },
    navigate:   { type: 'boolean', default: true },   // walk AROUND walls (the world's walk grid, runtime/nav.js) instead of into them
  };
  start() { const p = this.entity.object3d.position; this.home = [p.x, p.z]; this.route = null; this.repath = 0; }
  // the world's shared walk grid, rebuilt when the solids change (a wall broke, a door shut)
  nav() {
    const W = this.world, n = (W.solids || []).length;
    if (!W.nav || W.nav.count !== n) W.nav = new NavGrid().build(W.solids || []);
    return W.nav;
  }
  onMoved() { this.start(); }
  update(dt) {
    if (this.entity.object3d.visible === false || this.entity.defeated || this.entity.dormant) return;
    const t = this.world.getEntity(this.params.targetId); if (!t) return;
    const p = this.entity.object3d.position, q = t.object3d.position;
    let near = Math.hypot(q.x - p.x, q.z - p.z) < this.params.radius;
    if (near && this.params.sight && this.world.lineClear) {   // look from my eyes to theirs, ignoring my own and their colliders
      const h = this.params.eyeHeight;
      near = this.world.lineClear([p.x, p.y + h, p.z], [q.x, q.y + h, q.z], { ignore: [this.entity.id, t.id] });
    }
    let goal = near ? [q.x, q.z] : this.params.returnHome ? this.home : null;
    if (!goal) return;
    if (this.params.navigate && (this.world.solids || []).length) {   // the next corner of a path round the walls
      if ((this.repath -= dt) <= 0 || !this.route?.length) { this.repath = 0.4; this.route = this.nav().path([p.x, p.z], goal) || [goal]; }
      while (this.route.length > 1 && Math.hypot(this.route[0][0] - p.x, this.route[0][1] - p.z) < 0.3) this.route.shift();
      goal = this.route[0];
    }
    const dx = goal[0] - p.x, dz = goal[1] - p.z, d = Math.hypot(dx, dz), step = this.params.speed * dt;
    if (d < 0.05) return;
    const k = Math.min(step, d) / d;
    p.x += dx * k; p.z += dz * k;
    setYaw(this.entity.object3d, Math.atan2(dx, dz));
  }
}

// Touching it hurts the target, unless the target lands on top: then it's defeated (score + bounce).
export class Stompable extends Behavior {
  static schema = {
    targetId: { type: 'string', default: 'player' },
    radius:   { type: 'number', default: 0.9, min: 0.1, max: 5, step: 0.05 },  // horizontal reach
    height:   { type: 'number', default: 1.2, min: 0.1, max: 5, step: 0.05 },  // body height from origin
    points:   { type: 'number', default: 1, min: 0, max: 100, step: 1 },
    damage:   { type: 'number', default: 1, min: 0, max: 10, step: 1 },
    defeatClip: { type: 'string', default: '' },   // played once when stomped ('' = the character's death role; none = vanish at once)
    hideAfter:  { type: 'number', default: 1.5, min: 0, max: 10, step: 0.1 },  // s the defeat clip shows before it vanishes
    hitStop:    { type: 'number', default: 0, min: 0, max: 0.3, step: 0.01 },  // s the whole game freezes on a stomp (impact punch; 0.05–0.08 feels good)
    slowMo:     { type: 'number', default: 0, min: 0, max: 3, step: 0.1 },     // s of slow motion after a stomp (KO moment; 0 = off)
    slowMoScale: { type: 'number', default: 0.3, min: 0.05, max: 1, step: 0.05 }, // game speed during it
  };
  update(dt) {
    if (this.entity.dormant) return;
    if (this.defeated) {
      if (this.hideIn > 0 && (this.hideIn -= dt) <= 0) this.entity.object3d.visible = false;
      return;
    }
    const t = this.world.getEntity(this.params.targetId); if (!t) return;
    const p = this.entity.object3d.position, q = t.object3d.position, P = this.params;
    if (Math.hypot(q.x - p.x, q.z - p.z) > P.radius) return;
    const feet = q.y, top = p.y + P.height, bodyH = t.behaviors?.find(b => b instanceof PlayerController)?.params.height ?? 1.75;
    if (feet > top + 0.2 || feet + bodyH < p.y) return;                       // no vertical overlap
    const falling = (t.behaviors?.find(b => b instanceof PlayerController)?.vy ?? 0) < 0;
    if (falling && feet > p.y + P.height * 0.5) { this.defeat(); this.world.emit('bounce', 0.7); }
    else this.world.emit('hurt', P.damage);
  }
  // Knocked down: by a stomp, or struck by a Melee ('struck' event). Plays the death role, then vanishes.
  defeat() {
    if (this.defeated) return;
    const P = this.params;
    this.defeated = this.entity.defeated = true;   // entity.defeated stands Chase + Animator down
    const anim = this.entity.anim;
    const defeat = roleClip(P.defeatClip, 'death', this.entity.roles);
    if (defeat && anim?.clips.includes(defeat)) { anim.play(defeat, { once: true, fade: 0.1 }); this.hideIn = P.hideAfter; }
    else this.entity.object3d.visible = false;
    if (P.hitStop > 0) this.world.time?.hitStop(P.hitStop);
    if (P.slowMo > 0) this.world.time?.slowMo(P.slowMoScale, P.slowMo);
    this.world.emit('stomp', this.entity.id);
    this.world.emit('score', P.points);
  }
  start() {
    if (this.listening) return; this.listening = true;
    this.world.on('struck', (_by, id) => { if (id === this.entity.id && !this.entity.dormant) this.defeat(); });
  }
}

// A strike: world.input.attack ([x, z] direction, or [0, 0] = the way I face) plays the attack role on the UPPER body
// layer — the legs keep running — and after `hitDelay` anything Stompable within `reach`, inside the `arc` in front,
// is struck ('struck' event: attacker id, target id, damage). The game page sets input.attack from a right-stick flick.
export class Melee extends Behavior {
  static schema = {
    clip:     { type: 'string', default: '' },        // '' = the character's attack role
    layer:    { type: 'string', default: 'upper' },   // upper (keep running) | base (whole body)
    reach:    { type: 'number', default: 1.6, min: 0.3, max: 6, step: 0.1 },    // metres
    arc:      { type: 'number', default: 100, min: 10, max: 360, step: 5 },     // degrees in front that count
    hitDelay: { type: 'number', default: 0.15, min: 0, max: 1, step: 0.01 },    // s from swing to impact
    cooldown: { type: 'number', default: 0.45, min: 0, max: 3, step: 0.05 },
    damage:   { type: 'number', default: 1, min: 0, max: 100, step: 1 },
    blastY:   { type: 'number', default: 1, min: 0, max: 3, step: 0.05 },      // m up from the feet where a swing breaks things
    turn:     { type: 'boolean', default: true },     // face the strike direction
    speed:    { type: 'number', default: 1.75, min: 0.25, max: 4, step: 0.05 },  // clip playback rate (weirdport plays Zap's strikes at 1.75)
    // combos (zap's katana): a chain of clips — a press during a swing is kept and throws the next one; a pause resets it
    combo:    { type: 'string', default: '' },        // 'katana_slash_2, katana_slash_4, katana_slash_3' ('' = just `clip`)
    comboWindow: { type: 'number', default: 0.5, min: 0, max: 2, step: 0.05 },   // s after a swing's cooldown the next press still chains
    // lock-on: the nearest foe within `lockRange` inside a `lockOn`° cone round the flick (or his facing) is turned to and lunged at
    lockOn:   { type: 'number', default: 0, min: 0, max: 360, step: 5 },          // degrees (0 = off; zap's katana: 60)
    lockRange:{ type: 'number', default: 3.5, min: 0.5, max: 15, step: 0.1 },
    lunge:    { type: 'number', default: 4, min: 0, max: 15, step: 0.5 },        // m/s toward a locked foe (handed to the PlayerController)
    // in the air (with a PlayerController): a different clip on the whole body, and a slam straight down
    airClip:  { type: 'string', default: '' },        // e.g. katana_jump_attack ('' = the ground swing in the air)
    slam:     { type: 'number', default: 0, min: 0, max: 40, step: 1 },           // m/s down when it starts (0 = none)
  };
  start() { this.cool = 0; this.pending = null; this.queued = null; this.step = 0; this.since = 1e9; }
  update(dt) {
    if (this.entity.defeated) return;
    this.cool -= dt; this.since += dt;
    const input = this.world.input, a = input?.attack;
    if (a) { input.attack = null; if (this.cool <= 0) this.swing(a); else if (this.chain().length > 1) this.queued = a; }
    else if (this.queued && this.cool <= 0) { const q = this.queued; this.queued = null; this.swing(q); }
    if (this.pending && (this.pending.t -= dt) <= 0) { this.hit(this.pending.dir); this.pending = null; }
  }
  chain() { return this.params.combo ? this.params.combo.split(',').map(c => c.trim()).filter(Boolean) : []; }
  // the foe to lock on to: nearest Stompable inside the cone and range, or null
  target(dir) {
    const P = this.params; if (!(P.lockOn > 0)) return null;
    const p = this.entity.object3d.position, cosHalf = Math.cos((Math.min(P.lockOn, 359.9) / 2) * Math.PI / 180);
    let best = null;
    for (const e of this.world.entities?.values?.() || []) {
      if (e === this.entity || e.defeated || e.object3d?.visible === false || !e.behaviors?.some(b => b instanceof Stompable || b.constructor.hittable)) continue;
      const q = e.object3d.position, dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      if (d > P.lockRange || d < 1e-3 || Math.abs(q.y - p.y) > 2.5 || (dx * dir[0] + dz * dir[1]) / d < cosHalf) continue;
      if (!best || d < best.d) best = { e, d, dir: [dx / d, dz / d] };
    }
    return best;
  }
  swing([x, z]) {
    const P = this.params, o = this.entity.object3d;
    let dir = Math.hypot(x, z) > 1e-3 ? [x, z] : [Math.sin(yawOf(o)), Math.cos(yawOf(o))];
    const l = Math.hypot(...dir); dir = [dir[0] / l, dir[1] / l];
    const lock = this.target(dir), pc = this.entity.behaviors.find(b => b instanceof PlayerController);
    if (lock) {
      dir = lock.dir;
      if (pc && P.lunge > 0 && lock.d > P.reach * 0.6) pc.carry = [dir[0] * P.lunge, dir[1] * P.lunge];
      this.world.emit('lockon', this.entity.id, lock.e.id);
    }
    if (P.turn) setYaw(o, Math.atan2(dir[0], dir[1]));
    const chain = this.chain();
    if (chain.length) { this.step = this.since <= P.comboWindow + P.cooldown ? (this.step + 1) % chain.length : 0; }
    this.since = 0;
    const air = pc && !pc.grounded && P.airClip;
    const clip = air ? P.airClip : chain.length ? chain[this.step] : roleClip(P.clip, 'attack', this.entity.roles);
    if (clip && this.entity.anim?.clips.includes(clip)) {
      this.entity.anim.play(clip, { layer: air ? 'base' : P.layer, once: true, fade: 0.08, restart: true, speed: P.speed });
      if (air) this.entity.animHold = 0.6;     // a whole-body swing: the Animator keeps its hands off it for a moment
    }
    if (pc && !pc.grounded && P.slam > 0) { pc.vy = -P.slam; this.world.emit('slam', this.entity.id); }
    this.world.emit('swing', this.entity.id);
    this.cool = P.cooldown;
    if (P.hitDelay > 0) this.pending = { t: P.hitDelay, dir }; else this.hit(dir);
  }
  hit(dir) {
    const P = this.params, p = this.entity.object3d.position, cosHalf = Math.cos((P.arc / 2) * Math.PI / 180);
    for (const e of this.world.entities?.values?.() || []) {
      if (e === this.entity || e.defeated || e.object3d?.visible === false) continue;
      if (!e.behaviors?.some(b => b instanceof Stompable || b.constructor.hittable)) continue;
      const q = e.object3d.position, dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      if (d > P.reach || Math.abs(q.y - p.y) > 2) continue;
      if (d > 1e-3 && (dx * dir[0] + dz * dir[1]) / d < cosHalf) continue;
      this.world.emit('struck', this.entity.id, e.id, P.damage);
    }
    // and whatever breaks (Breakables: weirdport's walls) — a blast where the blade lands
    const k = P.reach * 0.75; this.world.emit('blast', p.x + dir[0] * k, p.y + P.blastY, p.z + dir[1] * k, P.reach * 0.5, P.damage);
  }
}

// Squash & stretch on events (default: squash on 'land', stretch on 'jump'). Animates scale around the
// authored scale and springs back; the authored scale itself is never changed.
export class Squash extends Behavior {
  static schema = {
    amount:   { type: 'number', default: 0.22, min: 0, max: 0.8, step: 0.02 },  // 0.22 = 22% shorter on land
    stretch:  { type: 'number', default: 0.12, min: 0, max: 0.8, step: 0.02 },  // taller on jump
    duration: { type: 'number', default: 0.22, min: 0.05, max: 1, step: 0.01 }, // s to spring back
    landEvent: { type: 'string', default: 'land' },
    jumpEvent: { type: 'string', default: 'jump' },
  };
  start() {
    this.onMoved(); this.k = 0; this.t = 1;
    this.world.on(this.params.landEvent, () => { this.k = -this.params.amount; this.t = 0; });
    this.world.on(this.params.jumpEvent, () => { this.k = this.params.stretch; this.t = 0; });
  }
  onMoved() { const s = this.entity.object3d.scale; if (s) this.base = [s.x, s.y, s.z]; }
  update(dt) {
    const s = this.entity.object3d.scale; if (!s || !this.base || this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / this.params.duration);
    const f = this.k * (1 - this.t) * (1 - this.t) * Math.cos(this.t * Math.PI * 1.5);   // eased wobble back to 1
    const y = 1 + f, xz = 1 / Math.sqrt(y);                                             // keep volume roughly
    s.x = this.base[0] * xz; s.y = this.base[1] * y; s.z = this.base[2] * xz;
  }
}

// Emits world 'step' events every `stride` metres walked on the ground (the game page plays a sound).
// Needs a PlayerController on the same entity; strides lengthen when running.
export class Footsteps extends Behavior {
  static schema = {
    stride:    { type: 'number', default: 0.75, min: 0.2, max: 3, step: 0.05 },  // metres per step at walk speed
    runStride: { type: 'number', default: 1.3, min: 0.2, max: 4, step: 0.05 },   // metres per step at full speed
    pitchJitter: { type: 'number', default: 0.08, min: 0, max: 0.5, step: 0.01 }, // ± random pitch per step (world.rng), so steps don't machine-gun
    source:    { type: 'string', default: 'auto' },   // auto | clip | distance — clip: on the character's measured `foot` frame events (tools/footsteps.mjs); auto: clip when it has them
  };
  start() {
    const p = this.entity.object3d.position; this.last = [p.x, p.z]; this.dist = 0;
    const has = Object.values(this.entity.anim?.events || {}).some(l => l.some(e => e.name === 'foot'));
    this.fromClip = this.params.source === 'clip' || (this.params.source === 'auto' && has);
    if (this.fromClip && !this.listening) {
      this.listening = true;
      this.world.on('foot', (id, info) => { if (id === this.entity.id && this.fromClip && this.moving) this.step(info); });
    }
  }
  step(info = {}) {
    const j = this.params.pitchJitter, r = this.world.rng;
    this.world.emit('step', this.entity.id, { pitch: j > 0 && r ? 1 + (r() * 2 - 1) * j : 1, ...(info.foot ? { foot: info.foot } : {}) });
  }
  update(dt) {
    const p = this.entity.object3d.position, pc = this.entity.behaviors.find(b => b instanceof PlayerController);
    const d = Math.hypot(p.x - this.last[0], p.z - this.last[1]);
    this.last = [p.x, p.z];
    const move = this.world.input?.move || [0, 0], push = Math.min(1, Math.hypot(move[0], move[1]));
    this.moving = !!pc && pc.grounded && push >= 0.05;
    if (this.fromClip) return;                       // the clip's own foot events drive the steps
    if (!pc || !pc.grounded || push < 0.05 || dt <= 0) { this.dist = Math.min(this.dist, this.params.stride * 0.5); return; }
    this.dist += d;
    const stride = this.params.stride + (this.params.runStride - this.params.stride) * push;
    if (this.dist >= stride) { this.dist -= stride; this.step(); }
  }
}


// An invisible box volume (bottom-anchored at the entity, like Solid). When the target walks in it emits `event`
// (with this entity's id) and wakes every entity listed in `activates` (comma-separated ids; see Dormant).
// The trigger's own model (a see-through box, prefab trigger_zone) shows in the editor and hides once play starts.
export class Trigger extends Behavior {
  static schema = {
    size:      { type: 'vec3', default: [3, 2, 3] },        // metres
    targetId:  { type: 'string', default: 'player' },
    event:     { type: 'string', default: 'trigger' },      // emitted on entry ('' = none)
    activates: { type: 'string', default: '' },             // "enemy_01, enemy_02" → world.emit('activate', id) each
    once:      { type: 'boolean', default: true },          // false: fires on every entry
  };
  start() { this.inside = false; this.fired = false; this.hidden = false; }
  contains(q) {
    const p = this.entity.object3d.position, [sx, sy, sz] = this.params.size;
    return Math.abs(q.x - p.x) <= sx / 2 && Math.abs(q.z - p.z) <= sz / 2 && q.y >= p.y - 0.05 && q.y <= p.y + sy;
  }
  update() {
    if (!this.hidden) { this.entity.object3d.visible = false; this.hidden = true; }   // first play frame
    const t = this.world.getEntity(this.params.targetId); if (!t) return;
    const inside = this.contains(t.object3d.position), entered = inside && !this.inside;
    this.inside = inside;
    if (!entered || (this.params.once && this.fired)) return;
    this.fired = true;
    if (this.params.event) this.world.emit(this.params.event, this.entity.id);
    for (const id of this.params.activates.split(',').map(x => x.trim()).filter(Boolean)) this.world.emit('activate', id);
  }
}

// Sleeps until a Trigger (or anything) emits 'activate' with this entity's id. While asleep, Chase / Patrol /
// Stompable stand still; `hidden` also keeps it invisible (an ambush that appears). Editor view is unaffected.
export class Dormant extends Behavior {
  static schema = {
    hidden: { type: 'boolean', default: false },
  };
  start() {
    this.entity.dormant = false;      // the editor never runs update(), so it never looks asleep there
    this.asleep = true;
    this.world.on('activate', id => {
      if (id !== this.entity.id || !this.asleep) return;
      this.asleep = false; this.entity.dormant = false; this.entity.object3d.visible = true;
      this.world.emit('awake', this.entity.id);
    });
  }
  update() {
    if (this.asleep && !this.entity.dormant) { this.entity.dormant = true; if (this.params.hidden) this.entity.object3d.visible = false; }
  }
}

// Makes copies of a prefab while the game runs (coin fountains, enemy waves, falling rocks). Spawned copies are
// runtime-only: they never end up in the scene file. `attach` parents them to this entity (they move with it).
export class Spawner extends Behavior {
  static schema = {
    prefab:   { type: 'string', default: 'coin' },
    interval: { type: 'number', default: 2, min: 0.1, max: 60, step: 0.1 },   // s between spawns
    max:      { type: 'number', default: 3, min: 1, max: 50, step: 1 },        // alive at once
    total:    { type: 'number', default: 0, min: 0, max: 500, step: 1 },       // stop after this many (0 = never)
    lifetime: { type: 'number', default: 0, min: 0, max: 120, step: 0.5 },     // s before each copy is removed (0 = stays)
    offset:   { type: 'vec3', default: [0, 1, 0] },                            // where copies appear, from this entity
    spread:   { type: 'number', default: 0, min: 0, max: 20, step: 0.25 },     // random sideways scatter (m)
    attach:   { type: 'boolean', default: false },
    tag:      { type: 'string', default: '' },                                 // extra tag on each copy (world.find)
  };
  start() {
    this.timer = 0; this.made = 0; this.alive = new Map();   // id → seconds left (Infinity = no lifetime)
    this.world.on?.('destroyed', id => this.alive.delete(id));
  }
  update(dt) {
    if (this.entity.dormant) return;
    const P = this.params;
    for (const [id, left] of this.alive) if ((left - dt) <= 0) { this.alive.delete(id); this.world.destroy(id); } else this.alive.set(id, left - dt);
    this.timer += dt;
    if (this.timer + 1e-6 < P.interval || this.pending || this.alive.size >= P.max || (P.total && this.made >= P.total)) return;
    this.timer = 0; this.made++;
    const p = this.entity.object3d.position, r = this.world.rng ?? Math.random;
    const jitter = () => (r() * 2 - 1) * P.spread;
    const off = [P.offset[0] + jitter(), P.offset[1], P.offset[2] + jitter()];
    const at = P.attach ? off : [p.x + off[0], p.y + off[1], p.z + off[2]];
    this.pending = true;
    Promise.resolve(this.world.spawn(P.prefab, { position: at, ...(P.attach ? { parent: this.entity.id } : {}), ...(P.tag ? { tags: [P.tag] } : {}) }))
      .then(ent => { if (ent) this.alive.set(ent.id, P.lifetime > 0 ? P.lifetime : Infinity); this.world.emit('spawn', ent?.id, this.entity.id); })
      .catch(e => console.warn(`Spawner on ${this.entity.id}: ${e.message}`))
      .finally(() => { this.pending = false; });
  }
}

// "When this happens, (if …) do that" — rules authored in the inspector, no code (runtime/reactions.js has the vocabulary).
// Edge-triggered: `near` fires when the target arrives, not every frame it stays. World variables live in world.vars
// (seeded from settings.variables each Play).
export class Reactions extends Behavior {
  static schema = { rules: { type: 'rules', default: [] }, state: { type: 'string', default: 'idle' } };   // state: where the state machine starts
  start() {
    this.state = []; this.heard = {}; this.subscribed ||= new Set(); this.t = 0; this.started = false; this.world.vars ||= {};
    this.mode = this.params.state || 'idle'; this.entered = this.mode; this.moving = null; this.route = null; this.repath = 0;
    const p = this.entity.object3d?.position; this.home = p ? [p.x, p.z] : [0, 0];
  }
  onParamChanged() { this.state = []; }
  listen(name) {
    if (this.subscribed.has(name)) return; this.subscribed.add(name);
    this.world.on(name, (...args) => { (this.heard[name] ||= []).push(args); });
  }
  dist(targetId) {
    const t = targetId === 'self' ? this.entity : this.world.getEntity(targetId); if (!t?.object3d) return Infinity;
    const p = this.entity.object3d.position, q = t.object3d.position;
    return Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
  }
  triggered(rule, st, dt) {
    const w = { ...WHEN[rule.when?.type], ...rule.when };
    switch (w.type) {
      case 'start': return !this.started;
      case 'timer': st.acc = (st.acc || 0) + dt; if (st.acc >= Math.max(0.05, w.every)) { st.acc = 0; return true; } return false;
      case 'event': this.listen(w.name); return (this.heard[w.name] || []).some(args => !w.from || args[0] === w.from);
      case 'frame': this.listen(w.name); return (this.heard[w.name] || []).some(args => args[0] === this.entity.id);
      case 'struck': this.listen('struck'); return (this.heard.struck || []).some(args => args[1] === this.entity.id);
      case 'enter': return this.entered === w.state;
      case 'var': { const ok = compare(this.world.vars?.[w.var] ?? 0, w.op || '>=', w.value ?? 0), was = st.ok ?? false; st.ok = ok; return ok && !was; }
      case 'near': case 'bumped': case 'leave': {
        const inside = this.dist(w.target) <= w.radius, was = st.inside ?? false; st.inside = inside;
        return w.type === 'leave' ? (was && !inside) : (inside && !was);
      }
      default: return false;
    }
  }
  allowed(rule, st) {
    const c = rule.if || {};
    if (c.state && c.state !== this.mode) return false;
    if (c.once && st.done) return false;
    if (c.cooldown > 0 && this.t - (st.last ?? -Infinity) < c.cooldown) return false;
    if (c.var) { const v = this.world.vars[c.var] ?? 0; if (!compare(v, c.op || '>=', c.value ?? 0)) return false; }
    if (c.chance !== undefined && c.chance < 1) { const r = this.world.rng ? this.world.rng() : Math.random(); if (r >= c.chance) return false; }
    return true;
  }
  target(id) { return !id || id === 'self' ? this.entity : this.world.getEntity(id); }
  act(a) {
    const W = this.world, me = this.entity;
    switch (a.type) {
      case 'play': {
        const clip = me.roles?.[a.clip] || a.clip;
        const base = a.layer === 'base';   // base loops until something else plays; upper is a one-off gesture over the legs
        if (me.anim?.clips.includes(clip)) me.anim.play(clip, { layer: base ? 'base' : 'upper', once: !base, fade: 0.2, restart: !base });
        break;
      }
      case 'look': { const t = this.target(a.target); if (t && t !== me) { const p = me.object3d.position, q = t.object3d.position; setYaw(me.object3d, Math.atan2(q.x - p.x, q.z - p.z)); } break; }
      case 'say': W.emit('say', me.id, String(a.text ?? '')); break;
      case 'sound': W.emit('sound', String(a.name ?? ''), me.id); break;
      case 'emit': if (a.name) W.emit(a.name, me.id); break;
      case 'set': if (a.var) { W.vars[a.var] = a.value; W.emit('vars', a.var, a.value); } break;
      case 'add': if (a.var) { W.vars[a.var] = (W.vars[a.var] ?? 0) + (+a.value || 0); W.emit('vars', a.var, W.vars[a.var]); } break;
      case 'spawn': if (a.prefab && W.spawn) { const p = me.object3d.position, o = a.offset || [0, 0, 0]; W.spawn(a.prefab, { position: [p.x + o[0], p.y + o[1], p.z + o[2]] })?.catch?.(() => {}); } break;
      case 'hide': case 'show': { const t = this.target(a.target); if (t) t.object3d.visible = a.type === 'show'; break; }
      case 'destroy': { const t = this.target(a.target); if (t) (W.destroy ? W.destroy(t.id) : (t.object3d.visible = false)); break; }
      case 'hud': W.emit('hud', String(a.text ?? ''), +a.seconds || 2); break;
      case 'shake': W.emit('shake', +a.amount || 0.3, +a.seconds || 0.3); break;
      case 'end': W.emit('end', String(a.text ?? ''), { sub: a.sub ? String(a.sub) : '', button: a.button ? String(a.button) : '', next: a.next ? String(a.next) : '' }); break;   // a win / lose screen: title, line under it, button, next scene
      case 'load': if (a.scene) W.emit('loadScene', String(a.scene)); break;
      case 'go': if (a.state && a.state !== this.mode) { this.mode = String(a.state); this.nextEnter = this.mode; W.emit('state', me.id, this.mode); } break;
      case 'move': this.moving = a.mode === 'stop' ? null : { mode: a.mode || 'chase', target: a.target || 'player', speed: +a.speed || 3 }; this.route = null; break;
    }
  }
  // the standing `move`: chase / flee / home, round the walls on the world's walk grid
  walk(dt) {
    const M = this.moving, o = this.entity.object3d, p = o.position; if (!M) return;
    const t = this.world.getEntity(M.target)?.object3d?.position;
    let goal = M.mode === 'home' ? this.home : t ? (M.mode === 'flee' ? [p.x + (p.x - t.x), p.z + (p.z - t.z)] : [t.x, t.z]) : null;
    if (!goal) return;
    if ((this.world.solids || []).length) {
      const W = this.world, n = W.solids.length; if (!W.nav || W.nav.count !== n) W.nav = new NavGrid().build(W.solids);
      if ((this.repath -= dt) <= 0 || !this.route?.length) { this.repath = 0.4; this.route = W.nav.path([p.x, p.z], goal) || [goal]; }
      while (this.route.length > 1 && Math.hypot(this.route[0][0] - p.x, this.route[0][1] - p.z) < 0.3) this.route.shift();
      goal = this.route[0];
    }
    const dx = goal[0] - p.x, dz = goal[1] - p.z, d = Math.hypot(dx, dz), stop = M.mode === 'chase' ? 0.9 : 0.05;
    if (d <= stop && this.route?.length <= 1) return;
    const k = Math.min(M.speed * dt, d) / d; p.x += dx * k; p.z += dz * k; setYaw(o, Math.atan2(dx, dz));
  }
  update(dt) {
    if (this.entity.dormant) return;
    this.t += dt;
    const rules = this.params.rules || [];
    rules.forEach((rule, i) => {
      const st = (this.state[i] ||= {});
      if (!this.triggered(rule, st, dt) || !this.allowed(rule, st)) return;
      st.done = true; st.last = this.t;
      for (const a of rule.do || []) this.act(a);
    });
    this.started = true; this.heard = {};
    this.entered = this.nextEnter || null; this.nextEnter = null;   // `enter` fires on the frame after a `go`
    if (!this.entity.defeated) this.walk(dt);
  }
}

// Plays a sprite sheet's clips (an asset variant with `sprite`, runtime/sprites.js) by role, like Animator does for a rig:
// with a PlayerController on the body it picks idle / run / jump / fall, otherwise it plays `clip`. It keeps the quad facing
// the camera's plane and flips it to the way the body faces. `clip` set and `auto` off = always that clip (a coin spinning).
export class SpriteAnimator extends Behavior {
  static schema = {
    clip:  { type: 'string', default: 'idle' },
    auto:  { type: 'boolean', default: true },     // pick the clip from the PlayerController's state
    speed: { type: 'number', default: 1, min: 0, max: 4, step: 0.1 },   // × every clip's fps
  };
  start() { this.t = 0; this.cur = null; const p = this.entity.object3d.position; this.last = [p.x, p.z]; }
  update(dt) {
    const sp = this.entity.sprite; if (!sp) return;
    const o = this.entity.object3d, p = o.position, pc = this.entity.behaviors.find(b => b instanceof PlayerController);
    const speed = dt > 0 ? Math.hypot(p.x - this.last[0], p.z - this.last[1]) / dt : 0; this.last = [p.x, p.z];
    const want = this.params.auto && pc ? spriteRole({ grounded: pc.grounded, vy: pc.vy, speed }, sp.clips) : this.params.clip;
    if (want !== this.cur) { this.cur = want; this.t = 0; }
    this.t += dt * this.params.speed;
    const c = sp.clips[this.cur]; if (c) sp.setFrame(clipFrame(c, this.t));
    sp.face(yawOf(o));
  }
}

for (const [name, cls] of Object.entries({ Spin, Bob, Patrol, Pickup, Health, MoveTo, Animator, Solid, CollisionMesh, PlayerController, WallRun, Ledge, Vault, Mount, Deck, DeckTricks, Breakables, KitParts, KitWalls, Batch, Blaster, Projectile, Disguise, AudioSource, Emitter, Trail, HudLabel, HudBar, HudPrompt, Checkpoint, CameraRig, Dynamics, HandGrip, Bar, HighBar, Zoom, Duelist, Surface, Skater, Rail, FootIK, TailWave, TrickScore, Chase, Stompable, Melee, Squash, Footsteps, SpriteAnimator, Trigger, Dormant, Spawner, Reactions })) {
  registerBehavior(name, cls);
}
