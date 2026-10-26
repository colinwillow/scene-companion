// Procedural sky + image-based lighting from that sky.
// Scene settings:
//   "sky": { "elevation": 25, "azimuth": 140, "turbidity": 6, "rayleigh": 1.6,
//            "exposure": 0.6, "sunColor": "#fff3e0", "sunIntensity": 3, "envIntensity": 1 }
// The sun direction drives the scene's directional light(s), so shadows match the sky.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export const SKY_DEFAULTS = {
  elevation: 25, azimuth: 140, turbidity: 6, rayleigh: 1.6,
  mieCoefficient: 0.004, mieDirectionalG: 0.8,
  exposure: 0.6, sunColor: '#fff3e0', sunIntensity: 3, envIntensity: 1,
};

export function applySky(world, settings) {
  const { scene, renderer } = world;
  const cfg = { ...SKY_DEFAULTS, ...(settings === true ? {} : settings) };

  const sun = new THREE.Vector3().setFromSphericalCoords(
    1, THREE.MathUtils.degToRad(90 - cfg.elevation), THREE.MathUtils.degToRad(cfg.azimuth));

  const sky = new Sky();
  sky.name = '__sky';
  sky.scale.setScalar(1000);
  const u = sky.material.uniforms;
  u.turbidity.value = cfg.turbidity;
  u.rayleigh.value = cfg.rayleigh;
  u.mieCoefficient.value = cfg.mieCoefficient;
  u.mieDirectionalG.value = cfg.mieDirectionalG;
  u.sunPosition.value.copy(sun);
  scene.add(sky);
  scene.background = null;

  // Environment lighting baked from the same sky, so reflections and ambient match it.
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(1000);
  Object.entries(u).forEach(([k, v]) => { envSky.material.uniforms[k].value = v.value?.clone ? v.value.clone() : v.value; });
  envScene.add(envSky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  world.skyEnv = pmrem.fromScene(envScene).texture;
  pmrem.dispose();
  scene.environmentIntensity = cfg.envIntensity;

  // Point every directional light along the sun.
  scene.traverse(o => {
    if (!o.isDirectionalLight) return;
    o.position.copy(sun).multiplyScalar(30);
    o.color.set(cfg.sunColor);
    o.intensity = cfg.sunIntensity;
  });

  // Hemisphere fill gets quieter: the sky environment now does that job on PBR.
  scene.traverse(o => { if (o.isHemisphereLight) o.intensity *= 0.5; });

  renderer.toneMappingExposure = cfg.exposure;
  world.sunDirection = sun;
  return sky;
}
