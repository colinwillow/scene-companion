// Friendly words for the inspector (Stage 9): behavior and parameter names a person reads, a colour + icon per kind
// of behavior, and a unit guessed from the parameter name (a schema can say `units: 'm'` to be exact).
// Pure functions: the editor shows these, the scene JSON keeps the real names.

// 'PlayerController' -> 'Player controller', 'HUDBar' -> 'HUD bar', 'jumpSpeed' -> 'Jump speed', 'max_hp' -> 'Max hp'
export function friendly(name) {
  const words = String(name)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim().split(/\s+/).filter(Boolean);
  return words.map((w, i) => {
    if (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w)) return w;             // an acronym stays
    const low = w.toLowerCase();
    return i === 0 ? low[0].toUpperCase() + low.slice(1) : low;
  }).join(' ');
}

// Kinds, first match wins. icon = a name in ui/icons.js; colour = a theme token.
export const KINDS = [
  { kind: 'player', test: /^(PlayerController|Skater|Deck|DeckTricks|WallRun|Ledge|Vault|HighBar|Bar|HandGrip|Rail|Zoom)$/, icon: 'play', color: 'var(--edit)' },
  { kind: 'move',   test: /Spin|Bob|Patrol|MoveTo|Chase|Dynamics|Squash|Tail|Wave|Follow|Path/, icon: 'move', color: 'var(--info)' },
  { kind: 'anim',   test: /Anim|Sprite|FootIK|Footsteps/, icon: 'timeline', color: 'var(--paint)' },
  { kind: 'fight',  test: /Health|Melee|Blaster|Projectile|Duelist|Stompable|Breakables|Disguise/, icon: 'heart', color: 'var(--bad)' },
  { kind: 'game',   test: /Pickup|Checkpoint|Trigger|Spawner|Reactions|Dormant|TrickScore|Score|Goal/, icon: 'star', color: 'var(--ok)' },
  { kind: 'look',   test: /Camera|Parallax|Emitter|Trail|Light|Hud|Mount/, icon: 'look', color: 'var(--warn)' },
  { kind: 'sound',  test: /Audio|Sound|Music/, icon: 'sound', color: 'var(--info)' },
  { kind: 'world',  test: /Solid|Collision|Surface|Tile|Kit|Batch/, icon: 'boxes', color: 'var(--dim)' },
];
export function behaviorStyle(type) {
  const k = KINDS.find(k => k.test.test(type));
  return k ? { kind: k.kind, icon: k.icon, color: k.color } : { kind: 'other', icon: 'snap', color: 'var(--faint)' };
}

// A unit for a number param, from the schema or the name. '' when it can't tell (no unit beats a wrong one).
export function unitOf(key, def = {}) {
  if (def.units != null) return def.units;
  const k = String(key);
  if (/(speed|velocity|^vel)/i.test(k)) return 'm/s';
  if (/(gravity|accel)/i.test(k)) return 'm/s²';
  if (/(time|duration|delay|cooldown|interval|life|period)$/i.test(k) || /^(time|duration|delay|cooldown)/i.test(k)) return 's';
  if (/(height|distance|dist|radius|range|reach|gap|length|width|depth|spacing)$/i.test(k)) return 'm';
  if (/(angle|degrees|deg)$/i.test(k)) return '°';
  return '';
}

// "12.30000001" -> "12.3": a slider's number at a sensible precision for its step
export function fmtNum(v, step = 0.1) {
  const dp = Math.min(4, Math.max(0, (String(step).split('.')[1] || '').length));
  return (+(+v).toFixed(dp)).toString();
}
