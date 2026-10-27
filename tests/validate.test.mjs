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
    settings: { route: ['a', 'nowhere'] },
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
      { id: 'h', asset: { variants: { web: { glb: './assets/models/robot.glb' } } }, behaviors: [{ type: 'Animator', params: { landClip: 'Splat', fallClip: '' } }] },
    ],
  }));
  assert.equal(r.status, 1);
  for (const msg of ['unknown behavior "Nope"', 'duplicate id "a"', 'speed: 99', '"sped" is not in the schema',
                     'prefab "ghost" file not found', 'model file not found', 'unknown asset "missing"', 'animation "Moonwalk"', 'Animator.landClip "Splat"', 'settings.route: no entity "nowhere"'])
    assert.ok(r.stderr.includes(msg), `expected: ${msg}\n${r.stderr}`);
});

test('validator checks settings.routeKnownIssue', () => {
  const bad = validate(tmpScene({ settings: { route: ['a'], routeKnownIssue: 3 }, entities: [{ id: 'a' }] }));
  assert.equal(bad.status, 1);
  assert.ok(bad.stderr.includes('settings.routeKnownIssue must be a short reason'), bad.stderr);
  const lone = validate(tmpScene({ settings: { routeKnownIssue: 'guard too mean' }, entities: [{ id: 'a' }] }));
  assert.equal(lone.status, 0, lone.stderr);
  assert.ok(lone.stderr.includes('routeKnownIssue without a settings.route'), lone.stderr);
});

test('validator checks prefab files and removeBehaviors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sc-pf-'));
  writeFileSync(join(dir, 'bad.prefab.json'), JSON.stringify({ id: 'x', position: [0, 0, 0], behaviors: [{ type: 'Spin', params: { speed: 99 } }] }));
  writeFileSync(join(dir, 'unused.prefab.json'), JSON.stringify({ asset: { variants: { web: { primitive: 'box' } } } }));
  const r = validate(tmpScene({
    prefabs: { bad: join(dir, 'bad.prefab.json'), unused: join(dir, 'unused.prefab.json') },
    entities: [
      { id: 'a', prefab: 'bad', removeBehaviors: ['Bob'] },
      { id: 'b', removeBehaviors: ['Spin'] },
      { id: 'Bad-Id' },
    ],
  }));
  assert.equal(r.status, 1);
  for (const msg of ['"id" belongs on instances', '"position" belongs on instances', 'prefab "bad": no asset', 'prefab bad.Spin.speed',
                     'removeBehaviors "Bob"', 'b: removeBehaviors only works on prefab instances', 'prefab "unused" is listed but never used', 'lowercase_with_underscores'])
    assert.ok(r.stderr.includes(msg), `expected: ${msg}\n${r.stderr}`);
});

test('behaviors and the pure runtime files import nothing from three or the DOM', () => {
  const files = ['runtime/Behavior.js', 'runtime/registry.js', 'runtime/prefabs.js', 'runtime/editing.js', 'runtime/history.js', 'runtime/livepatch.js',
    ...readdirSync(join(root, 'behaviors')).filter(f => f.endsWith('.js')).map(f => `behaviors/${f}`)];
  for (const f of files) {
    const src = readFileSync(join(root, f), 'utf8');
    assert.ok(!/from\s+['"]three/.test(src), `${f} imports three`);
    assert.ok(!/\b(document|window|navigator)\./.test(src), `${f} touches the DOM`);
  }
});

test('every prefab file is valid JSON with an asset, and prefabs/index.json lists them all', () => {
  const files = readdirSync(join(root, 'prefabs')).filter(f => f.endsWith('.prefab.json'));
  for (const f of files) {
    const p = JSON.parse(readFileSync(join(root, 'prefabs', f), 'utf8'));
    assert.ok(p.asset, `${f} has an asset`);
  }
  const index = JSON.parse(readFileSync(join(root, 'prefabs', 'index.json'), 'utf8'));
  assert.deepEqual(index, files.map(f => f.replace('.prefab.json', '')).sort(), 'run npm run validate to refresh prefabs/index.json');
});
