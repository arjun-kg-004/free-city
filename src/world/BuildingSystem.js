import * as THREE from 'three';
import { SIDEWALK } from '../config.js';
import { Random } from '../utils/Random.js';
import { InstanceBatch } from '../utils/InstanceBatch.js';
import { createBuildingMaterial } from './BuildingMaterial.js';
import { Materials } from './Materials.js';

const SHOP_NAMES = [
  'Masala Mornings', 'Urban Threads', 'Book Nook', 'Pixel Electronics', 'Bloom Florist', 'Sweet Tooth Bakery',
  'Kaapi Corner', 'Tiffin Express', 'Silk & Spice', 'Gadget Galaxy', 'Green Grocer', 'MediCare Pharmacy',
  'Sole Street Shoes', 'Toy Town', 'Daily Needs', 'The Barber Lounge', 'Sunrise Opticals', 'Mithai Mahal',
  'Coastal Catch', 'Pizza Piazza', 'Noodle Nation', 'Dosa Darbar', 'Biryani House', 'Juice Junction',
  'Cycle Hub', 'Hardware Haven', 'Music Mantra', 'Lens Studio', 'Fresh Bake', 'Paper Planet',
];
const SIGN_COLORS = ['#b3202a', '#1d5fa8', '#1f7a4d', '#7a2f8e', '#c9661a', '#222831', '#0f766e', '#a21caf', '#854d0e', '#334155'];

const PALETTES = {
  office: ['#8fa3b8', '#6f8296', '#a7b4c2', '#5d6f7f', '#b9c2c9', '#7d8b9b', '#9eb2a8', '#c2b8a8'],
  apt: ['#d8c8b0', '#c9b79c', '#e0d4c0', '#b8a68c', '#d6b8a0', '#c4ccd4', '#e6dccb'],
  house: ['#f2e3c6', '#e8c9a8', '#d9e4ec', '#f0d8d0', '#e3edd5', '#f6efd9', '#e9d2b4', '#d5dde8'],
  roof: ['#8b3a2f', '#6e4a3a', '#5c5c66', '#7a4b36', '#9c5236', '#4f5b66'],
  ind: ['#9a958b', '#8a8f94', '#a39a88', '#7f8b8f', '#b0a594'],
  shop: ['#e8dcc8', '#d9c3a5', '#c7d3dd', '#e9d6cf', '#d4d9c8', '#efe6d6', '#cdb9a0'],
  hotel: ['#f4f1ea', '#eae2d2', '#dfeaf0', '#f2e6dc', '#e6eee6'],
};

