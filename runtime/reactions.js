// Reactions (SPEC §7g): "when this happens, (if …) do that" rules authored in the editor, no code. Pure data + helpers;
// the Reactions behavior runs them. One vocabulary table drives the behavior, the inspector's dropdowns, the validator
// and the MCP tool, so adding a trigger or an action is one entry here plus its case in behaviors/index.js.
//
// A rule: { when: { type, …fields }, if: { once, cooldown, chance, var, op, value }, do: [{ type, …fields }, …] }

// Field defaults also say each field's type (number / string / vec3 / boolean) to the editor.
export const WHEN = {
  near:   { target: 'player', radius: 3 },     // `target` comes within `radius` m (fires on arriving, again after it leaves)
  leave:  { target: 'player', radius: 3 },     // …and when it goes back out
  bumped: { target: 'player', radius: 1 },     // touches me (a short reach)
  event:  { name: 'pickup', from: '' },        // a world event fires (from: only when the event's first argument is this id)
  timer:  { every: 2 },                        // every N seconds
  start:  {},                                  // when play starts
  frame:  { name: 'hit' },                     // a frame event in MY clip (character.json events, e.g. hit, foot)
  struck: {},                                  // I was hit by a Melee strike
  var:    { var: 'coins', op: '>=', value: 10 },   // a world variable starts meeting the test (fires once each time it becomes true)
};
export const DO = {
  play:    { clip: 'wave', layer: 'upper' },   // a clip or a role name (idle, attack, …); upper = the legs keep doing their thing
  look:    { target: 'player' },               // turn to face it
  say:     { text: 'Hey!' },                   // a speech bubble (game page)
  sound:   { name: 'coin' },                   // a sound (game page)
  emit:    { name: 'trigger' },                // send a world event (other Reactions, Triggers, the game page can listen)
  set:     { var: 'flag', value: 1 },          // world variable = value
  add:     { var: 'count', value: 1 },         // world variable += value
  spawn:   { prefab: 'coin', offset: [0, 1, 0] },
  hide:    { target: 'self' },
  show:    { target: 'self' },
  destroy: { target: 'self' },
  hud:     { text: 'Find the key!', seconds: 2 },   // a message across the screen (game page)
  shake:   { amount: 0.3, seconds: 0.3 },            // camera shake (game page)
  end:     { text: 'You win!', sub: '', button: '', next: '' },   // the end screen (game page) — win or lose; sub: a line under it, button: its word, next: a scene to go to
  load:    { scene: './scenes/tiny-hop.scene.json' },   // go to another scene (game page)
};
export const OPS = ['>=', '>', '==', '!=', '<', '<='];

export const newRule = () => ({ when: { type: 'near', ...WHEN.near }, if: { once: false, cooldown: 1 }, do: [{ type: 'look', ...DO.look }] });
export const withDefaults = (table, type, cur = {}) => ({ type, ...table[type], ...Object.fromEntries(Object.entries(cur).filter(([k]) => k in table[type])) });

export function compare(a, op, b) {
  switch (op) { case '>': return a > b; case '==': return a == b; case '!=': return a != b; case '<': return a < b; case '<=': return a <= b; default: return a >= b; }
}

