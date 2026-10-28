// The game's side of an extension sandbox. startSandbox() opens the channel (a Worker in the browser), loads the extension
// in it, and returns a proxy Behavior class per behavior it defined: same name, same schema, so scenes, the inspector
// and the validator see no difference. Each frame every proxy hands its entity's transform in and takes back what the
// sandboxed behavior did with it last frame (one frame behind); all of a frame's proxies go in ONE message.
import { Behavior } from './Behavior.js';

const clean = v => { try { return JSON.parse(JSON.stringify(v ?? null)); } catch { return null; } };
const toT = o => [o.position.x, o.position.y, o.position.z, o.rotation.x, o.rotation.y, o.rotation.z, o.scale.x, o.scale.y, o.scale.z];

export async function startSandbox(world, { url, manifest, channel, timeout = 8000 }) {
  const latest = new Map(), queued = [], pendingEvents = [], errors = [];
  let flushing = false, frame = { dt: 0, t: 0 }, ready;
  let timer;
  const readyP = new Promise((ok, fail) => { ready = { ok, fail }; timer = setTimeout(() => fail(new Error('sandbox did not start')), timeout); });
  channel.onmessage = m => {
    if (m.type === 'ready') ready.ok(m.defs);
    else if (m.type === 'error') { errors.push(m.msg); if (!host.started) ready.fail(new Error(m.msg)); else console.warn(`extension ${manifest.id} (sandboxed): ${m.msg}`); }
    else if (m.type === 'listen') world.on(m.ev, (...args) => pendingEvents.push([m.ev, clean(args)]));
    else if (m.type === 'frame') { for (const [key, t] of m.out) latest.set(key, t); for (const [ev, args] of m.emits) world.emit(ev, ...(args || [])); }
  };
  const flush = () => {
    flushing = false;
    const snap = [...world.entities.values()].map(e => [e.id, [e.object3d.position.x, e.object3d.position.y, e.object3d.position.z]]);
    channel.postMessage({ type: 'frame', dt: frame.dt, t: frame.t, input: clean(world.input), snap, events: pendingEvents.splice(0), ents: queued.splice(0) });
  };
  const host = { started: false, nextKey: 1, errors,
    spawn(p) { p.key = host.nextKey++; channel.postMessage({ type: 'spawn', key: p.key, name: p.constructor.sandboxName, id: p.entity.id, params: clean(p.params), t: toT(p.entity.object3d) }); },
    tick(p, dt, t) {
      const back = latest.get(p.key), o = p.entity.object3d;
      if (back) { o.position.set(back[0], back[1], back[2]); o.rotation.set(back[3], back[4], back[5]); o.scale.set(back[6], back[7], back[8]); latest.delete(p.key); }
      frame = { dt, t }; queued.push([p.key, toT(o)]);
      if (!flushing) { flushing = true; queueMicrotask(flush); }
    },
    post: m => channel.postMessage(m) };
  channel.postMessage({ type: 'init', url, behaviors: manifest.behaviors, permissions: manifest.permissions || [] });
  const defs = await readyP.finally(() => clearTimeout(timer)); host.started = true;
  return defs.map(([name, schema]) => {
    const Proxy = class extends Behavior {
      static schema = schema; static sandboxName = name; static sandboxed = true;
      start() { host.spawn(this); }
      update(dt, t) { host.tick(this, dt, t); }
      onParamChanged(k, v) { super.onParamChanged(k, v); host.post({ type: 'param', key: this.key, k, v: clean(v) }); }
      onMoved() { host.post({ type: 'moved', key: this.key }); }
      destroy() { host.post({ type: 'destroy', key: this.key }); }
    };
    Object.defineProperty(Proxy, 'name', { value: name });
    return [name, Proxy];
  });
}

// The browser's channel: a module Worker. (Tests hand in an in-process channel instead.)
export function workerChannel() {
  const w = new Worker(new URL('./sandbox-worker.js', import.meta.url), { type: 'module' });
  const ch = { onmessage: null, postMessage: m => w.postMessage(m), close: () => w.terminate() };
  w.onmessage = e => ch.onmessage?.(e.data);
  w.onerror = e => ch.onmessage?.({ type: 'error', msg: e.message || 'the sandbox crashed' });
  return ch;
}
