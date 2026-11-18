import * as THREE from 'three';
import { CAR_SHAPES } from '../vehicles/VehicleTypes.js';
import { unitCarBody, unitCarCabin, roofPlacement, isBoxy } from '../vehicles/CarShapes.js';

const _m = new THREE.Matrix4();
const _base = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Renders many simple cars with ~8 draw calls total (body, cabin, roof, wheels, lights...).
 * Used for AI traffic (dynamic) and parked cars (static), and as the far-distance LOD
 * when realistic car models are loaded.
 */
export class CarInstancer {
  constructor(scene, capacity, { dynamic = true } = {}) {
    this.capacity = capacity;
    this.dynamic = dynamic;
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const wheel = new THREE.CylinderGeometry(1, 1, 1, 10);
    wheel.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
    rimGeo.rotateZ(Math.PI / 2);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.35, metalness: 0.8 });
    const paint = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.4 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x1d2733, roughness: 0.1, metalness: 0.4 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
    const lamp = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const mk = (geo, mat, perCar, colors) => {
      const im = new THREE.InstancedMesh(geo, mat, capacity * perCar);
      im.instanceMatrix.setUsage(dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
      im.castShadow = mat !== lamp;
      im.receiveShadow = false;
      im.frustumCulled = false;
      for (let i = 0; i < capacity * perCar; i++) im.setMatrixAt(i, HIDDEN);
      if (colors) for (let i = 0; i < capacity * perCar; i++) im.setColorAt(i, new THREE.Color(1, 1, 1));
      scene.add(im);
      return im;
    };
    this.parts = {
      body: mk(unitCarBody(), paint, 1, true),
      cabin: mk(unitCarCabin(), glass, 1, false),
      cabinBox: mk(unit, glass, 1, false),
      roof: mk(unit, paint, 1, true),
      wheels: mk(wheel, rubber, 4, false),
      rims: mk(rimGeo, rimMat, 4, false),
      head: mk(unit, lamp, 2, true),
      tail: mk(unit, lamp, 2, true),
      sign: mk(unit, lamp, 1, true),
    };
    this.locals = {}; // shape -> part local matrices
    for (const [k, s] of Object.entries(CAR_SHAPES)) this.locals[k] = this._buildLocals(s);
    this.slots = new Array(capacity).fill(null);
    // per-slot state; visible cars are packed into the instance buffers on commit(), so hidden
    // slots cost nothing on the GPU (no zero-scale instances being drawn)
    this.state = Array.from({ length: capacity }, () => ({ visible: false, x: 0, y: 0, z: 0, h: 0, color: new THREE.Color(1, 1, 1), brake: false }));
    this._head = new THREE.Color(0xfff6dc);
    this._sign = new THREE.Color(0xffd21f);
    this._brakeOn = new THREE.Color(0xff2a2a);
    this._brakeOff = new THREE.Color(0x6a0d0d);
  }

  _buildLocals(s) {
    const M = (x, y, z, sx, sy, sz) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
    const by = s.clearance + s.bodyH / 2;
    const cy = s.clearance + s.bodyH + s.cabH / 2;
    const wz = s.L / 2 - Math.max(0.65, s.wheelR * 2.1);
    const rf = roofPlacement(s);
    const wheelPos = [[-1, 1], [1, 1], [-1, -1], [1, -1]];
    return {
      body: [M(0, by, 0, s.W, s.bodyH, s.L)],
      cabin: isBoxy(s) ? [] : [M(0, cy, s.cabZ, s.W * 0.88, s.cabH, s.cabL)],
      cabinBox: isBoxy(s) ? [M(0, cy, s.cabZ, s.W * 0.88, s.cabH, s.cabL)] : [],
      roof: [M(0, cy + s.cabH / 2 + 0.02, rf.z, rf.w, 0.06, rf.l)],
      wheels: wheelPos.map(([sx, sz]) => M(sx * (s.W / 2 - 0.12), s.wheelR, sz * wz, 0.26, s.wheelR, s.wheelR)),
      rims: wheelPos.map(([sx, sz]) => M(sx * (s.W / 2 - 0.11), s.wheelR, sz * wz, 0.27, s.wheelR * 0.58, s.wheelR * 0.58)),
      head: [-1, 1].map((sx) => M(sx * (s.W / 2 - 0.27), by + s.bodyH * 0.04, s.L / 2 + 0.01, 0.36, 0.12, 0.05)),
      tail: [-1, 1].map((sx) => M(sx * (s.W / 2 - 0.25), by + s.bodyH * 0.18, -s.L / 2 - 0.03, 0.32, 0.13, 0.05)),
      sign: s.sign ? [M(0, cy + s.cabH / 2 + 0.17, s.cabZ, 0.7, 0.22, 0.25)] : [],
    };
  }

  /** Set the colour scheme of a slot. */
  setStyle(slot, shape, color) {
    this.slots[slot] = shape;
    this.state[slot].color.set(color);
    this.state[slot].brake = false;
  }

  setBrake(slot, on) {
    this.state[slot].brake = !!on;
  }

  setTransform(slot, x, z, heading, y = 0) {
    if (!this.slots[slot]) return;
    const st = this.state[slot];
    st.visible = true; st.x = x; st.z = z; st.h = heading; st.y = y;
  }

  hide(slot) {
    this.state[slot].visible = false;
  }

  commit() {
    const P = this.parts;
    const n = {};
    for (const k of Object.keys(P)) n[k] = 0;
    for (let slot = 0; slot < this.capacity; slot++) {
      const st = this.state[slot];
      const shape = this.slots[slot];
      if (!st.visible || !shape) continue;
      const L = this.locals[shape];
      _q.setFromAxisAngle(_yAxis, st.h);
      _base.compose(_p.set(st.x, st.y, st.z), _q, _s.set(1, 1, 1));
      for (const k in P) {
        const im = P[k];
        for (const local of L[k]) {
          const i = n[k]++;
          im.setMatrixAt(i, _m.multiplyMatrices(_base, local));
          if (im.instanceColor) {
            const c = k === 'body' || k === 'roof' ? st.color : k === 'head' ? this._head : k === 'tail' ? (st.brake ? this._brakeOn : this._brakeOff) : this._sign;
            im.setColorAt(i, c);
          }
        }
      }
    }
    for (const k in P) {
      const im = P[k];
      im.count = n[k];
      im.visible = n[k] > 0;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      if (im.frustumCulled && n[k]) im.computeBoundingSphere();
    }
  }

  finalizeStatic() {
    this.commit();
    for (const im of Object.values(this.parts)) { im.frustumCulled = true; im.computeBoundingSphere(); }
  }
}

