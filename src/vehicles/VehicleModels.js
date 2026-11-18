import * as THREE from 'three';
import { flattenStatic } from '../utils/MergeUtils.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const GLASS_RE = /(^|[^a-z])(glass|window|windscreen|windshield)([^a-z]|$)/i;

/**
 * One-time clean-up of a loaded vehicle GLB (shared by every clone):
 * - meshes shipped without normals (our optimiser strips them so the simplifier can work)
 *   get crease-aware normals: smooth panels, crisp edges;
 * - glass becomes thin tinted see-through glass (no costly transmission pass);
 * - lamp materials are found by emission + position when names don't say what they are.
 */
export function prepareVehicleAsset(scene, isLod = false) {
  if (scene.userData.vehiclePrepared) return;
  scene.userData.vehiclePrepared = true;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.geometry.attributes.normal) o.geometry = toCreasedNormals(o.geometry, THREE.MathUtils.degToRad(isLod ? 45 : 38));
    if (isLod) return; // LOD materials are authored for distance (opaque glass, baked colours)
    const mats = [].concat(o.material);
    for (const m of mats) {
      if (m.userData.prepared) continue;
      m.userData.prepared = true;
      const isGlass = (m.transmission > 0) || (m.transparent && m.opacity < 0.9) || (GLASS_RE.test(m.name) && !/^tintglass_\d+$/i.test(m.name));
      if (isGlass) {
        m.transmission = 0;
        m.transparent = true;
        m.opacity = Math.min(m.opacity ?? 1, 0.42);
        m.color.lerp(new THREE.Color(0x101820), 0.75);
        m.roughness = 0.04;
        m.metalness = 0.1;
        m.depthWrite = false;
        m.userData.glass = true;
      }
      if (m.envMapIntensity !== undefined) m.envMapIntensity = 1.15;
    }
  });
}

const WHEEL_RE = /wheel|tire|tyre/i;
const NOT_WHEEL_RE = /steer|spare|arch|well|house|cover/i;

/**
 * Normalises any car / bike GLB: length along +Z, centred, wheels on the ground,
 * scaled to the vehicle's real length. Options: { rotateY: degrees, length: metres, keepScale: bool }.
 */
export function fitVehicleModel(scene, targetLength, options = {}) {
  const model = scene.clone(true);
  const holder = new THREE.Group();
  holder.add(model);
  model.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  // Longest horizontal side is the vehicle's length; rotate it onto Z unless told otherwise.
  if (options.rotateY !== undefined) model.rotation.y = THREE.MathUtils.degToRad(options.rotateY);
  else if (size.x > size.z * 1.15) model.rotation.y = Math.PI / 2;
  model.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model);
  const len = box.max.z - box.min.z;
  const want = options.length || targetLength;
  const realistic = len > want * 0.7 && len < want * 1.4;
  const s = options.keepScale || realistic ? 1 : want / Math.max(0.01, len);
  model.scale.multiplyScalar(s);
  model.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model);
  // Make sure the nose points to +Z: compare front vs rear wheels / lights.
  if (options.rotateY === undefined && frontIsBackwards(model, scene, options.kind || 'car')) {
    model.rotation.y += Math.PI;
    model.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model);
  }
  holder.userData.rotateYDeg = THREE.MathUtils.radToDeg(model.rotation.y); // so a LOD can be fitted identically
  const c = box.getCenter(new THREE.Vector3());
  model.position.x -= c.x;
  model.position.z -= c.z;
  model.position.y -= box.min.y;
  model.updateMatrixWorld(true);
  holder.updateMatrixWorld(true);
  return holder;
}

const FRONT_RE = /(^|[^a-z])(f|front)[_\s.-]?(l|r|left|right)?($|[^a-z])|_f[lr]\b|front|head.?light|headlamp/i;
const REAR_RE = /(^|[^a-z])(r|rear|back)[_\s.-]?(l|r|left|right)($|[^a-z])|_r[lr]\b|rear|back|tail.?light|brake.?light/i;

