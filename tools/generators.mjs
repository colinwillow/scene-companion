// Server side of the generator plug-ins (see runtime/generators.js): load generators/*.gen.mjs, run one, save the result.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkGenInput, genFileName, genProblems } from '../runtime/generators.js';

export async function loadGenerators(dir) {
  const gens = {}, problems = [];
  let files = []; try { files = (await readdir(dir)).filter(f => f.endsWith('.gen.mjs')).sort(); } catch { return { gens, problems }; }
  for (const f of files) {
    try {
      const g = (await import(pathToFileURL(join(dir, f)).href)).default;
      const p = genProblems(g);
      if (p.length) problems.push(`${f}: ${p.join('; ')}`); else gens[g.id] = g;
    } catch (e) { problems.push(`${f}: ${e.message}`); }
  }
  return { gens, problems };
}

// → { status, body }. Saves to <root>/assets/generated/<slug>_<n>.<ext> and lists it in index.json there.
export async function runGenerator(gens, id, raw, { root, dry = false, ctx = {} } = {}) {
  const g = gens[id];
  if (!g) return { status: 404, body: { error: `no generator '${id}'`, have: Object.keys(gens) } };
  const { ok, input, errors } = checkGenInput(g, raw);
  if (!ok) return { status: 400, body: { error: errors.join('; ') } };
  const out = await g.run(input, { ...ctx, dry });
  if (out?.dry) return { status: 200, body: { dry: out.dry } };
  if (!out?.bytes || !out.ext) return { status: 500, body: { error: `${id} returned nothing` } };
  const dir = join(root, 'assets/generated'); await mkdir(dir, { recursive: true });
  const name = genFileName(input.prompt, out.ext, await readdir(dir));
  await writeFile(join(dir, name), out.bytes);
  let list = []; try { list = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')); } catch {}
  const path = `./assets/generated/${name}`;
  list.push({ path, kind: g.kind, generator: id, prompt: input.prompt });
  await writeFile(join(dir, 'index.json'), JSON.stringify(list, null, 1) + '\n');
  return { status: 200, body: { path, kind: g.kind, bytes: out.bytes.length } };
}
