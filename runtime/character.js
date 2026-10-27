// character.json: one file per character — its model, height and which clip plays each ROLE.
//   { "name": "Zap", "glb": "./assets/…/zap.glb", "height": 1.6, "roles": { "idle": "idle_01", "walk": "walk_fwd", … } }
// A scene/prefab asset variant points at it with { "character": "./assets/…/zap.character.json" } (other variant keys
// override the file's). Behaviors ask for a role; a clip param set on the behavior is the per-entity override.
// Pure (no three/DOM).

export const ROLES = ['idle', 'walk', 'run', 'jump', 'doubleJump', 'fall', 'land', 'hardLand', 'hit', 'death', 'attack'];

// Old assets with no character.json keep the names the Animator used to default to.
const LEGACY = { idle: 'Idle', walk: 'Walking', run: 'Running', jump: 'Jump' };

// Which clip to play for `role`. param: the behavior's clip param ('' = use the role, 'none' = no clip).
// roles: the character's roles (null/undefined for an asset without a character.json).
export function roleClip(param, role, roles) {
  if (param === 'none') return '';
  if (param) return param;
  if (roles) return roles[role] || '';
  return LEGACY[role] || '';
}

// The model keys a character file can carry into a variant.
const MODEL_KEYS = ['glb', 'height', 'scale', 'offset', 'frontSide', 'castShadow'];

// Merge a loaded character file into the variant that pointed at it; the variant's own keys win.
export function characterVariant(character, variant) {
  const out = {};
  for (const k of MODEL_KEYS) if (character?.[k] !== undefined) out[k] = character[k];
  for (const [k, v] of Object.entries(variant || {})) if (k !== 'character') out[k] = v;
  return out;
}

// Problems with a character file, given the clip names in its glb (null = glb not found). → [{ level, msg }]
export function checkCharacter(ch, clips) {
  const out = [], err = msg => out.push({ level: 'error', msg }), warn = msg => out.push({ level: 'warn', msg });
  if (!ch || typeof ch !== 'object') { err('not a JSON object'); return out; }
  if (typeof ch.glb !== 'string') err('needs "glb"');
  else if (clips === null) err(`model file not found: ${ch.glb}`);
  if (!(ch.height > 0)) warn('no "height" (metres) — the model is used at its exported size');
  if (!ch.roles || typeof ch.roles !== 'object') { err('needs "roles" ({ idle, walk, run, … })'); return out; }
  for (const [role, clip] of Object.entries(ch.roles)) {
    if (!ROLES.includes(role)) warn(`unknown role "${role}" (known: ${ROLES.join(', ')})`);
    if (typeof clip !== 'string' || !clip) err(`role "${role}" needs a clip name`);
    else if (clips && !clips.includes(clip)) err(`role "${role}": clip "${clip}" isn't in ${ch.glb}`);
  }
  if (!ch.roles.idle) warn('no "idle" role');
  return out;
}
