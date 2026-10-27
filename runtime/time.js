// Game time (docs/ENGINE.md #1). Pure, no three/DOM.
//   world.time  — fixed-timestep clock: behaviors update at `step` (1/60 s) however fast the screen runs; the
//                 renderer draws between the last two steps (`alpha`), so motion stays smooth at 30, 60 or 120 Hz.
//                 scale: 1 = normal, 0.3 = slow-mo, 0 = frozen. paused: stop gameplay. hitStop(0.08): freeze
//                 gameplay + animation for that many REAL seconds (impact punch), then carry on.
//   world.rng   — seeded random numbers, a fresh seed each Play (settings.seed pins it), so a run can be replayed
//                 and tests are deterministic. Behaviors use this.world.rng instead of Math.random.

export const STEP = 1 / 60;

export function createTime({ step = STEP, maxSteps = 60 } = {}) {
  return {
    step, maxSteps,
    interpolate: true,  // draw between the last two steps (smooth); false = draw the latest step as is
    scale: 1,           // time scale for gameplay and animation
    paused: false,
    t: 0,               // game seconds (sum of steps)
    frame: 0,           // fixed steps run so far
    alpha: 0,           // 0..1 how far the screen is between the last step and the next (render interpolation)
    stopFor: 0,         // real seconds of hit-stop left
    acc: 0,
    hitStop(seconds) { this.stopFor = Math.max(this.stopFor, Math.max(0, +seconds || 0)); },
    // How much animation (mixers, visual-only effects) should advance for `realDt` of wall-clock time.
    visualDt(realDt) { return this.paused || this.stopFor > 0 ? 0 : realDt * Math.max(0, this.scale); },
    // Feed wall-clock seconds; → how many fixed steps to run now. Caps the backlog at maxSteps (1 s) so the game
    // slows down instead of spiralling (the pages also clamp a frame to 0.05 s).
    advance(realDt) {
      realDt = Math.max(0, +realDt || 0);
      if (this.stopFor > 0) { this.stopFor = Math.max(0, this.stopFor - realDt); return 0; }
      if (this.paused) return 0;
      this.acc += realDt * Math.max(0, this.scale);
      let n = Math.floor(this.acc / this.step + 1e-9);
      if (n > this.maxSteps) { n = this.maxSteps; this.acc = n * this.step; }
      this.acc -= n * this.step;
      if (this.acc < 0) this.acc = 0;
      this.alpha = Math.min(1, this.acc / this.step);
      return n;
    },
    tick() { this.t += this.step; this.frame++; return this.t; },
  };
}

// Seeded RNG (mulberry32). Same seed → same numbers on every device. world.rng() works like Math.random().
export function createRng(seed = 1) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  // callable like Math.random (world.rng()), plus helpers
  return Object.assign(() => next(), {
    seed: seed >>> 0,
    next,                                                 // [0, 1)
    range: (a, b) => a + (b - a) * next(),                // [a, b)
    int: (a, b) => a + Math.floor((b - a + 1) * next()),  // a..b inclusive
    pick: list => (list?.length ? list[Math.floor(next() * list.length)] : undefined),
    chance: p => next() < p,
  });
}

// The seed for a Play: settings.seed if the scene pins one, else a fresh one (reported so a run can be replayed).
export const playSeed = (settings = {}, fresh = () => Math.floor(Math.random() * 2 ** 32)) =>
  Number.isInteger(settings.seed) ? settings.seed >>> 0 : fresh() >>> 0;

// Linear blend for render interpolation: prev + (curr - prev) * a, per component. Pure helper used by World.
export const lerp = (a, b, k) => a + (b - a) * k;
