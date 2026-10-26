// Every behavior is registered here. Keep behaviors free of `three` imports.
import { registerBehavior } from '../runtime/registry.js';
import { Behavior } from '../runtime/Behavior.js';

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
export class Animator extends Behavior {
  static schema = {
    idleClip: { type: 'string', default: 'Idle' },
    walkClip: { type: 'string', default: 'Walking' },
    runClip:  { type: 'string', default: 'Running' },
    runSpeed: { type: 'number', default: 4, min: 0.5, max: 15, step: 0.5 },  // m/s where walk becomes run
  };
  start() { const p = this.entity.object3d.position; this.last = [p.x, p.z]; }
  update(dt) {
    const anim = this.entity.anim; if (!anim || dt <= 0) return;
    const p = this.entity.object3d.position;
    const speed = Math.hypot(p.x - this.last[0], p.z - this.last[1]) / dt;
    this.last = [p.x, p.z];
    const clip = speed < 0.1 ? this.params.idleClip : speed < this.params.runSpeed ? this.params.walkClip : this.params.runClip;
    anim.play(clip);
  }
}

for (const [name, cls] of Object.entries({ Spin, Bob, Patrol, Pickup, Health, MoveTo, Animator })) {
  registerBehavior(name, cls);
}
