// Blender bridge: the pure model swap + the dev server's /bridge routes (the Blender add-on's side is plain HTTP).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { modelPath, replaceModel } from '../runtime/editing.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wait = ms => new Promise(r => setTimeout(r, ms));

test('modelPath / replaceModel swap one entity to the edited GLB, keeping size settings', () => {
  const asset = { variants: { web: { glb: './a.glb', height: 1.75, frontSide: true }, desktop: { glb: './a_hd.glb' } } };
  assert.equal(modelPath(asset), './a.glb');
  assert.equal(modelPath({ glb: './flat.glb' }), './flat.glb');
  assert.equal(modelPath({ variants: { web: { primitive: 'box' } } }), null);
  const data = { assets: { a: asset }, entities: [{ id: 'hero', asset: 'a', position: [1, 0, 0], behaviors: [{ type: 'Spin' }] }, { id: 'twin', asset: 'a' }] };
  assert.ok(replaceModel(data, 'hero', './assets/models/bridge/hero-1.glb', asset));
  assert.deepEqual(data.entities[0].asset, { variants: { web: { glb: './assets/models/bridge/hero-1.glb', height: 1.75, frontSide: true } } });
  assert.deepEqual(data.entities[0].position, [1, 0, 0]);
  assert.equal(data.entities[1].asset, 'a', 'other users of the asset untouched');
  assert.equal(asset.variants.web.glb, './a.glb', 'scene asset untouched');
  assert.equal(replaceModel(data, 'nobody', './x.glb', asset), false);
});

test('dev server bridge: send → inbox → return writes the GLB and tells the pages', async t => {
  const PORT = 18700 + Math.floor(Math.random() * 200), cwd = mkdtempSync(join(tmpdir(), 'sc-bridge-'));
  const dev = spawn(process.execPath, [join(root, 'tools/dev-server.mjs')], { cwd, env: { ...process.env, PORT }, stdio: 'ignore' });
  t.after(() => dev.kill());
  await wait(400);
  const url = p => `http://localhost:${PORT}/bridge/${p}`;
  const ed = new WebSocket(`ws://localhost:${PORT}/live`); await new Promise(r => ed.on('open', r)); t.after(() => ed.close());
  const heard = new Promise(r => ed.on('message', m => { const x = JSON.parse(m.toString()); if (x.type === 'bridge-return') r(x); }));

  assert.equal((await fetch(url('send'), { method: 'POST', body: '{"id":"Bad Id","glb":"./a.glb"}' })).status, 400);
  assert.equal((await fetch(url('send'), { method: 'POST', body: '{"id":"hero","glb":"../secret.glb"}' })).status, 400);
  const sent = await (await fetch(url('send'), { method: 'POST', body: JSON.stringify({ id: 'hero', glb: './a.glb', scene: './scenes/s.scene.json' }) })).json();
  assert.deepEqual(sent, { queued: true, blender: false });
  assert.deepEqual(await (await fetch(url('inbox'))).json(), [{ id: 'hero', glb: './a.glb', scene: './scenes/s.scene.json' }]);
  assert.deepEqual(await (await fetch(url('inbox'))).json(), [], 'inbox empties');
  assert.equal((await (await fetch(url('status'))).json()).blender, 0);

  assert.equal((await fetch(url('return?id=hero'), { method: 'POST', body: 'not a glb' })).status, 400);
  const glb = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(16)]);
  const r1 = await (await fetch(url('return?id=hero'), { method: 'POST', body: glb })).json();
  assert.equal(r1.saved, 'assets/models/bridge/hero-1.glb');
  assert.deepEqual(await heard, { type: 'bridge-return', id: 'hero', glb: './assets/models/bridge/hero-1.glb', scene: './scenes/s.scene.json' });
  const r2 = await (await fetch(url('return?id=hero'), { method: 'POST', body: glb })).json();
  assert.equal(r2.saved, 'assets/models/bridge/hero-2.glb', 'a new file per return, so undo keeps the old model');
  assert.ok(existsSync(join(cwd, 'assets/models/bridge/hero-1.glb')) && existsSync(join(cwd, 'assets/models/bridge/hero-2.glb')));
});

test('dev server bridge: a prefab send updates prefabs/<name>.prefab.json for every instance', async t => {
  const PORT = 18900 + Math.floor(Math.random() * 90), cwd = mkdtempSync(join(tmpdir(), 'sc-bridge-pf-'));
  mkdirSync(join(cwd, 'prefabs'));
  writeFileSync(join(cwd, 'prefabs/rock.prefab.json'), JSON.stringify({ asset: { variants: { web: { glb: './rock.glb', height: 0.5 }, desktop: { glb: './rock_hd.glb' } } }, behaviors: [{ type: 'Solid' }] }));
  const dev = spawn(process.execPath, [join(root, 'tools/dev-server.mjs')], { cwd, env: { ...process.env, PORT }, stdio: 'ignore' });
  t.after(() => dev.kill());
  await wait(400);
  const url = p => `http://localhost:${PORT}/bridge/${p}`;
  assert.equal((await fetch(url('send'), { method: 'POST', body: '{"id":"rock_01","glb":"./rock.glb","prefab":"nope"}' })).status, 400);
  assert.equal((await fetch(url('send'), { method: 'POST', body: '{"id":"rock_01","glb":"./rock.glb","prefab":"rock"}' })).status, 200);
  assert.equal((await (await fetch(url('inbox'))).json())[0].prefab, 'rock');
  const ed = new WebSocket(`ws://localhost:${PORT}/live`); await new Promise(r => ed.on('open', r)); t.after(() => ed.close());
  const heard = new Promise(r => ed.on('message', m => { const x = JSON.parse(m.toString()); if (x.type === 'bridge-return') r(x); }));
  const r = await (await fetch(url('return?id=rock_01'), { method: 'POST', body: Buffer.concat([Buffer.from('glTF'), Buffer.alloc(16)]) })).json();
  assert.equal(r.saved, 'assets/models/bridge/rock-1.glb');
  assert.equal((await heard).prefab, 'rock');
  const pf = JSON.parse(readFileSync(join(cwd, 'prefabs/rock.prefab.json'), 'utf8'));
  assert.deepEqual(pf.asset, { variants: { web: { glb: './assets/models/bridge/rock-1.glb', height: 0.5 } } });
  assert.deepEqual(pf.behaviors, [{ type: 'Solid' }]);
});
