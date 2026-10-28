// The example extension (extensions/README.md shows how to write one). It imports nothing: register() is handed the
// Behavior base class and define(), and defines exactly the behaviors extension.json lists.
export default function register({ Behavior, define }) {
  define('Wobble', class extends Behavior {
    static schema = {
      amount: { type: 'number', default: 0.08, min: 0, max: 0.5, step: 0.01 },   // how much it squashes (0.08 = 8%)
      speed:  { type: 'number', default: 6, min: 0.5, max: 20, step: 0.5 },      // wobbles per second × 2π
      sway:   { type: 'number', default: 4, min: 0, max: 30, step: 1 },          // degrees it leans side to side
      kick:   { type: 'number', default: 3, min: 0, max: 10, step: 0.5 },        // extra wobble when the player jumps within 6 m
    };
    start() {
      const s = this.entity.object3d.scale; this.base = [s.x, s.y, s.z]; this.t = Math.random() * 10; this.energy = 1;
      this.world.on?.('jump', () => {
        const me = this.entity.object3d.position, p = this.world.getEntity?.('player')?.object3d.position;
        if (!p || Math.hypot(p.x - me.x, p.z - me.z) < 6) this.energy = 1 + this.params.kick;
      });
    }
    onMoved() { const s = this.entity.object3d.scale; this.base = [s.x, s.y, s.z]; }
    update(dt) {
      const P = this.params, o = this.entity.object3d;
      this.t += dt; this.energy = 1 + (this.energy - 1) * Math.exp(-2.5 * dt);      // a kick dies away
      const w = Math.sin(this.t * P.speed) * P.amount * this.energy;
      o.scale.set(this.base[0] * (1 - w / 2), this.base[1] * (1 + w), this.base[2] * (1 - w / 2));   // volume roughly kept
      o.rotation.z = Math.sin(this.t * P.speed * 0.5) * P.sway * Math.PI / 180 * Math.min(this.energy, 3) / 3;
    }
  });
}
