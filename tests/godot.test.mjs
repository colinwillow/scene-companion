import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basis, lookBasis, toTscn, nodeName } from '../runtime/godot.js';
import { undraco, readGlb, isDraco } from '../tools/undraco.mjs';

const near = (a, b) => a.flat().every((v, i) => Math.abs(v - b.flat()[i]) < 1e-9);

test('basis: three Euler XYZ degrees + scale, row-major as Godot writes it', () => {
  assert.ok(near(basis([0, 90, 0]), [[0, 0, 1], [0, 1, 0], [-1, 0, 0]]));
  assert.ok(near(basis([0, 0, 0], 2), [[2, 0, 0], [0, 2, 0], [0, 0, 2]]));
  const L = lookBasis([0, 10, 0], [0, 0, 0]);            // pointing down: the light's -Z column is (0,-1,0)
  assert.ok(near([[-L[0][2], -L[1][2], -L[2][2]]], [[0, -1, 0]]));
  assert.equal(nodeName('a.b:c'), 'a_b_c');
});

test('toTscn: models, primitives, lights, solids, metadata, sky', () => {
  const ents = [
    { id: 'sun', light: { type: 'directional', intensity: 2 }, position: [5, 10, 5] },
    { id: 'fill', light: { type: 'hemisphere', color: '#aabbcc', intensity: 1 } },
    { id: 'player', position: [0, 0, 3], variant: { glb: './assets/a.glb', height: 2 }, behaviors: [{ type: 'PlayerController', params: { speed: 5 } }] },
    { id: 'box', position: [1, 0, 0], rotation: [0, 90, 0], variant: { primitive: 'box', size: [2, 1, 2], color: '#ff0000', pivot: 'bottom' }, behaviors: [{ type: 'Solid', params: { size: [2, 1, 2] } }],
      children: [{ id: 'kid', position: [0, 1, 0], variant: { glb: './assets/b.glb', scale: 3 } }] },
  ];
  const { tscn, files } = toTscn(ents, { name: 'T', settings: { sky: {} }, measure: p => p.endsWith('a.glb') ? { minY: -0.5, height: 1 } : null });
  assert.deepEqual(files.sort(), ['assets/a.glb', 'assets/b.glb']);
  assert.match(tscn, /^\[gd_scene load_steps=\d+ format=3\]/);
  assert.match(tscn, /\[node name="model" parent="player" instance=ExtResource\("1_res"\)\]\ntransform = Transform3D\(2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 1, 0\)/);   // ×2 to 2 m, feet lifted 0.5 × 2
  assert.match(tscn, /\[node name="box" type="Node3D" parent="\."\]\ntransform = Transform3D\(0, 0, 1, 0, 1, 0, -1, 0, 0, 1, 0, 0\)/);
  assert.match(tscn, /\[node name="kid" type="Node3D" parent="box"\]/);
  assert.match(tscn, /parent="box\/kid" instance=ExtResource\("2_res"\)\]\ntransform = Transform3D\(3, 0, 0, 0, 3, 0, 0, 0, 3/);
  assert.match(tscn, /\[node name="shape" type="CollisionShape3D" parent="box\/collider"\]\ntransform = Transform3D\(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.5, 0\)/);
  assert.match(tscn, /metadata\/sc_behaviors = "\[\{\\"type\\":\\"PlayerController\\"/);
  assert.match(tscn, /type="DirectionalLight3D"/);
  assert.ok(tscn.indexOf('id="ProceduralSkyMaterial') < tscn.indexOf('id="Sky_') && tscn.indexOf('id="Sky_') < tscn.indexOf('id="Environment'));   // used after defined
  assert.match(tscn, /ambient_light_color = Color\(0\.66667, 0\.73333, 0\.8, 1\)/);
});

test('undraco: a Draco GLB comes back plain with the same vertex counts', async () => {
  const src = readFileSync(new URL('../assets/models/colin/props/alien_rock_01.glb', import.meta.url));
  const before = readGlb(src).json; assert.ok(isDraco(before));
  const { buf, decoded } = await undraco(src), after = readGlb(buf).json;
  assert.ok(decoded > 0); assert.ok(!isDraco(after)); assert.ok(!JSON.stringify(after).includes('KHR_draco'));
  for (const [i, m] of before.meshes.entries()) m.primitives.forEach((pr, k) =>
    assert.equal(after.accessors[after.meshes[i].primitives[k].attributes.POSITION].count, before.accessors[pr.attributes.POSITION].count));
});
