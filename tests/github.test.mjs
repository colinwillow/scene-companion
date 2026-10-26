import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, saveFile } from '../runtime/github.js';

// A tiny fake of the GitHub contents API.
function fakeGitHub(files = {}) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body && JSON.parse(opts.body), auth: opts.headers?.Authorization });
    const path = decodeURI(new URL(url).pathname.split('/contents/')[1]);
    const res = (status, json) => ({ ok: status < 300, status, json: async () => json });
    if ((opts.method || 'GET') === 'GET') {
      if (!(path in files)) return res(404, { message: 'Not Found' });
      return res(200, { content: Buffer.from(files[path].text).toString('base64'), sha: files[path].sha });
    }
    const b = JSON.parse(opts.body);
    if (path in files && b.sha !== files[path].sha) return res(409, { message: 'sha mismatch' });
    files[path] = { text: Buffer.from(b.content, 'base64').toString(), sha: 'sha' + calls.length };
    return res(200, { commit: { sha: 'c' + calls.length, html_url: 'https://github.com/x' } });
  };
  return { fetch, calls, files };
}
const base = { repo: 'colin/game', path: 'scenes/a.scene.json', token: 't0k' };

test('reads and decodes (UTF-8 safe)', async () => {
  const gh = fakeGitHub({ 'scenes/a.scene.json': { text: '{"name":"café ★"}', sha: 's1' } });
  assert.deepEqual(await readFile({ ...base, fetch: gh.fetch }), { text: '{"name":"café ★"}', sha: 's1' });
  assert.equal(gh.calls[0].auth, 'Bearer t0k');
  assert.equal(await readFile({ ...base, path: 'nope.json', fetch: gh.fetch }), null);
});

test('saves with the current sha and reports the commit', async () => {
  const gh = fakeGitHub({ 'scenes/a.scene.json': { text: '{"v":1}', sha: 's1' } });
  const r = await saveFile({ ...base, text: '{"v":2}', expectText: '{"v":1}', fetch: gh.fetch });
  assert.equal(r.saved, true);
  assert.equal(gh.calls[1].body.sha, 's1');
  assert.equal(gh.files['scenes/a.scene.json'].text, '{"v":2}');
});

test('creates a new file', async () => {
  const gh = fakeGitHub();
  const r = await saveFile({ ...base, text: '{}', fetch: gh.fetch });
  assert.equal(r.saved, true);
  assert.ok(!('sha' in gh.calls[1].body));
});

test('refuses to overwrite someone else\'s change unless forced', async () => {
  const gh = fakeGitHub({ 'scenes/a.scene.json': { text: '{"v":"theirs"}', sha: 's9' } });
  const r = await saveFile({ ...base, text: '{"v":"mine"}', expectText: '{"v":1}', fetch: gh.fetch });
  assert.deepEqual(r, { conflict: true, remote: '{"v":"theirs"}' });
  assert.equal(gh.calls.length, 1, 'nothing written');
  const f = await saveFile({ ...base, text: '{"v":"mine"}', expectText: '{"v":1}', force: true, fetch: gh.fetch });
  assert.equal(f.saved, true);
});

test('no-op when nothing changed', async () => {
  const gh = fakeGitHub({ 'scenes/a.scene.json': { text: '{"v":1}\n', sha: 's1' } });
  assert.deepEqual(await saveFile({ ...base, text: '{"v":1}', fetch: gh.fetch }), { unchanged: true });
});
