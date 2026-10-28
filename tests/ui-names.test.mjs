import test from 'node:test';
import assert from 'node:assert/strict';
import { friendly, behaviorStyle, unitOf, fmtNum } from '../runtime/ui-names.js';
import { ICONS } from '../ui/icons.js';

test('friendly names', () => {
  assert.equal(friendly('PlayerController'), 'Player controller');
  assert.equal(friendly('HudBar'), 'Hud bar');
  assert.equal(friendly('FootIK'), 'Foot IK');
  assert.equal(friendly('jumpSpeed'), 'Jump speed');
  assert.equal(friendly('max_hp'), 'Max hp');
  assert.equal(friendly('airJumps'), 'Air jumps');
});

test('every behavior gets a style whose icon exists', async () => {
  const src = (await import('node:fs')).readFileSync('behaviors/index.js', 'utf8');
  const types = [...src.matchAll(/^export class ([A-Za-z]+)/gm)].map(m => m[1]);
  assert.ok(types.length > 20);
  for (const t of types) assert.ok(ICONS[behaviorStyle(t).icon], t);
  assert.equal(behaviorStyle('PlayerController').kind, 'player');
  assert.equal(behaviorStyle('Patrol').kind, 'move');
  assert.equal(behaviorStyle('Pickup').kind, 'game');
});

test('units from names', () => {
  assert.equal(unitOf('jumpSpeed'), 'm/s');
  assert.equal(unitOf('gravity'), 'm/s²');
  assert.equal(unitOf('cooldown'), 's');
  assert.equal(unitOf('radius'), 'm');
  assert.equal(unitOf('airJumps'), '');
  assert.equal(unitOf('anything', { units: 'hp' }), 'hp');
  assert.equal(fmtNum(12.30000001, 0.1), '12.3');
  assert.equal(fmtNum(3, 1), '3');
});
