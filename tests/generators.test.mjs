import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkGenInput, genFileName, genProblems } from '../runtime/generators.js';
import { loadGenerators, runGenerator } from '../tools/generators.mjs';

test('the shipped generators load clean', async () => {
  const { gens, problems } = await loadGenerators(new URL('../generators', import.meta.url).pathname);
  assert.deepEqual(problems, []);
  assert.ok(gens['openai-image']);
});

test('genProblems names what is missing', () => {
  assert.ok(genProblems({ id: 'X Y', kind: 'video' }).length >= 4);
  assert.deepEqual(genProblems({ id: 'a', label: 'A', kind: 'image', fields: {}, run() {} }), []);
});

test('checkGenInput fills defaults, drops unknowns, checks options', () => {
  const g = { fields: { prompt: { required: true }, size: { default: 's', options: ['s', 'm'] } } };
  assert.deepEqual(checkGenInput(g, { prompt: ' cat ', junk: 1 }), { ok: true, input: { prompt: 'cat', size: 's' }, errors: [] });
  assert.equal(checkGenInput(g, {}).ok, false);
  assert.match(checkGenInput(g, { prompt: 'x', size: 'xl' }).errors[0], /one of s, m/);
});

test('genFileName slugs and numbers past taken names', () => {
  assert.equal(genFileName('A Red Barrel!', 'png'), 'a_red_barrel_1.png');
  assert.equal(genFileName('A Red Barrel!', 'png', ['a_red_barrel_1.png']), 'a_red_barrel_2.png');
});

test('runGenerator: dry spends nothing, a real run saves the file and lists it', async () => {
  const { gens } = await loadGenerators(new URL('../generators', import.meta.url).pathname);
  const root = await mkdtemp(join(tmpdir(), 'gen-'));
  const dry = await runGenerator(gens, 'openai-image', { prompt: 'barrel' }, { root, dry: true });
  assert.equal(dry.body.dry.body.model, 'gpt-image-1');
  const png = Buffer.from([137, 80, 78, 71]);
  const fakeFetch = async (url, opts) => ({ ok: true, json: async () => ({ data: [{ b64_json: png.toString('base64') }] }), url, opts });
  const r = await runGenerator(gens, 'openai-image', { prompt: 'barrel' }, { root, ctx: { fetch: fakeFetch, env: {} } });
  assert.equal(r.status, 200);
  assert.equal(r.body.path, './assets/generated/barrel_1.png');
  assert.deepEqual(await readFile(join(root, 'assets/generated/barrel_1.png')), png);
  const list = JSON.parse(await readFile(join(root, 'assets/generated/index.json'), 'utf8'));
  assert.equal(list[0].generator, 'openai-image');
  assert.equal((await runGenerator(gens, 'nope', {}, { root })).status, 404);
  assert.equal((await runGenerator(gens, 'openai-image', {}, { root })).status, 400);
});

test('tripo-model: uploads the picture, waits on both tasks, saves the textured GLB', async () => {
  const { gens } = await loadGenerators(new URL('../generators', import.meta.url).pathname);
  const root = await mkdtemp(join(tmpdir(), 'gen-'));
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(join(root, 'assets/generated'), { recursive: true });
  await writeFile(join(root, 'assets/generated/barrel_1.png'), Buffer.from([1, 2, 3]));
  const calls = [], polls = { m1: 0, t1: 0 };
  const ok = data => ({ ok: true, json: async () => ({ code: 0, data }) });
  const fakeFetch = async (url, opts = {}) => {
    calls.push(`${opts.method || 'GET'} ${url.replace('https://openapi.tripo3d.ai/v3', '')}`);
    if (url.endsWith('/files')) return ok({ file_token: 'tok' });
    if (url.endsWith('/multiview-to-model')) { assert.equal(JSON.parse(opts.body).inputs[0].front, 'tok'); return ok({ task_id: 'm1' }); }
    if (url.endsWith('/models/texture')) { assert.equal(JSON.parse(opts.body).input, 'm1'); return ok({ task_id: 't1' }); }
    const t = url.match(/tasks\/(\w+)/)?.[1];
    if (t) return ok(++polls[t] < 2 ? { status: 'running' } : { status: 'success', task_id: t, output: { model_url: 'https://cdn/x.glb' } });
    return { ok: true, arrayBuffer: async () => new Uint8Array([103, 108, 84, 70]).buffer };
  };
  const dry = await runGenerator(gens, 'tripo-model', { image: './assets/generated/barrel_1.png' }, { root, dry: true });
  assert.equal(dry.body.dry.mesh.body.face_limit, 8000);
  const r = await runGenerator(gens, 'tripo-model', { image: './assets/generated/barrel_1.png' }, { root, ctx: { fetch: fakeFetch, env: {}, sleep: async () => {} } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.path, './assets/generated/barrel_1_1.glb');
  assert.equal(calls.filter(c => c.includes('/tasks/')).length, 4);
  await assert.rejects(runGenerator(gens, 'tripo-model', { image: '../secret.png' }, { root }), /inside the project/);
});
