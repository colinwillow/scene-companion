// Every inline <script type="module"> in the HTML pages must parse. A syntax error there is a blank editor with no
// test failing (it happened: d7d0a47 shipped a stray ")" in index.html and npm run check stayed green).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = new URL('..', import.meta.url).pathname;
const pages = readdirSync(ROOT).filter(f => f.endsWith('.html'));
const dir = mkdtempSync(join(tmpdir(), 'sc-pages-'));

for (const page of pages) test(`${page}: inline module scripts parse`, () => {
  const html = readFileSync(join(ROOT, page), 'utf8');
  const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(m => m[1]);
  scripts.forEach((src, i) => {
    const f = join(dir, `${page}.${i}.mjs`); writeFileSync(f, src);
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${page} script ${i}:\n${r.stderr.split('\n').slice(0, 5).join('\n')}`);
  });
});
