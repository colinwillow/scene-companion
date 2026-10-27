// Look profiles: style, independent of the quality tier.
//  toon  — stepped toon shading
//  baked — lighting already in the textures, drawn unlit
//  pbr   — physically based materials + environment lighting + shadows
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

let toonRamp;
function getToonRamp() {
  if (toonRamp) return toonRamp;
  const data = new Uint8Array([90, 170, 255]);           // 3 light steps
  toonRamp = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  toonRamp.minFilter = toonRamp.magFilter = THREE.NearestFilter;
  toonRamp.needsUpdate = true;
  return toonRamp;
}

// Toon material with a rim light baked into the shader (bright edge where the surface turns away from the camera).
// vViewPosition points from the surface to the camera; `normal` faces the camera on front faces.
// toonGain undoes the sky's low exposure on toon surfaces, so flat toon colours read at full strength
// while the sky (tuned for pbr) keeps its look.
const toonGain = { value: 1 };
function toonMaterial(base) {
  const m = new THREE.MeshToonMaterial({ ...base, gradientMap: getToonRamp() });
  m.onBeforeCompile = shader => {
    shader.uniforms.toonGain = toonGain;
    shader.fragmentShader = 'uniform float toonGain;\n' + shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float rim = 1.0 - max(dot(normalize(vViewPosition), normal), 0.0);
       rim = smoothstep(0.62, 0.8, rim) * 0.35;
       outgoingLight = outgoingLight * toonGain + vec3(rim);
       #include <opaque_fragment>`);
  };
  return m;
}

const OUTLINE = new THREE.MeshBasicMaterial({ color: '#141821', side: THREE.BackSide });
OUTLINE.userData.shared = true;   // one material for every hull: a World's dispose() leaves it alone
OUTLINE.onBeforeCompile = shader => {
  shader.uniforms.outlineWidth = { value: 0.025 };
  shader.vertexShader = 'uniform float outlineWidth;\n' + shader.vertexShader.replace(
    '#include <project_vertex>',
    // Width is in world metres: divide out the mesh's world scale (rigged models often sit under x39-scaled bones,
    // which blew flat-shaded hulls apart into shards).
    'transformed += normalize(normal) * outlineWidth / max(length(modelMatrix[0].xyz), 1e-4);\n#include <project_vertex>');
};

// Inverted-hull outline: a slightly fattened back-facing copy drawn in dark ink.
function addOutline(mesh) {
  if (mesh.userData.outline || mesh.geometry.attributes.normal === undefined) return;
  let hull;
  if (mesh.isSkinnedMesh) {
    hull = new THREE.SkinnedMesh(mesh.geometry, OUTLINE);
    hull.bind(mesh.skeleton, mesh.bindMatrix);
  } else hull = new THREE.Mesh(mesh.geometry, OUTLINE);
  // Share morph weights (face expressions etc.); without them the hull's morphs read garbage and explode.
  if (mesh.morphTargetInfluences) {
    hull.morphTargetInfluences = mesh.morphTargetInfluences;
    hull.morphTargetDictionary = mesh.morphTargetDictionary;
  }
  hull.name = '__outline';
  hull.raycast = () => {};            // never selectable
  hull.castShadow = false;
  hull.frustumCulled = mesh.frustumCulled;
  mesh.add(hull);
  mesh.userData.outline = hull;
}

function convert(mat, look) {
  const base = { color: mat.color?.clone(), map: mat.map || null, transparent: mat.transparent, opacity: mat.opacity, depthWrite: mat.depthWrite };
  if (look === 'toon') return toonMaterial(base);
  if (look === 'baked') return new THREE.MeshBasicMaterial(base);
  return mat; // pbr keeps the standard material
}

// Convert the materials under one object (the whole scene on load; a spawned entity later).
export function applyLookTo(root, look) {
  const meshes = [];
  root.traverse(o => { if (o.isMesh && o.name !== '__sky' && o.name !== '__outline') meshes.push(o); });
  for (const o of meshes) {
    o.material = Array.isArray(o.material) ? o.material.map(m => convert(m, look)) : convert(o.material, look);
    // Outlines on toon, except big flat floors (they'd draw a dark rim along the horizon).
    const big = o.geometry.boundingSphere ?? (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere);
    if (look === 'toon' && ![].concat(o.material).some(m => m.transparent && m.opacity < 1) && big.radius * Math.max(...o.getWorldScale(new THREE.Vector3()).toArray()) < 6) addOutline(o);
  }
}

export function applyLook(world, look) {
  const { scene, renderer } = world;
  applyLookTo(scene, look);

  const lights = [];
  scene.traverse(o => o.isLight && lights.push(o));
  lights.forEach(l => (l.visible = look !== 'baked'));

  if (look === 'pbr') {
    if (world.skyEnv) scene.environment = world.skyEnv;          // lit by the sky
    else {
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    }
  } else {
    scene.environment = null;
  }

  // Tier decides how heavy rendering gets.
  const ultra = world.tier === 'desktop';
  renderer.shadowMap.enabled = look !== 'baked';
  renderer.shadowMap.type = ultra ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  // Filmic tone mapping for lit looks (AgX keeps saturated colours from blowing out).
  renderer.toneMapping = look === 'baked' ? THREE.NoToneMapping : THREE.AgXToneMapping;
  if (!world.skyEnv) renderer.toneMappingExposure = 1;
  toonGain.value = 1 / Math.max(renderer.toneMappingExposure, 0.1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, ultra ? 2 : 1.5));
}
