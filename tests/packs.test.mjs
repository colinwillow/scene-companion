import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { checkPack, packItems, itemName } from '../runtime/packs.js';

const has = { file: p => p !== './missing.png', prefab: n => n !== 'ghost', behavior: n => n !== 'Fly' };
const good = { id: 'p', name: 'P', version: '1.0.0', tier: 'free', prefabs: ['tree'], characters: ['./a/zap.character.json'] };

test('checkPack: a good pack has no problems; each rule reports', () => {
  assert.deepEqual(checkPack(good, 'p', has), []);
  const msgs = checkPack({ id: 'q', version: '1', tier: 'paid', prefabs: ['ghost'], behaviors: ['Fly'], scenes: 'x',
    thumbnails: { tree: './missing.png' } }, 'p', has).map(x => x.msg).join(' | ');
  for (const m of ['match its folder', 'needs a "name"', '"version"', '"tier"', 'prefab not found: ghost', 'behavior not registered: Fly',
    '"scenes" must be a list', 'thumbnail for "tree"', 'thumbnail not found']) assert.ok(msgs.includes(m), m);
  assert.ok(checkPack({ ...good, prefabs: [], characters: [] }, 'p', has).some(x => x.level === 'warn' && /empty/.test(x.msg)));
});

test('packItems: characters then prefabs, tagged with the pack', () => {
  assert.equal(itemName('./x/y/mutant.character.json'), 'mutant');
  assert.deepEqual(packItems(good), [
    { kind: 'character', name: 'zap', path: './a/zap.character.json', pack: 'p' },
    { kind: 'prefab', name: 'tree', pack: 'p' },
  ]);
  assert.deepEqual(packItems(null), []);
});

test('colin-starter is installed and its files exist', () => {
  assert.ok(JSON.parse(readFileSync('packs/index.json', 'utf8')).includes('colin-starter'));
  const pk = JSON.parse(readFileSync('packs/colin-starter/pack.json', 'utf8'));
  const problems = checkPack(pk, 'colin-starter', { file: p => existsSync(p.replace(/^\.\//, '')), prefab: n => existsSync(`prefabs/${n}.prefab.json`), behavior: () => true });
  assert.deepEqual(problems, []);
  assert.ok(pk.characters.length >= 3 && pk.prefabs.includes('kit_ramp'));
});

import { installedIds, setInstalled, isLocked, parseUnlocks, libraryPacks, checkScenePacks } from '../runtime/packs.js';
import { runCommand } from '../runtime/commands.js';
const cat = [good, { id: 'q', name: 'Q', version: '1.0.0', tier: 'unlock', prefabs: ['rock'] }, { id: 'r', name: 'R', version: '1.0.0', tier: 'free', prefabs: ['bush'] }];

test('installedIds: no "packs" field = every free pack; a list is used as is', () => {
  assert.deepEqual(installedIds({}, cat), ['p', 'r']);
  assert.deepEqual(installedIds({ packs: ['q'] }, cat), ['q']);
  assert.deepEqual(installedIds({ packs: [] }, cat), []);
});

test('setInstalled: install/uninstall writes scene.packs in catalog order; unknown id throws', () => {
  const s = {};
  assert.deepEqual(setInstalled(s, cat, 'p', false), ['r']);
  assert.deepEqual(setInstalled(s, cat, 'q', true), ['q', 'r']);
  assert.deepEqual(setInstalled(s, cat, 'p', true), ['p', 'q', 'r']);
  assert.deepEqual(setInstalled(s, cat, 'p', true), ['p', 'q', 'r']);
  assert.deepEqual(s.packs, ['p', 'q', 'r']);
  assert.throws(() => setInstalled(s, cat, 'nope', true), /no pack "nope"/);
});

test('locks: unlock-tier packs are locked until their id is unlocked; items carry the flag', () => {
  assert.equal(isLocked(cat[1]), true); assert.equal(isLocked(cat[1], ['q']), false); assert.equal(isLocked(good), false);
  assert.deepEqual(parseUnlocks(' q, bad id!, r '), ['q', 'r']); assert.deepEqual(parseUnlocks(null), []);
  const rows = libraryPacks(cat, { packs: ['q'] });
  assert.deepEqual(rows.map(r => [r.pack.id, r.installed, r.locked]), [['q', true, true], ['p', false, false], ['r', false, false]]);
  assert.equal(rows[0].items[0].locked, true);
  assert.equal(libraryPacks(cat, { packs: ['q'] }, ['q'])[0].items[0].locked, false);
});

test('checkScenePacks + MCP install_pack / uninstall_pack / list_packs', () => {
  assert.deepEqual(checkScenePacks({}, ['p']), []);
  assert.deepEqual(checkScenePacks({ packs: 'p' }, ['p']), ['"packs" must be a list of pack ids']);
  assert.match(checkScenePacks({ packs: ['p', 'x'] }, ['p'])[0], /no pack "x"/);
  const data = { entities: [] }, ctx = { packs: cat };
  assert.deepEqual(runCommand(data, 'uninstall_pack', { id: 'r' }, ctx).result.packs, ['p']);
  assert.deepEqual(runCommand(data, 'install_pack', { id: 'q' }, ctx).result.packs, ['p', 'q']);
  assert.throws(() => runCommand(data, 'install_pack', { id: 'zz' }, ctx), /no pack/);
  assert.deepEqual(data.packs, ['p', 'q']);
  const list = runCommand(data, 'list_packs', {}, ctx).result;
  assert.deepEqual(list.map(p => [p.id, p.installed, p.locked]), [['p', true, false], ['q', true, true], ['r', false, false]]);
  assert.deepEqual(list[0].items, ['character:zap', 'prefab:tree']);
});
