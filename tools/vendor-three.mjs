// Vendor three.js next to a page so it runs offline: the build plus every addon the given code imports (and what those
// import), and a rewrite of a page's import map from the CDN to ./vendor/three/. Used by the app and desktop exports.
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const T = 'node_modules/three/';
const importsOf = src => [...src.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1] || m[2]);
export function vendorThree(outDir, codeFiles) {
  const addons = new Set();
  const scan = p => { if (addons.has(p)) return; addons.add(p); const src = readFileSync(join(T, 'examples/jsm', p), 'utf8');
    for (const i of importsOf(src)) if (i.startsWith('.')) scan(normalize(join(dirname(p), i))); };
  for (const f of codeFiles) for (const i of importsOf(readFileSync(f, 'utf8'))) if (i.startsWith('three/addons/')) scan(i.slice('three/addons/'.length));
  mkdirSync(join(outDir, 'vendor/three/addons'), { recursive: true });
  copyFileSync(join(T, 'build/three.module.js'), join(outDir, 'vendor/three/three.module.js'));
  copyFileSync(join(T, 'build/three.webgpu.js'), join(outDir, 'vendor/three/three.webgpu.js'));   // play.html?renderer=webgpu
  for (const a of addons) { mkdirSync(join(outDir, 'vendor/three/addons', dirname(a)), { recursive: true }); copyFileSync(join(T, 'examples/jsm', a), join(outDir, 'vendor/three/addons', a)); }
  return addons.size;
}
export const localThree = page => page
  .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@[^/]+\/build\/three\.module\.js/g, './vendor/three/three.module.js')
  .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@[^/]+\/build\/three\.webgpu\.js/g, './vendor/three/three.webgpu.js')
  .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@[^/]+\/examples\/jsm\//g, './vendor/three/addons/');
