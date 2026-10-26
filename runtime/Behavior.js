// Base class for every behavior. Behaviors must NOT import three, so the
// validator (and a future native runtime) can load them without a renderer.
//
// static schema = { paramName: { type: 'number'|'boolean'|'string'|'vec3'|'color', default, min, max, step } }

export class Behavior {
  static schema = {};

  constructor(entity, params = {}, world) {
    this.entity = entity;          // { id, object3d, data }
    this.world = world;
    this.params = Behavior.resolveParams(this.constructor.schema, params);
  }

  static resolveParams(schema, params) {
    const out = {};
    for (const [key, def] of Object.entries(schema)) {
      const v = params[key];
      out[key] = v === undefined ? structuredClone(def.default) : v;
    }
    return out;
  }

  // Lifecycle hooks — override as needed.
  start() {}
  update(dt, t) {}
  destroy() {}

  // Called by the editor when an authored value changes while playing.
  onParamChanged(key, value) { this.params[key] = value; }
}
