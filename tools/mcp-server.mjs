#!/usr/bin/env node
// Scene Companion MCP server: lets Claude see and edit the scene that's open in the editor.
//
//   Claude ⇄ (stdio, MCP) ⇄ this ⇄ (WebSocket /live) ⇄ dev server ⇄ editor tab (desktop or phone)
//
// Run `npm run dev`, open the editor, and add this server to Claude (the repo's .mcp.json does it for
// Claude Code). Hand-written JSON-RPC over stdio, no SDK: the protocol surface we need is tiny.
// No editor open? It opens a headless one (SC_HEADLESS=auto|off|always, needs playwright); no dev server? It starts one.
// Env: SC_DEV_URL (default ws://localhost:8080/live), SC_TIMEOUT_MS (default 30000; adding objects rebuilds the scene, slow on old phones).
import { WebSocket } from 'ws';
import { writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, relative, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { TOOLS } from './mcp-tools.mjs';
import { sceneForSave, sceneFromTemplate } from '../runtime/commands.js';
import { modelPath } from '../runtime/editing.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEV_URL = process.env.SC_DEV_URL || `ws://localhost:${process.env.PORT || 8080}/live`;
const TIMEOUT = +(process.env.SC_TIMEOUT_MS || 30000);
const log = (...a) => process.stderr.write(a.join(' ') + '\n');   // stdout is the protocol — never log there

// ---- link to the dev server (reconnects lazily; starts one if nothing is listening)
let ws = null, opening = null, seq = 0, devChild = null;
const pending = new Map();
const tryOpen = () => new Promise((res, rej) => {
  const s = new WebSocket(DEV_URL);
  s.once('open', () => res(s));
  s.once('error', rej);
});
async function link() {
  if (ws?.readyState === WebSocket.OPEN) return ws;
  if (opening) return opening;
  opening = (async () => {
    let s;
    try { s = await tryOpen(); }
    catch (e) {
      const url = new URL(DEV_URL);
      if (process.env.SC_AUTOSTART === '0' || !['localhost', '127.0.0.1'].includes(url.hostname) || devChild)
        throw new Error(`Can't reach the dev server at ${DEV_URL} (${e.message}). Start it with \`npm run dev\`.`);
      log('no dev server — starting one on port', url.port || 80);
      devChild = spawn(process.execPath, [join(ROOT, 'tools/dev-server.mjs')], { cwd: ROOT, env: { ...process.env, PORT: url.port || '80' }, stdio: ['ignore', 'ignore', 'inherit'] });
      for (let i = 0; i < 50 && !s; i++) { await sleep(100); s = await tryOpen().catch(() => null); }
      if (!s) throw new Error(`Started a dev server but couldn't connect to ${DEV_URL}`);
    }
    s.on('close', () => { if (ws === s) ws = null; });
    s.on('message', raw => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (process.env.SC_DEBUG) log('ws <-', m.type, m.id || '', m.ok ?? '');
      if (m.type !== 'cmd-result' || !pending.has(m.id)) return;
      const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer);
      m.ok ? p.res(m) : p.rej(new Error(m.error));
    });
    ws = s; return s;
  })().finally(() => { opening = null; });
  return opening;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function send(op, args, scene, timeoutMs, timeoutMsg) {
  return link().then(s => new Promise((res, rej) => {
    const id = `c${++seq}_${Date.now()}`;
    const timer = setTimeout(() => { pending.delete(id); rej(new Error(timeoutMsg)); }, timeoutMs);
    pending.set(id, { res, rej, timer });
    s.send(JSON.stringify({ type: 'cmd', id, op, args, ...(scene ? { scene } : {}) }));
  }));
}

