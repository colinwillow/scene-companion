// Every behavior is registered here. Keep behaviors free of `three` imports.
import { registerBehavior } from '../runtime/registry.js';
import { WHEN, compare } from '../runtime/reactions.js';
import { Behavior } from '../runtime/Behavior.js';
import { roleClip } from '../runtime/character.js';
import { topAt, walkShape } from '../runtime/collide.js';
import { placeCollider } from '../runtime/colliders.js';
export { topAt };

// Face a heading. Writing rotation.y alone is wrong once the rotation has been through a quaternion (interpolation,
// slerp): a yaw past 90° reads back as (π, π − yaw, π), and setting only .y under that x/z turns him to π − yaw (mirrored).
// So a flipped Euler is normalised first; a small authored tilt is kept.
export function setYaw(o, yaw, roll) {
  const r = o.rotation;
  if (Math.abs(r.x) > Math.PI / 2 || Math.abs(r.z) > Math.PI / 2) { r.x = 0; r.z = 0; }
  r.y = yaw;
  if (roll !== undefined) r.z = roll;
}

export class Spin extends Behavior {
  static schema = {
    speed: { type: 'number', default: 1, min: -10, max: 10, step: 0.1 },  // radians/sec around Y
  };
  update(dt) { this.entity.object3d.rotation.y += this.params.speed * dt; }
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
      const q = ((Math.round((this.entity.object3d.rotation?.y || 0) / (Math.PI / 2)) % 4) + 4) % 4;
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
      const { c, size, yaw } = placeCollider(col, pos, o.rotation?.y || 0, k);
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
    const mx = mag > 0.3 ? move[0] / mag : Math.sin(o.rotation.y), mz = mag > 0.3 ? move[1] / mag : Math.cos(o.rotation.y);
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
    setYaw(this.entity.object3d, this.entity.object3d.rotation.y, 0);
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
    const input = this.world.input || {}, move = input.move || [0, 0];
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
      if (Math.hypot(move[0], move[1]) <= 0.05 && Math.hypot(...this.carry) > 0.5) setYaw(o, Math.atan2(this.carry[0], this.carry[1]));
      if (Math.hypot(...this.carry) < 0.05) this.carry = null;
    }
    if (Math.hypot(move[0], move[1]) > 0.05) setYaw(o, Math.atan2(move[0], move[1]));
    for (const b of solids) {
      if (p.y + P.height <= b.minY) continue;                               // below it
      const { cx, cz, inside } = b.near(p.x, p.z);
      // above it? (a ramp or a curved top: walk up it, STEP_UP at a time)
      if (p.y >= (inside ? b.top(p.x, p.z) : b.top(cx, cz)) - (b.sloped ? STEP_UP : 0.05)) continue;
      const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
      if (!inside && d >= P.radius) continue;
      if (!inside && d > 1e-6) { p.x = cx + (dx / d) * P.radius; p.z = cz + (dz / d) * P.radius; }
      else { const [ox, oz] = b.out(p.x, p.z, P.radius); p.x += ox; p.z += oz; }   // centre inside: shortest way out
    }

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
    if (this.vy > 0) for (const b of solids) {
      if (b.minY >= p.y + P.height - 0.01 && b.minY < ny + P.height && b.topNear(p.x, p.z, P.radius * 0.9) > -Infinity) { this.vy = 0; break; }
    }
    const onRamp = supportIdx >= 0 && solids[supportIdx].sloped;
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
  };
  start() { const p = this.entity.object3d.position; this.home = [p.x, p.z]; }
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
    const goal = near ? [q.x, q.z] : this.params.returnHome ? this.home : null;
    if (!goal) return;
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
    turn:     { type: 'boolean', default: true },     // face the strike direction
    speed:    { type: 'number', default: 1.75, min: 0.25, max: 4, step: 0.05 },  // clip playback rate (weirdport plays Zap's strikes at 1.75)
  };
  start() { this.cool = 0; this.pending = null; }
  update(dt) {
    if (this.entity.defeated) return;
    this.cool -= dt;
    const input = this.world.input, a = input?.attack;
    if (a) { input.attack = null; if (this.cool <= 0) this.swing(a); }
    if (this.pending && (this.pending.t -= dt) <= 0) { this.hit(this.pending.dir); this.pending = null; }
  }
  swing([x, z]) {
    const P = this.params, o = this.entity.object3d;
    let dir = Math.hypot(x, z) > 1e-3 ? [x, z] : [Math.sin(o.rotation.y), Math.cos(o.rotation.y)];
    const l = Math.hypot(...dir); dir = [dir[0] / l, dir[1] / l];
    if (P.turn) setYaw(o, Math.atan2(dir[0], dir[1]));
    const clip = roleClip(P.clip, 'attack', this.entity.roles);
    if (clip && this.entity.anim?.clips.includes(clip)) this.entity.anim.play(clip, { layer: P.layer, once: true, fade: 0.08, restart: true, speed: P.speed });
    this.world.emit('swing', this.entity.id);
    this.cool = P.cooldown;
    if (P.hitDelay > 0) this.pending = { t: P.hitDelay, dir }; else this.hit(dir);
  }
  hit(dir) {
    const P = this.params, p = this.entity.object3d.position, cosHalf = Math.cos((P.arc / 2) * Math.PI / 180);
    for (const e of this.world.entities?.values?.() || []) {
      if (e === this.entity || e.defeated || e.object3d?.visible === false) continue;
      if (!e.behaviors?.some(b => b instanceof Stompable)) continue;
      const q = e.object3d.position, dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      if (d > P.reach || Math.abs(q.y - p.y) > 2) continue;
      if (d > 1e-3 && (dx * dir[0] + dz * dir[1]) / d < cosHalf) continue;
      this.world.emit('struck', this.entity.id, e.id, P.damage);
    }
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
  static schema = { rules: { type: 'rules', default: [] } };
  start() { this.state = []; this.heard = {}; this.subscribed ||= new Set(); this.t = 0; this.started = false; this.world.vars ||= {}; }
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
      case 'end': W.emit('end', String(a.text ?? '')); break;
      case 'load': if (a.scene) W.emit('loadScene', String(a.scene)); break;
    }
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
  }
}

for (const [name, cls] of Object.entries({ Spin, Bob, Patrol, Pickup, Health, MoveTo, Animator, Solid, CollisionMesh, PlayerController, WallRun, Chase, Stompable, Melee, Squash, Footsteps, Trigger, Dormant, Spawner, Reactions })) {
  registerBehavior(name, cls);
}