/**
 * Instanced realistic car models (one InstancedMesh per model material).
 * Visible cars are packed at the front and `count` limits drawing, so a heavy model
 * costs nothing for cars that aren't currently shown in detail.
 */
export class ModelCarInstancer {
  constructor(scene, capacity, models, { castShadow = true } = {}) {
    this.capacity = capacity;
    this.models = models;
    this.counts = new Int32Array(models.length);
    this._c = new THREE.Color();
    this.meshes = models.map((m) => m.parts.map((part) => {
      const im = new THREE.InstancedMesh(part.geometry, part.material, capacity);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.castShadow = castShadow && part.castShadow !== false;
      im.receiveShadow = true;
      im.count = 0;
      im.visible = false;
      if (part.paint) for (let i = 0; i < capacity; i++) im.setColorAt(i, new THREE.Color(1, 1, 1));
      im.userData.paint = part.paint;
      scene.add(im);
      return im;
    }));
  }

  begin() {
    this.counts.fill(0);
  }

  add(modelIdx, x, z, heading, color) {
    const n = this.counts[modelIdx]++;
    _q.setFromAxisAngle(_yAxis, heading);
    _base.compose(_p.set(x, 0, z), _q, _s.set(1, 1, 1));
    this._c.set(color);
    for (const im of this.meshes[modelIdx]) {
      im.setMatrixAt(n, _base);
      if (im.userData.paint) im.setColorAt(n, this._c);
    }
  }

