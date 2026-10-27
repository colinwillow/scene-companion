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
