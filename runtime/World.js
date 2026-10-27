// Builds a Three.js scene from a scene file and runs its behaviors.
// The scene data object is the single source of truth: the editor edits it,
// Play builds a fresh runtime from it, Stop throws the runtime away.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { getBehavior } from './registry.js';
import { applyLook } from './look.js';
import { mergeEntity } from './prefabs.js';
import { applySky } from './sky.js';
import { proceduralTexture } from './textures.js';
import { characterVariant } from './character.js';

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
    this.mixers = [];
    this.t = 0;
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
    this.scene.background = new THREE.Color(st.background || '#202833');
    if (st.fog) this.scene.fog = new THREE.Fog(st.fogColor || st.background || '#202833', st.fog[0], st.fog[1]);

    // Prefabs: { name: "./prefabs/name.prefab.json" } loaded once per World.
    this.prefabs = {};
    for (const [name, url] of Object.entries(sceneData.prefabs || {})) {
      this.prefabs[name] = typeof url === 'string' ? await (await fetch(url)).json() : url;
    }

    for (const authored of sceneData.entities) {
      const e = authored.prefab ? mergeEntity(this.prefabs[authored.prefab], authored) : authored;
      // An asset can be a key into scene assets, or defined inline (prefabs do this).
      const assetDef = typeof e.asset === 'object' ? e.asset : sceneData.assets?.[e.asset];
      let variant = e.light ? null : this.resolveVariant(assetDef), character = null;
      if (variant?.character) {                     // character.json: model + clip roles (runtime/character.js)
        if (!this.characterCache.has(variant.character)) this.characterCache.set(variant.character, fetch(variant.character).then(r => r.json()));
        character = await this.characterCache.get(variant.character);
        variant = characterVariant(character, variant);
      }
      const obj = e.light ? this.buildLight(e.light) : await this.buildObject(variant);
      obj.name = e.id;
      obj.userData.entityId = e.id;
      if (e.position) obj.position.fromArray(e.position);
      if (e.rotation) obj.rotation.set(...e.rotation.map(d => THREE.MathUtils.degToRad(d)));
      if (e.scale) obj.scale.fromArray(e.scale);
      this.scene.add(obj);
      const ent = { id: e.id, object3d: obj, data: authored, resolved: e, behaviors: [] };
      if (character?.roles) ent.roles = { ...character.roles };
      if (obj.userData.clips?.length) ent.anim = this.makeAnimator(obj, obj.userData.clips, e.animation || ent.roles?.idle);
      this.entities.set(e.id, ent);
    }

    if (st.sky) applySky(this, st.sky);
    applyLook(this, st.look || 'toon');

    // Behaviors attach after every object exists, so they can find each other.
    for (const ent of this.entities.values()) {
      for (const b of ent.resolved.behaviors || []) {
        const Cls = getBehavior(b.type);
        if (!Cls) { console.warn(`Unknown behavior "${b.type}" on ${ent.id}`); continue; }
        ent.behaviors.push(new Cls(ent, b.params, this));
      }
    }
    for (const ent of this.entities.values()) ent.behaviors.forEach(b => b.start());
  }

  // Animation API handed to behaviors as entity.anim — keeps behaviors free of three.
  makeAnimator(root, clips, startClip) {
    const mixer = new THREE.AnimationMixer(root);
    this.mixers.push(mixer);
    let current = null, currentName = null;
    const anim = {
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
  animate(dt) { this.mixers.forEach(m => m.update(dt)); }

  update(dt) {
    this.t += dt;
    for (const ent of this.entities.values()) ent.behaviors.forEach(b => b.update(dt, this.t));
  }

  dispose() {
    for (const ent of this.entities.values()) ent.behaviors.forEach(b => b.destroy());
    this.scene.traverse(o => { o.geometry?.dispose(); [].concat(o.material || []).forEach(m => m.dispose()); });
    this.entities.clear();
    this.mixers.forEach(m => m.stopAllAction());
    this.mixers = [];
  }
}
