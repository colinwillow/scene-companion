// Builds a Three.js scene from a scene file and runs its behaviors.
// The scene data object is the single source of truth: the editor edits it,
// Play builds a fresh runtime from it, Stop throws the runtime away.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { retargetClip } from './retarget.js';
import { entityMotions, motionsBase, motionUrl } from './motions.js';
import { raycast, sweep, overlap, lineClear } from './collide.js';
import { bodyMasks, eventsCrossed, DEFAULT_MASK_ROOTS, mergeClipVariants, mergeEvents } from './animlayers.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { getBehavior, registerBehavior } from './registry.js';
import { Behavior } from './Behavior.js';
import { parseRef, satisfies, checkManifest } from './extensions.js';
import { ENGINE } from './version.js';
import { applyLook, applyLookTo } from './look.js';
import { mergeEntity } from './prefabs.js';
import { applySky } from './sky.js';
import { proceduralTexture } from './textures.js';
import { frameUV, normClips } from './sprites.js';
import { cellCentre } from './tilemap.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { characterVariant } from './character.js';
import { childIdFor, mergeTags, matchesQuery, spawnId } from './tree.js';
import { createTime, createRng, playSeed } from './time.js';
import { colliderKind, fitColliders } from './colliders.js';

// A copy of a node tree where every mixamorig_* node is a real THREE.Bone (same name and rest transform).
function asBones(node) {
  const out = /^mixamorig/.test(node.name) ? new THREE.Bone() : new THREE.Object3D();
  out.name = node.name; out.position.copy(node.position); out.quaternion.copy(node.quaternion); out.scale.copy(node.scale);
  for (const c of node.children) out.add(asBones(c));
  return out;
}

const TIER_ORDER = { web: 0, desktop: 1 };

const GLTF_CACHE = new Map(), MOTION_CACHE = new Map();
const SHARED = new WeakSet();   // geometries + materials owned by the caches: a World's dispose() must not free them
let LOADER = null;
function sharedLoader() {
  if (LOADER) return LOADER;
  LOADER = new GLTFLoader();
  // Colin's characters are Draco-compressed. The decoder is vendored next to the pages so it works offline.
  if (typeof document !== 'undefined') {
    const draco = new DRACOLoader();
    draco.setDecoderPath(new URL('../vendor/draco/', import.meta.url).href);
    LOADER.setDRACOLoader(draco);
  }
  return LOADER;
}
export function markShared(gltf) {
  gltf.scene.traverse(o => { if (o.geometry) SHARED.add(o.geometry); for (const m of [].concat(o.material || [])) SHARED.add(m); });
  return gltf;
}
// Forget cached models (e.g. a GLB was replaced on disk under the same path).
export function clearAssetCache() { GLTF_CACHE.clear(); MOTION_CACHE.clear(); COLLIDER_CACHE.clear(); }
const COLLIDER_CACHE = new Map();   // collision GLB + model transform → fitted colliders (runtime/colliders.js)

export class World {
  constructor(renderer, { tier = 'web' } = {}) {
    this.renderer = renderer;
    this.tier = tier;
    this.scene = new THREE.Scene();
    this.entities = new Map();
    this.listeners = {};
    // One loader, one Draco worker pool and one parsed-GLB cache for the whole page, shared by every World: the editor
    // builds a new World on every structural edit (duplicate, undo, re-parent), and a per-World cache meant downloading,
    // Draco-decoding and re-uploading every model again each time (ROADMAP: "editor rebuild is very slow").
    this.loader = sharedLoader();
    this.gltfCache = GLTF_CACHE;   // path → Promise<gltf>, so many entities (and Worlds) share one download
    this.characterCache = new Map();   // character.json path → Promise<json>
    this.characters = {};              // character.json path → json (loaded), for the editor
    this.mixers = [];
    this.prefabs = {};
    this.t = 0;
    this.time = createTime();      // fixed-step gameplay clock: scale, paused, hitStop (runtime/time.js)
    this.rng = createRng(1);       // reseeded per load (= per Play) from settings.seed or a fresh seed
    this.input = { move: [0, 0], jump: false };   // filled by the game page; read by behaviors
  }

  // ---- collision queries for behaviors (runtime/collide.js), against every Solid in the world
  raycast(origin, dir, opts) { return raycast(this.solids || [], origin, dir, opts); }
  sweep(origin, dir, radius, opts) { return sweep(this.solids || [], origin, dir, radius, opts); }
  overlap(center, radius, opts) { return overlap(this.solids || [], center, radius, opts); }
  lineClear(a, b, opts) { return lineClear(this.solids || [], a, b, opts); }

