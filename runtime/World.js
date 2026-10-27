// Builds a Three.js scene from a scene file and runs its behaviors.
// The scene data object is the single source of truth: the editor edits it,
// Play builds a fresh runtime from it, Stop throws the runtime away.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { retargetClip } from './retarget.js';
import { entityMotions, motionsBase, motionUrl } from './motions.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { getBehavior } from './registry.js';
import { applyLook, applyLookTo } from './look.js';
import { mergeEntity } from './prefabs.js';
import { applySky } from './sky.js';
import { proceduralTexture } from './textures.js';
import { characterVariant } from './character.js';
import { childIdFor, mergeTags, matchesQuery, spawnId } from './tree.js';
import { createTime, createRng, playSeed } from './time.js';

// A copy of a node tree where every mixamorig_* node is a real THREE.Bone (same name and rest transform).
function asBones(node) {
  const out = /^mixamorig/.test(node.name) ? new THREE.Bone() : new THREE.Object3D();
  out.name = node.name; out.position.copy(node.position); out.quaternion.copy(node.quaternion); out.scale.copy(node.scale);
  for (const c of node.children) out.add(asBones(c));
  return out;
}

const TIER_ORDER = { web: 0, desktop: 1 };

export class World {
  constructor(renderer, { tier = 'web' } = {}) {
    this.renderer = renderer;
    this.tier = tier;
    this.scene = new THREE.Scene();
    this.entities = new Map();
    this.listeners = {};
    this.loader = new GLTFLoader();
    // Colin's characters are Draco-compressed. The decoder is vendored next to the pages so it works offline.
    if (typeof document !== 'undefined') {
      const draco = new DRACOLoader();
      draco.setDecoderPath(new URL('../vendor/draco/', import.meta.url).href);
      this.loader.setDRACOLoader(draco);
    }
    this.gltfCache = new Map();   // path → Promise<gltf>, so many entities share one download
    this.characterCache = new Map();   // character.json path → Promise<json>
    this.characters = {};              // character.json path → json (loaded), for the editor
    this.mixers = [];
    this.prefabs = {};
    this.t = 0;
    this.time = createTime();      // fixed-step gameplay clock: scale, paused, hitStop (runtime/time.js)
    this.rng = createRng(1);       // reseeded per load (= per Play) from settings.seed or a fresh seed
    this.input = { move: [0, 0], jump: false };   // filled by the game page; read by behaviors
  }

  // ---- events (score, etc.)
  on(name, fn) { (this.listeners[name] ||= []).push(fn); }
  emit(name, ...args) { (this.listeners[name] || []).forEach(fn => fn(...args)); }

  getEntity(id) { return this.entities.get(id); }

  // Pick the richest variant this tier allows; fall back to web.
  resolveVariant(asset) {
    if (!asset) return null;
    const variants = asset.variants || { web: asset };
    let best = null, bestRank = -1;
    for (const [tier, v] of Object.entries(variants)) {
      const rank = TIER_ORDER[tier] ?? 0;
      if (rank <= TIER_ORDER[this.tier] && rank > bestRank) { best = v; bestRank = rank; }
    }
    return best;
  }

