#!/usr/bin/env node
// Dev server: serves the repo and relays live edits between the editor and running games.
//   npm run dev  →  http://<your-computer-ip>:8080/index.html (editor)  +  /play.html (game, on your phone)
// Every message a client sends on /live is passed to every other client. The last scene is kept,
// so a game that connects later starts from the editor's current version.
import { createServer } from 'node:http';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';

const PORT = +(process.env.PORT || 8080);
const ROOT = process.cwd();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.md': 'text/markdown' };

// ---- Blender bridge (tools/blender/scene_companion_bridge.py polls these over plain HTTP)
//   POST /bridge/send   {id, glb, scene}  editor → queued for Blender
//   GET  /bridge/inbox                    Blender takes the queue (also its heartbeat)
//   POST /bridge/return?id=<id>           Blender posts the edited GLB → assets/models/bridge/<id>-<n>.glb,
//                                         then every page hears {type:'bridge-return', id, glb, scene}
//   GET  /bridge/status                   {blender: seconds since Blender last polled, or null}
const bridge = { queue: [], lastPoll: 0, scenes: {} };
const ID = /^[a-z0-9_]+$/;
const body = (req, max) => new Promise((ok, fail) => {
  const parts = []; let n = 0;
  req.on('data', c => { n += c.length; if (n > max) { fail(new Error('too big')); req.destroy(); } else parts.push(c); });
  req.on('end', () => ok(Buffer.concat(parts))); req.on('error', fail);
});
const json = (res, code, obj) => res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(obj));
async function bridgeRoute(req, res, url) {
  const route = url.pathname.slice('/bridge/'.length);
  if (route === 'status') return json(res, 200, { blender: bridge.lastPoll ? Math.round((Date.now() - bridge.lastPoll) / 1000) : null, queued: bridge.queue.length });
  if (route === 'inbox' && req.method === 'GET') { bridge.lastPoll = Date.now(); const q = bridge.queue; bridge.queue = []; return json(res, 200, q); }
  if (route === 'send' && req.method === 'POST') {
    let job; try { job = JSON.parse(await body(req, 1e5)); } catch { return json(res, 400, { error: 'bad JSON' }); }
    if (!ID.test(job.id || '') || typeof job.glb !== 'string' || !/\.glb$/i.test(job.glb) || job.glb.includes('..')) return json(res, 400, { error: 'need id and a .glb path' });
    bridge.queue = bridge.queue.filter(j => j.id !== job.id).concat({ id: job.id, glb: job.glb, scene: job.scene || '' });
    bridge.scenes[job.id] = job.scene || '';
    return json(res, 200, { queued: true, blender: !!bridge.lastPoll && Date.now() - bridge.lastPoll < 5000 });
  }
  if (route === 'return' && req.method === 'POST') {
    const id = url.searchParams.get('id') || '';
    if (!ID.test(id)) return json(res, 400, { error: 'bad id' });
    let glb; try { glb = await body(req, 60e6); } catch { return json(res, 413, { error: 'GLB over 60 MB' }); }
    if (glb.subarray(0, 4).toString() !== 'glTF') return json(res, 400, { error: 'not a GLB' });
    const dir = join(ROOT, 'assets/models/bridge'); await mkdir(dir, { recursive: true });
    const taken = new Set(await readdir(dir));
    let n = 1; while (taken.has(`${id}-${n}.glb`)) n++;
    await writeFile(join(dir, `${id}-${n}.glb`), glb);
    const msg = JSON.stringify({ type: 'bridge-return', id, glb: `./assets/models/bridge/${id}-${n}.glb`, scene: url.searchParams.get('scene') || bridge.scenes[id] || '' });
    for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
    return json(res, 200, { saved: `assets/models/bridge/${id}-${n}.glb`, bytes: glb.length, editors: wss.clients.size });
  }
  json(res, 404, { error: 'unknown bridge route' });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/bridge/')) return bridgeRoute(req, res, url).catch(e => json(res, 500, { error: e.message }));
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (path.includes('..') || path.startsWith('node_modules')) { res.writeHead(403).end(); return; }
  let file = join(ROOT, path || 'index.html');
  try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('not found'); }
});

const wss = new WebSocketServer({ server, path: '/live' });
let lastScene = null, lastSelect = null;   // replayed to pages that connect later
wss.on('connection', ws => {
  if (lastScene) ws.send(lastScene);
  if (lastSelect) ws.send(lastSelect);
  ws.on('message', (msg, isBinary) => {
    const text = msg.toString();
    try { const t = JSON.parse(text).type; if (t === 'scene') lastScene = text; else if (t === 'select') lastSelect = text; } catch { return; }
    for (const c of wss.clients) if (c !== ws && c.readyState === 1) c.send(text, { binary: isBinary });
  });
});

server.listen(PORT, () => {
  const ips = Object.values(networkInterfaces()).flat().filter(i => i?.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`Scene Companion dev server on :${PORT}`);
  for (const ip of ['localhost', ...ips]) console.log(`  editor  http://${ip}:${PORT}/index.html\n  game    http://${ip}:${PORT}/play.html`);
});
export { server, wss };
