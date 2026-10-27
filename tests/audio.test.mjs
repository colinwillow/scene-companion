import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioSource } from '../behaviors/index.js';
import { createAudio } from '../runtime/audio.js';

test('AudioSource: plays on its event (only events about its entity), from where it happened; a loop at Play follows the entity', () => {
  const handlers = {}, sent = [], world = { on: (n, f) => { handlers[n] = f; }, emit: (n, r) => sent.push([n, r]) };
  const ent = { id: 'house', object3d: { position: { x: 1, y: 2, z: 3 } } };
  new AudioSource(ent, { clip: 'a.mp3', on: 'chunk', pitchVar: 0 }, world).start();
  handlers.chunk('other', 'w', 0, 1, 9, 9, 9); assert.equal(sent.length, 0, 'not mine');
  handlers.chunk('house', 'w', 0, 1, 5, 6, 7);
  assert.deepEqual(sent[0][1].at, [5, 6, 7]); assert.equal(sent[0][1].url, 'a.mp3'); assert.equal(sent[0][1].follow, null);
  const loop = new AudioSource({ id: 'fountain', object3d: { position: { x: 0, y: 0, z: 0 } } }, { clip: 'w.mp3', loop: true }, world); loop.start();
  assert.equal(sent[1][1].follow, 'fountain'); assert.equal(sent[1][1].key, 'fountain:w.mp3');
  loop.destroy(); assert.deepEqual(sent[2], ['audiostop', 'fountain:w.mp3']);
});

test('audio runtime: buses carry the volumes (kept per device), mute silences master, a loop asked for before the tap starts on it', async () => {
  const gains = [], started = [];
  const node = () => ({ connect() {}, gain: { value: 1 } });
  class FakeCtx {
    constructor() { this.state = 'running'; this.destination = {}; this.listener = {}; }
    createGain() { const g = node(); gains.push(g); return g; }
    createBufferSource() { return { connect() {}, playbackRate: { value: 1 }, start() { started.push(this); }, stop() {} }; }
    createPanner() { return { connect() {}, positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 } }; }
    decodeAudioData(b, ok) { ok({ duration: 1 }); }
    resume() { return Promise.resolve(); }
  }
  globalThis.AudioContext = FakeCtx; globalThis.fetch = async () => ({ arrayBuffer: async () => new ArrayBuffer(4) });
  const store = { v: null, getItem() { return this.v; }, setItem(k, v) { this.v = v; } };
  const a = createAudio({ storage: store });
  await a.play({ url: 'music.mp3', loop: true, bus: 'music', key: 'music' });
  assert.equal(started.length, 0, 'no context yet: queued');
  a.unlock(); await new Promise(r => setTimeout(r, 5));
  assert.equal(started.length, 1, 'the queued loop started on unlock');
  a.setVolume('music', 0.3); assert.equal(gains[1].gain.value, 0.3); assert.equal(JSON.parse(store.v).music, 0.3);
  a.muted = true; a.setVolume(); assert.equal(gains[0].gain.value, 0);
  delete globalThis.AudioContext;
});

test('Emitter: a burst where the event happened (a blast starts with its position, a chunk ends with it); a stream at its rate', async () => {
  const { Emitter, eventPos } = await import('../behaviors/index.js');
  assert.deepEqual(eventPos([1, 2, 3, 0.5, 9]), [1, 2, 3]); assert.deepEqual(eventPos(['h', 'w', 0, 1, 4, 5, 6]), [4, 5, 6]); assert.equal(eventPos(['h', 'left']), null);
  const handlers = {}, sent = [], world = { on: (n, f) => { handlers[n] = f; }, emit: (n, r) => sent.push(r) };
  const p = { x: 0, y: 0, z: 0 }, ent = { id: 'p', object3d: { position: p } };
  new Emitter(ent, { preset: 'sparks', on: 'blast', mine: false }, world).start();
  handlers.blast(1, 2, 3, 1, 2); assert.deepEqual(sent[0], { preset: 'sparks', at: [1, 2, 3], count: undefined, scale: 1, color: null });
  const s = new Emitter({ id: 'chimney', object3d: { position: { x: 5, y: 0, z: 0 } } }, { preset: 'smoke', rate: 10, height: 4 }, world); s.start();
  for (let i = 0; i < 61; i++) s.update(1 / 60);
  const stream = sent.slice(1); assert.equal(stream.reduce((n, r) => n + r.count, 0), 10); assert.deepEqual(stream[0].at, [5, 4, 0]);
});

test('Trail: samples a bone after animation, only while it moves fast enough, stronger the faster', async () => {
  const THREE = await import('three'); const { Trail } = await import('../behaviors/index.js');
  const root = new THREE.Group(), foot = new THREE.Object3D(); foot.name = 'toe'; root.add(foot);
  const sent = [], world = { emit: (n, s) => sent.push(s) };
  const t = new Trail({ id: 'sk', object3d: root }, { bones: 'toe', minSpeed: 6, fullSpeed: 14 }, world); t.start();
  t.lateUpdate(1 / 60); root.position.x += 3 / 60; root.updateMatrixWorld(true); t.lateUpdate(1 / 60);
  assert.equal(sent.length, 0, '3 m/s: no trail');
  root.position.x += 20 / 60; root.updateMatrixWorld(true); t.lateUpdate(1 / 60);
  assert.equal(sent.length, 1); assert.equal(sent[0].key, 'sk:toe'); assert.equal(sent[0].strength, 1);
});

