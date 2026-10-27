// Tiny synthesized sound effects (Web Audio, no files). Browser-only: game pages use it, behaviors never do.
// Usage: const sfx = createSfx(); sfx.unlock() on the first tap; sfx.play('jump').
const SOUNDS = {
  jump:     [{ type: 'square',   f0: 330, f1: 660, dur: 0.12, vol: 0.12 }],
  step:     [{ type: 'noise', dur: 0.04, vol: 0.05 }, { type: 'triangle', f0: 90, f1: 60, dur: 0.05, vol: 0.06 }],
  land:     [{ type: 'triangle', f0: 120, f1: 60,  dur: 0.08, vol: 0.18 }],
  coin:     [{ type: 'square',   f0: 988, f1: 988, dur: 0.07, vol: 0.10 }, { type: 'square', f0: 1319, f1: 1319, dur: 0.18, vol: 0.10, at: 0.07 }],
  stomp:    [{ type: 'square',   f0: 520, f1: 140, dur: 0.14, vol: 0.14 }, { type: 'noise', dur: 0.08, vol: 0.12 }],
  hurt:     [{ type: 'sawtooth', f0: 300, f1: 90,  dur: 0.3,  vol: 0.14 }],
  respawn:  [{ type: 'sine',     f0: 220, f1: 660, dur: 0.35, vol: 0.12 }],
  win:      [523, 659, 784, 1047].map((f, i) => ({ type: 'square', f0: f, f1: f, dur: 0.16, vol: 0.10, at: i * 0.13 })),
  gameover: [392, 330, 262].map((f, i) => ({ type: 'triangle', f0: f, f1: f * 0.97, dur: 0.3, vol: 0.16, at: i * 0.25 })),
};

export function createSfx({ muted = false } = {}) {
  let ctx = null, noise = null;
  const sfx = {
    muted,
    unlock() {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!ctx && AC) ctx = new AC();
      if (ctx?.state === 'suspended') ctx.resume();
    },
    play(name) {
      const parts = SOUNDS[name];
      if (!parts || sfx.muted || !ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      for (const s of parts) {
        const t = now + (s.at || 0), g = ctx.createGain();
        g.gain.setValueAtTime(s.vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + s.dur);
        g.connect(ctx.destination);
        let src;
        if (s.type === 'noise') {
          if (!noise) { noise = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
          src = ctx.createBufferSource(); src.buffer = noise;
        } else {
          src = ctx.createOscillator(); src.type = s.type;
          src.frequency.setValueAtTime(s.f0, t);
          src.frequency.exponentialRampToValueAtTime(s.f1, t + s.dur);
        }
        src.connect(g); src.start(t); src.stop(t + s.dur + 0.02);
      }
    },
  };
  return sfx;
}
