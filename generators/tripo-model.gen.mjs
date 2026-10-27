// Image → 3D through Tripo (the same calls as blender-addons/pipeline/tripo.py): upload the picture as the FRONT view,
// multiview-to-model for the mesh, then /models/texture for the paint, download the textured GLB. Takes minutes; the
// dev server request waits. The key comes from TRIPO_API_KEY on the dev server's machine (or a proxy that injects it).
// Failed and cancelled tasks are not charged.
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';

const BASE = 'https://openapi.tripo3d.ai/v3';

export default {
  id: 'tripo-model',
  label: 'Image → 3D model (Tripo)',
  kind: 'model',
  needs: 'TRIPO_API_KEY',
  fields: {
    image: { required: true, max: 300 },          // a project path, e.g. ./assets/generated/red_barrel_1.png
    prompt: { max: 200 },                         // only names the file; defaults to the image's name
    faces: { default: '8000', options: ['3000', '5000', '8000', '15000'] },
  },
  plan(input) {
    return { mesh: { path: '/generation/multiview-to-model', body: { inputs: [{ front: '<file token>' }], model: 'P2-20260801', quad: true, face_limit: +input.faces, texture: false, pbr: false } },
      texture: { path: '/models/texture', body: { input: '<mesh task>', model: 'v3.0-20250812', texture_quality: 'detailed', pbr: false, delight: false } } };
  },
  async run(input, { dry, root = process.cwd(), env = process.env, fetch: f = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
    const rel = normalize(input.image.replace(/^\.\//, ''));
    if (rel.startsWith('..') || !/\.(png|jpe?g|webp)$/i.test(rel)) throw new Error('image: a .png/.jpg/.webp inside the project');
    if (dry) return { dry: { image: rel, ...this.plan(input) } };
    const auth = env.TRIPO_API_KEY ? { Authorization: `Bearer ${env.TRIPO_API_KEY}` } : {};
    const call = async (method, path, body, form) => {
      const r = await f(BASE + path, { method, headers: form ? auth : { ...auth, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: form || (body && JSON.stringify(body)) });
      const j = await r.json().catch(() => ({}));
      if (j.code !== 0) throw new Error(`Tripo ${path}: ${j.message || j.msg || r.status}`);
      return j.data;
    };
    const wait = async id => {
      for (let i = 0; i < 150; i++) {
        const d = await call('GET', `/tasks/${id}`);
        if (d.status === 'success') return d;
        if (d.status === 'failed' || d.status === 'cancelled') throw new Error(`Tripo task ${d.status}: ${d.error_msg || d.message || ''}`);
        await sleep(8000);
      }
      throw new Error('Tripo task took over 20 minutes');
    };
    const form = new FormData();
    form.append('file', new Blob([await readFile(join(root, rel))]), rel.split('/').pop());
    const token = (await call('POST', '/files', null, form)).file_token;
    const plan = this.plan(input), inputs = [{ front: token }];
    const mesh = await wait((await call('POST', plan.mesh.path, { ...plan.mesh.body, inputs })).task_id);
    const tex = await wait((await call('POST', plan.texture.path, { ...plan.texture.body, input: mesh.task_id, texture_prompt: { images: inputs } })).task_id);
    const glb = await f(tex.output.model_url);
    if (!glb.ok) throw new Error(`download failed (${glb.status})`);
    return { bytes: Buffer.from(await glb.arrayBuffer()), ext: 'glb' };
  },
};
