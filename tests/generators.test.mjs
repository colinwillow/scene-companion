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