// Validation: [] when fine, else readable problems. Used by validate.mjs, commands (MCP) and the behavior's schema type.
export function checkRules(rules) {
  if (!Array.isArray(rules)) return ['rules must be a list'];
  const out = [];
  rules.forEach((r, i) => {
    const at = `rule ${i + 1}`;
    if (!r || typeof r !== 'object') { out.push(`${at}: not an object`); return; }
    if (!WHEN[r.when?.type]) out.push(`${at}: when.type must be one of ${Object.keys(WHEN).join(', ')}`);
    else for (const [k, d] of Object.entries(WHEN[r.when.type])) if (r.when[k] !== undefined && typeof r.when[k] !== typeof d) out.push(`${at}: when.${k} should be a ${typeof d}`);
    if (r.if !== undefined) {
      if (typeof r.if !== 'object') out.push(`${at}: if must be an object`);
      else {
        if (r.if.chance !== undefined && !(r.if.chance >= 0 && r.if.chance <= 1)) out.push(`${at}: if.chance is 0..1`);
        if (r.if.cooldown !== undefined && !(r.if.cooldown >= 0)) out.push(`${at}: if.cooldown is seconds ≥ 0`);
        if (r.if.var !== undefined && r.if.var !== '' && !OPS.includes(r.if.op ?? '>=')) out.push(`${at}: if.op must be one of ${OPS.join(' ')}`);
        if (r.when?.type === 'var' && !OPS.includes(r.when.op ?? '>=')) out.push(`${at}: when.op must be one of ${OPS.join(' ')}`);
      }
    }
    if (!Array.isArray(r.do) || !r.do.length) out.push(`${at}: needs at least one action in do`);
    else r.do.forEach((a, j) => {
      if (!DO[a?.type]) out.push(`${at} action ${j + 1}: type must be one of ${Object.keys(DO).join(', ')}`);
      else if (a.type === 'spawn' && a.offset !== undefined && !(Array.isArray(a.offset) && a.offset.length === 3)) out.push(`${at} action ${j + 1}: offset is [x, y, z]`);
    });
  });
  return out;
}

// One line per rule for lists, the MCP and the node-graph later: "near player 3 m → look player, say “Hey!”".
export function describeRule(r) {
  const w = r.when || {}, fields = o => Object.entries(o).filter(([k]) => k !== 'type').map(([, v]) => (Array.isArray(v) ? v.join(',') : typeof v === 'string' ? (v.includes(' ') ? `“${v}”` : v) : v)).join(' ');
  const cond = r.if ? [r.if.once && 'once', r.if.var && `${r.if.var} ${r.if.op || '>='} ${r.if.value}`, r.if.chance < 1 && `${Math.round(r.if.chance * 100)}%`].filter(Boolean).join(', ') : '';
  return `${w.type} ${fields(w)}${cond ? ` [${cond}]` : ''} → ${(r.do || []).map(a => `${a.type} ${fields(a)}`.trim()).join(', ')}`;
}

// Read-only node graph of an object's rules (SVG string, theme colours from CSS variables): When → If → Do, one lane per rule.
export function graphSvg(rules) {
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fields = o => Object.entries(o || {}).filter(([k]) => k !== 'type').map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(',') : v}`).join(' · ');
  const W = 150, H = 44, GX = 30, GY = 14, cols = [];
  let y = 8, out = '';
  const box = (x, y, kind, title, sub) => `<g><rect x="${x}" y="${y}" width="${W}" height="${H}" rx="8" class="n ${kind}"/><text x="${x + 8}" y="${y + 17}" class="t">${esc(title)}</text><text x="${x + 8}" y="${y + 33}" class="s">${esc(sub).slice(0, 34)}</text></g>`;
  const wire = (x1, y1, x2, y2) => `<path d="M${x1} ${y1} C${x1 + GX / 2} ${y1} ${x2 - GX / 2} ${y2} ${x2} ${y2}" class="w"/>`;
  for (const r of rules || []) {
    const c = r.if || {}, cond = [c.once && 'once', c.cooldown > 0 && `cooldown ${c.cooldown}s`, c.chance < 1 && `${Math.round(c.chance * 100)}%`, c.var && `${c.var} ${c.op || '>='} ${c.value}`].filter(Boolean).join(' · ');
    const acts = r.do || [], laneH = Math.max(1, acts.length) * (H + GY) - GY;
    const mid = y + laneH / 2 - H / 2;
    out += box(0, mid, 'when', `When ${r.when?.type}`, fields(r.when));
    let x = W + GX;
    if (cond) { out += wire(W, mid + H / 2, x, mid + H / 2) + box(x, mid, 'if', 'If', cond); x += W + GX; }
    acts.forEach((a, i) => { const ay = y + i * (H + GY); out += wire(x - GX, mid + H / 2, x, ay + H / 2) + box(x, ay, 'do', a.type, fields(a)); });
    cols.push(x + W); y += laneH + GY * 2;
  }
  const w = Math.max(W, ...cols) + 4, h = Math.max(y, 20);
  return `<svg class="rulegraph" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${out}</svg>`;
}
