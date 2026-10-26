// Post-processing, scaled by quality tier. Scene settings:
//   "post": { "ao": true, "bloom": { "strength": 0.35, "radius": 0.5, "threshold": 0.85 }, "vignette": 0.25 }
// web tier:     bloom + vignette, 2x MSAA, AO only if "ao": "always"
// desktop tier: ambient occlusion + bloom + vignette, 4x MSAA
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';

export const POST_DEFAULTS = {
  ao: true,
  bloom: { strength: 0.35, radius: 0.5, threshold: 0.85 },
  vignette: 0.25,
};

export function createPost(renderer, scene, camera, settings, tier) {
  if (settings === false) return null;   // scene opted out: render directly
  const cfg = { ...POST_DEFAULTS, ...(settings || {}) };
  const ultra = tier === 'desktop';

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: ultra ? 4 : 2,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  if (cfg.ao === 'always' || (cfg.ao && ultra)) {
    const ao = new GTAOPass(scene, camera, size.x, size.y);
    ao.output = GTAOPass.OUTPUT.Default;
    ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.2, thickness: 1, scale: 1.2 });
    composer.addPass(ao);
  }

  if (cfg.bloom) {
    const b = { ...POST_DEFAULTS.bloom, ...cfg.bloom };
    const scale = ultra ? 1 : 0.5;   // half-res bloom on phones
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x * scale, size.y * scale), b.strength, b.radius, b.threshold));
  }

  composer.addPass(new OutputPass());   // tone mapping + colour space

  if (cfg.vignette) {
    const v = new ShaderPass(VignetteShader);
    v.uniforms.offset.value = 1.0;
    v.uniforms.darkness.value = 1 + cfg.vignette;
    composer.addPass(v);
  }

  return {
    render: () => composer.render(),
    setSize: (w, h) => composer.setSize(w, h),
    dispose: () => { composer.dispose(); target.dispose(); },
  };
}
