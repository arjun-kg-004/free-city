import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Random } from '../utils/Random.js';

/**
 * Realistic-looking trees without external assets:
 * crowns are clusters of alpha-tested leaf cards (hundreds of painted leaves each) with
 * spherical normals for soft light, trunks have branches, and everything sways in the wind.
 */

let leafTex = null;
let barkTex = null;

function leafTexture() {
  if (leafTex) return leafTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = new Random(321);
  g.clearRect(0, 0, 256, 256);
  // dense leaves near the middle, sparser at the edges -> soft, irregular silhouette
  for (let i = 0; i < 340; i++) {
    const a = r.next() * Math.PI * 2;
    const d = Math.pow(r.next(), 0.7) * 118;
    const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d;
    const len = r.range(9, 17), wid = len * r.range(0.38, 0.5);
    const l = r.range(52, 80);
    g.save();
    g.translate(x, y);
    g.rotate(r.next() * Math.PI * 2);
    g.fillStyle = `hsl(${r.range(85, 118)}, ${r.range(35, 55)}%, ${l}%)`;
    g.beginPath();
    g.ellipse(0, 0, len / 2, wid / 2, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = `hsla(100, 30%, ${l - 18}%, 0.55)`;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(-len / 2, 0); g.lineTo(len / 2, 0); g.stroke();
    g.restore();
  }
  leafTex = new THREE.CanvasTexture(c);
  leafTex.colorSpace = THREE.SRGBColorSpace;
  leafTex.anisotropy = 4;
  return leafTex;
}

function barkTexture() {
  if (barkTex) return barkTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  const r = new Random(654);
  g.fillStyle = '#5b4632'; g.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(${r.next() < 0.5 ? '30,22,14' : '120,100,80'},${r.range(0.15, 0.45)})`;
    g.fillRect(r.next() * 64, r.next() * 256, r.range(1, 3), r.range(20, 80));
  }
  barkTex = new THREE.CanvasTexture(c);
  barkTex.wrapS = barkTex.wrapT = THREE.RepeatWrapping;
  barkTex.colorSpace = THREE.SRGBColorSpace;
  return barkTex;
}

/** A cloud of leaf cards around `center`, normals pointing out from `normalCenter`. */
function leafCluster(r, center, radius, count, cardSize, normalCenter) {
  const pos = [], nrm = [], uv = [], idx = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // random point inside the cluster, biased to the surface
    const dir = new THREE.Vector3(r.range(-1, 1), r.range(-0.7, 1), r.range(-1, 1)).normalize();
    const p = dir.clone().multiplyScalar(radius * Math.pow(r.next(), 0.35)).add(center);
    q.setFromEuler(e.set(r.range(0, Math.PI), r.range(0, Math.PI * 2), r.range(0, Math.PI)));
    const s = cardSize * r.range(0.75, 1.25);
    const base = pos.length / 3;
    for (const [cx, cy] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      v.set(cx * s, cy * s, 0).applyQuaternion(q).add(p);
      pos.push(v.x, v.y, v.z);
      const nn = v.clone().sub(normalCenter).normalize();
      nrm.push(nn.x, nn.y, nn.z);
      uv.push(cx + 0.5, cy + 0.5);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function branch(from, to, r0, r1) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const g = new THREE.CylinderGeometry(r1, r0, dir.length(), 6, 1, true);
  g.translate(0, dir.length() / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  g.applyQuaternion(q);
  g.translate(from.x, from.y, from.z);
  return g;
}

const cache = {};

/** Leaf-card crown geometry. kind: 'round' | 'conifer' | 'bush'. */
export function crownGeometry(kind) {
  if (cache[kind]) return cache[kind];
  const r = new Random(kind === 'round' ? 11 : kind === 'conifer' ? 22 : 33);
  const parts = [];
  if (kind === 'round') {
    const c0 = new THREE.Vector3(0, 4.9, 0);
    const blobs = [[0, 5.3, 0, 1.7], [1.1, 4.6, 0.5, 1.3], [-1.0, 4.7, -0.4, 1.3], [0.3, 4.4, -1.1, 1.2], [-0.4, 4.3, 1.1, 1.2], [0.2, 6.2, 0.1, 1.1]];
    for (const [x, y, z, rad] of blobs) parts.push(leafCluster(r, new THREE.Vector3(x, y, z), rad, 26, 1.35, c0));
  } else if (kind === 'conifer') {
    for (let k = 0; k < 6; k++) {
      const y = 2.6 + k * 0.85;
      const rad = 2.0 * (1 - k / 6.5);
      parts.push(leafCluster(r, new THREE.Vector3(0, y, 0), rad, 18, 1.1, new THREE.Vector3(0, y - 0.4, 0)));
    }
  } else {
    parts.push(leafCluster(r, new THREE.Vector3(0, 0.6, 0), 0.85, 20, 0.8, new THREE.Vector3(0, 0.2, 0)));
  }
  cache[kind] = mergeGeometries(parts, false);
  return cache[kind];
}

/** Trunk with a few branches reaching into the crown. */
export function trunkGeometry(kind = 'round') {
  const key = `trunk-${kind}`;
  if (cache[key]) return cache[key];
  const parts = [];
  const top = kind === 'conifer' ? 6.5 : 4.4;
  const t = new THREE.CylinderGeometry(0.13, 0.27, top, 7, 1, true);
  t.translate(0, top / 2, 0);
  parts.push(t);
  if (kind === 'round') {
    const v = (x, y, z) => new THREE.Vector3(x, y, z);
    parts.push(branch(v(0, 3.0, 0), v(1.1, 4.5, 0.4), 0.1, 0.04));
    parts.push(branch(v(0, 3.2, 0), v(-1.0, 4.6, -0.4), 0.1, 0.04));
    parts.push(branch(v(0, 3.4, 0), v(0.3, 4.4, -1.1), 0.08, 0.03));
    parts.push(branch(v(0, 3.5, 0), v(-0.3, 4.3, 1.1), 0.08, 0.03));
  }
  for (const p of parts) { p.deleteAttribute('uv'); }
  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()), false);
  // simple cylindrical UVs for the bark
  const pos = merged.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { uv[i * 2] = Math.atan2(pos.getX(i), pos.getZ(i)) / Math.PI; uv[i * 2 + 1] = pos.getY(i) * 0.5; }
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  cache[key] = merged;
  return merged;
}

/** Wind sway (vertex shader), shared by leaves and grass. strength scales with height above `pivot`. */
export function addWind(material, shared, { pivot = 2.5, amount = 0.05, flutter = 0.02 } = {}) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, r) => {
    if (prev) prev(shader, r);
    shader.uniforms.uTime = shared.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
          #endif
          float h = max(0.0, transformed.y - ${pivot.toFixed(2)});
          float ph = ip.x * 0.31 + ip.z * 0.23;
          transformed.x += (sin(uTime * 1.3 + ph) * ${amount.toFixed(3)} + sin(uTime * 5.1 + position.y * 3.0 + ph * 3.0) * ${flutter.toFixed(3)}) * h;
          transformed.z += (cos(uTime * 1.1 + ph) * ${(amount * 0.7).toFixed(3)} + cos(uTime * 4.3 + position.x * 3.0 + ph) * ${flutter.toFixed(3)}) * h;
        }`);
  };
  material.customProgramCacheKey = () => `wind-${pivot}-${amount}`;
  return material;
}