  async buildObject(variant) {
    if (!variant) return new THREE.Group();
    if (variant.glb) {
      if (!this.gltfCache.has(variant.glb)) this.gltfCache.set(variant.glb, this.loader.loadAsync(variant.glb));
      const gltf = await this.gltfCache.get(variant.glb);
      const model = cloneSkinned(gltf.scene);
      model.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false; } });
      // Normalize: scale to `height` metres and put the feet on the entity's origin.
      if (variant.height) {
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model, true);
        const h = box.max.y - box.min.y || 1;
        model.scale.multiplyScalar(variant.height / h);
        model.updateMatrixWorld(true);
        box.setFromObject(model, true);
        model.position.y -= box.min.y;
      } else if (variant.scale) {
        // Plain scale for props whose size is already known (e.g. Kenney tiles are ~1 unit).
        const s = variant.scale;
        Array.isArray(s) ? model.scale.multiply(new THREE.Vector3(...s)) : model.scale.multiplyScalar(s);
      }
      // Optional nudge in metres, e.g. sink a tile's base plate into the ground.
      if (variant.offset) model.position.add(new THREE.Vector3(...variant.offset));
      // Tripo/generated exports mark every material doubleSided; on a closed shell that is wasted fill on a phone.
      if (variant.frontSide) model.traverse(o => { if (o.isMesh) [].concat(o.material).forEach(m => { m.side = THREE.FrontSide; }); });
      if (variant.castShadow === false) model.traverse(o => { if (o.isMesh) o.castShadow = false; });
      const root = new THREE.Group();
      root.add(model);
      root.userData.clips = gltf.animations;
      return root;
    }
    const s = variant.size || [1, 1, 1];
    const geo = {
      box: () => new THREE.BoxGeometry(...s),
      sphere: () => new THREE.SphereGeometry(s[0] / 2, 32, 16),
      cylinder: () => new THREE.CylinderGeometry(s[0] / 2, s[0] / 2, s[1], 24),
      capsule: () => new THREE.CapsuleGeometry(s[0] / 2, s[1] - s[0], 8, 16),
      plane: () => new THREE.PlaneGeometry(s[0], s[2]).rotateX(-Math.PI / 2),
      ramp: () => {   // a wedge rising toward +x (Solid slope: true matches it)
        const g = new THREE.BoxGeometry(...s), pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0 && pos.getX(i) < 0) pos.setY(i, -s[1] / 2);
        g.computeVertexNormals();
        return g;
      },
    }[variant.primitive]?.() || new THREE.BoxGeometry(...s);
    if (variant.pivot === 'bottom' && variant.primitive !== 'plane') geo.translate(0, s[1] / 2, 0);   // origin at the base: sits on what it's dropped on
    const mat = new THREE.MeshStandardMaterial({
      map: variant.texture ? proceduralTexture(variant.texture, variant.repeat ?? 8) : null,
      color: variant.color || (variant.texture ? '#ffffff' : '#cccccc'),
      roughness: variant.roughness ?? 0.8,
      metalness: variant.metalness ?? 0,
      emissive: variant.emissive || '#000000',
      ...(variant.opacity < 1 ? { transparent: true, opacity: variant.opacity, depthWrite: false } : {}),   // e.g. trigger volumes
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = variant.castShadow !== false && !(variant.opacity < 1);
    mesh.receiveShadow = !(variant.opacity < 1);
    return mesh;
  }

  buildLight(l) {
    let light;
    if (l.type === 'directional') {
      light = new THREE.DirectionalLight(l.color || '#ffffff', l.intensity ?? 2);
      light.castShadow = true;
      const ultra = this.tier === 'desktop';
      light.shadow.mapSize.set(ultra ? 2048 : 1024, ultra ? 2048 : 1024);
      const r = l.shadowRadius ?? 14;   // metres covered around the camera focus
      Object.assign(light.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 80 });
      light.shadow.bias = -0.0004;
      light.shadow.normalBias = 0.03;
      light.shadow.radius = ultra ? 4 : 2;
      this.scene.add(light.target);
      this.shadowLights = [...(this.shadowLights || []), light];
      if (l.shadows === false) light.castShadow = false;
    } else if (l.type === 'point' || l.type === 'spot') {
      // Lamps, torches, spotlights. Shadows are off unless asked for (each one costs a shadow pass on a phone).
      light = l.type === 'point'
        ? new THREE.PointLight(l.color || '#ffd9a0', l.intensity ?? 20, l.distance ?? 10, 2)
        : new THREE.SpotLight(l.color || '#ffffff', l.intensity ?? 40, l.distance ?? 15, THREE.MathUtils.degToRad(l.angle ?? 35), l.penumbra ?? 0.3, 2);
      if (light.isSpotLight) { light.add(light.target); light.target.position.set(0, -1, 0); }   // aims down; rotate the entity to aim
      if (l.shadows) { light.castShadow = true; light.shadow.mapSize.set(512, 512); light.shadow.bias = -0.0005; }
    } else if (l.type === 'hemisphere') {
      light = new THREE.HemisphereLight(l.color || '#ffffff', l.groundColor || '#444444', l.intensity ?? 1);
    } else {
      light = new THREE.AmbientLight(l.color || '#ffffff', l.intensity ?? 0.5);
    }
    return light;
  }

  async load(sceneData) {
    this.data = sceneData;
    const st = sceneData.settings || {};
    this.rng = createRng(playSeed(st));
    this.scene.background = new THREE.Color(st.background || '#202833');
    if (st.fog) this.scene.fog = new THREE.Fog(st.fogColor || st.background || '#202833', st.fog[0], st.fog[1]);

    // Prefabs: { name: "./prefabs/name.prefab.json" } loaded once per World.
    this.prefabs = {};
    for (const [name, url] of Object.entries(sceneData.prefabs || {})) {
      this.prefabs[name] = typeof url === 'string' ? await (await fetch(url)).json() : url;
    }

    for (const authored of sceneData.entities) await this.buildEntity(authored, null);
    this.look = st.look || 'toon';

    if (st.sky) applySky(this, st.sky);
    applyLook(this, this.look);

    // Behaviors attach after every object exists, so they can find each other.
    const all = [...this.entities.values()];
    all.forEach(ent => this.attachBehaviors(ent));
    all.forEach(ent => ent.behaviors.forEach(b => b.start()));
  }

  attachBehaviors(ent) {
    for (const b of ent.resolved.behaviors || []) {
      const Cls = getBehavior(b.type);
      if (!Cls) { console.warn(`Unknown behavior "${b.type}" on ${ent.id}`); continue; }
      ent.behaviors.push(new Cls(ent, b.params, this));
    }
  }

  // One authored entity (prefab merged) and its children, depth-first. Children's transforms are relative to the
  // parent's object; a prefab's own children come with every instance (ids prefixed with the instance id).
  // opts.spawned marks runtime-only entities (world.spawn) — never in the scene file.
  async buildEntity(authored, parentEnt, { spawned = false, prefix = null } = {}) {
    const pf = authored.prefab ? await this.loadPrefab(authored.prefab) : null;
    const e = pf ? mergeEntity(pf, authored) : authored;
    const id = prefix ? childIdFor(prefix, e.id) : e.id;   // prefix: the instance id, for a prefab file's children
    // An asset can be a key into scene assets, or defined inline (prefabs do this).
    const assetDef = typeof e.asset === 'object' ? e.asset : this.data?.assets?.[e.asset];
    let variant = e.light ? null : this.resolveVariant(assetDef), character = null;
    if (variant?.character) {                     // character.json: model + clip roles (runtime/character.js)
      if (!this.characterCache.has(variant.character)) this.characterCache.set(variant.character, fetch(variant.character).then(r => r.json()));
      character = this.characters[variant.character] = await this.characterCache.get(variant.character);
      variant = characterVariant(character, variant);
    }
    const obj = e.light ? this.buildLight(e.light) : await this.buildObject(variant);
    obj.name = id;
    obj.userData.entityId = id;
    if (e.position) obj.position.fromArray(e.position);
    if (e.rotation) obj.rotation.set(...e.rotation.map(d => THREE.MathUtils.degToRad(d)));
    if (e.scale) obj.scale.fromArray(e.scale);
    (parentEnt ? parentEnt.object3d : this.scene).add(obj);
    const ent = { id, object3d: obj, data: authored, resolved: e, behaviors: [], children: [],
      parent: parentEnt?.id ?? null, depth: parentEnt ? parentEnt.depth + 1 : 0, tags: mergeTags(pf?.tags || [], authored.tags || []),
      prefab: authored.prefab ?? parentEnt?.prefab ?? null };
    if (spawned) ent.spawned = true;
    if (prefix) ent.inherited = true;   // a prefab file's child: not in the scene file, edit the prefab instead
    if (character?.roles) ent.roles = { ...character.roles };
    const stems = entityMotions(character, e);
    if (stems.length && obj.userData.clips && variant?.glb) obj.userData.clips = [...obj.userData.clips, ...await this.loadMotions(obj.children[0], variant, stems)];
    if (obj.userData.clips?.length) ent.anim = this.makeAnimator(obj, obj.userData.clips, e.animation || ent.roles?.idle);
    this.entities.set(id, ent);
    parentEnt?.children.push(id);
    // The instance's own children (authored) plus the prefab's children (renamed per instance; both, so adding a hat keeps the sword).
    for (const c of authored.children || []) await this.buildEntity(c, ent, { spawned, prefix });
    if (pf?.children) for (const c of pf.children) await this.buildEntity(c, ent, { spawned, prefix: id });
    return ent;
  }

  // A prefab by name: the scene's own list first, else prefabs/<name>.prefab.json (children and spawns may use
  // prefabs the scene doesn't list).
  async loadPrefab(name) {
    if (!this.prefabs[name]) {
      const url = this.data?.prefabs?.[name] || `./prefabs/${name}.prefab.json`;
      this.prefabs[name] = typeof url === 'string' ? await (await fetch(url)).json() : url;
    }
    return this.prefabs[name];
  }

  // ---- runtime entities (behaviors call these; nothing here is ever saved to the scene file)
  // world.spawn('coin', { position: [x, y, z], rotation, scale, parent: 'id', id, tags }) → Promise<entity>
  async spawn(prefab, { position, rotation, scale, parent, id, tags } = {}) {
    await this.loadPrefab(prefab);
    const parentEnt = parent ? this.entities.get(parent) : null;
    if (parent && !parentEnt) throw new Error(`spawn: no parent "${parent}"`);
    const authored = { id: id && !this.entities.has(id) ? id : spawnId(new Set(this.entities.keys()), prefab, (this.spawnSeq ||= {})), prefab,
      ...(position ? { position } : {}), ...(rotation ? { rotation } : {}), ...(scale ? { scale } : {}), ...(tags ? { tags } : {}) };
    const before = new Set(this.entities.keys());
    const ent = await this.buildEntity(authored, parentEnt, { spawned: true });
    applyLookTo(ent.object3d, this.look || 'toon');
    const added = [...this.entities.values()].filter(x => !before.has(x.id));
    added.forEach(x => this.attachBehaviors(x));
    added.forEach(x => x.behaviors.forEach(b => b.start()));
    this.emit('spawned', ent.id);
    return ent;
  }

  // Remove an entity and everything under it (spawned or authored — authored ones come back on the next Play).
  destroy(id) {
    const ent = this.entities.get(id);
    if (!ent) return false;
    for (const c of [...ent.children]) this.destroy(c);
    ent.destroyed = true;
    ent.behaviors.forEach(b => b.destroy());
    ent.object3d.removeFromParent();
    if (ent.anim?.mixer) this.mixers = this.mixers.filter(m => m !== ent.anim.mixer);
    const parent = ent.parent && this.entities.get(ent.parent);
    if (parent) parent.children = parent.children.filter(c => c !== id);
    this.entities.delete(id);
    this.emit('destroyed', id);
    return true;
  }

  // Entities matching a tag ('enemy'), a query ({ tag, prefab, id, near: [x,y,z], radius }) or a function.
  find(q) {
    const out = [];
    for (const ent of this.entities.values()) {
      if (ent.destroyed) continue;
      const p = ent.object3d.getWorldPosition(new THREE.Vector3());
      if (matchesQuery({ id: ent.id, tags: ent.tags, prefab: ent.prefab, position: [p.x, p.y, p.z] }, q)) out.push(ent);
    }
    return out;
  }

  // Motion library (runtime/motions.js): fetch each Mixamo clip and retarget it onto this model with the Forge's
  // layer-1 transfer. One retarget per (model, height, stem), shared by every instance. A missing library (Pages, no
  // dev server) or a missing clip is a warning, never a broken scene.
  async loadMotions(model, variant, stems) {
    const base = motionsBase(this.data?.settings);
    this.motionCache ||= new Map();
    const out = await Promise.all(stems.map(stem => {
      const key = `${variant.glb}|${variant.height ?? ''}|${stem}`;
      if (!this.motionCache.has(key)) this.motionCache.set(key, (async () => {
        const url = motionUrl(base, stem);
        if (!this.gltfCache.has(url)) this.gltfCache.set(url, this.loader.loadAsync(url));
        const src = await this.gltfCache.get(url);
        if (!src.animations?.length) throw new Error('no animation in ' + url);
        // Library clips carry no skin, so the loader makes plain nodes; retargetClip clones its input and looks for real
        // Bones (the Forge sets isBone on a copy instead, which a clone would lose). Rebuild the rig as THREE.Bones once.
        src.boneRig ||= asBones(src.scene);
        return retargetClip(src.boneRig, src.animations[0], model, { name: stem });
      })().catch(err => { (this.motionErrors ||= []).push(`${stem}: ${err.message || err}`); console.warn('[motions]', stem, err.message || err); return null; }));
      return this.motionCache.get(key);
    }));
    return out.filter(Boolean);
  }

  // Animation API handed to behaviors as entity.anim — keeps behaviors free of three.
  makeAnimator(root, clips, startClip) {
    const mixer = new THREE.AnimationMixer(root);
    this.mixers.push(mixer);
    let current = null, currentName = null;
    const anim = {
      mixer,
      clips: clips.map(c => c.name),
      get current() { return currentName; },
      play(name, { fade = 0.2, once = false, speed = 1, restart = false } = {}) {   // restart: replay even if it's playing
        if (name === currentName && !restart) return;
        const clip = THREE.AnimationClip.findByName(clips, name);
        if (!clip) return;
        const action = mixer.clipAction(clip);
        action.reset();
        action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat);
        action.clampWhenFinished = once;
        action.timeScale = speed;
        action.fadeIn(fade).play();
        if (current && current !== action) current.fadeOut(fade);
        current = action; currentName = name;
      },
    };
    anim.play(startClip || (anim.clips.includes('Idle') ? 'Idle' : anim.clips[0]), { fade: 0 });
    return anim;
  }

  // Keep the shadow box centred on what the camera is looking at, so shadows stay crisp anywhere.
  followFocus(focus) {
    const dir = this.sunDirection || new THREE.Vector3(0.4, 1, 0.3).normalize();
    for (const l of this.shadowLights || []) {
      l.target.position.copy(focus);
      l.position.copy(focus).addScaledVector(dir, 30);
    }
  }

  // Runs in edit mode too, so authored animations preview while placing things.
  // Edit mode (playing = false) previews at normal speed; in play, animation follows time.scale / pause / hit-stop.
  animate(dt, playing = true) { const d = playing ? this.time.visualDt(dt) : dt; this.mixers.forEach(m => m.update(d)); }

  // Gameplay: behaviors update in fixed steps (world.time.step, 1/60 s) whatever the frame rate; between steps the
  // moving entities are drawn interpolated (position + rotation), so 120 Hz screens stay smooth.
  update(dt) {
    const time = this.time, n = time.advance(dt);
    const movers = time.interpolate ? [...this.entities.values()].filter(e => e.behaviors.length && e.object3d && !e.destroyed) : [];
    for (const e of movers) {                     // undo last frame's blend — unless something else moved it since
      const l = e.lerp, o = e.object3d; if (!l) continue;
      if (o.position.equals(l.ps) && o.quaternion.equals(l.qs)) { o.position.copy(l.p1); o.quaternion.copy(l.q1); }
      else { l.p0.copy(o.position); l.p1.copy(o.position); l.q0.copy(o.quaternion); l.q1.copy(o.quaternion); }   // live-link move, respawn…
    }
    for (let i = 0; i < n; i++) {
      if (i === n - 1) for (const e of movers) {
        const l = (e.lerp ||= { p0: new THREE.Vector3(), q0: new THREE.Quaternion(), p1: new THREE.Vector3(), q1: new THREE.Quaternion(), ps: new THREE.Vector3(), qs: new THREE.Quaternion() });
        l.p0.copy(e.object3d.position); l.q0.copy(e.object3d.quaternion);
      }
      this.t = time.tick();
      for (const ent of this.entities.values()) { if (!ent.destroyed) for (const b of ent.behaviors) { if (ent.destroyed) break; b.update(time.step, this.t); } }
      if (i === n - 1) for (const e of movers) { e.lerp.p1.copy(e.object3d.position); e.lerp.q1.copy(e.object3d.quaternion); }
    }
    for (const e of movers) {
      const l = e.lerp; if (!l) continue;
      // a teleport (respawn, live-link move) shouldn't smear across the screen
      if (l.p0.distanceToSquared(l.p1) > 4) { l.p0.copy(l.p1); l.q0.copy(l.q1); }
      e.object3d.position.lerpVectors(l.p0, l.p1, time.alpha);
      e.object3d.quaternion.slerpQuaternions(l.q0, l.q1, time.alpha);
      l.ps.copy(e.object3d.position); l.qs.copy(e.object3d.quaternion);
    }
  }

  dispose() {
    for (const ent of this.entities.values()) ent.behaviors.forEach(b => b.destroy());
    this.scene.traverse(o => { o.geometry?.dispose(); [].concat(o.material || []).forEach(m => m.dispose()); });
    this.entities.clear();
    this.mixers.forEach(m => m.stopAllAction());
    this.mixers = [];
  }
}
