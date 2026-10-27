import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bodyMasks, eventsCrossed, checkLayers } from '../runtime/animlayers.js';
import { World } from '../runtime/World.js';

test('bodyMasks: spine and below it is upper, the rest lower', () => {
  const bones = [{ name: 'mixamorig_Hips', parent: null }, { name: 'mixamorig_Spine', parent: 'mixamorig_Hips' },
    { name: 'mixamorig_RightArm', parent: 'mixamorig_Spine' }, { name: 'mixamorig_LeftUpLeg', parent: 'mixamorig_Hips' }];
  const m = bodyMasks(bones);
  assert.deepEqual([...m.upper].sort(), ['mixamorig_RightArm', 'mixamorig_Spine']);
  assert.deepEqual([...m.lower].sort(), ['mixamorig_Hips', 'mixamorig_LeftUpLeg']);
  assert.deepEqual([...bodyMasks(bones, ['mixamorig_RightArm']).upper], ['mixamorig_RightArm']);
});

test('eventsCrossed: window (prev, now], and across a loop', () => {
  const ev = [{ t: 0.2, name: 'stepL' }, { t: 0.7, name: 'stepR' }];
  const names = l => l.map(e => e.name);
  assert.deepEqual(names(eventsCrossed(ev, 0.1, 0.3)), ['stepL']);
  assert.deepEqual(names(eventsCrossed(ev, 0.2, 0.3)), [], 'already fired at prev');
  assert.deepEqual(names(eventsCrossed(ev, 0.9, 0.25, true)), ['stepL'], 'wrapped');
  assert.deepEqual(names(eventsCrossed(ev, 0.65, 0.1, true)), ['stepR']);
  assert.equal(checkLayers({ events: { run: [{ t: -1, name: 'x' }] } }, ['run']).length, 1);
  assert.equal(checkLayers({ events: { nope: [] } }, ['run']).length, 1);
  assert.deepEqual(checkLayers({ events: { run: [{ t: 0.2, name: 'step' }] }, masks: { upper: ['mixamorig_Spine'] } }, ['run']), []);
});

test('animator: an upper-layer clip owns the arms while the legs keep walking; events fire; one-shots hand back', () => {
  const B = n => Object.assign(new THREE.Bone(), { name: n });
  const hips = B('mixamorig_Hips'), spine = B('mixamorig_Spine'), arm = B('mixamorig_RightArm'), leg = B('mixamorig_LeftUpLeg');
  hips.add(spine, leg); spine.add(arm);
  const root = new THREE.Group(); root.add(hips);
  const rot = (bone, deg, len) => new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, [0, len],
    [...new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(deg)).toArray(),
     ...new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(deg)).toArray()]);
  const all = (name, deg, len) => new THREE.AnimationClip(name, len, ['mixamorig_Hips', 'mixamorig_Spine', 'mixamorig_RightArm', 'mixamorig_LeftUpLeg'].map(b => rot(b, deg, len)));
  const clips = [all('walk', 30, 1), all('slash', 90, 0.5)];
  const fired = [];
  globalThis.window ??= { devicePixelRatio: 1 };
  const w = new World({ shadowMap: {}, setPixelRatio() {}, toneMappingExposure: 1 });
  const anim = w.makeAnimator(root, clips, 'walk', { events: { walk: [{ t: 0.25, name: 'step', foot: 'L' }] }, emit: (n, o) => fired.push(`${n}:${o.clip}:${o.foot}`) });
  const deg = b => Math.round(THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(b.quaternion.w)))));
  w.animate(0.3, true);
  assert.equal(deg(arm), 30); assert.equal(deg(leg), 30);
  assert.deepEqual(fired, ['step:walk:L']);
  anim.play('slash', { layer: 'upper', once: true, fade: 0 });
  w.animate(0.1, true);
  assert.equal(anim.layer('upper'), 'slash');
  assert.equal(deg(arm), 90, 'arm follows the upper clip, not an average');
  assert.equal(deg(leg), 30, 'legs keep walking');
  for (let i = 0; i < 10; i++) w.animate(0.1, true);   // the 0.5 s one-shot ends
  assert.equal(anim.layer('upper'), null, 'one-shot handed the arms back');
  w.animate(0.3, true);
  assert.equal(deg(arm), 30);
  assert.equal(anim.current, 'walk');
});

test('clip variants: trim + re-zero, rate, mask; validation; MCP commands', async () => {
  const { checkClipVariants, mergeEvents } = await import('../runtime/animlayers.js');
  const { runCommand } = await import('../runtime/commands.js');
  const B = n => Object.assign(new THREE.Bone(), { name: n });
  const hips = B('mixamorig_Hips'), spine = B('mixamorig_Spine'), leg = B('mixamorig_LeftUpLeg'); hips.add(spine, leg);
  const root = new THREE.Group(); root.add(hips);
  const pos = n => new THREE.VectorKeyframeTrack(`${n}.position`, [0, 0.5, 1, 1.5, 2], [0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0]);
  const run = new THREE.AnimationClip('run', 2, [pos('mixamorig_Hips'), pos('mixamorig_Spine'), pos('mixamorig_LeftUpLeg')]);
  globalThis.window ??= { devicePixelRatio: 1 };
  const w = new World({ shadowMap: {}, setPixelRatio() {}, toneMappingExposure: 1 });
  const [cut, arms] = w.clipVariants(root, [run], { cut: { from: 'run', start: 0.5, end: 1.5, rate: 2 }, arms: { from: 'run', mask: 'upper' } });
  assert.equal(cut.name, 'cut'); assert.equal(cut.duration, 0.5, '1 s of clip at 2× = 0.5 s');
  assert.deepEqual([...cut.tracks[0].times], [0, 0.25, 0.5]); assert.equal(cut.tracks[0].values[0], 1, 're-zeroed at the trim start');
  assert.deepEqual(arms.tracks.map(t => t.name), ['mixamorig_Spine.position']);
  assert.deepEqual(checkClipVariants({ a: { from: 'run', start: 1, end: 0.5 } }, ['run']).length, 1);
  assert.deepEqual(checkClipVariants({ a: { from: 'nope' } }, ['run']).length, 1);
  assert.deepEqual(mergeEvents({ events: { run: [{ t: 0.5, name: 'foot' }] } }, { events: { run: [{ t: 0.2, name: 'hit' }] } }).run.map(e => e.name), ['hit', 'foot']);
  const data = { entities: [{ id: 'hero' }] };
  runCommand(data, 'add_clip_variant', { id: 'hero', name: 'fast_run', from: 'run', rate: 1.5, play: true }, {});
  runCommand(data, 'add_frame_event', { id: 'hero', clip: 'fast_run', t: 0.3, name: 'hit' }, {});
  assert.deepEqual(data.entities[0], { id: 'hero', clips: { fast_run: { from: 'run', rate: 1.5 } }, animation: 'fast_run', events: { fast_run: [{ t: 0.3, name: 'hit' }] } });
  assert.throws(() => runCommand(data, 'add_clip_variant', { id: 'hero', name: 'x', from: 'run', rate: -1 }, {}), /rate/);
});
