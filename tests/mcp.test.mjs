// End to end without a browser: real dev server + real MCP server (child processes) + a fake editor tab
// that answers commands with runtime/commands.js, like index.html does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { WebSocket } from 'ws';
import { runCommand } from '../runtime/commands.js';
import { Spin } from '../behaviors/index.js';

const PORT = 18000 + Math.floor(Math.random() * 2000);
const wait = ms => new Promise(r => setTimeout(r, ms));

test('MCP server lists tools and drives an editor through the dev server', async t => {
  const dev = spawn(process.execPath, ['tools/dev-server.mjs'], { env: { ...process.env, PORT }, stdio: 'ignore' });
  t.after(() => dev.kill());
  await wait(400);

  // fake editor
  const data = { settings: {}, assets: { crate: { variants: { web: { glb: './assets/models/crate.glb' } } } }, prefabs: {}, entities: [{ id: 'crate_01', asset: 'crate', position: [0, 0, 0] }] };
  const ed = new WebSocket(`ws://localhost:${PORT}/live`);
  await new Promise(r => ed.on('open', r));
  t.after(() => ed.close());
  ed.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.type !== 'cmd') return;
    if (m.op === 'get_scene') return ed.send(JSON.stringify({ type: 'cmd-result', id: m.id, ok: true, result: { url: './scenes/fake.scene.json', data } }));
    try { const { result } = runCommand(data, m.op, m.args, { schemas: { Spin: Spin.schema } }); ed.send(JSON.stringify({ type: 'cmd-result', id: m.id, ok: true, result })); }
    catch (e) { ed.send(JSON.stringify({ type: 'cmd-result', id: m.id, ok: false, error: e.message })); }
  });

  const mcp = spawn(process.execPath, ['tools/mcp-server.mjs'], { env: { ...process.env, SC_DEV_URL: `ws://localhost:${PORT}/live`, SC_TIMEOUT_MS: '2000', SC_HEADLESS: 'off' } });
  t.after(() => mcp.kill());
  const lines = createInterface({ input: mcp.stdout });
  const waiting = new Map(); let n = 0;
  lines.on('line', l => { const m = JSON.parse(l); waiting.get(m.id)?.(m); });
  const rpc = (method, params) => new Promise(r => { const id = ++n; waiting.set(id, r); mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });

  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  assert.equal(init.result.serverInfo.name, 'scene-companion');
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const names = (await rpc('tools/list')).result.tools.map(x => x.name);
  for (const want of ['list_entities', 'get_selection', 'spawn', 'move', 'delete', 'attach_behavior', 'set_param', 'play', 'stop', 'screenshot', 'read_errors'])
    assert.ok(names.includes(want), want);

  const call = (name, args) => rpc('tools/call', { name, arguments: args }).then(r => r.result);
  let r = await call('attach_behavior', { id: 'crate_01', type: 'Spin', params: { speed: 2 } });
  assert.ok(!r.isError, r.content[0].text);
  r = await call('move', { id: 'crate_01', position: [1, 2, 3] });
  assert.deepEqual(data.entities[0].position, [1, 2, 3]);
  r = await call('set_param', { id: 'crate_01', type: 'Spin', key: 'speed', value: 50 });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /between/);
  r = await call('list_entities', {});
  assert.deepEqual(JSON.parse(r.content[0].text)[0].behaviors, ['Spin']);

  r = await call('new_scene', { name: 'Bad Name' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /lowercase-with-dashes/);
  r = await call('new_scene', { name: 'tiny-hop' });
  assert.match(r.content[0].text, /already exists/);
  r = await call('batch', { calls: [{ tool: 'move', args: { id: 'crate_01', position: [4, 0, 0] } }, { tool: 'set_animation', args: { id: 'crate_01', clip: 'Idle' } }] });
  assert.ok(!r.isError, r.content[0].text);
  assert.equal(data.entities[0].animation, 'Idle');

  r = await call('blender_status', {});
  assert.match(r.content[0].text, /isn't connected/);
  r = await call('send_to_blender', { id: 'crate_01' });
  assert.ok(!r.isError, r.content[0].text);
  assert.match(r.content[0].text, /queued/);
  assert.deepEqual(await (await fetch(`http://localhost:${PORT}/bridge/inbox`)).json(), [{ id: 'crate_01', glb: './assets/models/crate.glb', scene: './scenes/fake.scene.json' }]);
  r = await call('blender_status', {});
  assert.match(r.content[0].text, /is connected/);

  ed.close(); await wait(100);
  r = await call('list_entities', {});
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /No editor answered/);
});
