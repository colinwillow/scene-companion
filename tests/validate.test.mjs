import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const validate = (...files) => spawnSync(process.execPath, ['tools/validate.mjs', ...files], { cwd: root, encoding: 'utf8' });
const tmpScene = obj => { const f = join(mkdtempSync(join(tmpdir(), 'sc-')), 'bad.scene.json'); writeFileSync(f, JSON.stringify(obj)); return f; };

test('kitchen-sink (and every scene) validates', () => {
  const r = validate();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /kitchen-sink/);
});

test('validator catches duplicate ids, unknown behaviors, bad params, missing prefabs and models', () => {
  const r = validate(tmpScene({
    assets: { m: { variants: { web: { glb: './assets/models/nope.glb' } } } },
    prefabs: { ghost: './prefabs/ghost.prefab.json' },
    entities: [
      { id: 'a', behaviors: [{ type: 'Nope' }] },
      { id: 'a' },
      { id: 'b', behaviors: [{ type: 'Spin', params: { speed: 99 } }] },
      { id: 'c', behaviors: [{ type: 'Spin', params: { sped: 1 } }] },
      { id: 'd', prefab: 'ghost' },
      { id: 'e', asset: 'm' },
      { id: 'f', asset: 'missing' },
      { id: 'g', asset: { variants: { web: { glb: './assets/models/robot.glb' } } }, animation: 'Moonwalk' },
    ],
  }));
  assert.equal(r.status, 1);
  for (const msg of ['unknown behavior "Nope"', 'duplicate id "a"', 'speed: 99', '"sped" is not in the schema',
                     'prefab "ghost" file not found', 'model file not found', 'unknown asset "missing"', 'animation "Moonwalk"'])
    assert.ok(r.stderr.includes(msg), `expected: ${msg}\n${r.stderr}`);
});

test('behaviors and the pure runtime files import nothing from three or the DOM', () => {
  const files = ['runtime/Behavior.js', 'runtime/registry.js', 'runtime/prefabs.js',
    ...readdirSync(join(root, 'behaviors')).filter(f => f.endsWith('.js')).map(f => `behaviors/${f}`)];
  for (const f of files) {
    const src = readFileSync(join(root, f), 'utf8');
    assert.ok(!/from\s+['"]three/.test(src), `${f} imports three`);
    assert.ok(!/\b(document|window|navigator)\./.test(src), `${f} touches the DOM`);
  }
});

test('every prefab file is valid JSON with an asset', () => {
  for (const f of readdirSync(join(root, 'prefabs'))) {
    const p = JSON.parse(readFileSync(join(root, 'prefabs', f), 'utf8'));
    assert.ok(p.asset, `${f} has an asset`);
  }
});
