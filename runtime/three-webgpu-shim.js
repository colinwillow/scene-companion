// "three" in WebGPU mode (play.html?renderer=webgpu): three's WebGPU build, plus the one name the WebGL-era addons this
// runtime imports still ask for at load (UniformsUtils: Sky, ShaderPass, SSRPass). Those code paths are not used under
// WebGPU, but a missing export fails the whole import graph, so the two plain helpers are provided here.
export * from 'three/webgpu';

function cloneUniforms(src) {
  const dst = {};
  for (const u in src) {
    dst[u] = {};
    for (const p in src[u]) {
      const v = src[u][p];
      dst[u][p] = v && (v.isColor || v.isMatrix3 || v.isMatrix4 || v.isVector2 || v.isVector3 || v.isVector4 || v.isTexture || v.isQuaternion) ? v.clone()
        : Array.isArray(v) ? v.slice() : v;
    }
  }
  return dst;
}
function mergeUniforms(list) { const out = {}; for (const u of list) Object.assign(out, cloneUniforms(u)); return out; }
export const UniformsUtils = { clone: cloneUniforms, merge: mergeUniforms };
