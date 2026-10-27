import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { roleClip, characterVariant, checkCharacter, ROLES } from '../runtime/character.js';
import { Animator, Stompable, PlayerController } from '../behaviors/index.js';
import { fakeEntity, fakeWorld, attach } from './fakes.js';

test('roleClip: override > role > legacy name; "none" = no clip', () => {
  const roles = { idle: 'idle_01', jump: 'in_air' };
  assert.equal(roleClip('', 'idle', roles), 'idle_01');
  assert.equal(roleClip('front_flip', 'jump', roles), 'front_flip');
  assert.equal(roleClip('none', 'jump', roles), '');
  assert.equal(roleClip('', 'run', roles), '', 'a character without that role plays nothing');
  assert.equal(roleClip('', 'run', undefined), 'Running', 'old assets keep the old default names');
  assert.equal(roleClip('', 'death', undefined), '');
});

test('characterVariant: file supplies the model, the variant overrides', () => {
  const ch = { name: 'Zap', glb: './z.glb', height: 1.6, roles: { idle: 'i' } };
  assert.deepEqual(characterVariant(ch, { character: './z.character.json' }), { glb: './z.glb', height: 1.6 });
  assert.deepEqual(characterVariant(ch, { character: 'x', height: 2, castShadow: false }), { glb: './z.glb', height: 2, castShadow: false });
});

test('checkCharacter: missing glb, unknown roles, clips not in the model', () => {
  assert.deepEqual(checkCharacter({ glb: './z.glb', height: 1.6, roles: { idle: 'i', walk: 'w' } }, ['i', 'w']), []);
  const p = checkCharacter({ glb: './z.glb', roles: { idle: 'i', dance: 'd', run: 'r' } }, ['i', 'd']).map(x => x.level + ': ' + x.msg);
  assert.ok(p.some(m => m.startsWith('warn: no "height"')));
  assert.ok(p.some(m => m.startsWith('warn: unknown role "dance"')));
  assert.ok(p.some(m => m.startsWith('error: role "run": clip "r"')));
  assert.ok(checkCharacter({ glb: './z.glb', roles: {} }, null).some(x => /not found/.test(x.msg)));
});

test('the shipped characters (Zap, skeleton, mutant) only use known roles', () => {
  for (const n of ['zap', 'skeleton', 'mutant']) {
    const ch = JSON.parse(readFileSync(`assets/models/colin/characters/${n}.character.json`, 'utf8'));
    for (const r of Object.keys(ch.roles)) assert.ok(ROLES.includes(r), `${n}: ${r}`);
    assert.ok(ch.roles.idle && ch.roles.walk && ch.roles.run && ch.roles.death, n);
  }
});

test('Animator + Stompable play role clips; a param overrides one entity', () => {
  const e = fakeEntity(); const played = [];
  e.roles = { idle: 'idle_01', walk: 'walk_fwd', run: 'run_fwd' };
  e.anim = { play: n => played.push(n), clips: ['idle_01', 'walk_fwd', 'run_fwd', 'jog', 'die'] };
  const a = attach(Animator, e, { runSpeed: 4, walkClip: 'jog' }, fakeWorld());
  a.update(0.1); e.object3d.position.x += 0.2; a.update(0.1); e.object3d.position.z += 0.6; a.update(0.1);
  assert.deepEqual(played, ['idle_01', 'jog', 'run_fwd']);

  // Stompable with no defeatClip plays the character's death role
  const player = fakeEntity('player', [0, 0, 0]), w = fakeWorld([player]);
  w.input = { move: [0, 0], jump: false };
  const pc = attach(PlayerController, player, {}, w);
  const enemy = fakeEntity('skel', [0.5, 0, 0]); enemy.roles = { death: 'Shoulder_Hit_And_Fall' }; const shown = [];
  enemy.anim = { clips: ['Shoulder_Hit_And_Fall'], play: (n, o) => shown.push([n, o?.once]) };
  const st = attach(Stompable, enemy, { height: 1 }, w);
  player.object3d.position.y = 0.8; pc.vy = -3; st.update(0.016);
  assert.deepEqual(shown, [['Shoulder_Hit_And_Fall', true]]);
  assert.equal(enemy.object3d.visible, true, 'shows the death clip before hiding');
});

test('editor: character variants resolve to their GLB; Library adds bare characters; Motions labels roles', async () => {
  const { modelPath, replaceModel, addCharacter } = await import('../runtime/editing.js');
  const { clipRoles, characterEntries } = await import('../runtime/character.js');
  const path = './assets/models/colin/characters/zap.character.json';
  const chars = { [path]: { glb: './z.glb', roles: { idle: 'i', jump: 'air', fall: 'air' } } };
  const asset = { variants: { web: { character: path } } };
  assert.equal(modelPath(asset), null, 'unknown until the file is loaded');
  assert.equal(modelPath(asset, chars), './z.glb');
  const d = { entities: [{ id: 'player', asset: 'p' }], assets: { p: asset } };
  assert.ok(replaceModel(d, 'player', './edited.glb', asset, chars));
  assert.deepEqual(d.entities[0].asset, { variants: { web: { character: path, glb: './edited.glb' } } }, 'keeps the roles, swaps the model');
  const d2 = { entities: [], assets: { zap: { variants: { web: { glb: './other.glb' } } } } };
  const a = addCharacter(d2, 'zap', path, [1, 0, 2]), b = addCharacter(d2, 'zap', path, [3, 0, 2]);
  assert.deepEqual([a.id, b.id, a.asset, b.asset, a.behaviors[0].type], ['zap_01', 'zap_02', 'zap_2', 'zap_2', 'Animator']);
  const d3 = { entities: [{ id: 'player', asset: 'player' }], assets: { player: asset } };
  assert.deepEqual([addCharacter(d3, 'zap', path, [0, 0, 0]).id, d3.entities[1].asset], ['zap_01', 'player'], 'reuses the asset, still named zap');
  assert.deepEqual(clipRoles({ idle: 'i', jump: 'air', fall: 'air' }), { i: ['idle'], air: ['jump', 'fall'] });
  const idx = JSON.parse(readFileSync('assets/models/colin/characters/index.json', 'utf8'));
  const entries = characterEntries(idx);
  assert.deepEqual(entries.map(e => e.name), ['zap', 'skeleton', 'mutant']);
  for (const e of entries) assert.ok(readFileSync(e.path.slice(2)), e.path);
});
