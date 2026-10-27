// Image gen through the OpenAI image API. The key comes from OPENAI_API_KEY on the machine running the dev server
// (or a network proxy that injects it). The model is a field because OpenAI renames them.
export default {
  id: 'openai-image',
  label: 'Image (OpenAI)',
  kind: 'image',
  needs: 'OPENAI_API_KEY',
  fields: {
    prompt: { required: true, max: 4000 },
    size: { default: '1024x1024', options: ['1024x1024', '1024x1536', '1536x1024'] },
    model: { default: 'gpt-image-1' },
  },
  request(input) {
    return { url: 'https://api.openai.com/v1/images/generations',
      body: { model: input.model, prompt: input.prompt, size: input.size, n: 1 } };
  },
  async run(input, { dry, env = process.env, fetch: f = fetch } = {}) {
    const req = this.request(input);
    if (dry) return { dry: req };
    const headers = { 'Content-Type': 'application/json' };
    if (env.OPENAI_API_KEY) headers.Authorization = `Bearer ${env.OPENAI_API_KEY}`;
    const r = await f(req.url, { method: 'POST', headers, body: JSON.stringify(req.body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `OpenAI said ${r.status}`);
    const b64 = j.data?.[0]?.b64_json;
    if (!b64) throw new Error('no image in the reply');
    return { bytes: Buffer.from(b64, 'base64'), ext: 'png' };
  },
};
