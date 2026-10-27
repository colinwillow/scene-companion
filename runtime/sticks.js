// Colin's twin-stick touch controls (after rollergirl/weirdport `bindStick`): each pad is an invisible zone (half
// the screen, lower part); the stick draws itself wherever the thumb lands and measures from THERE, so a thumb
// landing near a rim isn't instantly full travel. A short, small touch is a TAP (jump); a fast sweep + release is
// a FLICK (free for future verbs, reported via onFlick). Pure maths at the top (tested), DOM binding below.

export const STICK = { rad: 52, tapFar: 0.42, tapMs: 260, flickAt: 0.72, flickWithin: 280, flickLet: 260, holdMs: 320 };   // holdMs: pressed and kept in place this long = a HOLD (onHold)

// Thumb offset in px → stick vector in [-1, 1], clamped to the ring. → { x, y, px, py } (px/py: knob offset)
export function stickVector(dx, dy, rad = STICK.rad) {
  const d = Math.hypot(dx, dy);
  if (d > rad) { dx *= rad / d; dy *= rad / d; }
  return { x: dx / rad, y: dy / rad, px: dx, py: dy };
}

// What a release means. far: furthest deflection this touch (0..1); heldMs: touch length; flick: the armed sweep
// ({ x, y, t } or null) and now: release time. → 'flick' | 'tap' | null (a hold / drag)
export function releaseGesture({ far, heldMs, flick, now }, k = STICK) {
  if (flick && now - flick.t < k.flickLet) return 'flick';
  if (far < k.tapFar && heldMs < k.tapMs) return 'tap';
  return null;
}

// Arm a flick: hist is [{ x, y, t }] (recent samples, oldest first). → { x, y, t } when the stick swept more than
// flickAt within flickWithin ms, else null.
export function armFlick(hist, k = STICK) {
  if (hist.length < 2) return null;
  const last = hist[hist.length - 1];
  const first = hist.find(h => last.t - h.t <= k.flickWithin) || last;
  const dx = last.x - first.x, dy = last.y - first.y;
  return Math.hypot(dx, dy) > k.flickAt ? { x: dx, y: dy, t: last.t } : null;
}

// ---- DOM: el is a .pad with a .ring and a .knob inside. out gets { x, y, down }. Returns { release() }.
const PADS = [];
export function bindStick(el, out, { onTap, onFlick, onHold } = {}) {
  const ring = el.querySelector('.ring'), knob = el.querySelector('.knob');
  let id = null, t0 = 0, far = 0, ox = 0, oy = 0, hist = [], flick = null, holdTimer = null, holding = false;
  // Where it rests when nobody holds it (a hint where to put your thumb); a landing thumb becomes the centre.
  const home = () => { const r = el.getBoundingClientRect(); return [el.dataset.side === 'right' ? r.width - 92 : 92, r.height - 92]; };
  const draw = (px, py, dx, dy) => {
    ring.style.left = px + 'px'; ring.style.top = py + 'px';
    knob.style.left = px + dx + 'px'; knob.style.top = py + dy + 'px';
  };
  const rest = () => { const [x, y] = home(); draw(x, y, 0, 0); };
  rest(); addEventListener('resize', () => { if (id === null) rest(); });
  const clear = () => { id = null; flick = null; hist = []; out.x = out.y = 0; out.down = false; rest(); el.classList.remove('act'); };
  const move = (cx, cy) => {
    const r = el.getBoundingClientRect(), v = stickVector(cx - r.left - ox, cy - r.top - oy);
    out.x = v.x; out.y = v.y; far = Math.max(far, Math.hypot(v.x, v.y));
    draw(ox, oy, v.px, v.py);
    const now = performance.now();
    hist.push({ x: v.x, y: v.y, t: now });
    while (hist.length > 2 && now - hist[0].t > STICK.flickWithin) hist.shift();
    const f = armFlick(hist); if (f) { flick = f; hist = [hist[hist.length - 1]]; }   // the last sweep before lift counts
  };
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    if (id !== null) return;                              // one thumb per pad
    const r = el.getBoundingClientRect();
    id = e.pointerId; t0 = performance.now(); far = 0; flick = null;
    ox = Math.min(Math.max(e.clientX - r.left, 70), r.width - 70);
    oy = Math.min(Math.max(e.clientY - r.top, 70), r.height - 70);
    hist = [{ x: 0, y: 0, t: t0 }];
    try { el.setPointerCapture(id); } catch {}
    out.down = true; el.classList.add('act'); move(e.clientX, e.clientY);
    // a HOLD: the thumb down and still (inside the tap's radius) past holdMs — told on start and on release
    if (onHold) { clearTimeout(holdTimer); holdTimer = setTimeout(() => { if (id !== null && far < STICK.tapFar) { holding = true; el.classList.add('hold'); onHold(true); } }, STICK.holdMs); }
  });
  el.addEventListener('pointermove', e => { if (e.pointerId === id) { move(e.clientX, e.clientY); e.stopPropagation(); } });
  const end = e => {
    if (e.pointerId !== id) return;
    const g = releaseGesture({ far, heldMs: performance.now() - t0, flick, now: performance.now() });
    const f = flick, wasHold = holding; clearTimeout(holdTimer); holding = false; el.classList.remove('hold'); clear();
    if (wasHold) { onHold?.(false); return; }
    if (g === 'tap') { onTap?.(); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
    if (g === 'flick') onFlick?.(f.x, f.y);
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
  const pad = { el, end, id: () => id, release: () => { if (id !== null) clear(); } };
  PADS.push(pad);
  return pad;
}
// Safety nets for a stuck stick (a lost pointerup): the window hears every up first; leaving the app releases all.
if (typeof addEventListener === 'function') {
  for (const t of ['pointerup', 'pointercancel']) addEventListener(t, e => { for (const p of PADS) if (p.id() === e.pointerId) p.end(e); }, { capture: true });
  for (const t of ['blur', 'pagehide', 'visibilitychange']) addEventListener(t, () => {
    if (t === 'visibilitychange' && document.visibilityState === 'visible') return;
    for (const p of PADS) p.release();
  });
}
