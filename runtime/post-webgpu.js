// Post-processing for the WebGPU renderer (play.html?renderer=webgpu): three's node pipeline instead of EffectComposer.
// The scene pass + bloom (same settings as runtime/post.js) + ambient occlusion on desktop/ultra; tone mapping and the
// output colour space come from the renderer. Vignette and reflections are WebGL-only for now.
import * as THREE from 'three';
import { pass, mrt, output, normalView } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { POST_DEFAULTS } from './post.js';

export function createPostGPU(renderer, scene, camera, settings, tier) {
  if (settings === false) return null;
  const cfg = { ...POST_DEFAULTS, ...(settings || {}) }, rank = { desktop: 1, ultra: 2 }[tier] ?? 0;
  const post = new THREE.PostProcessing(renderer);
  const scenePass = pass(scene, camera);
  const useAO = cfg.ao === 'always' || (cfg.ao && rank >= 1);
  if (useAO) scenePass.setMRT(mrt({ output, normal: normalView }));
  let color = scenePass.getTextureNode('output');
  if (useAO) {
    const aoPass = ao(scenePass.getTextureNode('depth'), scenePass.getTextureNode('normal'), camera);
    color = color.mul(aoPass.getTextureNode().r);
  }
  if (cfg.bloom) { const b = { ...POST_DEFAULTS.bloom, ...cfg.bloom }; color = color.add(bloom(color, b.strength, b.radius, b.threshold)); }
  post.outputNode = color;
  return { render: () => post.render(), setSize: () => {}, dispose: () => post.dispose?.(), webgpu: true };
}
