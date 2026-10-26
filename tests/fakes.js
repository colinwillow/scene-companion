// Minimal stand-ins for the runtime, so behaviors run in plain Node (no three, no browser).
export function fakeEntity(id = 'e', pos = [0, 0, 0]) {
  return {
    id,
    object3d: { position: { x: pos[0], y: pos[1], z: pos[2] }, rotation: { x: 0, y: 0, z: 0 }, visible: true },
    behaviors: [],
  };
}

export function fakeWorld(entities = []) {
  const map = new Map(entities.map(e => [e.id, e]));
  const listeners = {};
  return {
    emitted: [],
    getEntity: id => map.get(id),
    on(name, fn) { (listeners[name] ||= []).push(fn); },
    emit(name, ...args) { this.emitted.push([name, ...args]); (listeners[name] || []).forEach(fn => fn(...args)); },
  };
}

// Attach a behavior the way World does (construct, then start).
export function attach(Cls, entity, params, world) {
  const b = new Cls(entity, params, world);
  entity.behaviors.push(b);
  b.start();
  return b;
}

// Step a behavior n times with a fixed dt; t accumulates like World.update.
export function run(b, n, dt = 1 / 60, t0 = 0) {
  let t = t0;
  for (let i = 0; i < n; i++) { t += dt; b.update(dt, t); }
  return t;
}