export function foliageMaterials(shared) {
  const tex = leafTexture();
  const leaves = addWind(new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.82, metalness: 0 }), shared, { pivot: 2.5, amount: 0.035, flutter: 0.018 });
  const bushes = addWind(new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.85 }), shared, { pivot: 0.1, amount: 0.03, flutter: 0.02 });
  const depth = new THREE.MeshDepthMaterial({ map: tex, alphaTest: 0.42, depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  const bark = new THREE.MeshStandardMaterial({ map: barkTexture(), color: 0xb0a090, roughness: 0.95 });
  return { leaves, bushes, depth, bark };
}

/** Grass clump: crossed blades, base at y = 0. */
export function grassGeometry() {
  if (cache.grass) return cache.grass;
  const r = new Random(77);
  const pos = [], nrm = [], col = [], idx = [];
  for (let b = 0; b < 22; b++) {
    const a = r.next() * Math.PI * 2;
    const ox = r.range(-0.4, 0.4), oz = r.range(-0.4, 0.4);
    const h = r.range(0.08, 0.22), w = r.range(0.02, 0.04);
    const lean = r.range(0.02, 0.09);
    const dx = Math.cos(a), dz = Math.sin(a);
    const base = pos.length / 3;
    pos.push(ox - dz * w, 0, oz + dx * w, ox + dz * w, 0, oz - dx * w, ox + dx * lean, h, oz + dz * lean);
    for (let k = 0; k < 3; k++) nrm.push(0, 1, 0);
    const shade = r.range(0.7, 1.0), y = r.range(0, 0.05);
    col.push(0.2 * shade, 0.34 * shade, 0.09 * shade, 0.2 * shade, 0.34 * shade, 0.09 * shade, (0.42 + y) * shade, 0.6 * shade, 0.18 * shade);
    idx.push(base, base + 1, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  cache.grass = g;
  return g;
}

export function grassMaterial(shared) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, color: 0xffffff, side: THREE.DoubleSide });
  // blades are lit like the lawn they grow from: never flip the normal on the back face
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize( vNormal );');
  };
  return addWind(m, shared, { pivot: 0.0, amount: 0.09, flutter: 0.05 });
}
