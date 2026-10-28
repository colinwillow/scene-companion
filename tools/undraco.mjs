// Undo Draco mesh compression in a GLB: every compressed primitive is decoded (three's own draco decoder, which is an
// ordinary emscripten module and runs in node) and written back as plain accessors, and the extension is dropped.
// Godot 4 cannot read Draco, so the Godot export runs every GLB through this. Skins, animations, materials, textures
// (including EXT_texture_webp) are untouched — only the meshes' bytes change.
//   node tools/undraco.mjs in.glb out.glb
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const LIB = join(dirname(fileURLToPath(import.meta.url)), '../node_modules/three/examples/jsm/libs/draco/');
let D = null;
async function decoder() {
  if (D) return D;
  const tmp = join(tmpdir(), 'sc-draco-wrapper.cjs');           // this repo is "type": "module"; a .cjs copy will require()
  writeFileSync(tmp, readFileSync(LIB + 'draco_wasm_wrapper.js'));
  const Mod = createRequire(import.meta.url)(tmp);
  return (D = await Mod({ wasmBinary: readFileSync(LIB + 'draco_decoder.wasm') }));
}

const COMP = { 5120: [Int8Array, 'DT_INT8'], 5121: [Uint8Array, 'DT_UINT8'], 5122: [Int16Array, 'DT_INT16'], 5123: [Uint16Array, 'DT_UINT16'], 5125: [Uint32Array, 'DT_UINT32'], 5126: [Float32Array, 'DT_FLOAT32'] };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function readGlb(buf) {
  let off = 12, json = null, bin = Buffer.alloc(0);
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4), body = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8')); else if (type === 0x004e4942) bin = Buffer.from(body);
    off += 8 + len;
  }
  return { json, bin };
}
export function writeGlb(json, bin) {
  const pad = (b, c) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, c)]);
  const j = pad(Buffer.from(JSON.stringify(json)), 0x20), b = pad(bin, 0);
  const head = Buffer.alloc(12); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + (b.length ? 8 + b.length : 0), 8);
  const ch = (t, d) => { const h = Buffer.alloc(8); h.writeUInt32LE(d.length, 0); h.writeUInt32LE(t, 4); return Buffer.concat([h, d]); };
  return Buffer.concat([head, ch(0x4e4f534a, j), ...(b.length ? [ch(0x004e4942, b)] : [])]);
}
export const isDraco = json => (json.extensionsUsed || []).includes('KHR_draco_mesh_compression');

export async function undraco(buf) {
  const { json: g, bin } = readGlb(buf);
  if (!isDraco(g)) return { buf, decoded: 0 };
  const d = await decoder(), EXT = 'KHR_draco_mesh_compression';
  const dracoViews = new Set(), prims = [];
  for (const m of g.meshes || []) for (const pr of m.primitives) if (pr.extensions?.[EXT]) { dracoViews.add(pr.extensions[EXT].bufferView); prims.push(pr); }
  // keep every other bufferView, re-packed, then append the decoded data
  const parts = [], remap = new Map(), views = []; let len = 0;
  const add = (bytes, extra = {}) => { const pad = (4 - (len % 4)) % 4; if (pad) { parts.push(Buffer.alloc(pad)); len += pad; }
    views.push({ buffer: 0, byteOffset: len, byteLength: bytes.length, ...extra }); parts.push(bytes); len += bytes.length; return views.length - 1; };
  (g.bufferViews || []).forEach((v, i) => { if (dracoViews.has(i)) return; const { byteOffset = 0, byteLength, buffer, ...rest } = v; remap.set(i, add(bin.subarray(byteOffset, byteOffset + byteLength), rest)); });
  for (const a of g.accessors || []) if (a.bufferView !== undefined) a.bufferView = remap.get(a.bufferView);
  for (const im of g.images || []) if (im.bufferView !== undefined) im.bufferView = remap.get(im.bufferView);
  for (const pr of prims) {
    const ext = pr.extensions[EXT], bv = g.bufferViews[ext.bufferView], src = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    const dec = new d.Decoder(), db = new d.DecoderBuffer(); db.Init(new Int8Array(src), src.length);
    const mesh = new d.Mesh(), st = dec.DecodeBufferToMesh(db, mesh);
    if (!st.ok() || mesh.ptr === 0) throw new Error('draco decode failed: ' + st.error_msg());
    const n = mesh.num_points();
    for (const [name, uid] of Object.entries(ext.attributes)) {
      const acc = g.accessors[pr.attributes[name]], [Arr, dt] = COMP[acc.componentType], k = SIZE[acc.type], bytes = n * k * Arr.BYTES_PER_ELEMENT;
      const att = dec.GetAttributeByUniqueId(mesh, uid), ptr = d._malloc(bytes);
      dec.GetAttributeDataArrayForAllPoints(mesh, att, d[dt], bytes, ptr);
      const data = Buffer.from(new Uint8Array(d.HEAPU8.buffer, ptr, bytes).slice()); d._free(ptr);
      Object.assign(acc, { bufferView: add(data, { target: 34962 }), byteOffset: 0, count: n });
    }
    const nf = mesh.num_faces(), ptr = d._malloc(nf * 12);
    dec.GetTrianglesUInt32Array(mesh, nf * 12, ptr);
    const idx32 = new Uint32Array(d.HEAPU32.buffer, ptr, nf * 3).slice(); d._free(ptr);
    const small = n < 65536, idx = small ? Uint16Array.from(idx32) : idx32;
    Object.assign(g.accessors[pr.indices], { bufferView: add(Buffer.from(idx.buffer), { target: 34963 }), byteOffset: 0, count: nf * 3, componentType: small ? 5123 : 5125 });
    delete pr.extensions[EXT]; if (!Object.keys(pr.extensions).length) delete pr.extensions;
    d.destroy(mesh); d.destroy(db); d.destroy(dec);
  }
  g.bufferViews = views; g.buffers = [{ byteLength: len }];
  for (const k of ['extensionsUsed', 'extensionsRequired']) if (g[k]) { g[k] = g[k].filter(e => e !== EXT); if (!g[k].length) delete g[k]; }
  return { buf: writeGlb(g, Buffer.concat(parts)), decoded: prims.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [i, o] = process.argv.slice(2);
  const r = await undraco(readFileSync(i)); writeFileSync(o, r.buf);
  console.log(`${i} → ${o}: ${r.decoded} primitive(s) decoded`);
}

// The files a GLB loads from beside itself (images / buffers with a relative uri, e.g. Kenney's Textures/colormap.png),
// as repo paths. An exporter that copies the GLB has to copy these too.
export function glbExternal(path) {
  try {
    const { json } = readGlb(readFileSync(path)), base = dirname(path);
    return [...(json.images || []), ...(json.buffers || [])].map(x => x.uri).filter(u => u && !/^data:|^[a-z]+:\/\//i.test(u))
      .map(u => join(base, decodeURIComponent(u)));
  } catch { return []; }
}