  end() {
    this.meshes.forEach((list, k) => {
      for (const im of list) {
        im.count = this.counts[k];
        im.visible = im.count > 0; // empty models issue no draw calls
        if (!im.count) continue;
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    });
  }
}

/**
 * Three-tier car renderer (same API as CarInstancer, plus commit(focus)):
 *  - FULL: the original detailed model for the few cars right next to the camera,
 *  - MID:  a baked LOD (textures in vertex colours, 3-4 draw calls per model) out to midDist,
 *  - FAR:  cheap instanced box cars beyond that.
 * Models without a LOD fall back to the old near/far behaviour with a triangle budget.
 */
export class HybridCarRenderer {
  constructor(scene, capacity, models, { dynamic = true, nearDist = 70, triBudget = 900000, fullDist = 16, maxFull = 3, midDist = 110, farDist = Infinity } = {}) {
    this.farDist = farDist;
    this.box = new CarInstancer(scene, capacity, { dynamic });
    const has = models && models.length;
    this.model = has ? new ModelCarInstancer(scene, capacity, models) : null;
    this.hasLod = has && models.every((m) => m.lod);
    this.mid = this.hasLod ? new ModelCarInstancer(scene, capacity, models.map((m) => ({ ...m, parts: m.lod.parts, tris: m.lod.tris }))) : null;
    const maxTris = has ? Math.max(...models.map((m) => m.tris)) : 1;
    this.maxNear = this.hasLod ? maxFull : Math.max(1, Math.min(capacity, Math.floor(triBudget / Math.max(1, maxTris))));
    this.nearDist = this.hasLod ? fullDist : nearDist;
    this.midDist = this.hasLod ? midDist : 0;
    this.pose = Array.from({ length: capacity }, () => ({ x: 0, z: 0, h: 0, visible: false, modelIdx: -1, shape: null, color: '#ffffff' }));
    this.capacity = capacity;
    this._c = [];
  }

  setStyle(slot, shape, color) {
    this.box.setStyle(slot, shape, color);
    const p = this.pose[slot];
    p.shape = shape;
    p.color = color;
    p.modelIdx = -1;
    if (this.model && shape !== 'bus' && shape !== 'van' && shape !== 'taxi') {
      const M = this.model.models;
      const same = M.map((m, i) => i).filter((i) => M[i].shape === shape);
      const pool = same.length ? same : M.map((m, i) => i);
      p.modelIdx = pool[(slot * 7 + 3) % pool.length];
      const m = M[p.modelIdx];
      // untintable models keep their own paint, so the far box should match it
      if (!m.tintable && m.color) { p.color = m.color; this.box.setStyle(slot, shape, m.color); }
    }
  }

  setBrake(slot, on) {
    this.box.setBrake(slot, on);
  }

  setTransform(slot, x, z, heading) {
    const p = this.pose[slot];
    p.x = x; p.z = z; p.h = heading; p.visible = true;
  }

  hide(slot) {
    this.pose[slot].visible = false;
  }

  commit(focus) {
    const near = new Set();
    const c = this._c; c.length = 0;
    if (this.model && focus) {
      for (let i = 0; i < this.capacity; i++) {
        const p = this.pose[i];
        if (!p.shape || !p.visible || p.modelIdx < 0) continue;
        const d = Math.hypot(p.x - focus.x, p.z - focus.z);
        if (d < Math.max(this.nearDist, this.midDist)) c.push([d, i]);
      }
      c.sort((a, b) => a[0] - b[0]);
      for (let k = 0; k < Math.min(c.length, this.maxNear); k++) if (c[k][0] < this.nearDist) near.add(c[k][1]);
    }
    const midSet = new Set();
    if (this.mid) for (const [d, i] of c) if (!near.has(i) && d < this.midDist) midSet.add(i);
    if (this.model) this.model.begin();
    if (this.mid) this.mid.begin();
    for (let i = 0; i < this.capacity; i++) {
      const p = this.pose[i];
      if (!p.shape) continue;
      if (!p.visible || (focus && this.farDist < Infinity && Math.hypot(p.x - focus.x, p.z - focus.z) > this.farDist)) { this.box.hide(i); continue; }
      if (near.has(i)) { this.model.add(p.modelIdx, p.x, p.z, p.h, p.color); this.box.hide(i); }
      else if (midSet.has(i)) { this.mid.add(p.modelIdx, p.x, p.z, p.h, p.color); this.box.hide(i); }
      else this.box.setTransform(i, p.x, p.z, p.h);
    }
    this.box.commit();
    if (this.model) this.model.end();
    if (this.mid) this.mid.end();
  }

  finalizeStatic() {
    this.commit(null);
    this.box.finalizeStatic();
  }
}
