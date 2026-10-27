// Particle presets (pure data, shared by the page's particle system and the editor's lists). Sizes in METRES (the point size is
// derived from the lens, so a puff is the same size at any field of view — zap's puffPool). `add`: additive (sparks, glows) vs
// soft alpha (dust, smoke). `grav` m/s² down (negative rises), `drag` 1/s, `grow` size multiplier over the life.
export const FX = {
  sparks: { add: true,  count: 14, speed: [3, 7],     up: 2,    spread: 1,    life: [0.25, 0.5], size: [0.06, 0.1], grow: 0.4, grav: 14,  drag: 1.5, color: ['#fff6d0', '#ffb347'] },
  dust:   { add: false, count: 10, speed: [0.6, 1.6], up: 0.6,  spread: 1,    life: [0.6, 1.1],  size: [0.25, 0.4], grow: 2.2, grav: -0.3, drag: 2.5, color: ['#d8cbb8', '#b9ab98'], alpha: 0.55 },
  smoke:  { add: false, count: 6,  speed: [0.2, 0.6], up: 0.8,  spread: 0.5,  life: [1.4, 2.4],  size: [0.3, 0.5], grow: 3,   grav: -0.6, drag: 0.8, color: ['#8b8f96', '#5f636a'], alpha: 0.45 },
  glow:   { add: true,  count: 8,  speed: [0.5, 2],   up: 0.5,  spread: 1,    life: [0.3, 0.6],  size: [0.15, 0.3], grow: 1.5, grav: 0,   drag: 3,   color: ['#9ff4ff', '#38d6ff'] },
  glass:  { add: true,  count: 18, speed: [2, 5],     up: 1.5,  spread: 1,    life: [0.4, 0.8],  size: [0.04, 0.08], grow: 0.8, grav: 12, drag: 1,   color: ['#ffffff', '#bfe9ff'] },
};
