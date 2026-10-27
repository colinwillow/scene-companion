// Every behavior is registered here. Keep behaviors free of `three` imports.
import { registerBehavior } from '../runtime/registry.js';
import { Behavior } from '../runtime/Behavior.js';
import { roleClip } from '../runtime/character.js';

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
    if (this.params.faceDirection) this.entity.object3d.rotation.y = Math.atan2(dx, dz);
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
    this.entity.object3d.rotation.y = Math.atan2(dx, dz);
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

// A box other things can stand on and bump into. Axis-aligned (rotation is ignored).
// anchor "bottom" = the entity's origin is the box's bottom centre (Kenney models), "center" = primitives.
export class Solid extends Behavior {
  static schema = {
    size:   { type: 'vec3', default: [1, 1, 1] },        // metres
    anchor: { type: 'string', default: 'bottom' },        // bottom | center
    slope:  { type: 'boolean', default: false },          // a ramp: the top rises from nothing to size.y along the model's +x
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

// Height of a solid's top at (x, z): maxY for boxes, along the incline for ramps.
export function topAt(b, x, z) {
  if (!b.slope) return b.maxY;
  const c = (v, lo, hi) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  const t = { '+x': c(x, b.minX, b.maxX), '-x': 1 - c(x, b.minX, b.maxX), '+z': c(z, b.minZ, b.maxZ), '-z': 1 - c(z, b.minZ, b.maxZ) }[b.slope];
  return b.minY + t * (b.maxY - b.minY);
}
const STEP_UP = 0.35;   // m: walk up ramps and small steps without jumping; stick to ramps on the way down

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
    const P = this.params, p = this.entity.object3d.position, o = this.entity.object3d;
    const input = this.world.input || {}, move = input.move || [0, 0];
    const all = this.world.solids || [], solids = all.map(s => s.box());
    // Ride moving platforms: move with whatever we stood on last frame by however much it moved since.
    if (this.ride && this.grounded) {
      const i = all.indexOf(this.ride.solid);
      if (i >= 0) { const b = solids[i]; p.x += b.minX - this.ride.x; p.y += b.maxY - this.ride.y; p.z += b.minZ - this.ride.z; }
    }
    this.ride = null;
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    o.visible = this.hurtTimer <= 0 || Math.floor(this.hurtTimer * 10) % 2 === 0;   // blink while invulnerable

    // Horizontal move, then push out of any solid we're inside (side collision).
    const ms = this.entity.moveScale ?? 1;                                  // e.g. Animator slows us during a hard landing
    p.x += move[0] * P.speed * ms * dt;
    p.z += move[1] * P.speed * ms * dt;
    if (Math.hypot(move[0], move[1]) > 0.05) o.rotation.y = Math.atan2(move[0], move[1]);
    for (const b of solids) {
      if (p.y >= (b.slope ? topAt(b, p.x, p.z) - STEP_UP : b.maxY - 0.05) || p.y + P.height <= b.minY) continue;      // above or below it (on a ramp: walk up it)
      const cx = Math.max(b.minX, Math.min(p.x, b.maxX)), cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
      const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
      if (d >= P.radius) continue;
      if (d > 1e-6) { p.x = cx + (dx / d) * P.radius; p.z = cz + (dz / d) * P.radius; }
      else {                                                                // centre inside: shortest way out
        const pushes = [[b.minX - P.radius - p.x, 0], [b.maxX + P.radius - p.x, 0], [0, b.minZ - P.radius - p.z], [0, b.maxZ + P.radius - p.z]];
        const [ox, oz] = pushes.sort((a, c) => Math.hypot(...a) - Math.hypot(...c))[0];
        p.x += ox; p.z += oz;
      }
    }

    // Jump (buffered a little so an early tap still counts), with coyote time.
    if (input.jump) { this.jumpBuffer = 0.12; input.jump = false; }
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
      const top = topAt(b, p.x, p.z);
      if (top <= p.y + (b.slope ? STEP_UP : 0.05) && top > support && this.overlapsXZ(b, p.x, p.z, P.radius * 0.9)) { support = top; supportIdx = i; }
    });
    if (this.vy > 0) for (const b of solids) {
      if (b.minY >= p.y + P.height - 0.01 && b.minY < ny + P.height && this.overlapsXZ(b, p.x, p.z, P.radius * 0.9)) { this.vy = 0; break; }
    }
    const onRamp = supportIdx >= 0 && solids[supportIdx].slope;
    if ((ny <= support || (onRamp && this.grounded && p.y - support < STEP_UP)) && this.vy <= 0) {   // ramps: stay stuck to the slope going down
      if (!this.grounded && this.airTime > 0.15) this.world.emit('land');
      p.y = support; this.vy = 0; this.grounded = true; this.airTime = 0; this.airJumpCount = 0;
      if (supportIdx >= 0) { const b = solids[supportIdx]; this.ride = { solid: all[supportIdx], x: b.minX, y: b.maxY, z: b.minZ }; }
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
  };
  start() { const p = this.entity.object3d.position; this.home = [p.x, p.z]; }
  onMoved() { this.start(); }
  update(dt) {
    if (this.entity.object3d.visible === false || this.entity.defeated || this.entity.dormant) return;
    const t = this.world.getEntity(this.params.targetId); if (!t) return;
    const p = this.entity.object3d.position, q = t.object3d.position;
    const near = Math.hypot(q.x - p.x, q.z - p.z) < this.params.radius;
    const goal = near ? [q.x, q.z] : this.params.returnHome ? this.home : null;
    if (!goal) return;
    const dx = goal[0] - p.x, dz = goal[1] - p.z, d = Math.hypot(dx, dz), step = this.params.speed * dt;
    if (d < 0.05) return;
    const k = Math.min(step, d) / d;
    p.x += dx * k; p.z += dz * k;
    this.entity.object3d.rotation.y = Math.atan2(dx, dz);
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
    if (falling && feet > p.y + P.height * 0.5) {
      this.defeated = this.entity.defeated = true;   // entity.defeated stands Chase + Animator down
      const anim = this.entity.anim;
      const defeat = roleClip(P.defeatClip, 'death', this.entity.roles);
      if (defeat && anim?.clips.includes(defeat)) { anim.play(defeat, { once: true, fade: 0.1 }); this.hideIn = P.hideAfter; }
      else this.entity.object3d.visible = false;
      this.world.emit('stomp', this.entity.id);
      this.world.emit('score', P.points);
      this.world.emit('bounce', 0.7);
    } else this.world.emit('hurt', P.damage);
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
  };
  start() { const p = this.entity.object3d.position; this.last = [p.x, p.z]; this.dist = 0; }
  update(dt) {
    const p = this.entity.object3d.position, pc = this.entity.behaviors.find(b => b instanceof PlayerController);
    const d = Math.hypot(p.x - this.last[0], p.z - this.last[1]);
    this.last = [p.x, p.z];
    const move = this.world.input?.move || [0, 0], push = Math.min(1, Math.hypot(move[0], move[1]));
    if (!pc || !pc.grounded || push < 0.05 || dt <= 0) { this.dist = Math.min(this.dist, this.params.stride * 0.5); return; }
    this.dist += d;
    const stride = this.params.stride + (this.params.runStride - this.params.stride) * push;
    if (this.dist >= stride) { this.dist -= stride; this.world.emit('step', this.entity.id); }
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

for (const [name, cls] of Object.entries({ Spin, Bob, Patrol, Pickup, Health, MoveTo, Animator, Solid, PlayerController, Chase, Stompable, Squash, Footsteps, Trigger, Dormant, Spawner })) {
  registerBehavior(name, cls);
}
