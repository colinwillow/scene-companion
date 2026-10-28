// Post-processing, scaled by quality tier. Scene settings:
//   "post": { "ao": true, "bloom": { "strength": 0.35, "radius": 0.5, "threshold": 0.85 }, "vignette": 0.25 }
// web tier:     bloom + vignette, 2x MSAA, AO only if "ao": "always"
// desktop tier: ambient occlusion + bloom + vignette, 4x MSAA
// ultra tier:   all of that at full resolution, 8x MSAA, and screen-space reflections on the entities listed in
//               "post": { "reflect": ["plaza", "pond"] } (each entity's meshes; reflections cost a lot, so they are opt-in)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSRPass } from 'three/addons/postprocessing/SSRPass.js';
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

export function createPost(renderer, scene, camera, settings, tier, world) {
  if (settings === false) return null;   // scene opted out: render directly
  const cfg = { ...POST_DEFAULTS, ...(settings || {}) };
  const rank = { desktop: 1, ultra: 2 }[tier] ?? 0, ultra = rank >= 1, top = rank >= 2;

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: top ? 8 : ultra ? 4 : 2,      // three clamps this to what the GPU allows
  });
  const composer = new EffectComposer(renderer, target);
  // ultra + post.reflect: the SSR pass draws the scene itself (beauty + reflections on the listed entities' meshes)
  const reflect = [];
  if (top && Array.isArray(cfg.reflect) && world) for (const id of cfg.reflect) world.getEntity(id)?.object3d.traverse(o => { if (o.isMesh) reflect.push(o); });
  let ssr = null;
  if (reflect.length) {
    ssr = new SSRPass({ renderer, scene, camera, width: size.x, height: size.y, selects: reflect });
    Object.assign(ssr, { maxDistance: 12, thickness: 0.03, opacity: 0.6, fresnel: true, distanceAttenuation: true, infiniteThick: false });
    composer.addPass(ssr);
  } else composer.addPass(new RenderPass(scene, camera));

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
    setSize: (w, h) => { composer.setSize(w, h); ssr?.setSize(w, h); },
    reflecting: reflect.length,
    dispose: () => { composer.dispose(); target.dispose(); },
  };
}
