// Mid-distance LOD for a vehicle GLB: textures baked into vertex colours (sampled at each vertex's UV),
// everything merged into a few meshes: body (vertex colours), paint (tintable), glass, lampA (+Z), lampB (-Z).
// Usage: node make-lod.mjs in.glb out.lod.glb [targetTris=10000]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, flatten, join, weld, simplify, draco, unpartition } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
await MeshoptDecoder.ready; await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const [,, src, dst, targetArg = '10000'] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(), 'draco3d.encoder': await draco3d.createEncoderModule(), 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
const root = doc.getRoot();
await doc.transform(flatten()); // bake node transforms into world space below
const GLASS = /(^|[^a-z])(glass|window|windscreen|windshield)([^a-z]|$)/i;
const PAINT = /paint|body.?col|car.?body|carpaint/i;
const texCache = new Map();
async function texData(tex) {
  if (!tex) return null;
  if (texCache.has(tex)) return texCache.get(tex);
  let d = null;
  try {
    const { data, info } = await sharp(Buffer.from(tex.getImage())).resize(256, 256, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    d = { data, w: info.width, h: info.height };
  } catch { d = null; }
  texCache.set(tex, d);
  return d;
}
const srgb2lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const groups = { body: [], paint: [], glass: [], lamp: [] };
const mul = (m, x, y, z) => [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]];
for (const node of root.listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const W = node.getWorldMatrix();
  for (const p of mesh.listPrimitives()) {
    if (p.getMode() !== 4) continue;
    const mat = p.getMaterial();
    const name = mat ? mat.getName() : '';
    const pos = p.getAttribute('POSITION'); if (!pos) continue;
    const idx = p.getIndices();
    const uv = p.getAttribute('TEXCOORD_0');
    const bf = mat ? mat.getBaseColorFactor() : [1, 1, 1, 1];
    const em = mat ? mat.getEmissiveFactor() : [0, 0, 0];
    const trans = mat && (mat.getAlphaMode() === 'BLEND' || bf[3] < 0.9 || mat.getExtension('KHR_materials_transmission'));
    let g = 'body';
    if (trans || (GLASS.test(name) && !/^tintglass_\d+$/i.test(name))) g = 'glass';
    else if (em[0] + em[1] + em[2] > 0.15 || (mat && mat.getEmissiveTexture())) g = 'lamp';
    else if (PAINT.test(name) && !/tintglass/i.test(name) && !(mat && mat.getBaseColorTexture())) g = 'paint'; // textured paint is baked like the body
    const td = g === 'body' && uv ? await texData(mat && mat.getBaseColorTexture()) : null;
    const n = pos.getCount();
    const P = new Float32Array(n * 3), C = new Float32Array(n * 3);
    const v = [], t = [];
    for (let i = 0; i < n; i++) {
      pos.getElement(i, v);
      const w = mul(W, v[0], v[1], v[2]); P[i*3] = w[0]; P[i*3+1] = w[1]; P[i*3+2] = w[2];
      let r = bf[0], gg = bf[1], b = bf[2];
      if (g === 'lamp') { r = Math.max(r, em[0]); gg = Math.max(gg, em[1]); b = Math.max(b, em[2]); }
      if (td) {
        uv.getElement(i, t);
        const x = ((t[0] % 1) + 1) % 1, y = ((t[1] % 1) + 1) % 1;
        const k = (Math.min(td.h - 1, Math.floor(y * td.h)) * td.w + Math.min(td.w - 1, Math.floor(x * td.w))) * 3;
        r *= srgb2lin(td.data[k] / 255); gg *= srgb2lin(td.data[k+1] / 255); b *= srgb2lin(td.data[k+2] / 255);
      }
      C[i*3] = r; C[i*3+1] = gg; C[i*3+2] = b;
    }
    const I = idx ? Uint32Array.from({ length: idx.getCount() }, (_, k) => idx.getScalar(k)) : Uint32Array.from({ length: n }, (_, k) => k);
    groups[g].push({ P, C, I, em });
  }
}
// drop the interior (seats, dash, engine): hidden behind the opaque LOD glass and body
{
  const all = Object.values(groups).flat();
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const l of all) for (let i = 0; i < l.P.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], l.P[i + a]); hi[a] = Math.max(hi[a], l.P[i + a]); }
  const sz = lo.map((x, a) => hi[a] - x);
  const la = sz[0] > sz[2] ? 0 : 2, wa = la === 0 ? 2 : 0;
  let cut = 0;
  for (const g of ['body', 'lamp']) {
    groups[g] = groups[g].filter((l) => {
      const blo = [Infinity, Infinity, Infinity], bhi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < l.P.length; i += 3) for (let a = 0; a < 3; a++) { blo[a] = Math.min(blo[a], l.P[i + a]); bhi[a] = Math.max(bhi[a], l.P[i + a]); }
      const mid = (a) => (lo[a] + hi[a]) / 2;
      const inside = Math.abs(blo[wa] - mid(wa)) < sz[wa] * 0.4 && Math.abs(bhi[wa] - mid(wa)) < sz[wa] * 0.4
        && blo[1] > lo[1] + sz[1] * 0.22 && bhi[1] < lo[1] + sz[1] * 0.82
        && Math.abs(blo[la] - mid(la)) < sz[la] * 0.42 && Math.abs(bhi[la] - mid(la)) < sz[la] * 0.42;
      if (inside) cut += l.I.length / 3;
      return !inside;
    });
  }
  console.error('interior tris removed', cut);
}
// rebuild a fresh document with one primitive per group
for (const n of root.listNodes()) n.dispose();
for (const m of root.listMeshes()) m.dispose();
await doc.transform(prune());
const scene = root.listScenes()[0] || doc.createScene();
const buf = root.listBuffers()[0] || doc.createBuffer();
// weld identical positions, simplify with meshoptimizer, compact
function simplifyGroup(P, C, I, ratio, err) {
  if (ratio >= 0.999) return { P, C, I };
  const map = new Map(), remap = new Uint32Array(P.length / 3);
  const WP = [], WC = [];
  for (let i = 0; i < P.length / 3; i++) {
    const key = `${P[i*3].toFixed(4)},${P[i*3+1].toFixed(4)},${P[i*3+2].toFixed(4)}`;
    let j = map.get(key);
    if (j === undefined) { j = WP.length / 3; map.set(key, j); WP.push(P[i*3], P[i*3+1], P[i*3+2]); WC.push(C[i*3], C[i*3+1], C[i*3+2]); }
    remap[i] = j;
  }
  const WI = I.map((k) => remap[k]);
  const target = Math.max(3, Math.floor((WI.length * ratio) / 3) * 3);
  const [out] = MeshoptSimplifier.simplify(WI, new Float32Array(WP), 3, target, err, []);
  const used = new Map(), NP = [], NC = [];
  const NI = new Uint32Array(out.length);
  for (let k = 0; k < out.length; k++) {
    let j = used.get(out[k]);
    if (j === undefined) { j = NP.length / 3; used.set(out[k], j); NP.push(WP[out[k]*3], WP[out[k]*3+1], WP[out[k]*3+2]); NC.push(WC[out[k]*3], WC[out[k]*3+1], WC[out[k]*3+2]); }
    NI[k] = j;
  }
  return { P: new Float32Array(NP), C: new Float32Array(NC), I: NI };
}
let RATIO = 1;
const mk = (name, list, matSetup, keep = false) => {
  if (!list.length) return;
  let nv = 0, ni = 0; for (const l of list) { nv += l.P.length / 3; ni += l.I.length; }
  let P = new Float32Array(nv * 3), C = new Float32Array(nv * 3), I = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const l of list) { P.set(l.P, ov * 3); C.set(l.C, ov * 3); for (let k = 0; k < l.I.length; k++) I[oi + k] = l.I[k] + ov; ov += l.P.length / 3; oi += l.I.length; }
  if (!keep) ({ P, C, I } = simplifyGroup(P, C, I, RATIO, +(process.env.LOD_ERR || 0.006)));
  const mat = doc.createMaterial(name); matSetup(mat);
  const prim = doc.createPrimitive().setMaterial(mat)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(I).setBuffer(buf));
  if (name === 'lod_body' || name === 'lod_lamp') prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(C).setBuffer(buf));
  const mesh = doc.createMesh(name).addPrimitive(prim);
  scene.addChild(doc.createNode(name).setMesh(mesh));
};
const avg = (list) => { let s = [0, 0, 0], n = 0; for (const l of list) for (let i = 0; i < l.C.length; i += 3) { s[0] += l.C[i]; s[1] += l.C[i+1]; s[2] += l.C[i+2]; n++; } return n ? s.map((x) => x / n) : [1, 1, 1]; };
{
  const count = (list) => list.reduce((t, l) => t + l.I.length / 3, 0);
  const keepTris = count(groups.paint);
  const rest = count(groups.body) + count(groups.glass) + count(groups.lamp);
  RATIO = Math.min(1, Math.max(0.05, (+targetArg - keepTris) / Math.max(1, rest)));
}
mk('lod_body', groups.body, (m) => m.setRoughnessFactor(0.45).setMetallicFactor(0.25).setDoubleSided(true));
mk('lod_paint', groups.paint, (m) => m.setBaseColorFactor([...avg(groups.paint), 1]).setRoughnessFactor(0.3).setMetallicFactor(0.45).setDoubleSided(true), true);
mk('lod_glass', groups.glass, (m) => m.setBaseColorFactor([0.03, 0.04, 0.05, 1]).setRoughnessFactor(0.06).setMetallicFactor(0.7));
mk('lod_lamp', groups.lamp, (m) => m.setEmissiveFactor([0.6, 0.6, 0.6]).setRoughnessFactor(0.3));
const tri0 = Object.values(groups).flat().reduce((t, l) => t + l.I.length / 3, 0);
await doc.transform(prune(), draco());
for (const e of root.listExtensionsUsed()) if (!/draco/i.test(e.extensionName)) e.dispose();
let tri = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tri += p.getIndices().getCount() / 3;
console.log(JSON.stringify({ groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])), tris: `${tri0} -> ${tri}` }));
await io.write(dst, doc);
