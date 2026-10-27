import test from 'node:test';
import assert from 'node:assert/strict';
import { Reactions } from '../behaviors/index.js';
import { checkRules, describeRule, newRule, withDefaults, WHEN } from '../runtime/reactions.js';
import { runCommand } from '../runtime/commands.js';
import { fakeEntity, fakeWorld, attach, run } from './fakes.js';

test('checkRules catches bad rules; describeRule reads like a sentence', () => {
  assert.deepEqual(checkRules([newRule()]), []);
  assert.match(checkRules([{ when: { type: 'nope' }, do: [{ type: 'say' }] }])[0], /when.type/);
  assert.match(checkRules([{ when: { type: 'near' }, do: [] }])[0], /at least one action/);
  assert.match(checkRules([{ when: { type: 'near', radius: 'far' }, do: [{ type: 'say' }] }])[0], /radius should be a number/);
  assert.equal(describeRule({ when: { type: 'near', target: 'player', radius: 3 }, if: { once: true }, do: [{ type: 'say', text: 'Hey there' }] }),
    'near player 3 [once] → say “Hey there”');
  assert.deepEqual(withDefaults(WHEN, 'timer'), { type: 'timer', every: 2 });
});

test('near fires on arrival (not every frame), cooldown, leave, look + say + play', () => {
  const npc = fakeEntity('npc', [0, 0, 0]), player = fakeEntity('player', [10, 0, 0]);
  const played = []; npc.anim = { clips: ['Wave', 'Idle'], play: (n, o) => played.push(`${n}/${o.layer}`) };
  const w = fakeWorld([npc, player]);
  const said = []; w.on('say', (id, t) => said.push(t));
  const r = attach(Reactions, npc, { rules: [
    { when: { type: 'near', target: 'player', radius: 3 }, if: { cooldown: 2 }, do: [{ type: 'look', target: 'player' }, { type: 'say', text: 'Hey!' }, { type: 'play', clip: 'Wave', layer: 'base' }] },
    { when: { type: 'leave', target: 'player', radius: 3 }, do: [{ type: 'play', clip: 'Idle', layer: 'base' }] }] }, w);
  run(r, 5); assert.deepEqual(said, []);
  player.object3d.position.x = 2; run(r, 30);
  assert.deepEqual(said, ['Hey!'], 'once on arrival, not every frame');
  assert.ok(Math.abs(npc.object3d.rotation.y - Math.PI / 2) < 1e-9, 'turned to face +x');
  player.object3d.position.x = 10; run(r, 2);
  player.object3d.position.x = 2; run(r, 2);
  assert.deepEqual(said, ['Hey!'], 'cooldown holds a quick return');
  assert.deepEqual(played, ['Wave/base', 'Idle/base']);
  player.object3d.position.x = 10; run(r, 2); run(r, 130); player.object3d.position.x = 2; run(r, 2);
  assert.deepEqual(said, ['Hey!', 'Hey!'], 'after the cooldown it greets again');
});

test('event (from a specific id), once, variables + condition, timer, hide', () => {
  const box = fakeEntity('box'), lamp = fakeEntity('lamp');
  const w = fakeWorld([box, lamp]); w.vars = { coins: 0 };
  const r = attach(Reactions, box, { rules: [
    { when: { type: 'event', name: 'pickup', from: 'coin_03' }, if: { once: true }, do: [{ type: 'add', var: 'coins', value: 1 }] },
    { when: { type: 'timer', every: 0.5 }, if: { var: 'coins', op: '>=', value: 1, once: true }, do: [{ type: 'hide', target: 'lamp' }] }] }, w);
  r.update(1 / 60);
  w.emit('pickup', 'coin_01'); r.update(1 / 60);
  assert.equal(w.vars.coins, 0, 'a different coin');
  w.emit('pickup', 'coin_03'); r.update(1 / 60);
  w.emit('pickup', 'coin_03'); r.update(1 / 60);
  assert.equal(w.vars.coins, 1, 'once');
  run(r, 40);
  assert.equal(lamp.object3d.visible, false, 'timer + variable condition fired');
});

test('MCP add_reaction adds a Reactions behavior and validates the rule', () => {
  const data = { entities: [{ id: 'npc', position: [0, 0, 0] }] };
  const res = runCommand(data, 'add_reaction', { id: 'npc', rule: { when: { type: 'start' }, do: [{ type: 'say', text: 'Hi' }] } }, { prefabs: {} });
  assert.deepEqual(res.result.rules, ['start  → say Hi']);
  assert.equal(data.entities[0].behaviors[0].type, 'Reactions');
  assert.throws(() => runCommand(data, 'add_reaction', { id: 'npc', rule: { when: { type: 'start' }, do: [{ type: 'fly' }] } }, { prefabs: {} }), /type must be one of/);
  runCommand(data, 'add_reaction', { id: 'npc', rule: { when: { type: 'timer', every: 1 }, do: [{ type: 'emit', name: 'tick' }] } }, { prefabs: {} });
  assert.equal(data.entities[0].behaviors[0].params.rules.length, 2);
});

test('v1: frame, struck and var triggers; hud / shake / end / load actions; graph view', async () => {
  const { graphSvg } = await import('../runtime/reactions.js');
  const me = fakeEntity('me'), w = fakeWorld([me]); w.vars = { coins: 0 };
  const out = []; for (const n of ['hud', 'shake', 'end', 'loadScene']) w.on(n, (...a) => out.push([n, ...a]));
  const r = attach(Reactions, me, { rules: [
    { when: { type: 'frame', name: 'hit' }, do: [{ type: 'shake', amount: 0.2, seconds: 0.1 }] },
    { when: { type: 'struck' }, do: [{ type: 'hud', text: 'Ow', seconds: 1 }] },
    { when: { type: 'var', var: 'coins', op: '>=', value: 3 }, do: [{ type: 'end', text: 'You win!' }, { type: 'load', scene: './scenes/x.scene.json' }] }] }, w);
  r.update(1 / 60);
  w.emit('hit', 'someone_else', { clip: 'punch' }); w.emit('hit', 'me', { clip: 'punch' }); r.update(1 / 60);
  w.emit('struck', 'hero', 'me', 1); r.update(1 / 60);
  w.vars.coins = 2; r.update(1 / 60); w.vars.coins = 3; r.update(1 / 60); r.update(1 / 60);
  assert.deepEqual(out, [['shake', 0.2, 0.1], ['hud', 'Ow', 1], ['end', 'You win!'], ['loadScene', './scenes/x.scene.json']]);
  const svg = graphSvg([{ when: { type: 'near', target: 'player', radius: 3 }, if: { once: true }, do: [{ type: 'say', text: 'Hi <you>' }, { type: 'look', target: 'player' }] }]);
  assert.match(svg, /^<svg/); assert.match(svg, /When near/); assert.match(svg, />If</); assert.match(svg, /Hi &lt;you&gt;/);
  assert.equal((svg.match(/class="n do"/g) || []).length, 2);
});
