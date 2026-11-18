import * as THREE from 'three';
import { GRID, RIVER, WORLD, xs } from '../config.js';
import { Materials } from './Materials.js';
import { GeoBuilder } from '../utils/GeoBuilder.js';
import { makeLabelTexture } from '../utils/Textures.js';
import { mergeMeshChildren } from '../utils/MergeUtils.js';

/** Hand-built landmarks the player can discover. Also hosts animated set pieces. */
export class LandmarkSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'landmarks';
    ctx.root.add(this.group);
    this.landmarks = [];
    this.animated = [];
  }

  add(id, name, x, z, desc, radius = 30) {
    this.landmarks.push({ id, name, x, z, desc, radius, reward: 150 });
  }

  build() {
    const s = this.ctx.sites;
    if (s.skyNeedle) this._skyNeedle(s.skyNeedle);
    if (s.clockTower) this._clockTower(s.clockTower);
    if (s.plaza) this._plazaFountain(s.plaza);
    if (s.cityHall) this._cityHall(s.cityHall);
    if (s.crane) this._crane(s.crane);
    if (s.lotusFountain) this._lotus(s.lotusFountain);
    if (s.pierEnd) this._ferrisWheel(s.pierEnd);
    this._stadium();
    this._lighthouse();
    this.add('bridge', 'Silver River Bridges', xs[GRID.N / 2], (RIVER.z0 + RIVER.z1) / 2, 'Seven bridges carry the city over the Silver River. Best viewed at sunset.', 24);
  }

  _mesh(geo, mat, x, y, z, ry = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  _skyNeedle({ x, z }) {
    const conc = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.6 });
    this._mesh(new THREE.CylinderGeometry(2.2, 4.5, 120, 16), conc, x, 60, z);
    const pod = this._mesh(new THREE.CylinderGeometry(9, 6, 8, 24), new THREE.MeshStandardMaterial({ color: 0x9fb4c8, roughness: 0.15, metalness: 0.6 }), x, 118, z);
    pod.castShadow = true;
    this._mesh(new THREE.CylinderGeometry(9.6, 9.6, 1, 24), conc, x, 123, z);
    this._mesh(new THREE.CylinderGeometry(0.4, 0.8, 30, 8), Materials.metal, x, 138, z);
    const beacon = this._mesh(new THREE.SphereGeometry(0.9, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3030 }), x, 154, z);
    beacon.userData.noMerge = true;
    this.animated.push((t) => { beacon.visible = Math.sin(t * 3) > 0; });
    this._mesh(new THREE.CylinderGeometry(7, 8, 6, 16), conc, x, 3, z);
    this.ctx.physics.addCylinder(x, 30, z, 30, 8);
    this.ctx.footprints.push({ x0: x - 8, z0: z - 8, x1: x + 8, z1: z + 8, h: 150, round: true, color: '#d0d0d0' });
    this.add('needle', 'Sky Needle', x, z, 'The 150 m observation tower is the tallest structure in the city — you can see it from almost everywhere.', 34);
  }

  _clockTower({ x, z }) {
    const stone = new THREE.MeshStandardMaterial({ color: 0xc9b38f, roughness: 0.85 });
    this._mesh(new THREE.BoxGeometry(6, 22, 6), stone, x, 11, z);
    this._mesh(new THREE.BoxGeometry(7, 1, 7), stone, x, 22.5, z);
    this._mesh(new THREE.ConeGeometry(5, 7, 4), new THREE.MeshStandardMaterial({ color: 0x4b5d6b, roughness: 0.6 }), x, 26.5, z, Math.PI / 4);
    this.ctx.physics.addBox(x, 11, z, 3, 11, 3);
    this.ctx.footprints.push({ x0: x - 3, z0: z - 3, x1: x + 3, z1: z + 3, h: 30, color: '#c9b38f' });
    // Four clock faces whose hands follow the in-game time
    const faceMat = new THREE.MeshStandardMaterial({ color: 0xfaf6ea, emissive: 0xfff3cf, emissiveIntensity: 0.1 });
    const handMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const hands = [];
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      const nx = Math.sin(a), nz = Math.cos(a);
      const face = new THREE.Mesh(new THREE.CircleGeometry(2.2, 32), faceMat);
      face.position.set(x + nx * 3.02, 18, z + nz * 3.02);
      face.rotation.y = a;
      this.group.add(face);
      const hourPivot = new THREE.Group();
      hourPivot.position.copy(face.position).add(new THREE.Vector3(nx * 0.04, 0, nz * 0.04));
      hourPivot.rotation.y = a;
      const minPivot = hourPivot.clone();
      const hh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.2, 0.04), handMat);
      hh.position.y = 0.55;
      const mh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.8, 0.04), handMat);
      mh.position.y = 0.85;
      const hp = new THREE.Group(); hp.add(hh); hourPivot.add(hp);
      const mp = new THREE.Group(); mp.add(mh); minPivot.add(mp);
      this.group.add(hourPivot, minPivot);
      hands.push({ hp, mp });
    }
    this.animated.push(() => {
      const tod = this.ctx.sceneManager.timeOfDay;
      const hr = (tod % 12) / 12, mn = tod % 1;
      for (const h of hands) { h.hp.rotation.z = -hr * Math.PI * 2; h.mp.rotation.z = -mn * Math.PI * 2; }
    });
    this.add('clock', 'Old Clock Tower', x, z, 'Built in 1921, the clock tower marks the heart of the City Centre. Its faces always show the current time.', 26);
  }

  _plazaFountain({ x, z }) {
    const zc = z + 6;
    this._mesh(new THREE.CylinderGeometry(6, 6.3, 0.8, 32), Materials.concrete, x, 0.4, zc);
    const water = new THREE.Mesh(new THREE.CircleGeometry(5.6, 32), this.ctx.waterMaterial);
    water.rotation.x = -Math.PI / 2;
    water.position.set(x, 0.7, zc);
    this.group.add(water);
    this._mesh(new THREE.CylinderGeometry(0.6, 1, 2.2, 12), Materials.concrete, x, 1.4, zc);
    const jetMat = new THREE.MeshStandardMaterial({ color: 0xcfe9ff, transparent: true, opacity: 0.55, roughness: 0.1 });
    const jet = this._mesh(new THREE.ConeGeometry(0.5, 3, 10, 1, true), jetMat, x, 3.6, zc);
    jet.castShadow = false;
    jet.userData.noMerge = true;
    this.animated.push((t) => { jet.scale.y = 1 + Math.sin(t * 4) * 0.12; });
    this.ctx.physics.addCylinder(x, 0.5, zc, 0.5, 6.2);
  }

  _cityHall({ x, z }) {
    const stone = new THREE.MeshStandardMaterial({ color: 0xece4d4, roughness: 0.8 });
    this._mesh(new THREE.BoxGeometry(34, 14, 18), stone, x, 7, z);
    this._mesh(new THREE.BoxGeometry(36, 1.2, 20), stone, x, 14.6, z);
    this._mesh(new THREE.BoxGeometry(38, 1, 26), stone, x, 0.5, z - 2);
    const dome = this._mesh(new THREE.SphereGeometry(7, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6f8f7f, roughness: 0.4, metalness: 0.4 }), x, 15, z);
    dome.castShadow = true;
    this._mesh(new THREE.CylinderGeometry(7.2, 7.2, 3, 24), stone, x, 15.5, z);
    // columns on the front (north side)
    const col = new THREE.CylinderGeometry(0.55, 0.65, 12, 10);
    for (let k = 0; k < 8; k++) this._mesh(col, stone, x - 14 + k * 4, 7, z - 11);
    this._mesh(new THREE.BoxGeometry(34, 1.4, 4), stone, x, 13.6, z - 11);
    this.ctx.physics.addBox(x, 7, z, 17, 7, 9);
    for (let k = 0; k < 8; k++) this.ctx.physics.addCylinder(x - 14 + k * 4, 6, z - 11, 6, 0.6);
    this.ctx.footprints.push({ x0: x - 17, z0: z - 9, x1: x + 17, z1: z + 9, h: 22, color: '#ece4d4' });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.4), new THREE.MeshStandardMaterial({ map: makeLabelTexture('CITY HALL', { bg: '#ece4d4', fg: '#3b3b3b', font: 'bold 80px serif' }) }));
    sign.position.set(x, 13.6, z - 13.05);
    sign.rotation.y = Math.PI;
    this.group.add(sign);
    this.add('cityhall', 'City Hall', x, z - 12, 'The domed City Hall houses the mayor\'s office and a small museum of the city\'s history.', 30);
  }

  _crane({ x, z }) {
    const yellow = new THREE.MeshStandardMaterial({ color: 0xd9a21b, roughness: 0.6, metalness: 0.3 });
    const gb = new GeoBuilder(1);
    for (const sx of [-12, 12]) for (const sz of [-6, 6]) gb.box(sx, 14, sz, 1.2, 28, 1.2);
    gb.box(0, 28.5, -6, 26, 1.6, 1.2);
    gb.box(0, 28.5, 6, 26, 1.6, 1.2);
    gb.box(-12, 28.5, 0, 1.2, 1.6, 13);
    gb.box(12, 28.5, 0, 1.2, 1.6, 13);
    const crane = new THREE.Mesh(gb.build(), yellow);
    crane.position.set(x, 0, z);
    crane.castShadow = true;
    this.group.add(crane);
    const trolley = this._mesh(new THREE.BoxGeometry(3, 2.5, 13), yellow, x, 27, z);
    const cable = this._mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 4), Materials.darkMetal, x, 20, z);
    const box = this._mesh(new THREE.BoxGeometry(2.4, 2.6, 6), new THREE.MeshStandardMaterial({ color: 0x1f5f9b }), x, 12, z);
    trolley.userData.noMerge = cable.userData.noMerge = box.userData.noMerge = true;
    this.animated.push((t) => {
      const px = x + Math.sin(t * 0.15) * 9;
      const lift = 10 + Math.sin(t * 0.3) * 5;
      trolley.position.x = px;
      box.position.set(px, lift, z);
      cable.position.set(px, (27 + lift + 1.3) / 2, z);
      cable.scale.y = 27 - lift - 1.3;
    });
    for (const sx of [-12, 12]) for (const sz of [-6, 6]) this.ctx.physics.addBox(x + sx, 14, z + sz, 0.7, 14, 0.7);
    this.add('crane', 'Rust Crane', x, z, 'The giant gantry crane still moves containers around the old Ironworks yard, day and night.', 32);
  }

  _lotus({ x, z, r }) {
    const petalMat = new THREE.MeshStandardMaterial({ color: 0xf5b5c8, roughness: 0.5 });
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const p = this._mesh(new THREE.SphereGeometry(1, 10, 6), petalMat, x + Math.sin(a) * 1.4, 0.9, z + Math.cos(a) * 1.4, a);
      p.scale.set(0.6, 0.3, 1.6);
      p.rotation.x = -0.6;
    }
    const jetMat = new THREE.MeshStandardMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.5 });
    const jets = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const j = this._mesh(new THREE.CylinderGeometry(0.08, 0.2, 4, 6, 1, true), jetMat, x + Math.sin(a) * (r * 0.6), 2, z + Math.cos(a) * (r * 0.6));
      j.castShadow = false;
      j.userData.noMerge = true;
      jets.push(j);
    }
    const center = this._mesh(new THREE.CylinderGeometry(0.15, 0.4, 7, 8, 1, true), jetMat, x, 3.5, z);
    center.userData.noMerge = true;
    this.animated.push((t) => {
      jets.forEach((j, k) => { j.scale.y = 0.8 + 0.4 * Math.sin(t * 2 + k); j.position.y = j.scale.y * 2; });
      center.scale.y = 0.9 + 0.15 * Math.sin(t * 3);
    });
    this.add('lotus', 'Lotus Fountain', x, z, 'A lotus-shaped fountain in Central Park. Locals say tossing a coin brings good luck.', 26);
  }

  _ferrisWheel({ x, z }) {
    const R = 16;
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5, metalness: 0.3 });
    const wheel = new THREE.Group();
    wheel.position.set(x, R + 3, z);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.35, 8, 64), white);
    const rim2 = rim.clone();
    rim.position.z = -1.2; rim2.position.z = 1.2;
    wheel.add(rim, rim2);
    const n = 16;
    const cabins = [];
    const cabinMat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, emissive: c, emissiveIntensity: 0.1 });
    const colors = [0xef4444, 0xf59e0b, 0x10b981, 0x3b82f6, 0x8b5cf6, 0xec4899];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.2, R, 0.2), white);
      spoke.position.set(Math.sin(a) * R / 2, Math.cos(a) * R / 2, 0);
      spoke.rotation.z = -a;
      wheel.add(spoke);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), cabinMat(colors[k % colors.length]));
      cabin.position.set(Math.sin(a) * R, Math.cos(a) * R - 1.3, 0);
      wheel.add(cabin);
      cabins.push(cabin);
    }
    wheel.rotation.y = Math.PI / 2;
    this.group.add(wheel);
    const legGeo = new THREE.CylinderGeometry(0.35, 0.5, R + 4, 8);
    for (const sz of [-3, 3]) for (const sx of [-6, 6]) {
      const leg = this._mesh(legGeo, white, x + sx * 0.5, (R + 3) / 2, z + sz);
      leg.rotation.x = sz > 0 ? -0.2 : 0.2;
    }
    // lights ring
    const bulbs = new THREE.Mesh(new THREE.TorusGeometry(R + 0.4, 0.15, 6, 64), Materials.lampGlow);
    wheel.add(bulbs);
    let ang = 0;
    this.animated.push((t, dt) => {
      // rotate around the wheel's own axle; cabins counter-rotate to stay upright
      ang += dt * 0.12;
      wheel.rotation.set(0, Math.PI / 2, 0);
      wheel.rotateZ(ang);
      for (const c of cabins) c.rotation.z = -ang;
    });
    this.ctx.physics.addBox(x, 4, z, 2, 4, 4);
    this.add('ferris', 'Pier Ferris Wheel', x, z, 'The Golden Sands Ferris wheel at the end of the pier. Lights up beautifully after dark.', 30);
  }

  _stadium() {
    const b = this.ctx.layout.blocksOfType('STAD')[0];
    if (!b) return;
    const x = b.cx, z = b.cz;
    const R = Math.min(b.w, b.d) / 2 - 6;
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 2, 16, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0xd4d4dc, roughness: 0.6, side: THREE.DoubleSide }));
    shell.position.set(x, 8, z);
    shell.castShadow = true;
    this.group.add(shell);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x7c3aed, roughness: 0.5 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R + 0.5, 0.8, 8, 40), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 16, z);
    this.group.add(ring);
    const pitch = new THREE.Mesh(new THREE.CircleGeometry(R - 1, 40), Materials.grass);
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.set(x, 0.05, z);
    this.group.add(pitch);
    // seating tiers inside
    const tiers = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.5, R - 9, 12, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.8, side: THREE.BackSide }));
    tiers.position.set(x, 6.2, z);
    this.group.add(tiers);
    // floodlights
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      this._mesh(new THREE.CylinderGeometry(0.4, 0.6, 26, 6), Materials.metal, x + Math.sin(a) * (R + 3), 13, z + Math.cos(a) * (R + 3));
      const lamp = this._mesh(new THREE.BoxGeometry(4, 2, 0.6), Materials.lampGlow, x + Math.sin(a) * (R + 3), 26, z + Math.cos(a) * (R + 3), a);
      lamp.castShadow = false;
    }
    // collider ring approximated with boxes
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      this.ctx.physics.addBox(x + Math.sin(a) * (R + 1), 8, z + Math.cos(a) * (R + 1), 1.2, 8, (Math.PI * 2 * (R + 1)) / 40 + 0.4, a);
    }
    this.ctx.footprints.push({ x0: x - R - 2, z0: z - R - 2, x1: x + R + 2, z1: z + R + 2, h: 16, round: true, color: '#b9b4cc' });
    this.add('stadium', 'Arena Stadium', x, z, 'Home of the city cricket and football clubs. 40,000 seats and floodlights you can see from the highway.', R + 12);
  }

  _lighthouse() {
    const x = 352, z = WORLD.minZ + 19.5;
    const white = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.7 });
    const red = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.7 });
    this._mesh(new THREE.CylinderGeometry(5, 5.5, 2, 20), Materials.concrete, x, 1, z);
    for (let k = 0; k < 6; k++) this._mesh(new THREE.CylinderGeometry(3.2 - k * 0.22, 3.4 - k * 0.22, 4, 18), k % 2 ? red : white, x, 4 + k * 4, z);
    this._mesh(new THREE.CylinderGeometry(2.4, 2.4, 3, 12), Materials.glass, x, 27.5, z);
    const lamp = this._mesh(new THREE.SphereGeometry(1.2, 12, 8), Materials.lampGlow, x, 27.5, z);
    lamp.castShadow = false;
    this._mesh(new THREE.ConeGeometry(2.8, 2.5, 12), red, x, 30.3, z);
    this.ctx.physics.addCylinder(x, 15, z, 15, 3.6);
    this.ctx.footprints.push({ x0: x - 4, z0: z - 4, x1: x + 4, z1: z + 4, h: 30, round: true, color: '#f0f0f0' });
    this.add('lighthouse', 'Old Lighthouse', x, z, 'The lighthouse at the northern end of Golden Sands has guided fishing boats home for over a century.', 26);
  }

  update(t, dt) {
    for (const fn of this.animated) fn(t, dt);
  }

  /** Merge every static landmark mesh into one draw call per material. */
  optimize() {
    mergeMeshChildren(this.group);
  }
}