export class BuildingSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.rng = new Random(424242);
    this.group = new THREE.Group();
    this.group.name = 'buildings';
    ctx.root.add(this.group);
    this.footprints = [];
    this.shopFronts = []; // { x, z, nx, nz, name, enterable? }
    this.signs = [];
    const attrs = { aStyle: 1, aSeed: 1 };
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 1);
    cyl.translate(0, 0.5, 0);
    this.boxBatch = new InstanceBatch(box, createBuildingMaterial(), { colors: true, attributes: attrs });
    this.cylBatch = new InstanceBatch(cyl, createBuildingMaterial({ cylinder: true }), { colors: true, attributes: attrs });
    // Gable roof prism (unit, base at y=0, ridge along z)
    const prism = new THREE.BufferGeometry();
    const P = [
      -0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5,
      -0.5, 0, 0.5, 0, 1, 0.5, 0.5, 0, 0.5,
      -0.5, 0, -0.5, 0, 1, -0.5, 0, 1, 0.5, -0.5, 0, -0.5, 0, 1, 0.5, -0.5, 0, 0.5,
      0.5, 0, -0.5, 0.5, 0, 0.5, 0, 1, 0.5, 0.5, 0, -0.5, 0, 1, 0.5, 0, 1, -0.5,
    ];
    prism.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    prism.computeVertexNormals();
    this.roofBatch = new InstanceBatch(prism, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }), { colors: true });
    const ac = new THREE.BoxGeometry(1, 1, 1);
    ac.translate(0, 0.5, 0);
    this.detailBatch = new InstanceBatch(ac, Materials.instColor, { colors: true, lodDistance: 'prop', lodScale: 1.5, castShadow: false });
    const tank = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
    tank.translate(0, 0.5, 0);
    this.tankBatch = new InstanceBatch(tank, Materials.instColor, { colors: true, lodDistance: 'prop', lodScale: 1.5 });
    const awn = new THREE.BoxGeometry(1, 0.12, 1);
    this.awningBatch = new InstanceBatch(awn, Materials.instColor, { colors: true, lodDistance: 'prop', castShadow: false });
    const slab = new THREE.BoxGeometry(1, 0.18, 1);
    this.balconyBatch = new InstanceBatch(slab, Materials.concrete, { lodDistance: 'prop', lodScale: 1.3, castShadow: false });
    const fence = new THREE.BoxGeometry(1, 1, 0.08);
    fence.translate(0, 0.5, 0);
    this.fenceBatch = new InstanceBatch(fence, Materials.instColor, { colors: true, lodDistance: 'prop', castShadow: false });
    this.containerBatch = new InstanceBatch(box, Materials.instColor, { colors: true, lodDistance: 'prop', lodScale: 1.4 });
    this.groundGB = []; // paved / grass lots { x0,z0,x1,z1, mat }
  }

  col(list) {
    return new THREE.Color(this.rng.pick(list));
  }

  /** Register a solid building volume (visual + collider + minimap footprint). */
  addBox(x, z, w, d, h, color, style, opts = {}) {
    this.boxBatch.add(x, opts.y || 0, z, 0, w, h, d, color, { aStyle: style, aSeed: this.rng.next() * 100 });
    if (opts.collide !== false) this.ctx.physics.addBox(x, (opts.y || 0) + h / 2, z, w / 2, h / 2, d / 2);
    if (!opts.noFootprint) this.footprints.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, h, color: color.getStyle() });
    if (opts.roofDetails !== false && h > 9 && w > 6 && d > 6) this._roofDetails(x, z, w, d, (opts.y || 0) + h);
  }

  addCylinder(x, z, r, h, color, style) {
    this.cylBatch.add(x, 0, z, 0, r * 2, h, r * 2, color, { aStyle: style, aSeed: this.rng.next() * 100 });
    this.ctx.physics.addCylinder(x, h / 2, z, h / 2, r);
    this.footprints.push({ x0: x - r, z0: z - r, x1: x + r, z1: z + r, h, round: true, color: color.getStyle() });
  }

  _roofDetails(x, z, w, d, top) {
    const r = this.rng;
    const n = r.int(1, 3);
    for (let k = 0; k < n; k++) {
      const s = r.range(1.4, 3);
      this.detailBatch.add(x + r.range(-w / 2 + 2, w / 2 - 2), top, z + r.range(-d / 2 + 2, d / 2 - 2), 0, s, r.range(0.8, 1.6), s * 0.8, new THREE.Color(0x8b8f94));
    }
    if (r.chance(0.35)) this.tankBatch.add(x + r.range(-w / 4, w / 4), top, z + r.range(-d / 4, d / 4), 0, 2.4, 2.6, 2.4, new THREE.Color(0x5f6b73));
  }

  build() {
    const L = this.ctx.layout;
    this.ctx.sites = this.ctx.sites || {};
    for (const b of L.blocks) {
      const ib = { x0: b.x0 + SIDEWALK, x1: b.x1 - SIDEWALK, z0: b.z0 + SIDEWALK, z1: b.z1 - SIDEWALK, b };
      switch (b.type) {
        case 'DT': this._downtown(ib); break;
        case 'COM': this._commercial(ib); break;
        case 'RES': this._residential(ib); break;
        case 'APT': this._apartments(ib); break;
        case 'IND': this._industrial(ib); break;
        case 'SEA': this._seafront(ib); break;
        case 'CIVIC': this._civic(ib); break;
        default: break;
      }
    }
    this._buildSigns();
    this._buildLots();
    for (const bt of [this.boxBatch, this.cylBatch, this.roofBatch, this.detailBatch, this.tankBatch, this.awningBatch, this.balconyBatch, this.fenceBatch, this.containerBatch]) {
      bt.build(this.group);
    }
    this.batches = [this.detailBatch, this.tankBatch, this.awningBatch, this.balconyBatch, this.fenceBatch, this.containerBatch];
  }

  lot(ib, mat) {
    this.groundGB.push({ x0: ib.b.x0 + SIDEWALK, z0: ib.b.z0 + SIDEWALK, x1: ib.b.x1 - SIDEWALK, z1: ib.b.z1 - SIDEWALK, mat });
  }

  // ---------- District generators ----------
  _downtown(ib) {
    const r = this.rng;
    this.lot(ib, 'concrete');
    const gap = 4;
    const pw = (ib.x1 - ib.x0 - gap) / 2, pd = (ib.z1 - ib.z0 - gap) / 2;
    const b = ib.b;
    const central = 1 - Math.min(1, Math.hypot(b.bi - 1.5, b.bj - 0.5) / 2);
    for (let py = 0; py < 2; py++) for (let px = 0; px < 2; px++) {
      const cx = ib.x0 + pw / 2 + px * (pw + gap);
      const cz = ib.z0 + pd / 2 + py * (pd + gap);
      if (b.bi === 1 && b.bj === 1 && px === 1 && py === 0) { this.ctx.sites.skyNeedle = { x: cx, z: cz }; continue; }
      const h = r.range(38, 70) + central * r.range(20, 80);
      const color = this.col(PALETTES.office);
      const kind = r.next();
      if (kind < 0.18 && Math.abs(pw - pd) < 6) {
        const rad = Math.min(pw, pd) / 2 - 1;
        this.addCylinder(cx, cz, rad, h, color, 0);
        this.tankBatch.add(cx, h, cz, 0, rad * 1.2, 1.5, rad * 1.2, new THREE.Color(0x6b7680));
      } else if (kind < 0.45) {
        this.addBox(cx, cz, pw - 1, pd - 1, h * 0.55, color, 0, { roofDetails: false });
        const c2 = color.clone().offsetHSL(0, 0, 0.06);
        this.addBox(cx, cz, (pw - 1) * 0.7, (pd - 1) * 0.7, h * 0.3, c2, 0, { y: h * 0.55, noFootprint: true, roofDetails: false });
        this.addBox(cx, cz, (pw - 1) * 0.45, (pd - 1) * 0.45, h * 0.18, c2, 0, { y: h * 0.85, noFootprint: true });
      } else {
        this.addBox(cx, cz, pw - 1, pd - 1, h, color, 0);
      }
      // Lobby canopy
      this.awningBatch.add(cx, 4.2, cz - (pd - 1) / 2 - 1.2, 0, pw * 0.4, 1, 2.4, new THREE.Color(0x30353a));
    }
  }

  _shopRow(ib, side, depth, opts = {}) {
    const r = this.rng;
    const along = side === 'N' || side === 'S';
    const a0 = along ? ib.x0 : ib.z0 + depth;
    const a1 = along ? ib.x1 : ib.z1 - depth;
    const len = a1 - a0;
    const n = Math.max(1, Math.round(len / r.range(11, 15)));
    const seg = len / n;
    const out = [];
    for (let k = 0; k < n; k++) {
      const c = a0 + seg * (k + 0.5);
      const w = seg - 0.4;
      const h = opts.minH !== undefined ? r.range(opts.minH, opts.maxH) : r.range(7, 17);
      let x, z, bw, bd, fx, fz, nx = 0, nz = 0;
      if (side === 'N') { x = c; z = ib.z0 + depth / 2; bw = w; bd = depth; fx = c; fz = ib.z0; nz = -1; }
      if (side === 'S') { x = c; z = ib.z1 - depth / 2; bw = w; bd = depth; fx = c; fz = ib.z1; nz = 1; }
      if (side === 'W') { x = ib.x0 + depth / 2; z = c; bw = depth; bd = w; fx = ib.x0; fz = c; nx = -1; }
      if (side === 'E') { x = ib.x1 - depth / 2; z = c; bw = depth; bd = w; fx = ib.x1; fz = c; nx = 1; }
      const color = this.col(opts.palette || PALETTES.shop);
      this.addBox(x, z, bw, bd, h, color, opts.style ?? 4);
      const name = SHOP_NAMES[(this.shopFronts.length * 7 + 3) % SHOP_NAMES.length];
      const front = { x: fx, z: fz, nx, nz, width: w, name, height: h };
      this.shopFronts.push(front);
      out.push(front);
      // awning
      const awnColor = new THREE.Color(this.rng.pick(['#b23a3a', '#2f6f9f', '#3c8a55', '#c58a2a', '#6d4c9f', '#2c2c2c']));
      this.awningBatch.add(fx + nx * 0.9, 3.45, fz + nz * 0.9, 0, along ? w * 0.85 : 1.8, 1, along ? 1.8 : w * 0.85, awnColor, null, along ? nz * 0.18 : 0, along ? 0 : -nx * 0.18);
      this.signs.push({ x: fx + nx * 0.08, z: fz + nz * 0.08, nx, nz, w: Math.min(w * 0.8, 9), name, color: this.rng.pick(SIGN_COLORS) });
    }
    return out;
  }

  _commercial(ib) {
    this.lot(ib, 'concrete');
    const b = ib.b;
    const depth = 13;
    if (b.bi === 3 && b.bj === 0) {
      // FreshMart supermarket takes the west side as one long, low building (enterable)
      const x = ib.x0 + 9, z = (ib.z0 + ib.z1) / 2, d = ib.z1 - ib.z0 - 2;
      this.addBox(x, z, 18, d, 7, new THREE.Color('#e7e2d6'), 4);
      this.signs.push({ x: ib.x0 - 0.08, z, nx: -1, nz: 0, w: 14, name: 'FreshMart Supermarket', color: '#15803d' });
      this.ctx.sites.supermarket = { x: ib.x0 - 1.6, z, nx: -1, nz: 0, name: 'FreshMart Supermarket' };
      this._shopRow({ ...ib, x0: ib.x0 + 19 }, 'N', depth);
      this._shopRow({ ...ib, x0: ib.x0 + 19 }, 'S', depth);
      this._shopRow(ib, 'E', depth);
      return;
    }
    if (b.bi === 3 && b.bj === 1) {
      // Spice Garden restaurant on the north side with outdoor seating
      const x = (ib.x0 + ib.x1) / 2, z = ib.z0 + 8;
      this.addBox(x - 6, z + 2, 20, 12, 6.5, new THREE.Color('#d9a066'), 4);
      this.signs.push({ x: x - 6, z: z + 2 - 6.08, nx: 0, nz: -1, w: 12, name: 'Spice Garden Restaurant', color: '#9a3412' });
      this.ctx.sites.restaurant = { x: x - 6, z: ib.z0 + 2.2, nx: 0, nz: -1, name: 'Spice Garden Restaurant', terrace: { x: x + 10, z: ib.z0 + 6 } };
      this._shopRow(ib, 'S', depth);
      this._shopRow(ib, 'E', depth);
      this._shopRow(ib, 'W', depth);
      return;
    }
    this._shopRow(ib, 'N', depth);
    this._shopRow(ib, 'S', depth);
    this._shopRow(ib, 'E', depth);
    this._shopRow(ib, 'W', depth);
  }

  _residential(ib) {
    const r = this.rng;
    const b = ib.b;
    this.lot(ib, 'grass');
    if (r.chance(0.25) && !(b.bi === 2 && b.bj === 4)) { this._apartments(ib, true); return; }
    const n = 3;
    const lw = (ib.x1 - ib.x0) / n, ld = (ib.z1 - ib.z0) / n;
    this.ctx.sites.houses = this.ctx.sites.houses || [];
    for (let py = 0; py < n; py++) for (let px = 0; px < n; px++) {
      if (px === 1 && py === 1) {
        // shared garden in the middle
        this.ctx.treeSpots.push({ x: ib.x0 + lw * 1.5, z: ib.z0 + ld * 1.5, kind: 'round', s: 1.3 });
        continue;
      }
      const cx = ib.x0 + lw * (px + 0.5), cz = ib.z0 + ld * (py + 0.5);
      const w = r.range(7, Math.min(10.5, lw - 3)), d = r.range(7, Math.min(10, ld - 3));
      const h = r.chance(0.55) ? r.range(5.6, 6.6) : r.range(3.2, 3.8);
      const color = this.col(PALETTES.house);
      this.addBox(cx, cz, w, d, h, color, 2, { roofDetails: false });
      const roofRot = r.chance(0.5) ? 0 : Math.PI / 2;
      this.roofBatch.add(cx, h, cz, roofRot, (roofRot ? d : w) + 0.8, r.range(1.8, 2.8), (roofRot ? w : d) + 0.8, this.col(PALETTES.roof));
      // front fence + yard tree
      const fz = py === 0 ? ib.z0 + 0.4 : py === 2 ? ib.z1 - 0.4 : null;
      if (fz !== null) this.fenceBatch.add(cx, 0.05, fz, 0, lw - 2, 1.1, 1, new THREE.Color('#f5f5f0'));
      const fx = px === 0 ? ib.x0 + 0.4 : px === 2 ? ib.x1 - 0.4 : null;
      if (fx !== null) this.fenceBatch.add(fx, 0.05, cz, Math.PI / 2, ld - 2, 1.1, 1, new THREE.Color('#f5f5f0'));
      if (r.chance(0.7)) this.ctx.treeSpots.push({ x: cx + (r.chance(0.5) ? 1 : -1) * (w / 2 + 2), z: cz + r.range(-3, 3), kind: 'round', s: r.range(0.8, 1.1) });
      this.ctx.sites.houses.push({ street: py !== 1, x: cx, z: py === 0 ? ib.z0 - 1.6 : py === 2 ? ib.z1 + 1.6 : cz, door: { x: cx, z: cz + (py === 0 ? -d / 2 : d / 2) } });
    }
  }

  _apartments(ib, fromRes = false) {
    const r = this.rng;
    if (!fromRes) this.lot(ib, 'grass');
    const W = ib.x1 - ib.x0, D = ib.z1 - ib.z0;
    const towers = r.chance(0.5)
      ? [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]]
      : [[0.5, 0.25], [0.5, 0.75]];
    for (const [fx, fz] of towers) {
      const cx = ib.x0 + W * fx, cz = ib.z0 + D * fz;
      const wide = towers.length === 2;
      const w = wide ? W * 0.7 : W * 0.36, d = wide ? D * 0.3 : D * 0.36;
      const h = r.range(15, wide ? 28 : 42);
      this.addBox(cx, cz, w, d, h, this.col(PALETTES.apt), 1);
      // balconies on the long faces
      for (let y = 3; y < h - 1; y += 3) {
        this.balconyBatch.add(cx, y, cz - d / 2 - 0.55, 0, w * 0.8, 1, 1.1);
        this.balconyBatch.add(cx, y, cz + d / 2 + 0.55, 0, w * 0.8, 1, 1.1);
      }
    }
    this.ctx.treeSpots.push({ x: ib.x0 + W * 0.5, z: ib.z0 + D * 0.5, kind: 'round', s: 1.2 });
  }

  _industrial(ib) {
    const r = this.rng;
    const b = ib.b;
    this.lot(ib, 'concrete');
    const W = ib.x1 - ib.x0, D = ib.z1 - ib.z0;
    if (b.bi === 0 && b.bj === 0) {
      // container yard with the landmark gantry crane
      this.ctx.sites.crane = { x: ib.x0 + W / 2, z: ib.z0 + D / 2 };
      const colors = ['#b33a2b', '#1f5f9b', '#2e7d4f', '#c58a1c', '#6b3fa0', '#8b8f94'];
      for (let row = 0; row < 4; row++) for (let k = 0; k < 6; k++) {
        const x = ib.x0 + 6 + k * 6.6, z = ib.z0 + 6 + row * 9;
        if (z > ib.z1 - 4) continue;
        const stack = r.int(1, 3);
        for (let s = 0; s < stack; s++) this.containerBatch.add(x, s * 2.6, z, 0, 2.4, 2.6, 6, new THREE.Color(r.pick(colors)));
        this.ctx.physics.addBox(x, stack * 1.3, z, 1.2, stack * 1.3, 3);
        this.footprints.push({ x0: x - 1.2, z0: z - 3, x1: x + 1.2, z1: z + 3, h: stack * 2.6, color: '#8a5a44' });
      }
      return;
    }
    // Warehouses with sawtooth roofs
    const halves = r.chance(0.5) ? [[0.5, 0.28], [0.5, 0.75]] : [[0.3, 0.5], [0.76, 0.5]];
    halves.forEach(([fx, fz], k) => {
      const cx = ib.x0 + W * fx, cz = ib.z0 + D * fz;
      const horiz = halves[0][0] === 0.5;
      const w = horiz ? W - 4 : W * 0.5 - 4, d = horiz ? D * 0.42 : D - 4;
      const h = r.range(8, 12);
      this.addBox(cx, cz, w, d, h, this.col(PALETTES.ind), 3, { roofDetails: false });
      const teeth = Math.max(2, Math.floor(w / 7));
      for (let t = 0; t < teeth; t++) {
        const tx = cx - w / 2 + (w / teeth) * (t + 0.5);
        this.roofBatch.add(tx, h, cz, 0, w / teeth, 2.2, d, new THREE.Color('#6f747a'));
      }
      if (k === 0 && r.chance(0.8)) {
        const chx = cx + w / 2 - 3, chz = cz - d / 2 + 3;
        this.tankBatch.add(chx, h, chz, 0, 1.6, r.range(14, 24), 1.6, new THREE.Color('#7b5a4a'));
      }
    });
    if (r.chance(0.6)) {
      const sx = ib.x1 - 6, sz = ib.z1 - 6;
      this.addCylinder(sx, sz, 3.2, 16, new THREE.Color('#c0c4c8'), 6);
    }
  }

  _seafront(ib) {
    const r = this.rng;
    const b = ib.b;
    this.lot(ib, 'concrete');
    const D = ib.z1 - ib.z0;
    if (b.bj === 1) {
      // Sea Breeze café facing the beach boulevard (enterable)
      const x = ib.x1 - 7, z = (ib.z0 + ib.z1) / 2;
      this.addBox(x, z, 12, 16, 5, new THREE.Color('#e9f2f5'), 4);
      this.signs.push({ x: ib.x1 - 1 + 0.08, z, nx: 1, nz: 0, w: 10, name: 'Sea Breeze Café', color: '#0e7490' });
      this.ctx.sites.cafe = { x: ib.x1 + 1.6, z, nx: 1, nz: 0, name: 'Sea Breeze Café' };
      this.addBox(ib.x0 + 12, z, 20, D - 6, r.range(20, 32), this.col(PALETTES.hotel), 4);
      return;
    }
    // Hotels
    const n = D > 40 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const cz = ib.z0 + (D / n) * (k + 0.5);
      const h = r.range(16, 44);
      const w = ib.x1 - ib.x0 - 6;
      const d = D / n - 6;
      this.addBox((ib.x0 + ib.x1) / 2, cz, w, d, h, this.col(PALETTES.hotel), 4);
      for (let y = 4; y < h - 6; y += 3.3) this.balconyBatch.add(ib.x1 - 3 + 0.6, y, cz, 0, 1.2, 1, d * 0.85);
      if (k === 0) this.signs.push({ x: ib.x1 - 3 + 0.08 + 0, z: cz, nx: 1, nz: 0, w: 10, name: r.pick(['Hotel Marina', 'Seashell Suites', 'Coral Bay Hotel', 'Palm Residency', 'Hotel Sagar']), color: '#1e3a5f', high: h - 4 });
    }
  }

  _civic(ib) {
    this.lot(ib, 'concrete');
    const W = ib.x1 - ib.x0, D = ib.z1 - ib.z0;
    this.ctx.sites.cityHall = { x: ib.x0 + W / 2, z: ib.z0 + D * 0.32 };
    // Library block at the back
    this.addBox(ib.x0 + W / 2, ib.z1 - 7, W - 8, 12, 12, new THREE.Color('#cdbfa6'), 5);
    this.signs.push({ x: ib.x0 + W / 2, z: ib.z1 + 0.08 - 1, nx: 0, nz: 1, w: 10, name: 'City Library', color: '#3f3f46' });
  }

  // ---------- Signs (one merged mesh with a text atlas) ----------
  _buildSigns() {
    const cols = 4, rows = 16, sw = 512, sh = 96;
    const canvas = document.createElement('canvas');
    canvas.width = cols * sw; canvas.height = rows * sh;
    const g = canvas.getContext('2d');
    const pos = [], uv = [], nrm = [], idx = [];
    const signs = this.signs.slice(0, cols * rows);
    signs.forEach((s, k) => {
      const cx = (k % cols) * sw, cy = Math.floor(k / cols) * sh;
      g.fillStyle = s.color; g.fillRect(cx, cy, sw, sh);
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 6; g.strokeRect(cx + 6, cy + 6, sw - 12, sh - 12);
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      let size = 54;
      g.font = `bold ${size}px "Trebuchet MS", sans-serif`;
      while (g.measureText(s.name).width > sw * 0.88 && size > 16) { size -= 3; g.font = `bold ${size}px "Trebuchet MS", sans-serif`; }
      g.fillText(s.name, cx + sw / 2, cy + sh / 2 + 2);
      // quad
      const h = s.w * (sh / sw) * 1.15;
      const y0 = (s.high || 3.75), y1 = y0 + h;
      const tx = -s.nz, tz = s.nx; // tangent so text reads correctly from outside
      const ax = s.x - (tx * s.w) / 2, az = s.z - (tz * s.w) / 2;
      const bx = s.x + (tx * s.w) / 2, bz = s.z + (tz * s.w) / 2;
      const base = pos.length / 3;
      pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
      for (let q = 0; q < 4; q++) nrm.push(s.nx, 0, s.nz);
      const u0 = cx / canvas.width, u1 = (cx + sw) / canvas.width;
      const v0 = 1 - (cy + sh) / canvas.height, v1 = 1 - cy / canvas.height;
      uv.push(u1, v0, u0, v0, u0, v1, u1, v1);
      idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    });
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.12, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 });
    const mesh = new THREE.Mesh(geo, mat);
    this.group.add(mesh);
  }

  _buildLots() {
    const byMat = {};
    for (const l of this.groundGB) (byMat[l.mat] ||= []).push(l);
    for (const [mat, list] of Object.entries(byMat)) {
      if (mat === 'grass') continue; // base terrain already grass
      const pos = [], nrm = [], uv = [], idx = [];
      for (const l of list) {
        const b = pos.length / 3;
        pos.push(l.x0, 0.03, l.z0, l.x1, 0.03, l.z0, l.x1, 0.03, l.z1, l.x0, 0.03, l.z1);
        for (let q = 0; q < 4; q++) nrm.push(0, 1, 0);
        uv.push(l.x0 / 6, -l.z0 / 6, l.x1 / 6, -l.z0 / 6, l.x1 / 6, -l.z1 / 6, l.x0 / 6, -l.z1 / 6);
        idx.push(b, b + 3, b + 2, b, b + 2, b + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, Materials[mat] || Materials.concrete);
      m.receiveShadow = true;
      this.group.add(m);
    }
  }
}
