// The inside of an extension's sandbox (runtime/sandbox-worker.js runs it in a Worker; tests run it in-process).
// It owns the extension's behaviors and gives them a stand-in entity and world: an object3d with position / rotation /
// scale (Euler) and nothing else, world.on / emit / getEntity (last frame's positions) / input. Each 'frame' message
// brings the main side's transforms, input and events; the reply carries the new transforms and any events emitted.
// Globals the manifest did not ask for are taken away BEFORE the extension's code is imported.
export function lockGlobals(g, permissions = []) {
  const deny = what => function () { throw new Error(`this extension did not ask for "${what}" permission`); };
  if (!permissions.includes('network')) for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) try { Object.defineProperty(g, k, { value: deny('network'), configurable: false }); } catch {}
  if (!permissions.includes('storage')) for (const k of ['indexedDB', 'caches', 'localStorage', 'sessionStorage']) try { Object.defineProperty(g, k, { value: undefined, configurable: false }); } catch {}
  try { Object.defineProperty(g, 'importScripts', { value: deny('import'), configurable: false }); } catch {}
}

const xyz = (x = 0, y = 0, z = 0) => ({ x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; }, copy(v) { return this.set(v.x, v.y, v.z); } });
const fromT = t => ({ position: xyz(t[0], t[1], t[2]), rotation: xyz(t[3], t[4], t[5]), scale: xyz(t[6], t[7], t[8]) });
const intoT = (o, t) => { o.position.set(t[0], t[1], t[2]); o.rotation.set(t[3], t[4], t[5]); o.scale.set(t[6], t[7], t[8]); };
const toT = o => [o.position.x, o.position.y, o.position.z, o.rotation.x, o.rotation.y, o.rotation.z, o.scale.x, o.scale.y, o.scale.z];

export function createSandboxCore(post, { importer = u => import(u), globals = globalThis } = {}) {
  class Behavior {
    static schema = {};
    constructor(entity, params = {}, world) {
      this.entity = entity; this.world = world; this.params = {};
      for (const [k, d] of Object.entries(this.constructor.schema)) this.params[k] = params[k] === undefined ? structuredClone(d.default) : params[k];
    }
    start() {} update() {} lateUpdate() {} destroy() {} onMoved() {}
    onParamChanged(k, v) { this.params[k] = v; }
  }
  const defs = new Map(), inst = new Map(), listeners = new Map();
  let snap = new Map(), input = {}, emits = [], time = { t: 0 };
  const world = {
    on(ev, fn) { if (!listeners.has(ev)) { listeners.set(ev, []); post({ type: 'listen', ev }); } listeners.get(ev).push(fn); },
    emit(ev, ...args) { emits.push([ev, args]); },
    getEntity(id) { const p = snap.get(id); return p ? { id, object3d: { position: xyz(p[0], p[1], p[2]) } } : null; },
    get input() { return input; }, get time() { return time; },
  };
  return {
    async handle(m) {
      try {
        if (m.type === 'init') {
          lockGlobals(globals, m.permissions);
          const mod = await importer(m.url);
          await mod.default({ Behavior, helpers: {}, define: (name, cls) => {
            if (!m.behaviors.includes(name)) throw new Error(`defines "${name}", which extension.json does not list`);
            if (!(cls?.prototype instanceof Behavior)) throw new Error(`"${name}" must extend the Behavior it is handed`);
            defs.set(name, cls); } });
          post({ type: 'ready', defs: [...defs].map(([n, c]) => [n, c.schema || {}]) });
        } else if (m.type === 'spawn') {
          const C = defs.get(m.name); if (!C) throw new Error(`no behavior "${m.name}"`);
          const ent = { id: m.id, object3d: fromT(m.t), data: {} };
          inst.set(m.key, { b: new C(ent, m.params, world), started: false });
        } else if (m.type === 'frame') {
          snap = new Map(m.snap); input = m.input || {}; time = { t: m.t };
          for (const [ev, args] of m.events || []) for (const fn of listeners.get(ev) || []) fn(...args);
          const out = [];
          for (const [key, t] of m.ents) {
            const I = inst.get(key); if (!I) continue;
            intoT(I.b.entity.object3d, t);
            if (!I.started) { I.started = true; I.b.start(); }
            I.b.update(m.dt, m.t);
            out.push([key, toT(I.b.entity.object3d)]);
          }
          const e = emits; emits = [];
          post({ type: 'frame', out, emits: e });
        } else if (m.type === 'param') inst.get(m.key)?.b.onParamChanged(m.k, m.v);
        else if (m.type === 'moved') inst.get(m.key)?.b.onMoved();
        else if (m.type === 'destroy') { inst.get(m.key)?.b.destroy(); inst.delete(m.key); }
      } catch (e) { post({ type: 'error', msg: e.message }); }
    },
  };
}
