#!/usr/bin/env node
// Scene Companion MCP server: lets Claude see and edit the scene that's open in the editor.
//
//   Claude ⇄ (stdio, MCP) ⇄ this ⇄ (WebSocket /live) ⇄ dev server ⇄ editor tab (desktop or phone)
//
// Run `npm run dev`, open the editor, and add this server to Claude (the repo's .mcp.json does it for
// Claude Code). Hand-written JSON-RPC over stdio, no SDK: the protocol surface we need is tiny.
// Env: SC_DEV_URL (default ws://localhost:8080/live), SC_TIMEOUT_MS (default 30000; adding objects rebuilds the scene, slow on old phones).
import { WebSocket } from 'ws';
import { writeFile } from 'node:fs/promises';
import { resolve, relative, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { TOOLS } from './mcp-tools.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEV_URL = process.env.SC_DEV_URL || `ws://localhost:${process.env.PORT || 8080}/live`;
const TIMEOUT = +(process.env.SC_TIMEOUT_MS || 30000);
const log = (...a) => process.stderr.write(a.join(' ') + '\n');   // stdout is the protocol — never log there

// ---- link to the dev server (reconnects lazily)
let ws = null, opening = null, seq = 0;
const pending = new Map();
function link() {
  if (ws?.readyState === WebSocket.OPEN) return Promise.resolve(ws);
  if (opening) return opening;
  opening = new Promise((res, rej) => {
    const s = new WebSocket(DEV_URL);
    s.once('open', () => { ws = s; opening = null; res(s); });
    s.once('error', e => { opening = null; rej(new Error(`Can't reach the dev server at ${DEV_URL} (${e.message}). Start it with \`npm run dev\`.`)); });
    s.on('close', () => { if (ws === s) ws = null; });
    s.on('message', raw => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type !== 'cmd-result' || !pending.has(m.id)) return;
      const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer);
      m.ok ? p.res(m) : p.rej(new Error(m.error));
    });
  });
  return opening;
}

// Send one command to the editor; the first editor that answers wins.
export async function command(op, args = {}, scene) {
  const s = await link();
  const id = `c${++seq}_${Date.now()}`;
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { pending.delete(id); rej(new Error('No editor answered. Open the editor page from `npm run dev` (index.html, on a computer or phone) and keep it in the foreground.')); }, TIMEOUT + (args.seconds || 0) * 1000);
    pending.set(id, { res, rej, timer });
    s.send(JSON.stringify({ type: 'cmd', id, op, args, ...(scene ? { scene } : {}) }));
  });
}

// ---- tool calls
async function callTool(name, args = {}) {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) throw new Error(`Unknown tool ${name}`);
  const { scene, ...rest } = args;
  if (name === 'save_scene') {
    const { result } = await command('get_scene', {}, scene);
    const file = resolve(ROOT, result.url.replace(/^\.\//, ''));
    const rel = relative(ROOT, file);
    if (rel.startsWith('..') || !/^scenes\/[\w.-]+\.scene\.json$/.test(rel.split('\\').join('/'))) throw new Error(`Refusing to write outside scenes/: ${rel}`);
    await writeFile(file, JSON.stringify(result.data, null, 2) + '\n');
    return [{ type: 'text', text: `Saved ${rel} (${result.data.entities.length} entities). Run \`npm run check\`, then commit.` }];
  }
  const r = await command(name, rest, scene);
  const out = [{ type: 'text', text: JSON.stringify(r.result ?? null, null, 1) }];
  if (r.image) out.push({ type: 'image', data: r.image, mimeType: r.mime || 'image/jpeg' });
  return out;
}

// ---- MCP (JSON-RPC 2.0, newline-delimited over stdio)
const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');
async function handle(msg) {
  const { id, method, params } = msg;
  const reply = result => id !== undefined && send({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } });
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
    let msg; try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    handle(msg).catch(e => log('mcp error:', e.stack));
  });
  rl.on('close', () => { ws?.close(); process.exit(0); });
  log(`scene-companion MCP server → ${DEV_URL}`);
}

export { handle };
