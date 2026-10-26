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

function convert(mat, look) {
  const base = { color: mat.color?.clone(), map: mat.map || null, transparent: mat.transparent, opacity: mat.opacity };
  if (look === 'toon') return new THREE.MeshToonMaterial({ ...base, gradientMap: getToonRamp() });
  if (look === 'baked') return new THREE.MeshBasicMaterial(base);
  return mat; // pbr keeps the standard material
}

export function applyLook(world, look) {
  const { scene, renderer } = world;
  scene.traverse(o => {
    if (!o.isMesh || o.name === '__sky') return;
    o.material = Array.isArray(o.material) ? o.material.map(m => convert(m, look)) : convert(o.material, look);
  });

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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, ultra ? 2 : 1.5));
}
