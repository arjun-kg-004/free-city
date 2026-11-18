// Usage (from a folder with @gltf-transform/core, /extensions, /functions, draco3dgltf, meshoptimizer, sharp installed):
//   node prep-car.mjs in.glb out.glb [car|bike] [simplifyRatio=0.08] [textureSize=1024] [error=0.004]
// Make a Sketchfab/game-rip car game-ready: unskin, auto-detect + name wheels, drop names elsewhere so
// everything else joins by material. Then `gltf-transform optimize` does simplify/palette/join/draco/webp.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, flatten, join, weld, simplify, textureCompress, draco, palette, resample, sparse } from '@gltf-transform/functions';
import sharp from 'sharp';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
await MeshoptDecoder.ready; await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const [,, src, dst, mode = 'car', ratioArg = '0.08', texArg = '1024', errArg = '0.004'] = process.argv;
const lenAxisArg = null;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(), 'draco3d.encoder': await draco3d.createEncoderModule(), 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
const root = doc.getRoot();
// 1) strip skins (render at bind pose)
for (const n of root.listNodes()) if (n.getSkin()) n.setSkin(null);
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { for (const a of ['JOINTS_0', 'WEIGHTS_0', 'JOINTS_1', 'WEIGHTS_1']) if (p.getAttribute(a)) p.setAttribute(a, null); }
for (const s of root.listSkins()) s.dispose();
// 2) world-space bounds of every mesh node
const mul = (m, v) => [m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12], m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13], m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]];
const items = [];
for (const n of root.listNodes()) {
  const mesh = n.getMesh(); if (!mesh) continue;
  const W = n.getWorldMatrix();
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION'); const a = pos.getMin([]), b = pos.getMax([]);
    for (let k = 0; k < 8; k++) {
      const v = mul(W, [k & 1 ? b[0] : a[0], k & 2 ? b[1] : a[1], k & 4 ? b[2] : a[2]]);
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], v[i]); hi[i] = Math.max(hi[i], v[i]); }
    }
  }
  items.push({ n, lo, hi, c: lo.map((x, i) => (x + hi[i]) / 2), s: lo.map((x, i) => hi[i] - x) });
}
// drop stray bits floating outside the car (dummies, exhaust emitters, LOD leftovers)
const triCount = (it) => it.n.getMesh().listPrimitives().reduce((t, p) => t + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0);
for (const it of items) it.t = triCount(it);
const byT = [...items].sort((a, b) => b.t - a.t);
const total = byT.reduce((s, it) => s + it.t, 0);
const CL = [Infinity, Infinity, Infinity], CH = [-Infinity, -Infinity, -Infinity];
let acc = 0;
for (const it of byT) { if (acc > total * 0.7) break; acc += it.t; for (let i = 0; i < 3; i++) { CL[i] = Math.min(CL[i], it.lo[i]); CH[i] = Math.max(CH[i], it.hi[i]); } }
// the core itself may include a stray if a big mesh contains it — use the median-sized part's extent instead
const cs = CL.map((x, i) => CH[i] - x);
let removed = 0;
for (let k = items.length - 1; k >= 0; k--) {
  const it = items[k];
  const out = [0, 1, 2].some((i) => it.hi[i] < CL[i] - cs[i] * 0.03 || it.lo[i] > CH[i] + cs[i] * 0.03);
  if (out) { it.n.setMesh(null); items.splice(k, 1); removed++; }
}
// strays inside a merged mesh: split primitives can't be fixed here, report the extent instead
const L = [Infinity, Infinity, Infinity], H = [-Infinity, -Infinity, -Infinity];
for (const it of items) for (let i = 0; i < 3; i++) { L[i] = Math.min(L[i], it.lo[i]); H[i] = Math.max(H[i], it.hi[i]); }
const size = L.map((x, i) => H[i] - x);
const la = lenAxisArg ? +lenAxisArg : (size[0] > size[2] ? 0 : 2), wa = la === 0 ? 2 : 0; // length / width axes; Y up
const mid = L.map((x, i) => (x + H[i]) / 2);
// 3) wheel candidates: round in the (Y, length) plane, thin across, touching the ground, out at the sides
const cand = items.filter((it) => {
  const d = it.s[1];
  return d > size[1] * 0.2 && d < size[1] * 0.62 && Math.abs(it.s[la] - d) < d * 0.25 && it.s[wa] < d * 0.75
    && it.lo[1] < L[1] + d * 0.12 && (mode === 'bike' ? d > size[1] * 0.3 : Math.abs(it.c[wa] - mid[wa]) > size[wa] * 0.2);
});
if (process.env.DEBUG) for (const it of items) { const d = it.s[1]; if (d > size[1]*0.15 && d < size[1]*0.7) console.error(it.n.getName(), it.s.map(x=>+x.toFixed(2)), 'lo', it.lo.map(x=>+x.toFixed(2)), 'L', L[1].toFixed(2)); }
const corners = {};
for (const it of cand) {
  const key = (it.c[la] > mid[la] ? 'A' : 'B') + (mode === 'bike' ? 'C' : it.c[wa] > mid[wa] ? 'L' : 'R');
  const cur = corners[key];
  if (!cur || it.s[1] > cur.s[1]) corners[key] = it; // biggest round thing at each corner = tyre
}
let tagged = 0;
for (const [key, w] of Object.entries(corners)) {
  // everything sitting inside this wheel's envelope belongs to it (rim, disc, bolts)
  for (const it of items) {
    const inside = [0, 1, 2].every((i) => it.lo[i] >= w.lo[i] - w.s[1] * 0.08 && it.hi[i] <= w.hi[i] + w.s[1] * 0.08);
    if (inside && !/caliper/i.test(it.n.getName())) { it.n.setName(`wheel_${key}_${tagged++}`); it.wheel = true; }
  }
}
for (const it of items) if (!it.wheel) it.n.setName('');
// parents of meshes too, so join can merge freely
for (const n of root.listNodes()) if (!n.getMesh() && !/wheel/.test(n.getName())) n.setName('');
// keep wheel meshes apart from the body: give them unique names so join(keepNamed) leaves them alone
for (const n of root.listNodes()) if (/^wheel_/.test(n.getName()) && n.getMesh()) n.getMesh().setName(n.getName());
for (const m of root.listMeshes()) if (!/^wheel_/.test(m.getName())) m.setName('');
const nMat = root.listMaterials().length;
// drop normals (and UVs on untextured parts) so coincident vertices weld and the simplifier can work;
// the game rebuilds crease-aware normals at load time
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
  p.setAttribute('NORMAL', null); p.setAttribute('TANGENT', null);
  const mat = p.getMaterial();
  const textured = mat && (mat.getBaseColorTexture() || mat.getNormalTexture() || mat.getMetallicRoughnessTexture() || mat.getEmissiveTexture() || mat.getOcclusionTexture());
  if (!textured) for (const a of ['TEXCOORD_0', 'TEXCOORD_1']) p.setAttribute(a, null);
  if (!textured && p.getAttribute('COLOR_0')) p.setAttribute('COLOR_0', null);
}
const steps = [prune(), dedup()];
if (nMat > 30) steps.push(palette({ min: 5 }));
steps.push(flatten(), join({ keepNamed: true }), weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: +ratioArg, error: +errArg, lockBorder: false }), resample(), prune(), sparse(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [+texArg, +texArg] }),
  draco());
await doc.transform(...steps);
let tri = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tri += (p.getIndices() ? p.getIndices().getCount() : 0) / 3;
console.log(JSON.stringify({ materials: nMat + '->' + root.listMaterials().length, meshes: root.listMeshes().length, tris: tri, wheelMeshes: root.listMeshes().filter((m) => /^wheel_/.test(m.getName())).length }));
console.log(JSON.stringify({ size: size.map((x) => +x.toFixed(2)), lenAxis: la, corners: Object.keys(corners), wheelParts: tagged, meshes: items.length, removed }));
await io.write(dst, doc);
