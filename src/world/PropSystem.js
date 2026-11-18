import * as THREE from 'three';
import { SIDEWALK, RIVER } from '../config.js';
import { Random } from '../utils/Random.js';
import { InstanceBatch } from '../utils/InstanceBatch.js';
import { Materials } from './Materials.js';
import { GeoBuilder } from '../utils/GeoBuilder.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { foliageMaterials, crownGeometry, trunkGeometry, grassGeometry, grassMaterial } from './Foliage.js';

/** Trees, benches, bins, bus stops, the park and the city-centre plaza. */
export class PropSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.rng = new Random(9001);
    this.group = new THREE.Group();
    this.group.name = 'props';
    ctx.root.add(this.group);
    this.batches = [];

    // Leaf-card trees with branches and wind sway (see Foliage.js)
    const F = foliageMaterials(ctx.sceneManager.shared);
    this.trunks = new InstanceBatch(trunkGeometry('round'), F.bark, { lodDistance: 'prop', lodScale: 1.3 });
    this.coniferTrunks = new InstanceBatch(trunkGeometry('conifer'), F.bark, { lodDistance: 'prop', lodScale: 1.3 });
    this.crowns = new InstanceBatch(crownGeometry('round'), F.leaves, { colors: true, lodDistance: 'prop', lodScale: 1.6, depthMaterial: F.depth });
    this.cones = new InstanceBatch(crownGeometry('conifer'), F.leaves, { colors: true, lodDistance: 'prop', lodScale: 1.6, depthMaterial: F.depth });
    this.bushes = new InstanceBatch(crownGeometry('bush'), F.bushes, { colors: true, lodDistance: 'prop', castShadow: false });
    // Grass clumps on lawns (skipped on Low quality)
    this.grassOn = ctx.sceneManager.settings.quality !== 'low';
    this.grass = new InstanceBatch(grassGeometry(), grassMaterial(ctx.sceneManager.shared), { lodDistance: 'prop', lodScale: 0.16, castShadow: false, chunkSize: 30 });

    // Bench = seat + back + legs merged
    const bg = new GeoBuilder(1);
    bg.box(0, 0.45, 0, 1.8, 0.08, 0.5);
    bg.box(0, 0.8, -0.24, 1.8, 0.4, 0.06);
    for (const sx of [-0.8, 0.8]) bg.box(sx, 0.22, 0, 0.08, 0.44, 0.45);
    this.benches = new InstanceBatch(bg.build(), Materials.wood, { lodDistance: 'prop', castShadow: false });
    const bin = new THREE.CylinderGeometry(0.28, 0.24, 0.9, 8);
    bin.translate(0, 0.45, 0);
    this.bins = new InstanceBatch(bin, Materials.instColor, { colors: true, lodDistance: 'prop', lodScale: 0.8, castShadow: false });
    // Bus stop shelter
    const sg = new GeoBuilder(1);
    sg.box(0, 2.5, 0, 4, 0.12, 1.8);
    sg.box(0, 1.25, -0.85, 4, 2.4, 0.06);
    sg.box(-1.95, 1.25, 0, 0.08, 2.4, 1.8);
    sg.box(1.95, 1.25, 0, 0.08, 2.4, 1.8);
    sg.box(0, 0.45, -0.55, 3, 0.08, 0.4);
    this.shelters = new InstanceBatch(sg.build(), Materials.metal, { lodDistance: 'prop' });
    const sign = new THREE.BoxGeometry(0.06, 0.6, 0.6);
    sign.translate(0, 2.6, 0);
    this.busSigns = new InstanceBatch(sign, new THREE.MeshStandardMaterial({ color: 0x1d4ed8, emissive: 0x1d4ed8, emissiveIntensity: 0.3 }), { lodDistance: 'prop', castShadow: false });
    const pole = new THREE.CylinderGeometry(0.05, 0.05, 2.6, 5);
    pole.translate(0, 1.3, 0);
    this.signPoles = new InstanceBatch(pole, Materials.metal, { lodDistance: 'prop', castShadow: false });
    // Fire hydrant: barrel, cap and side nozzles
    const cyl = (rt, rb, h, y, seg = 10) => { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(0, y, 0); return g; };
    const nozzle = new THREE.CylinderGeometry(0.06, 0.06, 0.36, 8); nozzle.rotateZ(Math.PI / 2); nozzle.translate(0, 0.48, 0);
    const front = new THREE.CylinderGeometry(0.075, 0.075, 0.2, 8); front.rotateX(Math.PI / 2); front.translate(0, 0.42, 0.12);
    const hyd = mergeGeometries([cyl(0.15, 0.17, 0.08, 0.04), cyl(0.12, 0.13, 0.56, 0.36), cyl(0.15, 0.15, 0.05, 0.64), cyl(0.04, 0.13, 0.14, 0.73), nozzle, front].map((g) => g.toNonIndexed()));
    this.hydrants = new InstanceBatch(hyd, new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.45, metalness: 0.3 }), { lodDistance: 'prop', lodScale: 0.6 });
    // Bollards with a reflective band
    const bol = mergeGeometries([cyl(0.09, 0.1, 0.9, 0.45, 10), cyl(0.07, 0.09, 0.06, 0.93, 10)].map((g) => g.toNonIndexed()));
    this.bollards = new InstanceBatch(bol, Materials.darkMetal, { lodDistance: 'prop', lodScale: 0.6 });
    const band = cyl(0.102, 0.102, 0.07, 0.78, 10);
    this.bollardBands = new InstanceBatch(band, new THREE.MeshStandardMaterial({ color: 0xd8d8d8, emissive: 0x222222, roughness: 0.3 }), { lodDistance: 'prop', lodScale: 0.5, castShadow: false });
  }

  tree(x, z, kind = 'round', s = 1, collide = true) {
    const r = this.rng;
    const rot = r.range(0, 6.28);
    const sy = s * r.range(0.9, 1.2);
    if (kind === 'conifer') {
      this.coniferTrunks.add(x, 0, z, rot, s, sy, s);
      this.cones.add(x, 0, z, rot, s, sy, s, new THREE.Color().setHSL(r.range(0.28, 0.34), r.range(0.3, 0.45), r.range(0.36, 0.46)));
    } else {
      this.trunks.add(x, 0, z, rot, s, sy, s);
      this.crowns.add(x, 0, z, rot, s * r.range(0.9, 1.1), sy, s * r.range(0.9, 1.1), new THREE.Color().setHSL(r.range(0.2, 0.3), r.range(0.35, 0.55), r.range(0.5, 0.66)));
    }
    if (collide) this.ctx.physics.addCylinder(x, 1.5, z, 1.5, 0.3 * s);
  }

  /** Scatter grass clumps in a rectangle, skipping anything `skip(x, z)` rejects. */
  lawn(x0, z0, x1, z1, density, skip) {
    if (!this.grassOn) return;
    const r = this.rng;
    const n = Math.floor((x1 - x0) * (z1 - z0) * density);
    for (let i = 0; i < n; i++) {
      const x = r.range(x0, x1), z = r.range(z0, z1);
      if (skip && skip(x, z)) continue;
      const sc = r.range(0.7, 1.4);
      this.grass.add(x, 0, z, r.range(0, 6.28), sc, r.range(0.7, 1.3), sc);
    }
  }

  bench(x, z, faceRot, sittable = true) {
    // faceRot: direction a seated person looks toward
    this.benches.add(x, 0.05, z, faceRot);
    this.ctx.physics.addBox(x, 0.45, z, 0.9, 0.45, 0.3, faceRot);
    if (sittable) this.ctx.benches.push({ x: x + Math.sin(faceRot) * 0.15, z: z + Math.cos(faceRot) * 0.15, rot: faceRot, occupied: false });
  }

  build() {
    const L = this.ctx.layout;
    for (const b of L.blocks) {
      if (b.type === 'PARK') this._park(b);
      if (b.type === 'PLAZA') this._plaza(b);
    }
    this._streetFurniture();
    for (const t of this.ctx.treeSpots) this.tree(t.x, t.z, t.kind, t.s);
    this._westHills();
    this._lawns();
    const all = [this.trunks, this.coniferTrunks, this.crowns, this.cones, this.bushes, this.grass, this.benches, this.bins, this.shelters, this.busSigns, this.signPoles, this.hydrants, this.bollards, this.bollardBands];
    for (const bt of all) bt.build(this.group);
    this.batches.push(...all);
  }

  _streetFurniture() {
    const L = this.ctx.layout;
    const r = this.rng;
    let busCount = 0;
    for (const b of L.blocks) {
      if (b.type === 'RIVER' || b.type === 'BEACH') continue;
      const green = ['RES', 'APT', 'PARK', 'CIVIC', 'PLAZA', 'SEA'].includes(b.type);
      const busy = ['DT', 'COM', 'SEA', 'PLAZA', 'CIVIC'].includes(b.type);
      const sides = [
        { ax: b.x0 + 6, az: b.z0 + 1.2, bx: b.x1 - 6, bz: b.z0 + 1.2, face: Math.PI, nx: 0, nz: -1 },
        { ax: b.x0 + 6, az: b.z1 - 1.2, bx: b.x1 - 6, bz: b.z1 - 1.2, face: 0, nx: 0, nz: 1 },
        { ax: b.x0 + 1.2, az: b.z0 + 6, bx: b.x0 + 1.2, bz: b.z1 - 6, face: -Math.PI / 2, nx: -1, nz: 0 },
        { ax: b.x1 - 1.2, az: b.z0 + 6, bx: b.x1 - 1.2, bz: b.z1 - 6, face: Math.PI / 2, nx: 1, nz: 0 },
      ];
      sides.forEach((s, k) => {
        const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
        if (green) {
          for (let t = 0; t <= len; t += 13) {
            const x = s.ax + ((s.bx - s.ax) * t) / len, z = s.az + ((s.bz - s.az) * t) / len;
            if (this._nearRiver(z)) continue;
            this.tree(x, z, b.type === 'PARK' && r.chance(0.3) ? 'conifer' : 'round', r.range(0.75, 0.95));
          }
        }
        // a bench + bin in the middle of each side, facing the road
        const mx = (s.ax + s.bx) / 2 + (green ? 6 : 0) * (s.nz !== 0 ? 1 : 0);
        const mz = (s.az + s.bz) / 2 + (green ? 6 : 0) * (s.nx !== 0 ? 1 : 0);
        const bx = mx - s.nx * 1.4, bz = mz - s.nz * 1.4;
        if (busy && k % 2 === 0 && busCount++ % 2 === 0) {
          this.shelters.add(bx - s.nx * 0.3, 0.09, bz - s.nz * 0.3, s.face);
          this.signPoles.add(mx + s.nx * 1.0 + (s.nz ? 2.6 : 0), 0.09, mz + s.nz * 1.0 + (s.nx ? 2.6 : 0));
          this.busSigns.add(mx + s.nx * 1.0 + (s.nz ? 2.6 : 0), 0.09, mz + s.nz * 1.0 + (s.nx ? 2.6 : 0), s.face);
          this.ctx.physics.addBox(bx - s.nx * 0.3, 1.25, bz - s.nz * 0.3, 2, 1.25, 0.9, s.face);
          this.ctx.benches.push({ x: bx + s.nx * 0.2, z: bz + s.nz * 0.2, rot: s.face, occupied: false });
          this.ctx.busStops.push({ x: bx, z: bz });
        } else if (k % 2 === 1 || busy) {
          this.bench(bx, bz, s.face);
        }
        this.bins.add(bx + (s.nz ? 2.2 : 0), 0.09, bz + (s.nx ? 2.2 : 0), 0, 1, 1, 1, new THREE.Color(r.pick(['#2f6f3e', '#3a3f45', '#1f4e79'])));
        // hydrant near one end of the side, at the kerb
        if (k < 2 || r.chance(0.5)) {
          const t = r.range(0.12, 0.3) * len;
          const hx = s.ax + ((s.bx - s.ax) * t) / len + s.nx * 0.55, hz = s.az + ((s.bz - s.az) * t) / len + s.nz * 0.55;
          if (!this._nearRiver(hz)) {
            this.hydrants.add(hx, 0.09, hz, s.face + Math.PI);
            this.ctx.physics.addCylinder(hx, 0.45, hz, 0.4, 0.17);
          }
        }
        // bollards guarding the corners of busy blocks
        if (busy && b.type !== 'PARK') {
          for (const end of [0, 1]) {
            for (let i = 0; i < 3; i++) {
              const d = -1 + i * 1.5; // clear of the crosswalk at the corner
              const t = end ? len - d : d;
              const ox = s.ax + ((s.bx - s.ax) * t) / len + s.nx * 0.75, oz = s.az + ((s.bz - s.az) * t) / len + s.nz * 0.75;
              this.bollards.add(ox, 0.09, oz);
              this.bollardBands.add(ox, 0.09, oz);
              this.ctx.physics.addCylinder(ox, 0.5, oz, 0.45, 0.1);
            }
          }
        }
      });
    }
  }

  /** Grass in the parks and on residential lawns, avoiding paths, ponds and buildings. */
  _lawns() {
    const L = this.ctx.layout;
    const fps = this.ctx.footprints || [];
    const inBuilding = (x, z) => fps.some((f) => x > f.x0 - 0.8 && x < f.x1 + 0.8 && z > f.z0 - 0.8 && z < f.z1 + 0.8);
    for (const b of L.blocks) {
      const x0 = b.x0 + SIDEWALK + 0.5, x1 = b.x1 - SIDEWALK - 0.5, z0 = b.z0 + SIDEWALK + 0.5, z1 = b.z1 - SIDEWALK - 0.5;
      if (b.type === 'PARK') {
        const ring = this.ctx.parkRings.find((p) => p.block === b);
        const isPond = b.bi === 1 && b.bj === 4;
        this.lawn(x0, z0, x1, z1, 2.6, (x, z) => {
          const d = Math.hypot(x - b.cx, z - b.cz);
          if (ring && Math.abs(d - ring.r) < 2.2) return true;
          if (Math.abs(x - b.cx) < 2 || Math.abs(z - b.cz) < 2) return true;
          if (isPond && d < ring.r - 1.5) return true;
          return false;
        });
      } else if (b.type === 'RES' || b.type === 'APT') {
        this.lawn(x0, z0, x1, z1, 0.7, inBuilding);
      }
    }
  }

  _nearRiver(z) {
    return z > RIVER.z0 - 2 && z < RIVER.z1 + 2;
  }

  _park(b) {
    const r = this.rng;
    const cx = b.cx, cz = b.cz;
    const inner = Math.min(b.w, b.d) / 2 - SIDEWALK;
    // ring path + cross paths
    const ring = new THREE.Mesh(new THREE.RingGeometry(inner * 0.55, inner * 0.55 + 3, 48, 1), Materials.plaza);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(cx, 0.05, cz);
    ring.receiveShadow = true;
    this.group.add(ring);
    const gb = new GeoBuilder(0.25);
    gb.rect(cx - 1.5, b.z0 + SIDEWALK, cx + 1.5, cz - inner * 0.55, 0.045);
    gb.rect(cx - 1.5, cz + inner * 0.55, cx + 1.5, b.z1 - SIDEWALK, 0.045);
    gb.rect(b.x0 + SIDEWALK, cz - 1.5, cx - inner * 0.55, cz + 1.5, 0.045);
    gb.rect(cx + inner * 0.55, cz - 1.5, b.x1 - SIDEWALK, cz + 1.5, 0.045);
    const pm = new THREE.Mesh(gb.build(), Materials.plaza);
    pm.receiveShadow = true;
    this.group.add(pm);
    const R = inner * 0.55 + 1.5;
    this.ctx.parkRings.push({ x: cx, z: cz, r: R, block: b });

    // benches around the ring, facing inward
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.5;
      const bx = cx + Math.sin(a) * (R + 2.6), bz = cz + Math.cos(a) * (R + 2.6);
      this.bench(bx, bz, a + Math.PI);
    }
    const isPond = b.bi === 1 && b.bj === 4;
    const isPlay = b.bi === 0 && b.bj === 5;
    if (isPond) {
      const pond = new THREE.Mesh(new THREE.CircleGeometry(inner * 0.4, 40), this.ctx.waterMaterial || Materials.water);
      pond.rotation.x = -Math.PI / 2;
      pond.position.set(cx, 0.08, cz);
      this.group.add(pond);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(inner * 0.4, 0.35, 6, 40), Materials.concrete);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(cx, 0.15, cz);
      this.group.add(rim);
      this.ctx.physics.addCylinder(cx, 0.6, cz, 0.6, inner * 0.4);
      this.ctx.sites.lotusFountain = { x: cx, z: cz, r: inner * 0.4 };
    } else if (isPlay) {
      // simple playground: swing frames + slide
      const pg = new GeoBuilder(1);
      for (let k = 0; k < 2; k++) {
        const px = cx - 3 + k * 6;
        pg.box(px - 1.5, 1.2, cz, 0.12, 2.4, 0.12); pg.box(px + 1.5, 1.2, cz, 0.12, 2.4, 0.12);
        pg.box(px, 2.4, cz, 3.2, 0.12, 0.12);
        pg.box(px - 0.5, 0.6, cz, 0.5, 0.06, 0.25); pg.box(px + 0.5, 0.6, cz, 0.5, 0.06, 0.25);
      }
      pg.box(cx, 0.8, cz + 4, 1, 0.1, 4, 0.0);
      const play = new THREE.Mesh(pg.build(), new THREE.MeshStandardMaterial({ color: 0xe4572e, roughness: 0.6 }));
      play.castShadow = true;
      this.group.add(play);
      this.ctx.physics.addBox(cx, 1.2, cz, 4.8, 1.2, 0.4);
      for (let k = 0; k < 6; k++) this.bushes.add(cx + r.range(-7, 7), 0, cz + r.range(-7, 7), 0, 1, 1, 1, new THREE.Color().setHSL(0.3, 0.5, 0.3));
    } else {
      this.ctx.parkLawns.push({ x: cx, z: cz });
    }
    // trees scattered outside the ring, avoiding paths
    for (let k = 0; k < 26; k++) {
      const x = r.range(b.x0 + SIDEWALK + 3, b.x1 - SIDEWALK - 3);
      const z = r.range(b.z0 + SIDEWALK + 3, b.z1 - SIDEWALK - 3);
      const dr = Math.hypot(x - cx, z - cz);
      if (Math.abs(dr - R) < 4.5 || Math.abs(x - cx) < 3.5 || Math.abs(z - cz) < 3.5) continue;
      if ((isPond || isPlay) && dr < R - 2) continue;
      this.tree(x, z, r.chance(0.25) ? 'conifer' : 'round', r.range(0.9, 1.35));
      if (r.chance(0.4)) this.bushes.add(x + r.range(-2, 2), 0, z + r.range(-2, 2), r.range(0, 6), r.range(0.8, 1.4), 1, r.range(0.8, 1.4), new THREE.Color().setHSL(r.range(0.22, 0.32), 0.5, r.range(0.22, 0.32)));
    }
  }

  _plaza(b) {
    const gb = new GeoBuilder(0.2);
    gb.rect(b.x0 + SIDEWALK, b.z0 + SIDEWALK, b.x1 - SIDEWALK, b.z1 - SIDEWALK, 0.04);
    const m = new THREE.Mesh(gb.build(), Materials.plaza);
    m.receiveShadow = true;
    this.group.add(m);
    const cx = b.cx, cz = b.cz;
    this.ctx.sites.clockTower = { x: cx, z: cz - 12 };
    this.ctx.sites.plaza = { x: cx, z: cz };
    // planters with trees at the corners
    for (const [dx, dz] of [[-16, -16], [16, -16], [-16, 16], [16, 16], [-16, 4], [16, 4]]) {
      const planter = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.7, 0.6, 12), Materials.concrete);
      planter.position.set(cx + dx, 0.3, cz + dz);
      this.group.add(planter);
      this.tree(cx + dx, cz + dz, 'round', 1.0);
    }
    // benches facing the fountain
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      this.bench(cx + Math.sin(a) * 10.5, cz + 6 + Math.cos(a) * 10.5, a + Math.PI);
    }
    // food stalls along the south edge
    const colors = [0xd97706, 0x059669, 0xdc2626];
    for (let k = 0; k < 3; k++) {
      const sx = cx - 12 + k * 12, sz = b.z1 - SIDEWALK - 4;
      const st = new GeoBuilder(1);
      st.box(0, 0.5, 0, 3, 1, 1.4);
      for (const ex of [-1.4, 1.4]) st.box(ex, 1.4, -0.6, 0.08, 1.8, 0.08);
      const base = new THREE.Mesh(st.build(), Materials.wood);
      base.position.set(sx, 0, sz);
      base.rotation.y = Math.PI;
      base.castShadow = true;
      this.group.add(base);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.2, 4), new THREE.MeshStandardMaterial({ color: colors[k], roughness: 0.7 }));
      roof.rotation.y = Math.PI / 4;
      roof.position.set(sx, 2.9, sz);
      this.group.add(roof);
      this.ctx.physics.addBox(sx, 1.75, sz, 1.6, 1.75, 0.8); // tall enough to keep the camera out of the roof
      this.ctx.stalls.push({ x: sx, z: sz - 1.6, name: ['Chai & Snacks', 'Fresh Juice', 'Ice Cream'][k] });
    }
    this.ctx.talkSpots.push({ x: cx - 8, z: cz - 2 }, { x: cx + 9, z: cz + 14 }, { x: cx + 12, z: cz - 6 });
  }

  _westHills() {
    // Scenery beyond the highway guard rail
    const r = this.rng;
    const hillMat = Materials.grass;
    for (let k = 0; k < 9; k++) {
      const z = -290 + k * 72 + r.range(-20, 20);
      if (z > RIVER.z0 - 20 && z < RIVER.z1 + 20) continue;
      const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), hillMat);
      hill.scale.set(r.range(40, 70), r.range(14, 30), r.range(40, 60));
      hill.position.set(-360 - r.range(0, 40), -2, z);
      hill.receiveShadow = true;
      this.group.add(hill);
      for (let t = 0; t < 8; t++) this.tree(-330 - r.range(0, 60), z + r.range(-30, 30), 'conifer', r.range(1.1, 1.6), false);
    }
  }
}
