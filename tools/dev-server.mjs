#!/usr/bin/env node
// Dev server: serves the repo and relays live edits between the editor and running games.
//   npm run dev  →  http://<your-computer-ip>:8080/index.html (editor)  +  /play.html (game, on your phone)
// Every message a client sends on /live is passed to every other client. The last scene is kept,
// so a game that connects later starts from the editor's current version.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';

const PORT = +(process.env.PORT || 8080);
const ROOT = process.cwd();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.md': 'text/markdown' };

const server = createServer(async (req, res) => {
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