function frontIsBackwards(model, src, kind) {
  const named = frontByNames(model);
  if (named !== null) return named;
  // no telling names: decide from the shape once per source model
  const key = `noseBack_${kind}`;
  if (src.userData[key] === undefined) src.userData[key] = frontByShape(model, kind);
  return src.userData[key];
}

/**
 * Cars: the bonnet is lower than the roof / tailgate / rear wing, so the LOWER end is the nose.
 * Bikes: the handlebars + mirrors are the highest points, and they sit toward the front.
 */
function frontByShape(model, kind) {
  model.updateMatrixWorld(true);
  const pts = [];
  const v = new THREE.Vector3();
  model.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 4000));
    for (let i = 0; i < pos.count; i += step) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); pts.push(v.x, v.y, v.z); }
  });
  if (pts.length < 30) return false;
  let z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 3) { z0 = Math.min(z0, pts[i + 2]); z1 = Math.max(z1, pts[i + 2]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
  const len = z1 - z0, h = y1 - y0;
  if (kind === 'car') {
    const hi = (zmin, zmax) => {
      const ys = [];
      for (let i = 0; i < pts.length; i += 3) if (pts[i + 2] >= zmin && pts[i + 2] <= zmax) ys.push(pts[i + 1]);
      if (!ys.length) return 0;
      ys.sort((a, b) => a - b);
      return ys[Math.floor(ys.length * 0.97)];
    };
    const front = hi(z1 - len * 0.2, z1), rear = hi(z0, z0 + len * 0.2);
    return front > rear + h * 0.03; // +Z end is taller -> it's actually the back
  }
  // bikes / bicycles: centroid of the top 4% of points
  let sz = 0, n = 0;
  for (let i = 0; i < pts.length; i += 3) if (pts[i + 1] > y1 - h * 0.06) { sz += pts[i + 2]; n++; }
  return n > 0 && sz / n < (z0 + z1) / 2;
}

function frontByNames(model) {
  let fz = 0, fn = 0, rz = 0, rn = 0;
  const p = new THREE.Vector3();
  model.traverse((o) => {
    const n = o.name || '';
    const mats = o.isMesh ? [].concat(o.material).map((m) => m.name).join(' ') : '';
    const isFront = FRONT_RE.test(n) || /head.?light|headlamp|projector/i.test(mats);
    const isRear = REAR_RE.test(n) || /tail.?light|brake|taillight/i.test(mats);
    if (isFront === isRear) return;
    const b = new THREE.Box3().setFromObject(o);
    if (b.isEmpty()) return;
    b.getCenter(p);
    if (isFront) { fz += p.z; fn++; } else { rz += p.z; rn++; }
  });
  if (!fn || !rn) return null;
  return fz / fn < rz / rn;
}

/**
 * Finds wheel objects and wraps each in pivot (steer, Y) + spinner (roll) groups so they can
 * turn and roll regardless of how the artist oriented them.
 */
export function rigWheels(holder) {
  const found = [];
  holder.traverse((o) => {
    if (!WHEEL_RE.test(o.name) || NOT_WHEEL_RE.test(o.name)) return;
    // skip objects whose ancestor is already a wheel
    let a = o.parent;
    while (a && a !== holder) { if (found.includes(a)) return; a = a.parent; }
    found.push(o);
  });
  const wheels = [];
  holder.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(holder.matrixWorld).invert();
  for (const w of found) {
    const box = new THREE.Box3().setFromObject(w);
    if (box.isEmpty()) continue;
    const center = box.getCenter(new THREE.Vector3()).applyMatrix4(inv);
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.y / 2, 0.15);
    // re-parent the wheel under pivot/spinner located at its centre (keeping its world transform)
    const pivot = new THREE.Group();
    const spinner = new THREE.Group();
    pivot.position.copy(center);
    pivot.add(spinner);
    holder.add(pivot);
    holder.updateMatrixWorld(true);
    spinner.attach(w);
    wheels.push({ pivot, spinner, r, front: center.z > 0 });
  }
  return wheels;
}

