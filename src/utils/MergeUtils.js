import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Merges the direct Mesh children of `group` into one mesh per material.
 * Used on vehicle bodies (dozens of boxes/tubes) to cut draw calls dramatically.
 */
export function mergeMeshChildren(group) {
  const byMat = new Map();
  for (const c of [...group.children]) {
    if (!c.isMesh || c.isInstancedMesh || c.userData.noMerge) continue;
    c.updateMatrix();
    const g = c.geometry.clone();
    g.applyMatrix4(c.matrix);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    // vertex colours (e.g. baked LOD paint) as plain float RGB, so differently encoded meshes still merge
    if (g.attributes.color) {
      const c = g.attributes.color, rgb = new Float32Array(c.count * 3);
      for (let i = 0; i < c.count; i++) { rgb[i * 3] = c.getX(i); rgb[i * 3 + 1] = c.getY(i); rgb[i * 3 + 2] = c.getZ(i); }
      g.setAttribute('color', new THREE.Float32BufferAttribute(rgb, 3));
    }
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    g.morphAttributes = {};
    if (!byMat.has(c.material)) byMat.set(c.material, []);
    byMat.get(c.material).push({ g, shadow: c.castShadow });
    group.remove(c);
  }
  for (const [mat, list] of byMat) {
    // all or none: meshes sharing a material without vertex colours get white ones
    if (list.some((l) => l.g.attributes.color)) {
      for (const l of list) if (!l.g.attributes.color) l.g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(l.g.attributes.position.count * 3).fill(1), 3));
    }
    const merged = list.length === 1 ? list[0].g : mergeGeometries(list.map((l) => l.g), false);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = list.some((l) => l.shadow);
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

/** Bakes a whole static hierarchy into one mesh per material (for showroom props). */
export function flattenStatic(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const holder = new THREE.Group();
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) meshes.push(o); });
  for (const m of meshes) {
    const clone = new THREE.Mesh(m.geometry, m.material);
    clone.castShadow = m.castShadow;
    const rel = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    rel.decompose(clone.position, clone.quaternion, clone.scale);
    holder.add(clone);
  }
  mergeMeshChildren(holder);
  const out = new THREE.Group();
  out.position.copy(root.position);
  out.quaternion.copy(root.quaternion);
  out.scale.copy(root.scale);
  for (const c of [...holder.children]) out.add(c);
  return out;
}
