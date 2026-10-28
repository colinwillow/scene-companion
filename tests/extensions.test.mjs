import { test } from 'node:test';
import assert from 'node:assert/strict';
import { satisfies, parseRef, checkManifest, scanSource, checkSource } from '../runtime/extensions.js';

test('version ranges', () => {
  assert.ok(satisfies('1.2.5', '^1.2.0')); assert.ok(!satisfies('2.0.0', '^1.2.0')); assert.ok(!satisfies('1.1.9', '^1.2.0'));
  assert.ok(satisfies('0.9.4', '^0.9.0')); assert.ok(!satisfies('0.10.0', '^0.9.0'));          // 0.x: the minor is the major
  assert.ok(satisfies('1.2.9', '~1.2.0')); assert.ok(!satisfies('1.3.0', '~1.2.0'));
  assert.ok(satisfies('1.5.0', '>=1.2.0 <2.0.0')); assert.ok(!satisfies('2.0.0', '>=1.2.0 <2.0.0'));
  assert.ok(satisfies('3.1.4', '*')); assert.ok(satisfies('3.1.4', '3.1.4')); assert.ok(!satisfies('x', '*'));
  assert.deepEqual(parseRef('trail-plus@^1.2.0'), { id: 'trail-plus', range: '^1.2.0' });
  assert.deepEqual(parseRef('wobble'), { id: 'wobble', range: '*' });
});

test('manifest checks', () => {
  const good = { id: 'wobble', name: 'W', version: '1.0.0', engine: '^0.9.0', entry: 'index.js', behaviors: ['Wobble'], permissions: [] };
  assert.deepEqual(checkManifest(good, { engine: '0.9.0' }), []);
  const msgs = checkManifest({ id: 'Bad Id', version: '1', engine: '^2.0.0', entry: '../x.js', behaviors: ['lower'], permissions: ['camera'] }, { engine: '0.9.0' }).map(p => p.msg).join(' | ');
  for (const bit of ['id:', 'version', 'needs engine', 'entry', 'PascalCase', 'unknown permission']) assert.ok(msgs.includes(bit), bit);
});

test('source: permissions must be declared, some things never allowed, comments ignored', () => {
  assert.deepEqual(scanSource('fetch("x"); localStorage.x = 1; document.body'), { needs: ['network', 'storage', 'dom'], never: [] });
  assert.deepEqual(scanSource('// fetch() in a comment\n/* window.x */ const a = 1;').needs, []);
  assert.ok(scanSource('import x from "y"').never.length); assert.ok(scanSource('eval("1")').never.length); assert.ok(scanSource('await import("x")').never.length);
  const src = 'export default function register({ Behavior, define }) { define("A", class extends Behavior { update() { fetch("/x"); } }); }';
  assert.match(checkSource({ permissions: [] }, src)[0].msg, /network/);
  assert.deepEqual(checkSource({ permissions: ['network'] }, src), []);
  assert.match(checkSource({}, 'const a = 1;')[0].msg, /export default function register/);
});

test('the World loads a scene\'s extension and refuses a bad one', async () => {
  const { World } = await import('../runtime/World.js');
  const { getBehavior } = await import('../runtime/registry.js');
  const fs = await import('node:fs');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => { const p = new URL(url).pathname; return { ok: true, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) }; };
  try {
    const { createSandboxCore } = await import('../runtime/sandbox-core.js');
    const w = Object.create(World.prototype); w.extensionsBase = new URL('../extensions/', import.meta.url).href;
    w.sandboxChannel = () => {        // Wobble is sandboxed; node has no Worker, so the same two halves in-process
      const ch = { onmessage: null, postMessage: m => setImmediate(() => core.handle(structuredClone(m))) };
      const core = createSandboxCore(m => setImmediate(() => ch.onmessage(structuredClone(m))), { globals: {} });
      return ch;
    };
    await w.loadExtensions(['wobble@^1.0.0', 'wobble@^2.0.0', 'nope']);
    assert.ok(getBehavior('Wobble'), 'Wobble registered'); assert.equal(getBehavior('Wobble').sandboxed, true);
    assert.equal(w.extensionErrors.length, 2);
    assert.match(w.extensionErrors[0], /wobble: version 1\.0\.0 is not \^2\.0\.0/);
    assert.match(w.extensionErrors[1], /nope/);
  } finally { globalThis.fetch = realFetch; }
});
