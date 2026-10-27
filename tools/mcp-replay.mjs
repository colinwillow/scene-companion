#!/usr/bin/env node
// Replay a list of MCP tool calls against the Scene Companion MCP server, exactly as Claude would make them.
//   node tools/mcp-replay.mjs tests/finish-line/sky-steps.calls.json
// The file is [{ "tool": "spawn", "args": {…} }, …]. Stops at the first error. Images are saved next to it.
// Uses the headless editor unless SC_HEADLESS says otherwise.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2];
if (!file) { console.error('usage: node tools/mcp-replay.mjs <calls.json>'); process.exit(2); }
const calls = JSON.parse(readFileSync(file, 'utf8'));
const mcp = spawn(process.execPath, [join(ROOT, 'tools/mcp-server.mjs')], { cwd: ROOT, env: { SC_HEADLESS: 'always', ...process.env }, stdio: ['pipe', 'pipe', 'inherit'] });
const waiting = new Map(); let n = 0;
createInterface({ input: mcp.stdout }).on('line', l => { const m = JSON.parse(l); waiting.get(m.id)?.(m); });
const rpc = (method, params) => new Promise(r => { const id = ++n; waiting.set(id, r); mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });

await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-replay', version: '0' } });
mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
let failed = false, shots = 0;
for (const [i, { tool, args = {} }] of calls.entries()) {
  const t0 = Date.now();
  const r = (await rpc('tools/call', { name: tool, arguments: args })).result;
  const text = r.content.find(c => c.type === 'text')?.text || '';
  for (const img of r.content.filter(c => c.type === 'image')) {
    const out = join(dirname(file), `${basename(file, '.calls.json')}-${++shots}.jpg`);
    writeFileSync(out, Buffer.from(img.data, 'base64'));
    console.log(`   image → ${out}`);
  }
  console.log(`${r.isError ? '✗' : '✓'} ${i + 1}/${calls.length} ${tool} (${((Date.now() - t0) / 1000).toFixed(1)} s) ${text.replace(/\s+/g, ' ').slice(0, 160)}`);
  if (r.isError) { failed = true; break; }
}
mcp.stdin.end();
setTimeout(() => process.exit(failed ? 1 : 0), 500);
