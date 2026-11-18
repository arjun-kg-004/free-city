import * as THREE from 'three';

/**
 * Accumulates simple primitives into one merged BufferGeometry (one draw call).
 * UVs are world-space so tiling textures line up across pieces.
 */
export class GeoBuilder {
  constructor(uvScale = 0.125) {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.uvScale = uvScale;
    this.useColor = false;
  }

  _v(x, y, z, nx, ny, nz, u, v, c) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    if (c) { this.useColor = true; this.col.push(c.r, c.g, c.b); } else this.col.push(1, 1, 1);
    return this.pos.length / 3 - 1;
  }

  /** Horizontal rectangle (facing up) between x0..x1, z0..z1 at height y. */
  rect(x0, z0, x1, z1, y, color = null) {
    const s = this.uvScale;
    const a = this._v(x0, y, z0, 0, 1, 0, x0 * s, -z0 * s, color);
    const b = this._v(x1, y, z0, 0, 1, 0, x1 * s, -z0 * s, color);
    const c = this._v(x1, y, z1, 0, 1, 0, x1 * s, -z1 * s, color);
    const d = this._v(x0, y, z1, 0, 1, 0, x0 * s, -z1 * s, color);
    this.idx.push(a, d, c, a, c, b);
  }

  /** Vertical wall quad from (x0,z0) to (x1,z1) between heights y0..y1; normal faces left of the direction. */
  wall(x0, z0, x1, z1, y0, y1, color = null, flip = false) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    let nx = -dz / len, nz = dx / len;
    if (flip) { nx = -nx; nz = -nz; }
    const s = this.uvScale;
    const a = this._v(x0, y0, z0, nx, 0, nz, 0, y0 * s, color);
    const b = this._v(x1, y0, z1, nx, 0, nz, len * s, y0 * s, color);
    const c = this._v(x1, y1, z1, nx, 0, nz, len * s, y1 * s, color);
    const d = this._v(x0, y1, z0, nx, 0, nz, 0, y1 * s, color);
    if (flip) this.idx.push(a, c, b, a, d, c);
    else this.idx.push(a, b, c, a, c, d);
  }

  /** Axis-aligned box (optionally rotated around Y about its centre). */
  box(cx, cy, cz, w, h, d, rotY = 0, color = null) {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const cs = Math.cos(rotY), sn = Math.sin(rotY);
    const tr = (x, z) => [cx + x * cs + z * sn, cz - x * sn + z * cs];
    const rn = (x, z) => [x * cs + z * sn, -x * sn + z * cs];
    const faces = [
      [[1, 0, 0], [[hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd], [hw, hh, hd]]],
      [[-1, 0, 0], [[-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd]]],
      [[0, 1, 0], [[-hw, hh, hd], [hw, hh, hd], [hw, hh, -hd], [-hw, hh, -hd]]],
      [[0, -1, 0], [[-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd]]],
      [[0, 0, 1], [[-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd]]],
      [[0, 0, -1], [[hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd]]],
    ];
    const s = this.uvScale;
    for (const [n, vs] of faces) {
      const [nx, nz] = rn(n[0], n[2]);
      const ids = vs.map(([x, y, z], k) => {
        const [wx, wz] = tr(x, z);
        const u = n[0] !== 0 ? (k === 1 || k === 2 ? d : 0) : (k === 1 || k === 2 ? w : 0);
        const v = n[1] !== 0 ? (k >= 2 ? d : 0) : (k >= 2 ? h : 0);
        return this._v(wx, cy + y, wz, nx, n[1], nz, u * s, v * s, color);
      });
      this.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.useColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }

  get empty() {
    return this.pos.length === 0;
  }
}
