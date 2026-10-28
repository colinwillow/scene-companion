// Stage 9 icon set: every icon name a page asks for exists, and each renders as one inline SVG.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ICONS, icon } from '../ui/icons.js';

test('every icon renders as a single inline svg', () => {
  for (const name of Object.keys(ICONS)) {
    const svg = icon(name);
    assert.match(svg, /^<svg class="ic" viewBox="0 0 24 24"[^>]*>.+<\/svg>$/s, name);
  }
  assert.equal(icon('nope'), '');
});

test('every data-icon / setIcon name used by a page is in the set', () => {
  const used = new Set();
  for (const f of ['index.html', 'play.html', 'vfx.html', 'spritebake.html']) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/data-icon="([a-z]+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/setIcon\(([^;]*)/g))                     // lowercase quoted names, minus $('element') ids
      for (const q of m[1].replace(/\$\('[^']*'\)/g, '').matchAll(/'([a-z]+)'/g)) used.add(q[1]);
  }
  const missing = [...used].filter(n => !ICONS[n]);
  assert.deepEqual(missing, [], 'icons used but not drawn: ' + missing.join(', '));
  assert.ok(used.size >= 15, `found ${used.size} icon uses`);
});
