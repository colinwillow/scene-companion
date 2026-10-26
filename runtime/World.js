// Builds a Three.js scene from a scene file and runs its behaviors.
// The scene data object is the single source of truth: the editor edits it,
// Play builds a fresh runtime from it, Stop throws the runtime away.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { getBehavior } from './registry.js';
import { applyLook } from './look.js';
import { mergeEntity } from './prefabs.js';

const TIER_ORDER = { web: 0, desktop: 1 };

export class World {
  constructor(renderer, { tier = 'web' } = {}) {
    this.renderer = renderer;
    this.tier = tier;
    this.scene = new THREE.Scene();
    this.entities = new Map();
    this.listeners = {};
    this.loader = new GLTFLoader();
    this.gltfCache = new Map();   // path → Promise<gltf>, so many entities share one download
    this.mixers = [];
    this.t = 0;
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
        const box = new THREE.Box3().setFromObject(model);
        const h = box.max.y - box.min.y || 1;
        model.scale.multiplyScalar(variant.height / h);
        box.setFromObject(model);
        model.position.y -= box.min.y;
      }
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
    }[variant.primitive]?.() || new THREE.BoxGeometry(...s);
    const mat = new THREE.MeshStandardMaterial({
      color: variant.color || '#cccccc',
      roughness: variant.roughness ?? 0.8,
      metalness: variant.metalness ?? 0,
      emissive: variant.emissive || '#000000',
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }

  buildLight(l) {
    let light;
    if (l.type === 'directional') {
      light = new THREE.DirectionalLight(l.color || '#ffffff', l.intensity ?? 2);
      light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024);
      Object.assign(light.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15 });
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
    if (st.fog) this.scene.fog = new THREE.Fog(st.background || '#202833', st.fog[0], st.fog[1]);

    // Prefabs: { name: "./prefabs/name.prefab.json" } loaded once per World.
    this.prefabs = {};
    for (const [name, url] of Object.entries(sceneData.prefabs || {})) {
      this.prefabs[name] = typeof url === 'string' ? await (await fetch(url)).json() : url;
    }

    for (const authored of sceneData.entities) {
      const e = authored.prefab ? mergeEntity(this.prefabs[authored.prefab], authored) : authored;
      // An asset can be a key into scene assets, or defined inline (prefabs do this).
      const assetDef = typeof e.asset === 'object' ? e.asset : sceneData.assets?.[e.asset];
      const obj = e.light ? this.buildLight(e.light) : await this.buildObject(this.resolveVariant(assetDef));
      obj.name = e.id;
      obj.userData.entityId = e.id;
      if (e.position) obj.position.fromArray(e.position);
      if (e.rotation) obj.rotation.set(...e.rotation.map(d => THREE.MathUtils.degToRad(d)));
      if (e.scale) obj.scale.fromArray(e.scale);
      this.scene.add(obj);
      const ent = { id: e.id, object3d: obj, data: authored, resolved: e, behaviors: [] };
      if (obj.userData.clips?.length) ent.anim = this.makeAnimator(obj, obj.userData.clips, e.animation);
      this.entities.set(e.id, ent);
    }

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
      play(name, { fade = 0.2, once = false } = {}) {
        if (name === currentName) return;
        const clip = THREE.AnimationClip.findByName(clips, name);
        if (!clip) return;
        const action = mixer.clipAction(clip);
        action.reset();
        action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat);
        action.clampWhenFinished = once;
        action.fadeIn(fade).play();
        if (current) current.fadeOut(fade);
        current = action; currentName = name;
      },
    };
    anim.play(startClip || (anim.clips.includes('Idle') ? 'Idle' : anim.clips[0]), { fade: 0 });
    return anim;
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