test('Emitter.while: a stream only while a behavior property is true, here or on another entity', async () => {
  const { Emitter } = await import('../behaviors/index.js');
  class Blaster { constructor() { this.charging = false; } }
  const player = { id: 'player', behaviors: [new Blaster()] }, sent = [];
  const world = { emit: (n, r) => sent.push(r), getEntity: id => (id === 'player' ? player : null) };
  const e = new Emitter({ id: 'gun', object3d: { position: { x: 0, y: 1, z: 0 } } }, { preset: 'glow', rate: 30, while: 'player:Blaster.charging' }, world); e.start();
  for (let i = 0; i < 30; i++) e.update(1 / 60); assert.equal(sent.length, 0);
  player.behaviors[0].charging = true; for (let i = 0; i < 30; i++) e.update(1 / 60); assert.ok(sent.length > 10);
});

test('VFX workspace: a saved preset is clean (known fields, ordered pairs, in range)', async () => {
  const { cleanPreset } = await import('../runtime/fxedit.js');
  const out = cleanPreset({ add: 1, count: 500, speed: [5, 2], life: [0.3, 0.6], size: [0.1, 0.2], grow: 1.23456, grav: 3, drag: 1, up: 1, spread: 1, color: ['#fff', '#f00'], junk: 1 });
  assert.equal(out.count, 80); assert.deepEqual(out.speed, [2, 5]); assert.equal(out.grow, 1.235); assert.equal(out.junk, undefined); assert.equal(out.add, true);
});

test('HudLabel / HudBar: text from world variables and behavior properties, sent only when it changes', async () => {
  const { HudLabel, HudBar } = await import('../behaviors/index.js');
  class Health { constructor() { this.current = 3; this.params = { max: 5 }; } }
  const me = { id: 'player', behaviors: [new Health()] }, sent = [];
  const world = { vars: { score: 120 }, emit: (n, h) => sent.push(h), getEntity: id => (id === 'player' ? me : null) };
  const l = new HudLabel({ id: 'hud' }, { text: '{score} pts · ♥ {player:Health.current}' }, world); l.start(); l.update();
  assert.equal(sent.length, 1); assert.equal(sent[0].text, '120 pts · ♥ 3');
  world.vars.score = 150; l.update(); assert.equal(sent[1].text, '150 pts · ♥ 3');
  const b = new HudBar(me, {}, world); b.start(); assert.equal(sent[2].value, 0.6);
  me.behaviors[0].current = 5; b.update(); assert.equal(sent[3].value, 1);
});

test('HudPrompt: shows while the player is near, goes when they leave', async () => {
  const { HudPrompt } = await import('../behaviors/index.js');
  const player = { object3d: { position: { x: 10, y: 0, z: 0 } } }, sent = [];
  const world = { on() {}, emit: (n, h) => sent.push(h), getEntity: id => (id === 'player' ? player : null) };
  const p = new HudPrompt({ id: 'rail', object3d: { position: { x: 0, y: 0, z: 0 } } }, { text: 'Grind it!', radius: 3 }, world); p.start();
  p.update(); assert.equal(sent.length, 0);
  player.object3d.position.x = 2; p.update(); p.update(); assert.equal(sent.length, 1); assert.equal(sent[0].text, 'Grind it!');
  player.object3d.position.x = 9; p.update(); assert.equal(sent[1].remove, true);
});

test('Checkpoint: reaching it moves the respawn point and names it; a saved game naming it starts the player there', async () => {
  const { Checkpoint } = await import('../behaviors/index.js');
  const pc = { spawn: [0, 0, 0] }, player = { id: 'player', behaviors: [pc], object3d: { position: { x: 9, y: 0, z: 0 } } }, sent = [];
  const world = { vars: {}, emit: (...a) => sent.push(a), getEntity: id => (id === 'player' ? player : null) };
  const c = new Checkpoint({ id: 'cp', object3d: { position: { x: 5, y: 1, z: 0 } } }, { radius: 2 }, world); c.start();
  c.update(); assert.deepEqual(pc.spawn, [0, 0, 0]);
  player.object3d.position.x = 5.5; c.update();
  assert.deepEqual(pc.spawn, [5, 1, 0]); assert.equal(world.vars.checkpoint, 'cp'); assert.ok(sent.some(a => a[0] === 'checkpoint'));
  const w2 = { vars: { checkpoint: 'cp' }, emit() {}, getEntity: world.getEntity }; player.object3d.position.x = 0;
  const c2 = new Checkpoint({ id: 'cp', object3d: { position: { x: 5, y: 1, z: 0 } } }, {}, w2); c2.start(); c2.update();
  assert.equal(player.object3d.position.x, 5, 'resumed at the saved checkpoint');
});

test('CameraRig: the active rig with the highest priority wins; a zone rig only inside its zone; shakes on its event', async () => {
  const { CameraRig, pickRig } = await import('../behaviors/index.js');
  const player = { object3d: { position: { x: 0, y: 0, z: 0 } } }, handlers = {}, sent = [];
  const world = { on: (n, f) => { handlers[n] = f; }, emit: (...a) => sent.push(a), getEntity: id => (id === 'player' ? player : null) };
  const main = new CameraRig({ id: 'cam', object3d: { position: { x: 0, y: 0, z: 0 } } }, { shakeOn: 'blast' }, world); main.start();
  const room = new CameraRig({ id: 'room', object3d: { position: { x: 20, y: 3, z: 0 } } }, { mode: 'fixed', zone: 5, priority: 1 }, world); room.start();
  assert.equal(pickRig(world), main);
  player.object3d.position.x = 18; assert.equal(pickRig(world), room);
  handlers.blast(); assert.deepEqual(sent[0], ['shake', 0.25, 0.3]);
  room.destroy(); assert.equal(pickRig(world), main);
});
