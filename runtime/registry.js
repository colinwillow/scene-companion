// Name → Behavior class. Scene files refer to behaviors by these names.
const registry = new Map();

export function registerBehavior(name, cls) { registry.set(name, cls); }
export function getBehavior(name) { return registry.get(name); }
export function behaviorNames() { return [...registry.keys()]; }