  // ---- events (score, etc.)
  // Listeners a behavior adds (in start) are remembered, so reset() can drop them and keep the page's own.
  on(name, fn) { (this.listeners[name] ||= []).push(fn); if (this.starting) (this.owned ||= new Set()).add(fn); }
  startBehaviors(ents) { this.starting = true; try { ents.forEach(ent => ent.behaviors.forEach(b => b.start())); } finally { this.starting = false; } }
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
      if (!this.gltfCache.has(variant.glb)) this.gltfCache.set(variant.glb, this.loader.loadAsync(variant.glb).then(markShared));
      const gltf = await this.gltfCache.get(variant.glb);
      const model = cloneSkinned(gltf.scene);
      model.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = !o.isSkinnedMesh; } });   // a skinned mesh's bounds are its bind pose, so only those stay unculled
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
    if (variant.sprite) return this.buildSprite(variant);
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
      // a QUARTER PIPE: a curved transition rising toward +x (radius = height, `sweep` degrees, default 85), a flat deck
      // behind it, width along z. Its curve is real triangles — give it a Surface to ride it (a Solid would be a box).
      quarterpipe: () => {
        const [w, h, d] = s, R = h, sweep = (variant.sweep ?? 85) * Math.PI / 180, n = 16, run = R * Math.sin(sweep), deck = Math.max(0.3, w - run);
        const sh = new THREE.Shape(); sh.moveTo(-w / 2, -h / 2);
        for (let i = 0; i <= n; i++) { const a = sweep * i / n; sh.lineTo(-w / 2 + R * Math.sin(a), -h / 2 + R * (1 - Math.cos(a))); }
        const topY = -h / 2 + R * (1 - Math.cos(sweep));
        sh.lineTo(-w / 2 + run + deck, topY); sh.lineTo(-w / 2 + run + deck, -h / 2); sh.lineTo(-w / 2, -h / 2);
        const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false, curveSegments: 1 });
        g.translate(0, 0, -d / 2); g.computeVertexNormals();
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

  // A sprite (runtime/sprites.js): a quad standing on the origin, facing +z whatever way the body turns, one frame of its sheet
  // showing. root.userData.sprite = { clips, setFrame(i), face(yaw) } — SpriteAnimator drives it; the texture is per instance.
  async buildSprite(variant) {
    this.spriteTex ||= new Map();
    if (!this.spriteTex.has(variant.sprite)) this.spriteTex.set(variant.sprite, new THREE.TextureLoader().loadAsync(variant.sprite).catch(() => null));
    const base = await this.spriteTex.get(variant.sprite);
    const [cols, rows] = variant.frames || [1, 1], [w, h] = variant.size || [1, 1];
    const tex = base ? base.clone() : null;
    if (tex) {
      tex.colorSpace = THREE.SRGBColorSpace;
      if (variant.pixel !== false) { tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; }
      tex.needsUpdate = true;
    }
    const opts = { map: tex, color: tex ? '#ffffff' : '#ff00ff', alphaTest: 0.5, side: THREE.DoubleSide };
    const mat = variant.lit ? new THREE.MeshStandardMaterial({ ...opts, roughness: 1 }) : new THREE.MeshBasicMaterial(opts);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0), mat);
    mesh.castShadow = false; mesh.receiveShadow = !!variant.lit;
    const root = new THREE.Group(); root.add(mesh);
    let frame = -1, flip = 1;
    const sprite = { clips: normClips(variant.clips), cols, rows, mesh,
      setFrame(i) { if (i === frame || !tex) return; frame = i; const uv = frameUV(i, cols, rows); tex.offset.fromArray(uv.offset); tex.repeat.fromArray(uv.repeat); },
      face(yaw) { const sx = Math.sin(yaw); if (Math.abs(sx) > 0.01) flip = sx < 0 ? -1 : 1; mesh.rotation.y = -yaw; mesh.scale.x = (variant.flip === false ? 1 : flip) * (variant.mirror ? -1 : 1); },   // the art faces right; mirror: it faces left
      get frame() { return frame; } };
    sprite.setFrame(variant.frame ?? 0);
    root.userData.sprite = sprite;
    return root;
  }

  // A Tilemap's picture: every tile a box (cell × cell × depth) whose faces show its frame of the sheet (or its colour),
  // merged into ONE mesh under the entity, replacing the last one. Called again whenever the map is painted or moved.
  async drawTiles(ent, { cells, nRows, cell, depth, plane, sheet, frames }) {
    const token = (ent.tileToken = (ent.tileToken || 0) + 1);
    let tex = null;
    if (sheet) {
      this.spriteTex ||= new Map();
      if (!this.spriteTex.has(sheet)) this.spriteTex.set(sheet, new THREE.TextureLoader().loadAsync(sheet).then(t => {
        t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; return t; }).catch(() => null));
      tex = await this.spriteTex.get(sheet);
      if (token !== ent.tileToken) return;                 // painted again while the sheet loaded
    }
    const [cols, rows] = frames || [1, 1], col = new THREE.Color(), geos = [];
    for (const t of cells) {
      const g = new THREE.BoxGeometry(cell, cell, plane === 'top' ? cell : depth), uv = g.attributes.uv, f = frameUV(t.frame, cols, rows);
      for (let i = 0; i < uv.count; i++) uv.setXY(i, f.offset[0] + uv.getX(i) * f.repeat[0], f.offset[1] + uv.getY(i) * f.repeat[1]);
      col.set(t.color || (tex ? '#ffffff' : '#8a7a66'));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).map((_, i) => [col.r, col.g, col.b][i % 3]), 3));
      g.translate(...cellCentre(t.c, t.r, nRows, { cell, depth, plane }));
      geos.push(g);
    }
    const old = ent.object3d.getObjectByName('__tiles');
    if (old) { old.geometry.dispose(); old.material.dispose(); ent.object3d.remove(old); }
    if (!geos.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.9 }));
    geos.forEach(g => g.dispose());
    mesh.name = '__tiles'; mesh.castShadow = mesh.receiveShadow = true; mesh.userData.entityId = ent.id;
    ent.object3d.add(mesh);
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
    this.vars = { ...(sceneData.settings?.variables || {}) };   // Reactions' world variables, fresh each Play
    const st = sceneData.settings || {};
    this.rng = createRng(playSeed(st));
    this.scene.background = new THREE.Color(st.background || '#202833');
    if (st.fog) this.scene.fog = new THREE.Fog(st.fogColor || st.background || '#202833', st.fog[0], st.fog[1]);

    // Prefabs: { name: "./prefabs/name.prefab.json" } loaded once per World.
    this.prefabs = {};
    for (const [name, url] of Object.entries(sceneData.prefabs || {})) {
      this.prefabs[name] = typeof url === 'string' ? await (await fetch(url)).json() : url;
    }

    await this.loadExtensions(sceneData.extensions);
    for (const authored of sceneData.entities) await this.buildEntity(authored, null);
    this.look = st.look || 'toon';

    if (st.sky) applySky(this, st.sky);
    applyLook(this, this.look);

    // Behaviors attach after every object exists, so they can find each other.
    const all = [...this.entities.values()];
    all.forEach(ent => this.attachBehaviors(ent));
    this.startBehaviors(all);
    this.fitSkinnedBounds();
    this.ready = true;   // fully built (the editor ignores Play until then)
  }

  // A scene's extensions ("extensions": ["wobble", "id@^1.2.0"], runtime/extensions.js): each manifest checked against this
  // engine and the range asked for, its entry imported and handed { Behavior, define } — define() registers only the names
  // the manifest lists, and never over a built-in. Failures go to world.extensionErrors; the rest of the scene still loads.
  async loadExtensions(refs = []) {
    this.extensionErrors = [];
    const base = this.extensionsBase || './extensions/', here = globalThis.location?.href || import.meta.url;
    World.extOwned ||= new Map();                          // behavior name → extension id (the registry is shared)
    for (const ref of refs || []) {
      const { id, range } = parseRef(ref);
      try {
        const url = new URL(`${base}${id}/`, here), m = await (await fetch(new URL('extension.json', url))).json();
        const bad = checkManifest(m, { engine: ENGINE }).filter(p => p.level === 'error').map(p => p.msg);
        if (!satisfies(m.version, range)) bad.push(`version ${m.version} is not ${range}`);
        if (bad.length) throw new Error(bad.join('; '));
        const mod = await import(new URL(m.entry, url).href), defined = [];
        await mod.default({ Behavior, helpers: {}, define: (name, cls) => {
          if (!m.behaviors.includes(name)) throw new Error(`defines "${name}", which extension.json does not list`);
          if (getBehavior(name) && World.extOwned.get(name) !== id) throw new Error(`"${name}" is already a behavior`);
          if (!(cls?.prototype instanceof Behavior)) throw new Error(`"${name}" must extend the Behavior it is handed`);
          if (!cls.name || cls.name !== name) Object.defineProperty(cls, 'name', { value: name });   // an anonymous class reads as its behavior
          registerBehavior(name, cls); World.extOwned.set(name, id); defined.push(name);
        } });
        const missing = m.behaviors.filter(b => !defined.includes(b));
        if (missing.length) throw new Error(`listed but never defined: ${missing.join(', ')}`);
      } catch (e) { this.extensionErrors.push(`extension ${id}: ${e.message}`); console.warn(`Scene Companion: extension ${id}: ${e.message}`); }
    }
  }

  attachBehaviors(ent) {
    if (ent.colliders?.length && getBehavior('CollisionMesh')) ent.behaviors.push(new (getBehavior('CollisionMesh'))(ent, { colliders: ent.colliders }, this));
    for (const b of ent.resolved.behaviors || []) {
      const Cls = getBehavior(b.type);
      if (!Cls) { console.warn(`Unknown behavior "${b.type}" on ${ent.id}`); continue; }
      ent.behaviors.push(new Cls(ent, b.params, this));
    }
  }

  // A collision GLB (an asset variant's `collision`) → fitted colliders in the model's space: every bld_ / solid_ / prop_ /
  // deck_ / ground_ / road_ / ramp_ mesh (runtime/colliders.js), put through the same scale/offset as the visual model.
  // Cached per file + model transform; the file is read once (gltfCache).
  async loadColliders(url, model) {
    model?.updateMatrix();
    const key = `${url}|${model ? model.matrix.elements.map(v => v.toFixed(5)).join(',') : ''}`;
    if (!(this.colliderCache ||= COLLIDER_CACHE).has(key)) this.colliderCache.set(key, (async () => {
      if (!this.gltfCache.has(url)) this.gltfCache.set(url, this.loader.loadAsync(url).then(markShared));
      const gltf = await this.gltfCache.get(url);
      gltf.scene.updateMatrixWorld(true);
      const meshes = [], v = new THREE.Vector3(), M = new THREE.Matrix4();
      gltf.scene.traverse(o => {
        if (!o.isMesh) return;
        const name = colliderKind(o.name) ? o.name : colliderKind(o.parent?.name) ? o.parent.name : null;
        if (!name) return;
        M.copy(o.matrixWorld); if (model) M.premultiply(model.matrix);
        const pos = o.geometry.attributes.position, pts = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(M); pts[i * 3] = v.x; pts[i * 3 + 1] = v.y; pts[i * 3 + 2] = v.z; }
        meshes.push({ name, points: pts });
      });
      return fitColliders(meshes);
    })());
    return this.colliderCache.get(key);
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
    const colliders = variant?.collision && variant.glb ? await this.loadColliders(variant.collision, obj.children[0]) : null;
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
    if (colliders) ent.colliders = colliders;   // attachBehaviors adds a CollisionMesh for them
    if (prefix) ent.inherited = true;   // a prefab file's child: not in the scene file, edit the prefab instead
    if (character?.roles) ent.roles = { ...character.roles };
    const baked = new Set((obj.userData.clips || []).map(c => c.name));   // tools/bake-motions.mjs puts them in the GLB
    const stems = entityMotions(character, e).filter(m => !baked.has(m));
    if (stems.length && obj.userData.clips && variant?.glb) obj.userData.clips = [...obj.userData.clips, ...await this.loadMotions(obj.children[0], variant, stems)];
    const variants = mergeClipVariants(character, e);
    if (Object.keys(variants).length && obj.userData.clips?.length) obj.userData.clips = [...obj.userData.clips, ...this.clipVariants(obj, obj.userData.clips, variants, character?.masks)];
    if (obj.userData.sprite) ent.sprite = obj.userData.sprite;
    if (obj.userData.clips?.length) ent.anim = this.makeAnimator(obj, obj.userData.clips, e.animation || ent.roles?.idle,
      { masks: character?.masks, events: mergeEvents(character, e), emit: (name, info) => this.emit(name, id, info) });
    this.entities.set(id, ent);
    parentEnt?.children.push(id);
    // The instance's own children (authored) plus the prefab's children (renamed per instance; both, so adding a hat keeps the sword).
    for (const c of authored.children || []) await this.buildEntity(c, ent, { spawned, prefix });
    if (pf?.children) for (const c of pf.children) await this.buildEntity(c, ent, { spawned, prefix: id });
    return ent;
  }

  // Skinned meshes get a real bounding sphere (three skins every vertex through the bones once) with `room` × headroom for a
  // flip or a wall run, and are culled like everything else — the loader leaves them unculled because their stored bounds are
  // the bind pose, which for Colin's rigs (armature 0.01) is nowhere near the body.
  fitSkinnedBounds(root = this.scene, room = 1.6) {
    root.updateMatrixWorld(true);
    root.traverse(o => {
      if (!o.isSkinnedMesh || o.userData.fitBounds) return;
      o.skeleton?.update?.(); o.computeBoundingSphere();
      if (!(o.boundingSphere?.radius > 0)) return;
      o.boundingSphere.radius *= room; o.userData.fitBounds = true; o.frustumCulled = true;
    });
  }

  // Instance repeated STATIC props (Play only): entities sharing one asset, with no behaviors that move or change them (only
  // Solid / Surface / CollisionMesh), no children and no animation, become one InstancedMesh per mesh of the model — eleven trees
  // are a handful of draws instead of eleven times as many. The entities stay (their colliders, picking by id); only their meshes
  // are hidden. Call again after a live edit: it undoes the last pass first. → how many entities were instanced.
  instanceStatic(min = 4) {
    this.unInstance();
    const STATIC = new Set(['Solid', 'Surface', 'CollisionMesh']), groups = new Map();
    for (const e of this.entities.values()) {
      if (e.parent || e.children.length || e.anim || e.data?.light || e.object3d.visible === false) continue;
      if (!e.behaviors.every(b => STATIC.has(b.constructor.name))) continue;
      const key = typeof e.resolved?.asset === 'string' ? e.resolved.asset : e.prefab || (e.resolved?.asset ? JSON.stringify(e.resolved.asset) : null);
      if (!key) continue;
      (groups.get(key) || groups.set(key, []).get(key)).push(e);
    }
    this.instanced = []; let n = 0;
    for (const list of groups.values()) {
      if (list.length < min) continue;
      const per = list.map(e => { const m = []; e.object3d.updateMatrixWorld(true); e.object3d.traverse(o => { if (o.isMesh) m.push(o); }); return m; });
      const k = per[0].length;
      if (!k || per.some(m => m.length !== k || m.some(o => o.isSkinnedMesh || o.isInstancedMesh || !o.visible))) continue;
      for (let j = 0; j < k; j++) {
        const src = per[0][j], im = new THREE.InstancedMesh(src.geometry, src.material, list.length);
        per.forEach((m, i) => im.setMatrixAt(i, m[j].matrixWorld));
        im.castShadow = src.castShadow; im.receiveShadow = src.receiveShadow; im.name = `instanced:${src.name}`; im.userData.noLook = !!src.userData.noLook;
        im.computeBoundingSphere(); this.scene.add(im); this.instanced.push(im);
      }
      for (const m of per) for (const o of m) { o.visible = false; o.userData.instancedAway = true; }
      n += list.length;
    }
    return n;
  }
  unInstance() {
    for (const im of this.instanced || []) { im.removeFromParent(); im.dispose?.(); }
    this.instanced = [];
    for (const e of this.entities.values()) e.object3d.traverse(o => { if (o.userData.instancedAway) { o.visible = true; delete o.userData.instancedAway; } });
  }

  // Wear another asset's body (zap's DNA gun, `Disguise`): `asset` is a scene asset key (or a prefab id whose asset is used).
  // The entity keeps its object, position, behaviors and collider; its model, clips and roles become the asset's. The old model
  // is kept aside (with anything mounted on its bones) and `wear(id, null)` puts it back. → true when worn.
  async wear(id, asset) {
    const ent = this.entities.get(id); if (!ent) return false;
    const o = ent.object3d, isModel = c => !c.userData?.entityId;
    if (!asset) {                                       // back to his own
      const w = ent.worn; if (!w) return false;
      const cur = o.children.find(isModel); if (cur) o.remove(cur);
      this.mixers = this.mixers.filter(m => m !== ent.anim?.mixer); this.animators = (this.animators || []).filter(a => a !== ent.anim);
      o.add(w.model); ent.anim = w.anim; ent.roles = w.roles; if (w.anim?.mixer) this.mixers.push(w.anim.mixer); if (w.anim) (this.animators ||= []).push(w.anim);
      ent.worn = null; this.emit('wear', id, null); return true;
    }
    let def = typeof asset === 'object' ? asset : this.data?.assets?.[asset];
    if (!def && typeof asset === 'string') { const pf = await this.loadPrefab(asset).catch(() => null); def = typeof pf?.asset === 'object' ? pf.asset : this.data?.assets?.[pf?.asset]; }
    let variant = this.resolveVariant(def), character = null;
    if (!variant) return false;
    if (variant.character) {
      if (!this.characterCache.has(variant.character)) this.characterCache.set(variant.character, fetch(variant.character).then(r => r.json()));
      character = await this.characterCache.get(variant.character); variant = characterVariant(character, variant);
    }
    const root = await this.buildObject(variant);
    if (ent.worn) await this.wear(id, null);           // one disguise at a time
    const own = o.children.find(isModel);
    ent.worn = { model: own, anim: ent.anim, roles: ent.roles };
    if (own) o.remove(own);
    this.mixers = this.mixers.filter(m => m !== ent.anim?.mixer); this.animators = (this.animators || []).filter(a => a !== ent.anim);
    o.add(root);
    ent.roles = character?.roles ? { ...character.roles } : null;
    ent.anim = root.userData.clips?.length ? this.makeAnimator(root, root.userData.clips, ent.roles?.idle, { masks: character?.masks, events: character?.events, emit: (name, info) => this.emit(name, id, info) }) : null;
    this.fitSkinnedBounds(root);
    this.emit('wear', id, asset); return true;
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
    this.startBehaviors(added);
    this.fitSkinnedBounds(ent.object3d);
    this.emit('spawned', ent.id);
    return ent;
  }

  // Build an AUTHORED entity (from the scene file) into a running World — the editor's in-place add / duplicate / undo,
  // instead of rebuilding everything (runtime/livepatch.js patchScene). Same steps as spawn, minus the 'spawned' mark.
  async add(authored, parentId = null) {
    if (authored.prefab) await this.loadPrefab(authored.prefab);
    const parentEnt = parentId ? this.entities.get(parentId) : null;
    if (parentId && !parentEnt) throw new Error(`add: no parent "${parentId}"`);
    const before = new Set(this.entities.keys());
    const ent = await this.buildEntity(authored, parentEnt);
    applyLookTo(ent.object3d, this.look || 'toon');
    if (this.look === 'baked') ent.object3d.traverse(o => { if (o.isLight) o.visible = false; });   // baked draws unlit
    const added = [...this.entities.values()].filter(x => !before.has(x.id));
    added.forEach(x => this.attachBehaviors(x));
    this.startBehaviors(added);
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
    if (ent.anim?.mixer) { this.mixers = this.mixers.filter(m => m !== ent.anim.mixer); this.animators = (this.animators || []).filter(a => a !== ent.anim); }
    const parent = ent.parent && this.entities.get(ent.parent);
    if (parent) parent.children = parent.children.filter(c => c !== id);
    this.entities.delete(id);
    this.emit('destroyed', id);
    return true;
  }

  // Switch the look (toon / baked / pbr) in place: materials are re-made from each model's own, outlines come and go.
  setLook(look) { this.look = look; if (this.data?.settings) this.data.settings.look = look; applyLook(this, look); }

  // Back to the authored scene WITHOUT rebuilding models — the editor's Play / Stop. Behaviors are torn down and made
  // fresh, spawned objects go, destroyed authored ones come back, every transform / visibility / animation / variable /
  // clock / seed returns to what the scene file says. Models, looks and shaders are kept, which is the slow part.
  async reset(sceneData = this.data) {
    this.data = sceneData;
    const st = sceneData.settings || {};
    for (const [name, list] of Object.entries(this.listeners)) this.listeners[name] = list.filter(fn => !this.owned?.has(fn));
    this.owned = new Set();
    for (const ent of this.entities.values()) { ent.behaviors.forEach(b => b.destroy()); ent.behaviors = []; }
    for (const ent of [...this.entities.values()]) if (ent.spawned && this.entities.has(ent.id)) this.destroy(ent.id);
    // authored objects a behavior destroyed (or that are missing): build them again (roots of missing subtrees only)
    const missing = [];
    const authoredById = new Map();
    const walk = (list, parent) => list.forEach(e => {
      authoredById.set(e.id, e);
      if (!this.entities.has(e.id)) missing.push({ e, parent }); else walk(e.children || [], e.id);
    });
    walk(sceneData.entities, null);
    for (const { e, parent } of missing) {
      const ent = await this.buildEntity(e, parent ? this.entities.get(parent) : null);
      applyLookTo(ent.object3d, this.look || 'toon');
    }
    const KEEP = new Set(['id', 'object3d', 'data', 'resolved', 'behaviors', 'children', 'parent', 'depth', 'tags', 'prefab', 'spawned', 'inherited', 'roles', 'anim', 'colliders']);
    for (const ent of this.entities.values()) {
      for (const k of Object.keys(ent)) if (!KEEP.has(k)) delete ent[k];   // defeated, dormant, hp… set by behaviors
      const a = !ent.inherited && authoredById.get(ent.id);   // the latest authored data (edits since the build)
      if (a) { ent.data = a; ent.resolved = a.prefab ? mergeEntity(this.prefabs[a.prefab], a) : a; }
      const o = ent.object3d, e = ent.resolved;
      o.position.fromArray(e.position || [0, 0, 0]);
      o.rotation.set(...(e.rotation || [0, 0, 0]).map(d => THREE.MathUtils.degToRad(d)));
      o.scale.fromArray(e.scale || [1, 1, 1]);
      o.visible = true;
      if (ent.anim) {
        ent.anim.stop('upper', { fade: 0 });
        ent.anim.mixer.stopAllAction();
        ent.anim.play(ent.anim.startClip, { fade: 0, restart: true });
      }
    }
    this.vars = { ...(st.variables || {}) };
    this.rng = createRng(playSeed(st));
    this.time = createTime(); this.t = 0; this.spawnSeq = {};
    this.input = { move: [0, 0], jump: false };
    const all = [...this.entities.values()];
    all.forEach(ent => this.attachBehaviors(ent));
    this.startBehaviors(all);
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
    this.motionCache = MOTION_CACHE;
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
  // Clip variants (runtime/animlayers.js): new clips cut from existing ones — trim (start/end, re-zeroed), rate (times
  // scaled) and a body mask (only that part's tracks). Built once per entity at load; a bad variant is skipped.
  clipVariants(root, clips, variants, masks) {
    const bones = []; root.traverse(o => { if (o.isBone) bones.push({ name: o.name, parent: o.parent?.isBone ? o.parent.name : null }); });
    const split = bodyMasks(bones, masks?.upper || DEFAULT_MASK_ROOTS.upper), out = [];
    for (const [name, v] of Object.entries(variants)) {
      const src = THREE.AnimationClip.findByName(clips, v.from); if (!src) continue;
      const start = Math.max(0, v.start ?? 0), end = Math.min(src.duration, v.end ?? src.duration), rate = v.rate > 0 ? v.rate : 1;
      if (!(end > start)) continue;
      const tracks = [];
      for (const t of src.tracks) {
        if (v.mask && !split[v.mask]?.has(t.name.split('.')[0])) continue;
        const tr = t.clone(); tr.trim(start, end); tr.shift(-start);
        if (tr.times.length < 2) {   // too short to hold keys: sample the pose at start and end
          const I = t.createInterpolant(), a = Array.from(I.evaluate(start)), b = Array.from(I.evaluate(end));
          tr.times = new Float32Array([0, end - start]); tr.values = new Float32Array([...a, ...b]);
        }
        if (rate !== 1) tr.scale(1 / rate);
        tracks.push(tr);
      }
      out.push(new THREE.AnimationClip(name, (end - start) / rate, tracks));
    }
    return out;
  }

  // Two layers. BASE plays on the whole body; UPPER (spine and up, see runtime/animlayers.js) plays on top — and while it
  // does, the base switches to its legs-only copy, so no bone is ever shared by two clips (weights stay summed to 1;
  // averaging two full-body clips is a shrug). Frame events from character.json fire as world events with the entity id.
  //   anim.play(name, { layer: 'base' | 'upper', fade, once, speed, restart })   anim.stop('upper', { fade })
  // A one-shot on the upper layer stops itself when it ends, handing the arms back to the base clip.
  makeAnimator(root, clips, startClip, { masks, events, emit } = {}) {
    const mixer = new THREE.AnimationMixer(root);
    this.mixers.push(mixer);
    const bones = [];
    root.traverse(o => { if (o.isBone) bones.push({ name: o.name, parent: o.parent?.isBone ? o.parent.name : null }); });
    const split = bodyMasks(bones, masks?.upper || DEFAULT_MASK_ROOTS.upper);
    const masked = new Map();   // "name|upper" → clip with only that part's tracks
    const clipFor = (name, part) => {
      const clip = THREE.AnimationClip.findByName(clips, name); if (!clip || !part) return clip;
      const key = `${name}|${part}`;
      if (!masked.has(key)) masked.set(key, new THREE.AnimationClip(`${name}|${part}`, clip.duration,
        clip.tracks.filter(t => split[part].has(t.name.split('.')[0]))));
      return masked.get(key);
    };
    const L = { base: { name: null, action: null, opts: {} }, upper: { name: null, action: null, opts: {} } };
    const start = (clip, { fade = 0.2, once = false, speed = 1 }, time) => {
      const action = mixer.clipAction(clip);
      action.reset();
      action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat);
      action.clampWhenFinished = once;
      action.timeScale = speed;
      if (time !== undefined) action.time = Math.min(time, clip.duration);
      action.fadeIn(fade).play();
      return action;
    };
    // (Re)start the base clip on the right part of the body, keeping its phase when only the mask changes.
    const playBase = (fade, keepTime) => {
      const b = L.base; if (!b.name) return;
      const clip = clipFor(b.name, L.upper.name ? 'lower' : null); if (!clip) return;
      const t = keepTime ? b.action?.time : undefined, old = b.action;
      b.action = start(clip, { ...b.opts, fade }, t);
      if (old && old !== b.action) old.fadeOut(fade);
    };
    const anim = {
      mixer,
      clips: clips.map(c => c.name),
      events: events || {},
      get current() { return L.base.name; },
      layer: part => L[part]?.name ?? null,
      action: (part = 'base') => L[part]?.action ?? null,   // the running AnimationAction (the editor's timeline drives it)
      play(name, { layer = 'base', fade = 0.2, once = false, speed = 1, restart = false } = {}) {
        const l = L[layer]; if (!l) return;
        if (name === l.name && !restart) return;
        if (!THREE.AnimationClip.findByName(clips, name)) return;
        l.prev = 0;                                   // a fresh clip counts its events from the start
        if (layer === 'base') { l.name = name; l.opts = { once, speed }; playBase(fade, false); return; }
        const firstUpper = !L.upper.name, old = l.action;
        l.name = name; l.opts = { once, speed };
        l.action = start(clipFor(name, 'upper'), { fade, once, speed });
        if (old && old !== l.action) old.fadeOut(fade);
        if (firstUpper) playBase(fade, true);       // the base hands its arms over
      },
      stop(layer = 'upper', { fade = 0.2 } = {}) {
        const l = L[layer]; if (!l?.action) return;
        l.action.fadeOut(fade); l.action = null; l.name = null;
        if (layer === 'upper') playBase(fade, true);   // arms back to the base clip, same phase
      },
      // after each mixer update: frame events + one-shot upper layers ending
      tick() {
        for (const [part, l] of Object.entries(L)) {
          const a = l.action; if (!a) continue;
          const now = a.time, prev = l.prev ?? 0, list = events?.[l.name];
          if (list && emit) for (const { t, name, ...extra } of eventsCrossed(list, prev, now, now < prev - 1e-6)) emit(name, { clip: l.name, ...extra });
          l.prev = now;
          if (part === 'upper' && l.opts.once && !a.isRunning() && now >= a.getClip().duration - 1e-3) anim.stop('upper');
        }
      },
    };
    anim.startClip = startClip && anim.clips.includes(startClip) ? startClip : (anim.clips.includes('Idle') ? 'Idle' : anim.clips[0]);
    anim.play(anim.startClip, { fade: 0 });
    (this.animators ||= []).push(anim);
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
  animate(dt, playing = true) {
    const d = playing ? this.time.visualDt(dt) : dt;
    this.mixers.forEach(m => m.update(d));
    if (playing) (this.animators || []).forEach(a => a.tick());   // frame events only fire in play
    // after the pose: behaviors that move bones on top of the animation (spring chains, IK) — the mixer would overwrite them
    if (playing) for (const ent of this.entities.values()) if (!ent.destroyed) for (const b of ent.behaviors) b.lateUpdate?.(d);
  }

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
    this.scene.traverse(o => { if (o.geometry && !SHARED.has(o.geometry)) o.geometry.dispose(); [].concat(o.material || []).forEach(m => { if (!SHARED.has(m) && !m.userData?.shared) m.dispose(); }); });
    this.entities.clear();
    this.mixers.forEach(m => m.stopAllAction());
    this.animators = [];
    this.mixers = [];
  }
}
