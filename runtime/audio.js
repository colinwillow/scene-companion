// Sound files for game pages (Web Audio): one-shots and loops, 3D-positioned or flat, on three buses — master, music, sfx —
// whose volumes are kept per device. Browser-only like sfx.js; behaviors never touch it, they emit `audio` requests
// (AudioSource) and the page plays them.
//   const audio = createAudio(); audio.unlock() on a tap; audio.play({ url, volume, pitch, loop, at, follow, bus });
//   audio.listen(position, forward) each frame; audio.update(id => [x, y, z]) moves sounds that follow an entity.
export function createAudio({ storage = globalThis.localStorage } = {}) {
  let ctx = null; const buffers = new Map(), live = new Set(), buses = {}, pending = new Map();   // loops asked for before the first tap
  const vol = { master: 1, music: 0.6, sfx: 1 };
  try { Object.assign(vol, JSON.parse(storage?.getItem('sc.audio') || '{}')); } catch {}
  const audio = {
    vol, muted: false,
    unlock() {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!ctx && AC) {
        ctx = new AC();
        buses.master = ctx.createGain(); buses.master.connect(ctx.destination);
        for (const b of ['music', 'sfx']) { buses[b] = ctx.createGain(); buses[b].connect(buses.master); }
        audio.setVolume();
      }
      const go = () => { for (const r of pending.values()) audio.play(r); pending.clear(); };
      if (ctx?.state === 'suspended') ctx.resume().then(go); else if (ctx) go();
    },
    setVolume(bus, v) {
      if (bus) vol[bus] = Math.max(0, Math.min(1, v));
      try { storage?.setItem('sc.audio', JSON.stringify(vol)); } catch {}
      if (ctx) for (const b of ['master', 'music', 'sfx']) buses[b].gain.value = b === 'master' && audio.muted ? 0 : vol[b];
    },
    load(url) {
      if (!buffers.has(url)) buffers.set(url, fetch(url).then(r => r.arrayBuffer()).then(b => new Promise((ok, no) => ctx.decodeAudioData(b, ok, no))).catch(() => null));
      return buffers.get(url);
    },
    async play({ url, volume = 1, pitch = 1, loop = false, at = null, follow = null, bus = 'sfx', ref = 4, key = null } = {}) {
      if (!url) return null;
      if (!ctx || ctx.state !== 'running') { if (loop) pending.set(key || url, { url, volume, pitch, loop, at, follow, bus, ref, key }); return null; }
      if (key) for (const h of live) if (h.key === key) return h;      // a loop already playing for that key
      const buf = await audio.load(url); if (!buf || ctx.state !== 'running') return null;
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf; src.loop = loop; src.playbackRate.value = pitch; g.gain.value = volume;
      let out = g, pan = null;
      if (at || follow) {
        pan = ctx.createPanner(); pan.panningModel = 'equalpower'; pan.distanceModel = 'inverse'; pan.refDistance = ref; pan.rolloffFactor = 1;
        if (at) audio.place(pan, at);
        g.connect(pan); out = pan;
      }
      out.connect(buses[bus] || buses.sfx);
      src.start();
      const h = { src, pan, follow, key, stop() { try { src.stop(); } catch {} live.delete(h); } };
      src.onended = () => live.delete(h); live.add(h);
      return h;
    },
    place(pan, [x, y, z]) { if (pan.positionX) { pan.positionX.value = x; pan.positionY.value = y; pan.positionZ.value = z; } else pan.setPosition(x, y, z); },
    listen([x, y, z], [fx, fy, fz]) {
      const L = ctx?.listener; if (!L) return;
      if (L.positionX) { L.positionX.value = x; L.positionY.value = y; L.positionZ.value = z; L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
      else { L.setPosition(x, y, z); L.setOrientation(fx, fy, fz, 0, 1, 0); }
    },
    update(where) { for (const h of live) if (h.follow && h.pan) { const p = where(h.follow); if (p) audio.place(h.pan, p); } },
    stop(key) { for (const h of [...live]) if (!key || h.key === key) h.stop(); if (key) pending.delete(key); else pending.clear(); },
  };
  return audio;
}
