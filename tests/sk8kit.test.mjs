import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../runtime/World.js';
import { groundUnder } from '../behaviors/index.js';
import '../behaviors/index.js';

globalThis.window ??= { devicePixelRatio: 1 };
const fakeRenderer = () => ({ shadowMap: {}, setPixelRatio() {}, toneMappingExposure: 1 });
const kit = ['sk8_qp_s', 'sk8_qp_m', 'sk8_qp_l', 'sk8_qp_xl', 'sk8_bank', 'sk8_kicker', 'sk8_ledge', 'sk8_rail', 'sk8_funbox'];

test('skate kit: every piece loads, its ramps are Surfaces, its rails sit where they should', async () => {
  const noTex = s => s.replace(/"texture": "[a-z]+",?/g, '');   // procedural textures need a DOM canvas
  const prefabs = Object.fromEntries(kit.map(k => [k, JSON.parse(noTex(readFileSync(`prefabs/${k}.prefab.json`, 'utf8')))]));
  const entities = kit.map((k, i) => ({ id: k, prefab: k, position: [i * 12, 0, 0] }));
  const w = new World(fakeRenderer()); await w.load({ settings: { look: 'baked' }, assets: {}, prefabs, entities });
  for (const k of kit.filter(k => /qp|bank|kicker|funbox/.test(k))) assert.ok((w.surfaces || []).some(s => s.entity.id.startsWith(k) && s.count > 0), `${k} has a riding surface`);
  // a QP's coping rail runs along the top of its curve
  for (const [k, H, sw] of [['sk8_qp_m', 2.4, 80], ['sk8_qp_l', 3.6, 85]]) {
    const rail = w.rails.find(r => r.entity.id.startsWith(k)), [a, b] = rail.ends();
    const top = H * (1 - Math.cos(sw * Math.PI / 180));
    assert.ok(Math.abs(a[1] - top) < 0.05 && Math.abs(b[2] - a[2]) > 5.9, `${k}: coping rail at ${a[1].toFixed(2)} m (top ${top.toFixed(2)}), 6 m along z`);
  }
  // the bank rises 1.2 m over 4 m
  const x0 = kit.indexOf('sk8_bank') * 12, mid = groundUnder(w, x0, 0, 5).y;
  assert.ok(Math.abs(mid - 0.6) < 0.02, `bank half way up: ${mid.toFixed(3)} m`);
  // the handrail's bar is 0.9 m up, the ledge's edges 0.5
  const hr = w.rails.find(r => r.entity.id.startsWith('sk8_rail')).ends(), le = w.rails.filter(r => r.entity.id.startsWith('sk8_ledge'));
  assert.ok(Math.abs(hr[0][1] - 0.9) < 1e-6 && le.length === 2 && Math.abs(le[0].ends()[0][1] - 0.5) < 1e-6);
});
