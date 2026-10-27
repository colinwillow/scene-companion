#!/usr/bin/env node
// Measure when each foot is planted in a character's walk / run clips and write them as `foot` frame events into its
// character.json (runtime/animlayers.js fires them; Footsteps turns them into step sounds). Measured, never typed:
// the clip is played on the real skeleton (node, three.js, no mesh decode) and a foot is planted at each local
// minimum of its toe's height that sits in the bottom 20% of that toe's travel.
//   node tools/footsteps.mjs assets/models/colin/characters/zap.character.json [roles…]   (default: walk run sprint)
import * as THREE from 'three';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb, nodeTree, clipByName } from './bake-motions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FEET = { L: ['mixamorig_LeftToeBase', 'mixamorig_LeftFoot'], R: ['mixamorig_RightToeBase', 'mixamorig_RightFoot'] };

// fwd: [the foot's forward coordinate per sample], dt between samples. In an in-place clip a planted foot slides
// BACKWARDS under the body and a swinging foot moves forwards (weirdport's `npm run gait` stance rule), so the foot
// lands at the moment it is furthest forward. A locomotion cycle is one step per foot, so each foot plants once: at
// its most forward sample. (Local maxima were tried first and double-counted at the loop seam.)
export function plants(fwd, dt) {
  const lo = Math.min(...fwd), hi = Math.max(...fwd);
  if (hi - lo < 1e-4) return [];   // the foot never moves: no step in this clip
  return [+(fwd.indexOf(hi) * dt).toFixed(3)];
}

export function measure(glb, clipName, samples = 120) {
  const root = nodeTree(glb.json), clip = clipByName(glb, clipName);
  clip.resetDuration();
  const mixer = new THREE.AnimationMixer(root); mixer.clipAction(clip).play();
  const feet = Object.fromEntries(Object.entries(FEET).map(([k, names]) => [k, names.map(n => root.getObjectByName(n)).find(Boolean)]));
  const dt = clip.duration / samples, h = { L: [], R: [] }, v = new THREE.Vector3();
  // the character's forward in world space (they face +Z in their own frame; nodes above the hips may turn that)
  const fwdAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(root.children[0].getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
  for (let i = 0; i < samples; i++) {
    mixer.setTime(i * dt); root.updateMatrixWorld(true);
    for (const k of ['L', 'R']) if (feet[k]) h[k].push(feet[k].getWorldPosition(v).dot(fwdAxis));
  }
  const ev = [];
  for (const k of ['L', 'R']) for (const t of plants(h[k], dt)) ev.push({ t, name: 'foot', foot: k });
  return ev.sort((a, b) => a.t - b.t);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [charArg, ...roles] = process.argv.slice(2);
  if (!charArg?.endsWith('.character.json')) { console.error('usage: node tools/footsteps.mjs <x.character.json> [roles…]'); process.exit(1); }
  const charPath = join(process.cwd(), charArg), ch = JSON.parse(readFileSync(charPath, 'utf8'));
  const glb = readGlb(readFileSync(join(ROOT, ch.glb)));
  ch.events ||= {};
  for (const role of roles.length ? roles : ['walk', 'run', 'sprint']) {
    const clip = ch.roles?.[role]; if (!clip) continue;
    let ev; try { ev = measure(glb, clip); } catch (e) { console.error(`✗ ${role} (${clip}): ${e.message}`); continue; }
    if (!ev.length) { console.log(`– ${role} (${clip}): no planted feet found`); continue; }
    ch.events[clip] = [...(ch.events[clip] || []).filter(e => e.name !== 'foot'), ...ev].sort((a, b) => a.t - b.t);
    console.log(`✓ ${role} (${clip}): ${ev.map(e => `${e.foot}@${e.t}s`).join(' ')}`);
  }
  writeFileSync(charPath, JSON.stringify(ch, null, 2) + '\n');
}
