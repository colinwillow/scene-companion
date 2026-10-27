// Vendored from colinwillow/retarget-anims src/retarget.js (Colin's own code; the Forge's layer 1). Keep in sync by copying.
// retarget-anims: carry an animation clip from one Mixamo-named skeleton onto another.
//
// LAYER 1 (this file, working): ROTATION TRANSFER FROM REST. Per target bone, the source bone's WORLD rotation relative to
// its own rest is applied to the target bone's rest:
//     Wt(t) = Ws(t) * Ws_rest^-1 * Wt_rest
// then made local down the TARGET's own chain. So it does not care how either export orients its bones (Blender and
// Auto-Rig Pro re-orient them on import, which is why copying local rotations bone-for-bone fails), nor whether one
// rig rests in a T-pose and the other in an A-pose. Hips travel is scaled by hip height. Bones the source lacks
// (fingers, `root`) keep their rest. First used in zap m919 (Clancy's stretch onto the CEO).
//
// LAYERS STILL TO BUILD (see README): foot IK (plant where the source planted), arm clearance (the "penguin" fix),
// per-character offset layer (his sliders), and the library / converter / tuning page around it.
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

export const HIPS = 'mixamorig_Hips';

// src / dst: scenes (or any Object3D) holding a skeleton AT REST -- they are cloned here, never posed in place.
// Returns a THREE.AnimationClip whose tracks name the DESTINATION's bones.
export function retargetClip(srcRoot, clip, dstRoot, opts = {}) {
  const fps = opts.fps || 30, hipsName = opts.hips || HIPS;
  const Q = () => new THREE.Quaternion(), V = () => new THREE.Vector3();
  const src = skeletonClone(srcRoot), dst = skeletonClone(dstRoot);
  src.updateMatrixWorld(true); dst.updateMatrixWorld(true);
  const sb = {}, db = [];
  src.traverse(o => { if (o.isBone) sb[o.name] = o; });
  dst.traverse(o => { if (o.isBone) db.push(o); });
  const restS = {}, restT = db.map(b => b.getWorldQuaternion(Q())), restL = db.map(b => b.quaternion.clone());
  for (const n in sb) restS[n] = sb[n].getWorldQuaternion(Q()).invert();
  const hipS = sb[hipsName], hi = db.findIndex(b => b.name === hipsName), hipT = db[hi];
  if (!hipS || !hipT) throw new Error('retargetClip: no ' + hipsName + ' on ' + (hipS ? 'the target' : 'the source'));
  const hS0 = hipS.getWorldPosition(V()), hT0 = hipT.getWorldPosition(V()), k = hT0.y / (hS0.y || 1);
  const parInv = hipT.parent.matrixWorld.clone().invert();
  const mixer = new THREE.AnimationMixer(src); mixer.clipAction(clip).play();
  const nf = Math.max(2, Math.round(clip.duration * fps) + 1), times = new Float32Array(nf);
  const use = db.map(b => !!sb[b.name] && b.name !== 'root');
  const qv = db.map(() => new Float32Array(nf * 4)), pv = new Float32Array(nf * 3);
  const W = new Map(), ws = Q(), loc = Q();
  for (let f = 0; f < nf; f++) {
    const t = Math.min(clip.duration, f / fps); times[f] = t; mixer.setTime(t); src.updateMatrixWorld(true);
    W.clear();
    db.forEach((b, i) => {
      const par = b.parent, P = par && W.has(par) ? W.get(par) : (par ? par.getWorldQuaternion(Q()) : Q());
      const w = use[i] ? sb[b.name].getWorldQuaternion(ws).clone().multiply(restS[b.name]).multiply(restT[i]) : P.clone().multiply(restL[i]);
      W.set(b, w); loc.copy(P).invert().multiply(w); qv[i].set([loc.x, loc.y, loc.z, loc.w], f * 4);
    });
    const hp = hipS.getWorldPosition(V()).sub(hS0).multiplyScalar(k).add(hT0).applyMatrix4(parInv);
    pv.set([hp.x, hp.y, hp.z], f * 3);
  }
  const tracks = [];
  db.forEach((b, i) => { if (use[i]) tracks.push(new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, qv[i])); });
  tracks.push(new THREE.VectorKeyframeTrack(hipsName + '.position', times, pv));
  return new THREE.AnimationClip(opts.name || clip.name, clip.duration, tracks);
}
