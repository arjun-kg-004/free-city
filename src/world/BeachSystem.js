import * as THREE from 'three';
import { BEACH, RIVER, WORLD } from '../config.js';
import { Random } from '../utils/Random.js';
import { InstanceBatch } from '../utils/InstanceBatch.js';
import { Materials } from './Materials.js';
import { GeoBuilder } from '../utils/GeoBuilder.js';

/** Golden Sands beach: sand, ocean, palms, umbrellas, deck chairs, lifeguard towers and the pier. */
export class BeachSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.rng = new Random(777);
    this.group = new THREE.Group();
    this.group.name = 'beach';
    ctx.root.add(this.group);
    this.batches = [];
  }

  build() {
    this._sand();
    this._ocean();
    this._palms();
    this._umbrellas();
    this._lifeguards();
    this._pier();
    this._beachNodes();
  }

  sandHeight(x) {
    if (x < BEACH.flatUntil) return 0;
    return -Math.min(3.2, (x - BEACH.flatUntil) * 0.07);
  }

  _sand() {
    const x0 = BEACH.sandX0 - 0.5, x1 = 470;
    const segX = 60;
    const parts = [[WORLD.minZ - 60, RIVER.z0], [RIVER.z1, WORLD.maxZ + 60]];
    for (const [z0, z1] of parts) {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, segX, 8);
      g.rotateX(-Math.PI / 2);
      const p = g.attributes.position;
      const uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i) + (x0 + x1) / 2;
        const z = p.getZ(i) + (z0 + z1) / 2;
        p.setY(i, this.sandHeight(x) + 0.02 + Math.sin(z * 0.05) * 0.03 * (x > BEACH.flatUntil ? 0 : 1));
        uv.setXY(i, x / 6, z / 6);
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, Materials.sand);
      m.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  _ocean() {
    const mat = this.ctx.waterMaterial;
    const g = new THREE.PlaneGeometry(1400, 2400, 180, 120);
    const m = new THREE.Mesh(g, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(BEACH.flatUntil - 3 + 700, 0.12, 0);
    this.group.add(m);
    this.ocean = m;
  }

  _palms() {
    const r = this.rng;
    const trunk = new THREE.CylinderGeometry(0.16, 0.26, 1, 6);
    trunk.translate(0, 0.5, 0);
    const trunks = new InstanceBatch(trunk, Materials.trunk, { lodDistance: 'prop', lodScale: 1.5 });
    const leaf = new THREE.ConeGeometry(0.55, 4.2, 4, 1);
    leaf.translate(0, 2.1, 0);
    leaf.scale(1, 1, 0.25);
    const leaves = new InstanceBatch(leaf, Materials.foliage, { colors: true, lodDistance: 'prop', lodScale: 1.5 });
    const m = new THREE.Matrix4(), t = new THREE.Matrix4(), q = new THREE.Quaternion();
    const palm = (x, z) => {
      const h = r.range(6.5, 9.5), lean = r.range(-0.15, 0.15), rot = r.range(0, 6.28);
      trunks.add(x, this.sandHeight(x), z, rot, 1, h, 1, null, null, lean, 0);
      const top = new THREE.Vector3(0, h, 0).applyEuler(new THREE.Euler(lean, rot, 0, 'YXZ'));
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + r.range(-0.2, 0.2);
        q.setFromEuler(new THREE.Euler(1.15 + r.range(-0.2, 0.25), a, 0, 'YXZ'));
        m.compose(new THREE.Vector3(x + top.x, this.sandHeight(x) + top.y, z + top.z), q, new THREE.Vector3(1, 1, 1));
        leaves.addMatrix(m, new THREE.Color().setHSL(r.range(0.22, 0.3), 0.55, r.range(0.25, 0.33)));
      }
      this.ctx.physics.addCylinder(x, 1.5, z, 1.5, 0.3);
      t.identity();
    };
    for (let z = WORLD.minZ + 8; z < WORLD.maxZ - 8; z += 13) {
      if (z > RIVER.z0 - 6 && z < RIVER.z1 + 6) continue;
      palm(BEACH.sandX0 + 2.5 + r.range(-0.5, 0.5), z + r.range(-2, 2));
      if (r.chance(0.5)) palm(BEACH.sandX0 + r.range(14, 40), z + r.range(-5, 5));
    }
    // palms in the seafront blocks too
    trunks.build(this.group);
    leaves.build(this.group);
    this.batches.push(trunks, leaves);
  }

  _umbrellas() {
    const r = this.rng;
    const pole = new THREE.CylinderGeometry(0.04, 0.04, 2.4, 5);
    pole.translate(0, 1.2, 0);
    const poles = new InstanceBatch(pole, Materials.white, { lodDistance: 'prop', castShadow: false });
    const canopy = new THREE.ConeGeometry(1.5, 0.6, 8, 1, true);
    canopy.translate(0, 2.5, 0);
    const canopies = new InstanceBatch(canopy, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }), { colors: true, lodDistance: 'prop' });
    const cg = new GeoBuilder(1);
    cg.box(0, 0.3, 0, 0.7, 0.08, 1.4);
    cg.box(0, 0.55, -0.62, 0.7, 0.5, 0.08, 0);
    for (const sx of [-0.3, 0.3]) for (const sz of [-0.6, 0.6]) cg.box(sx, 0.15, sz, 0.05, 0.3, 0.05);
    const chairs = new InstanceBatch(cg.build(), Materials.instColor, { colors: true, lodDistance: 'prop', castShadow: false });
    const towelGeo = new THREE.PlaneGeometry(1, 2);
    towelGeo.rotateX(-Math.PI / 2);
    const towels = new InstanceBatch(towelGeo, Materials.instColor, { colors: true, lodDistance: 'prop', castShadow: false });
    const cols = ['#e63946', '#f1c40f', '#2a9d8f', '#e76f51', '#457b9d', '#ffffff', '#ff7aa2'];
    this.ctx.beachSpots = [];
    for (let z = WORLD.minZ + 14; z < WORLD.maxZ - 14; z += 11) {
      if (z > RIVER.z0 - 6 && z < RIVER.z1 + 6) continue;
      if (Math.abs(z) < 14) continue; // pier entrance
      for (let k = 0; k < 2; k++) {
        if (r.chance(0.35)) continue;
        const x = r.range(318, 348), zz = z + r.range(-3, 3);
        const c = new THREE.Color(r.pick(cols));
        poles.add(x, 0, zz);
        canopies.add(x, 0, zz, r.range(0, 6), 1, 1, 1, c);
        const face = Math.PI / 2 + r.range(-0.3, 0.3); // face the sea (east)
        chairs.add(x - 1, 0.02, zz + 0.9, face + Math.PI, 1, 1, 1, new THREE.Color(r.pick(['#ffffff', '#3b82f6', '#f59e0b'])));
        if (r.chance(0.5)) chairs.add(x - 1, 0.02, zz - 0.9, face + Math.PI, 1, 1, 1, new THREE.Color('#ffffff'));
        if (r.chance(0.5)) towels.add(x + 2, 0.03, zz + r.range(-1, 1), r.range(-0.4, 0.4), 1, 1, 1, new THREE.Color(r.pick(cols)));
        this.ctx.beachSpots.push({ x: x - 1, z: zz + 0.9 });
      }
    }
    for (const b of [poles, canopies, chairs, towels]) { b.build(this.group); this.batches.push(b); }
  }

  _lifeguards() {
    const gb = new GeoBuilder(1);
    for (const sx of [-0.9, 0.9]) for (const sz of [-0.9, 0.9]) gb.box(sx, 1.4, sz, 0.15, 2.8, 0.15);
    gb.box(0, 2.9, 0, 2.4, 0.15, 2.4);
    gb.box(0, 3.8, 0.9, 2.4, 1.6, 0.1);
    gb.box(-1.15, 3.6, 0, 0.1, 1.2, 2.4);
    gb.box(1.15, 3.6, 0, 0.1, 1.2, 2.4);
    gb.box(0, 4.6, 0, 2.8, 0.15, 2.8);
    const geo = gb.build();
    const mat = new THREE.MeshStandardMaterial({ color: 0xd94b3d, roughness: 0.7 });
    for (const z of [-110, -40, 220]) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(342, 0, z);
      m.rotation.y = Math.PI;
      m.castShadow = true;
      this.group.add(m);
      this.ctx.physics.addBox(342, 1.5, z, 1.2, 1.5, 1.2);
    }
  }

  _pier() {
    const z = 0, x0 = 352, x1 = 452, w = 9;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.4, w), Materials.wood);
    deck.position.set((x0 + x1) / 2, 0.18, z);
    deck.receiveShadow = true; deck.castShadow = true;
    this.group.add(deck);
    const end = new THREE.Mesh(new THREE.BoxGeometry(34, 0.4, 30), Materials.wood);
    end.position.set(x1 + 15, 0.18, z);
    end.receiveShadow = true;
    this.group.add(end);
    const piles = new InstanceBatch(new THREE.CylinderGeometry(0.25, 0.25, 5, 6), Materials.trunk, { castShadow: false });
    for (let x = x0; x <= x1 + 30; x += 6) {
      for (const sz of x > x1 ? [-14, -5, 5, 14] : [-w / 2 + 0.4, w / 2 - 0.4]) piles.add(x, -2.2, z + sz);
    }
    piles.build(this.group);
    this.batches.push(piles);
    // rails + colliders
    const rail = new THREE.BoxGeometry(1, 0.1, 0.1);
    const rails = new InstanceBatch(rail, Materials.white, { castShadow: false });
    const railLine = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az);
      rails.add((ax + bx) / 2, 1.3, (az + bz) / 2, -Math.atan2(bz - az, bx - ax), len, 1, 1);
      rails.add((ax + bx) / 2, 0.8, (az + bz) / 2, -Math.atan2(bz - az, bx - ax), len, 1, 1);
      this.ctx.physics.addWall(ax, az, bx, bz, 2.5, 0.3, 0);
    };
    railLine(BEACH.wallX, z - w / 2, x1, z - w / 2);
    railLine(BEACH.wallX, z + w / 2, x1, z + w / 2);
    railLine(x1, z - w / 2, x1, z - 15);
    railLine(x1, z + w / 2, x1, z + 15);
    railLine(x1, z - 15, x1 + 32, z - 15);
    railLine(x1, z + 15, x1 + 32, z + 15);
    railLine(x1 + 32, z - 15, x1 + 32, z + 15);
    rails.build(this.group);
    this.batches.push(rails);
    // Opening in the sea wall for the pier: walls north & south of it
    this.ctx.pierGap = { z0: z - w / 2, z1: z + w / 2 };
    // Deck colliders (so the player stands on it above the water)
    this.ctx.physics.addBox((BEACH.wallX + x1) / 2, 0.0, z, (x1 - BEACH.wallX) / 2, 0.38, w / 2);
    this.ctx.physics.addBox(x1 + 15, 0.0, z, 17, 0.38, 15);
    this.ctx.sites.pierEnd = { x: x1 + 18, z };
    this.ctx.sites.pierWalk = [{ x: 360, z }, { x: 400, z }, { x: x1 + 4, z }];
    // pier lamps
    const lamp = new THREE.CylinderGeometry(0.06, 0.08, 3.5, 5);
    lamp.translate(0, 1.75, 0);
    const lamps = new InstanceBatch(lamp, Materials.darkMetal, { castShadow: false });
    const globe = new InstanceBatch(new THREE.SphereGeometry(0.28, 8, 6), Materials.lampGlow, { castShadow: false });
    for (let x = x0 + 4; x < x1; x += 14) for (const sz of [-w / 2 + 0.3, w / 2 - 0.3]) { lamps.add(x, 0.38, z + sz); globe.add(x, 3.95, z + sz); }
    lamps.build(this.group); globe.build(this.group);
    this.batches.push(lamps, globe);
  }

  _beachNodes() {
    // walking spots used by pedestrians on the sand
    this.ctx.beachWalk = [];
    for (let z = WORLD.minZ + 20; z < WORLD.maxZ - 20; z += 24) {
      if (z > RIVER.z0 - 8 && z < RIVER.z1 + 8) continue;
      this.ctx.beachWalk.push({ x: 352, z });
    }
  }
}
