import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSandboxCore, lockGlobals } from '../runtime/sandbox-core.js';
import { startSandbox } from '../runtime/sandbox-host.js';

const tick = () => new Promise(r => setImmediate(r));
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; } });
function fakeWorld() {
  const L = {}, emitted = [];
  const ent = { id: 'crate', object3d: { position: v3(1, 0, 2), rotation: v3(), scale: v3(1, 1, 1) } };
  return { entities: new Map([['crate', ent]]), input: { move: [0, 0] }, ent, emitted,
    on(ev, fn) { (L[ev] ||= []).push(fn); }, emit(ev, ...a) { emitted.push([ev, ...a]); for (const f of L[ev] || []) f(...a); } };
}
// an in-process "Worker": the same two halves, messages delivered asynchronously like postMessage
function pair(globals = {}) {
  const ch = { onmessage: null, postMessage: m => setImmediate(() => core.handle(structuredClone(m))) };
  const core = createSandboxCore(m => setImmediate(() => ch.onmessage(structuredClone(m))), { globals });
  return ch;
}
const mod = src => 'data:text/javascript,' + encodeURIComponent(src);

test('a sandboxed Wobble moves the real object, a frame behind, through messages only', async () => {
  const W = fakeWorld(), url = new URL('../extensions/wobble/index.js', import.meta.url).href;
  const [[name, Proxy]] = await startSandbox(W, { url, manifest: { id: 'wobble', behaviors: ['Wobble'], permissions: [] }, channel: pair() });
  assert.equal(name, 'Wobble'); assert.equal(Proxy.schema.amount.default, 0.08);       // the schema came across
  const b = new Proxy(W.ent, { amount: 0.3 }, W); b.start();
  const ys = [];
  for (let i = 0; i < 12; i++) { b.update(1 / 30, i / 30); await tick(); await tick(); await tick(); ys.push(W.ent.object3d.scale.y); }
  assert.ok(ys.some(y => Math.abs(y - 1) > 0.01), `scale moved: ${ys.map(y => y.toFixed(3))}`);
  assert.equal(W.ent.object3d.position.x, 1);                                            // what it did not touch stays
});

test('events cross both ways, and getEntity sees last frame\'s positions', async () => {
  const W = fakeWorld();
  const src = `export default function register({ Behavior, define }) { define('Echo', class extends Behavior {
    start() { this.world.on('ping', n => this.world.emit('pong', n + 1, this.world.getEntity('crate').object3d.position.x)); }
    update() { this.entity.object3d.position.y = this.world.input.move[0]; } }); }`;
  const [[, Echo]] = await startSandbox(W, { url: mod(src), manifest: { id: 'echo', behaviors: ['Echo'] }, channel: pair() });
  const b = new Echo(W.ent, {}, W); b.start();
  b.update(0.016, 0); await tick(); await tick(); await tick();
  W.emit('ping', 41); W.input.move = [5, 0];
  b.update(0.016, 0.016); await tick(); await tick(); await tick();
  b.update(0.016, 0.032);
  assert.deepEqual(W.emitted.find(e => e[0] === 'pong'), ['pong', 42, 1]);
  assert.equal(W.ent.object3d.position.y, 5);
});

test('permissions: what the manifest did not ask for is gone before the extension runs', async () => {
  const g = { fetch: () => 'real', indexedDB: {} };
  lockGlobals(g, []);
  assert.throws(() => g.fetch('/x'), /did not ask for "network"/); assert.equal(g.indexedDB, undefined);
  const g2 = { fetch: () => 'real' }; lockGlobals(g2, ['network']); assert.equal(g2.fetch(), 'real');
  // and an extension that reaches for fetch anyway fails inside the sandbox, not in the game
  // (in-process the extension shares node's globals, so lock those — a Worker locks its own; each test file is its own process)
  const W = fakeWorld(), src = `export default function register({ Behavior, define }) { define('Leak', class extends Behavior { update() { this.entity.object3d.position.y = 7; fetch('https://example.com'); } }); }`;
  const warn = console.warn, said = []; console.warn = m => said.push(m);
  try {
    const [[, Leak]] = await startSandbox(W, { url: mod(src), manifest: { id: 'leak', behaviors: ['Leak'] }, channel: pair(globalThis) });
    const b = new Leak(W.ent, {}, W); b.start(); b.update(0.016, 0);
    await tick(); await tick(); await tick();
    assert.ok(said.some(m => /leak.*did not ask for "network"/.test(m)), said.join(' | '));   // reported, and the game carries on
  } finally { console.warn = warn; }
});

test('a bad extension fails to start with its reason', async () => {
  const W = fakeWorld(), src = `export default function register({ define }) { define('Other', class {}); }`;
  await assert.rejects(startSandbox(W, { url: mod(src), manifest: { id: 'bad', behaviors: ['Bad'] }, channel: pair(), timeout: 2000 }), /does not list/);
});