// ---- headless editor: when no editor tab answers, open one in a headless browser so Claude can work alone.
// SC_HEADLESS = auto (default) | off | always. Needs the `playwright` package (npm i -D playwright).
const HEADLESS = process.env.SC_HEADLESS || 'auto';
let browser = null, headlessScene = null, lastPong = 0;
async function startHeadless(scene) {
  await link();                                 // starts the dev server if none is running (SC_HEADLESS=always skips the ping that would)
  let pw;
  try { pw = await import('playwright'); } catch { try { pw = createRequire(import.meta.url)('playwright'); } catch {} }   // require() also honours NODE_PATH
  if (!pw) {
    throw new Error('No editor is open, and the headless fallback needs Playwright (`npm i -D playwright && npx playwright install chromium`). Or open the editor from `npm run dev`.');
  }
  const chromium = pw.chromium || pw.default?.chromium;
  browser ||= await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  if (process.env.SC_DEBUG) { page.on('console', m => log('[headless console]', m.type(), m.text().slice(0, 200))); page.on('requestfailed', r => log('[headless failed]', r.url())); }
  page.on('pageerror', e => log('[headless editor]', e.message));
  const localThree = join(ROOT, 'node_modules/three');
  if (existsSync(localThree))   // serve three from node_modules: faster, and works offline / behind a strict proxy
    await page.route(/cdn\.jsdelivr\.net\/npm\/three@[^/]+\//, r => r.fulfill({ path: join(localThree, new URL(r.request().url()).pathname.replace(/^\/npm\/three@[^/]+\//, '')) }));
  const http = DEV_URL.replace(/^ws/, 'http').replace(/\/live$/, '');
  headlessScene = scene || process.env.SC_SCENE || './scenes/kitchen-sink.scene.json';
  await page.goto(`${http}/index.html?scene=${encodeURIComponent(headlessScene)}`);
  log('headless editor open on', headlessScene);
  for (let i = 0; i < 12; i++)                  // wait until its live link answers (software GL is slow: be patient)
    if (await send('ping', {}, scene, 10000, 'no pong').then(() => true, () => false)) return;
  throw new Error('The headless editor did not come up (see the MCP server log).');
}

async function ensureEditor(scene) {
  if (HEADLESS === 'off') return;
  if (HEADLESS === 'always' && !browser) return startHeadless(scene);
  if (browser && (!scene || scene === headlessScene)) return;                 // our own headless editor is up
  if (Date.now() - lastPong < 20000 && !scene) return;
  const alive = await send('ping', {}, scene, 3000, 'no pong').then(() => true, () => false);
  if (alive) { lastPong = Date.now(); return; }
  await startHeadless(scene);
  lastPong = Date.now();
}

// Send one command to the editor; the first editor that answers wins.
export async function command(op, args = {}, scene) {
  await ensureEditor(scene);
  const r = await send(op, args, scene, TIMEOUT * (browser ? 4 : 1) + (args.seconds || 0) * 1000,
    'No editor answered. Open the editor page from `npm run dev` (index.html, on a computer or phone) and keep it in the foreground.');
  lastPong = Date.now();
  return r;
}

// ---- tool calls
async function callTool(name, args = {}) {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) throw new Error(`Unknown tool ${name}`);
  const { scene, ...rest } = args;
  if (name === 'new_scene') {           // file-only: no editor needed
    const { name: n, from = './scenes/tiny-hop.scene.json', keep = [] } = rest;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(n || '')) throw new Error('name must be lowercase-with-dashes, e.g. sky-steps');
    const rel = `scenes/${n}.scene.json`, file = join(ROOT, rel);
    if (existsSync(file)) throw new Error(`${rel} already exists — pick another name, or edit it with scene: "./${rel}"`);
    const fromFile = resolve(ROOT, from.replace(/^\.\//, ''));
    if (relative(ROOT, fromFile).startsWith('..') || !existsSync(fromFile)) throw new Error(`No template scene ${from}`);
    const data = sceneFromTemplate(JSON.parse(await readFile(fromFile, 'utf8')), keep);
    await writeFile(file, JSON.stringify(data, null, 2) + '\n');
    return [{ type: 'text', text: `Created ${rel} with ${data.entities.length} entities (${data.entities.map(e => e.id).join(', ')}). Use scene: "./${rel}" on the other tools. Play it at play.html?scene=./${rel}` }];
  }
  if (name === 'save_scene') {
    const { result } = await command('get_scene', {}, scene);
    const file = resolve(ROOT, result.url.replace(/^\.\//, ''));
    const rel = relative(ROOT, file);
    if (rel.startsWith('..') || !/^scenes\/[\w.-]+\.scene\.json$/.test(rel.split('\\').join('/'))) throw new Error(`Refusing to write outside scenes/: ${rel}`);
    const { data, dropped } = sceneForSave(result.data);
    await writeFile(file, JSON.stringify(data, null, 2) + '\n');
    const note = dropped.length ? ` Dropped unused prefabs: ${dropped.join(', ')}.` : '';
    return [{ type: 'text', text: `Saved ${rel} (${data.entities.length} entities).${note} Run \`npm run check\`, then commit.` }];
  }
  if (name === 'blender_status' || name === 'send_to_blender') {   // Blender bridge: plain HTTP on the dev server
    const http = DEV_URL.replace(/^ws/, 'http').replace(/\/live$/, '');
    if (name === 'blender_status') {
      await link();
      const st = await (await fetch(`${http}/bridge/status`)).json();
      const on = st.blender !== null && st.blender < 5;
      return [{ type: 'text', text: on ? `Blender is connected (polled ${st.blender} s ago).` : `Blender isn't connected${st.blender === null ? '' : ` (last seen ${st.blender} s ago)`}. In Blender: sidebar › Scene Companion › Start (add-on: tools/blender/scene_companion_bridge.py).` }];
    }
    const { result: ent } = await command('get_entity', { id: rest.id }, scene);
    const { result: sc } = await command('get_scene', {}, scene);
    const a = ent.resolved.asset, glb = modelPath(typeof a === 'object' ? a : sc.data.assets?.[a]);
    if (!glb) throw new Error(`${rest.id} has no GLB model to edit`);
    if (rest.prefab && !ent.authored.prefab) throw new Error(`${rest.id} isn't a prefab instance`);
    if (rest.prefab && ent.authored.asset) throw new Error(`${rest.id} overrides its prefab's model; send it without prefab`);
    const job = { id: rest.id, glb, scene: sc.url, ...(rest.prefab ? { prefab: ent.authored.prefab } : {}) };
    const r = await (await fetch(`${http}/bridge/send`, { method: 'POST', body: JSON.stringify(job) })).json();
    if (r.error) throw new Error(r.error);
    return [{ type: 'text', text: `Sent ${rest.id} (${glb}) to Blender${r.blender ? '' : " — queued; Blender isn't connected yet (sidebar › Scene Companion › Start)"}. When Colin presses Send Back, ${job.prefab ? `prefabs/${job.prefab}.prefab.json is updated so every ${job.prefab} changes; commit it and` : 'the edited model replaces it in the editor; then save_scene and commit'} the new GLB in assets/models/bridge/.` }];
  }
  const r = await command(name, rest, scene);
  if (name === 'list_library' && r.result) {           // prefab files the scene doesn't list yet (spawn adds them)
    const have = new Set(r.result.prefabs || []);
    r.result.morePrefabs = (await readdir(join(ROOT, 'prefabs')).catch(() => [])).filter(f => f.endsWith('.prefab.json'))
      .map(f => f.slice(0, -'.prefab.json'.length)).filter(n => !have.has(n)).sort();
  }
  const out = [{ type: 'text', text: JSON.stringify(r.result ?? null, null, 1) }];
  if (r.image) out.push({ type: 'image', data: r.image, mimeType: r.mime || 'image/jpeg' });
  return out;
}

// ---- MCP (JSON-RPC 2.0, newline-delimited over stdio)
const out = msg => process.stdout.write(JSON.stringify(msg) + '\n');
async function handle(msg) {
  const { id, method, params } = msg;
  const reply = result => id !== undefined && out({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => id !== undefined && out({ jsonrpc: '2.0', id, error: { code, message } });
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'scene-companion', version: '0.1.0' },
        instructions: 'Edit the Three.js scene open in the Scene Companion editor. Start with list_entities / list_library; take a screenshot to see the result; save_scene writes the scene file to the repo.',
      });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call':
      try { return reply({ content: await callTool(params.name, params.arguments) }); }
      catch (e) { return reply({ content: [{ type: 'text', text: e.message }], isError: true }); }
    default:
      if (method?.startsWith('notifications/')) return;
      return fail(-32601, `Method not found: ${method}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', line => {
    if (!line.trim()) return;
    let msg; try { msg = JSON.parse(line); } catch { return out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    handle(msg).catch(e => log('mcp error:', e.stack));
  });
  const bye = async () => { ws?.close(); await browser?.close().catch(() => {}); devChild?.kill(); process.exit(0); };
  rl.on('close', bye); process.on('SIGTERM', bye); process.on('SIGINT', bye);
  log(`scene-companion MCP server → ${DEV_URL}`);
}

export { handle };
