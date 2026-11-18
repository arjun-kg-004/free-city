import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

/**
 * Spatially chunked instanced mesh.
 * Repeated objects (buildings, trees, lamps...) are bucketed into world chunks so that
 * frustum culling works per chunk, and props can be faded out beyond an LOD distance.
 */
export class InstanceBatch {
  constructor(geometry, material, opts = {}) {
    this.geometry = geometry;
    this.material = material;
    this.chunkSize = opts.chunkSize || 240;
    this.castShadow = opts.castShadow ?? true;
    this.receiveShadow = opts.receiveShadow ?? true;
    this.lodDistance = opts.lodDistance ?? Infinity; // Infinity => always visible
    this.lodScale = opts.lodScale ?? 1;               // multiplier on the global prop distance
    this.useColor = !!opts.colors;
    this.attributes = opts.attributes || {};          // { name: itemSize }
    this.depthMaterial = opts.depthMaterial || null;  // alpha-tested shadows (leaf cards)
    this.chunks = new Map();
    this.meshes = [];
    this.count = 0;
  }

  /** Add with explicit transform values. */
  add(x, y, z, rotY = 0, sx = 1, sy = 1, sz = 1, color = null, attrs = null, rotX = 0, rotZ = 0) {
    _p.set(x, y, z);
    _q.setFromEuler(_e.set(rotX, rotY, rotZ, 'YXZ'));
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    return this.addMatrix(_m, color, attrs);
  }

  addMatrix(matrix, color = null, attrs = null) {
    const x = matrix.elements[12], z = matrix.elements[14];
    const key = `${Math.floor(x / this.chunkSize)},${Math.floor(z / this.chunkSize)}`;
    let c = this.chunks.get(key);
    if (!c) {
      c = { matrices: [], colors: [], attrs: {}, cx: 0, cz: 0, n: 0 };
      for (const k of Object.keys(this.attributes)) c.attrs[k] = [];
      this.chunks.set(key, c);
    }
    c.matrices.push(matrix.clone());
    if (this.useColor) c.colors.push(color ? color.clone?.() || new THREE.Color(color) : new THREE.Color(1, 1, 1));
    for (const k of Object.keys(this.attributes)) {
      const v = attrs && attrs[k] !== undefined ? attrs[k] : 0;
      if (Array.isArray(v)) c.attrs[k].push(...v); else c.attrs[k].push(v);
    }
    c.cx += x; c.cz += z; c.n++;
    this.count++;
  }

  build(parent) {
    for (const c of this.chunks.values()) {
      const mesh = new THREE.InstancedMesh(this.geometry, this.material, c.matrices.length);
      c.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      if (this.useColor) c.colors.forEach((col, i) => mesh.setColorAt(i, col));
      for (const [k, size] of Object.entries(this.attributes)) {
        // Per-mesh geometry clone so each chunk carries its own instanced attribute buffer.
        if (mesh.geometry === this.geometry) mesh.geometry = this.geometry.clone();
        mesh.geometry.setAttribute(k, new THREE.InstancedBufferAttribute(new Float32Array(c.attrs[k]), size));
      }
      mesh.castShadow = this.castShadow;
      mesh.receiveShadow = this.receiveShadow;
      if (this.depthMaterial) mesh.customDepthMaterial = this.depthMaterial;
      mesh.computeBoundingSphere();
      mesh.userData.cx = c.cx / c.n;
      mesh.userData.cz = c.cz / c.n;
      mesh.userData.radius = mesh.boundingSphere ? mesh.boundingSphere.radius : this.chunkSize;
      mesh.instanceMatrix.needsUpdate = true;
      parent.add(mesh);
      this.meshes.push(mesh);
    }
    this.chunks.clear();
    return this;
  }

  updateLOD(camX, camZ, propDistance) {
    if (this.lodDistance === Infinity) return;
    const lim = (this.lodDistance === 'prop' ? propDistance : this.lodDistance) * this.lodScale;
    for (const mesh of this.meshes) {
      const d = Math.hypot(mesh.userData.cx - camX, mesh.userData.cz - camZ) - mesh.userData.radius;
      mesh.visible = d < lim;
    }
  }
}