const BRAKE_RE = /tail|brake|rear.?light|stop.?light/i;
const HEAD_RE = /head.?light|projector|front.?light|lamp_front/i;
const PAINT_RE = /paint|body.?col|car.?body|body|exterior|carpaint/i;

/** Lights and paint materials of a model, so the game can drive brake lights / tint traffic. */
export function findModelMaterials(root) {
  const brake = new Set(), head = new Set();
  let paint = null;
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      const n = `${m.name} ${o.name}`;
      if (BRAKE_RE.test(n)) brake.add(m);
      else if (HEAD_RE.test(n)) head.add(m);
      // only an untextured paint can be recoloured (a texture holds its own livery); LOD groups other than lod_paint are not paint
      else if (!paint && PAINT_RE.test(m.name) && !/tintglass|^lod_(body|glass|lamp)/i.test(m.name) && !m.map) paint = m;
    }
  });
  if (!brake.size && !head.size) {
    // unnamed lamps: emissive parts at the nose are headlights, at the tail brake lights
    root.updateMatrixWorld(true);
    const all = new THREE.Box3().setFromObject(root);
    const len = all.max.z - all.min.z;
    const b = new THREE.Box3(), c = new THREE.Vector3();
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) {
        const glow = m.emissive && (m.emissiveMap || m.emissive.r + m.emissive.g + m.emissive.b > 0.15);
        if (!glow) continue;
        b.setFromObject(o).getCenter(c);
        if (c.z > all.max.z - len * 0.22) head.add(m);
        else if (c.z < all.min.z + len * 0.22) brake.add(m);
      }
    });
  }
  return { brake: [...brake], head: [...head], paint };
}

/**
 * Prepares a car model for instanced traffic: fitted, flattened, one geometry per material,
 * with the paint material made white so per-car colours can be applied via instance colour.
 */
export function prepareTrafficModel(scene, options = {}) {
  prepareVehicleAsset(scene);
  const fitted = fitVehicleModel(scene, options.length || 4.5, { kind: 'car', ...options });
  const full = instancedParts(fitted);
  let lod = null;
  if (options.lodGltf) {
    prepareVehicleAsset(options.lodGltf.scene, true);
    const lf = fitVehicleModel(options.lodGltf.scene, options.length || 4.5, { ...options, rotateY: fitted.userData.rotateYDeg, keepScale: false });
    lod = instancedParts(lf);
  }
  const box = new THREE.Box3().setFromObject(fitted);
  const height = box.max.y;
  const tintable = full.parts.some((p) => p.paint);
  return {
    parts: full.parts, tris: full.tris, lod,
    length: box.max.z - box.min.z, width: box.max.x - box.min.x, height,
    shape: options.shape || (height > 1.55 ? 'suv' : 'sports'),
    // far boxes of untintable models use this; without a manifest colour, the LOD's baked body colour
    color: options.color || (!tintable && lod ? bakedColor(lod.parts) : null),
    tintable,
  };
}

/** Average vertex colour of the LOD body (baked from the model's textures), as a hex string. */
function bakedColor(parts) {
  const sum = new THREE.Color(0, 0, 0);
  let n = 0;
  for (const p of parts) {
    const c = p.geometry.attributes.color;
    if (!c || !/lod_body/.test(p.material.name)) continue;
    for (let i = 0; i < c.count; i++) { sum.r += c.getX(i); sum.g += c.getY(i); sum.b += c.getZ(i); }
    n += c.count;
  }
  return n ? `#${sum.multiplyScalar(1 / n).getHexString()}` : null;
}

/** Fitted model -> one geometry per material (white paint for per-instance colour). */
function instancedParts(fitted) {
  const { paint } = findModelMaterials(fitted);
  const flat = flattenStatic(fitted);
  const parts = [];
  let tris = 0;
  for (const m of flat.children) {
    if (!m.isMesh) continue;
    let mat = m.material;
    const isPaint = paint && mat === paint;
    if (isPaint) { mat = mat.clone(); mat.color.set(0xffffff); }
    parts.push({ geometry: m.geometry, material: mat, paint: !!isPaint, castShadow: m.castShadow });
    tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  }
  return { parts, tris };
}
