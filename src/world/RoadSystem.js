import * as THREE from 'three';
import { GRID, xs, SIDEWALK, RIVER, RIVER_ROW, BEACH, WORLD } from '../config.js';
import { GeoBuilder } from '../utils/GeoBuilder.js';
import { InstanceBatch } from '../utils/InstanceBatch.js';
import { Materials } from './Materials.js';
import { Random } from '../utils/Random.js';

/**
 * Roads, sidewalks, markings, crossings, traffic lights, street lights, bridges, tunnel,
 * river and highway barriers — plus their colliders.
 */
export class RoadSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.layout = ctx.layout;
    this.group = new THREE.Group();
    this.group.name = 'roads';
    ctx.root.add(this.group);
    this.batches = [];
    this.lightHeads = [];
  }

  build() {
    this._roads();
    this._sidewalks();
    this._markings();
    this._river();
    this._bridges();
    this._tunnel();
    this._barriers();
    this._trafficLights();
    this._streetLights();
    for (const b of this.batches) b.build(this.group);
  }

  // ---------- Road surfaces ----------
  _roads() {
    const L = this.layout;
    const gb = new GeoBuilder(0.125);
    for (const n of L.nodes) gb.rect(n.x - n.hx, n.z - n.hz, n.x + n.hx, n.z + n.hz, 0.0);
    for (const e of L.edges) {
      const A = L.nodes[e.a], B = L.nodes[e.b];
      if (e.axis === 'x') gb.rect(A.x + A.hx, A.z - e.width / 2, B.x - B.hx, A.z + e.width / 2, 0.0);
      else gb.rect(A.x - e.width / 2, A.z + A.hz, A.x + e.width / 2, B.z - B.hz, 0.0);
    }
    const mesh = new THREE.Mesh(gb.build(), Materials.asphalt);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  _sidewalks() {
    const L = this.layout;
    const gb = new GeoBuilder(0.25);
    const curb = new GeoBuilder(0.25);
    const y = 0.09;
    const ring = (x0, z0, x1, z1, w) => {
      gb.rect(x0, z0, x1, z0 + w, y);
      gb.rect(x0, z1 - w, x1, z1, y);
      gb.rect(x0, z0 + w, x0 + w, z1 - w, y);
      gb.rect(x1 - w, z0 + w, x1, z1 - w, y);
      curb.wall(x0, z0, x1, z0, 0, y, null, true);
      curb.wall(x1, z1, x0, z1, 0, y, null, true);
      curb.wall(x0, z1, x0, z0, 0, y, null, true);
      curb.wall(x1, z0, x1, z1, 0, y, null, true);
    };
    for (const b of L.blocks) {
      if (b.type === 'RIVER' || b.type === 'BEACH') continue;
      ring(b.x0, b.z0, b.x1, b.z1, SIDEWALK);
    }
    // Seafront promenade
    const px0 = BEACH.promenadeX0, px1 = BEACH.sandX0;
    gb.rect(px0, WORLD.minZ - 10, px1, RIVER.z0, y);
    gb.rect(px0, RIVER.z1, px1, WORLD.maxZ + 10, y);
    curb.wall(px0, RIVER.z0, px0, WORLD.minZ - 10, 0, y, null, true);
    curb.wall(px0, WORLD.maxZ + 10, px0, RIVER.z1, 0, y, null, true);
    const m = new THREE.Mesh(gb.build(), Materials.sidewalk);
    m.receiveShadow = true;
    this.group.add(m);
    const c = new THREE.Mesh(curb.build(), Materials.concrete);
    this.group.add(c);
  }

  // ---------- Markings ----------
  _markings() {
    const L = this.layout;
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    const white = new InstanceBatch(plane, Materials.marking, { castShadow: false, lodDistance: 'prop', lodScale: 1.2 });
    const yellow = new InstanceBatch(plane, Materials.markingYellow, { castShadow: false, lodDistance: 'prop', lodScale: 1.2 });
    const Y = 0.012;
    for (const e of L.edges) {
      const A = L.nodes[e.a], B = L.nodes[e.b];
      const alongX = e.axis === 'x';
      const s0 = (alongX ? A.x + A.hx : A.z + A.hz);
      const s1 = (alongX ? B.x - B.hx : B.z - B.hz);
      const c = alongX ? A.z : A.x;
      const len = s1 - s0;
      const put = (batch, s, off, l, w) => {
        if (alongX) batch.add(s, Y, c + off, 0, l, 1, w);
        else batch.add(c + off, Y, s, 0, w, 1, l);
      };
      // Centre line
      if (e.highway) {
        put(yellow, (s0 + s1) / 2, -0.45, len - 2, 0.15);
        put(yellow, (s0 + s1) / 2, 0.45, len - 2, 0.15);
        for (let s = s0 + 3; s < s1 - 3; s += 9) { put(white, s, 5.5, 3, 0.15); put(white, s, -5.5, 3, 0.15); }
      } else {
        for (let s = s0 + 6; s < s1 - 6; s += 6) put(white, s, 0, 3, 0.15);
      }
      // Edge lines
      const ew = e.width / 2 - 0.4;
      put(white, (s0 + s1) / 2, ew, len, 0.15);
      put(white, (s0 + s1) / 2, -ew, len, 0.15);
      // Crosswalks + stop lines at both ends
      for (const [N, s, dir] of [[A, s0, 1], [B, s1, -1]]) {
        if (!N.lights && !N.roundabout) continue;
        const half = e.width / 2 - 0.6;
        for (let o = -half; o <= half; o += 1.1) put(white, s + dir * 2.2, o, 3.2, 0.55);
        put(white, s + dir * 4.4, 0, 0.35, e.width - 1);
      }
    }
    this.batches.push(white, yellow);
    this._roadDetail();
  }

  /** Manhole covers, oil drips down the lanes and patched asphalt — breaks up the clean CG look. */
  _roadDetail() {
    const L = this.layout;
    const r = new Random(4242);
    const disc = new THREE.CircleGeometry(0.42, 16);
    disc.rotateX(-Math.PI / 2);
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    const gradTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.5, 'rgba(255,255,255,0.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    const manholeMat = new THREE.MeshStandardMaterial({ color: 0x3b3a38, roughness: 0.55, metalness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
    const stainMat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: gradTex, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    const patchMat = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 });
    const manholes = new InstanceBatch(disc, manholeMat, { castShadow: false, lodDistance: 'prop', lodScale: 0.6 });
    const stains = new InstanceBatch(plane, stainMat, { castShadow: false, lodDistance: 'prop', lodScale: 0.7 });
    const patches = new InstanceBatch(plane, patchMat, { castShadow: false, lodDistance: 'prop', lodScale: 1 });
    for (const e of L.edges) {
      const A = L.nodes[e.a], B = L.nodes[e.b];
      const alongX = e.axis === 'x';
      const s0 = alongX ? A.x + A.hx : A.z + A.hz;
      const s1 = alongX ? B.x - B.hx : B.z - B.hz;
      const c = alongX ? A.z : A.x;
      const put = (batch, s, off, Y, rot, l, w) => {
        if (alongX) batch.add(s, Y, c + off, rot, l, 1, w);
        else batch.add(c + off, Y, s, rot, w, 1, l);
      };
      const lane = e.width / 4;
      for (let s = s0 + 8; s < s1 - 8; s += r.range(22, 34)) put(manholes, s, r.pick([-lane, lane, 0.0]) * r.range(0.6, 1), 0.016, 0, 1, 1);
      for (let s = s0 + 4; s < s1 - 4; s += r.range(5, 11)) {
        const off = (r.chance(0.5) ? -lane : lane) + r.range(-0.3, 0.3);
        put(stains, s, off, 0.014, r.range(0, 3), r.range(0.8, 2.2), r.range(0.5, 1.1));
      }
      if (r.chance(0.55)) {
        const s = r.range(s0 + 6, s1 - 6);
        put(patches, s, r.range(-lane, lane), 0.011, 0, r.range(2, 5), r.range(1.2, 2.6));
      }
    }
    this.batches.push(manholes, stains, patches);
  }

  // ---------- River ----------
  _river() {
    const { z0, z1, waterY, bedY } = RIVER;
    const x0 = WORLD.minX - 140, x1 = BEACH.wallX;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1), this.ctx.waterMaterial || Materials.water);
    water.rotation.x = -Math.PI / 2;
    water.position.set((x0 + x1) / 2, waterY, (z0 + z1) / 2);
    this.group.add(water);
    const bed = new GeoBuilder(0.1);
    bed.rect(x0, z0, x1, z1, bedY);
    const bm = new THREE.Mesh(bed.build(), Materials.dirt);
    this.group.add(bm);
    const banks = new GeoBuilder(0.25);
    banks.wall(x0, z0, x1, z0, bedY, 0.02, null, false);
    banks.wall(x1, z1, x0, z1, bedY, 0.02, null, false);
    const wallMat = Materials.concrete.clone();
    wallMat.side = THREE.DoubleSide;
    this.group.add(new THREE.Mesh(banks.build(), wallMat));

    // Breakwater rocks at the river mouth hiding the water level step to the ocean
    const rock = new THREE.DodecahedronGeometry(1, 0);
    const rocks = new InstanceBatch(rock, Materials.instColor, { colors: true, castShadow: false });
    for (let z = z0; z <= z1; z += 2.2) {
      rocks.add(BEACH.wallX - 4 + Math.random(), -0.4, z, Math.random() * 3, 2.2, 1.6 + Math.random(), 2.2, new THREE.Color().setHSL(0.08, 0.05, 0.35 + Math.random() * 0.1));
    }
    this.batches.push(rocks);

    // Bank colliders with gaps for bridges
    const gaps = [];
    for (let i = 0; i <= GRID.N; i++) {
      const w = this.layout.node(i, RIVER_ROW).hx + 4;
      gaps.push([xs[i] - w, xs[i] + w]);
    }
    const wallsAlong = (z) => {
      let cur = WORLD.minX - 1;
      for (const [g0, g1] of gaps) {
        this.ctx.physics.addWall(cur, z, g0, z, 2.2, 0.6, -0.5);
        cur = g1;
      }
      this.ctx.physics.addWall(cur, z, BEACH.wallX + 1, z, 2.2, 0.6, -0.5);
    };
    wallsAlong(z0 - 0.3);
    wallsAlong(z1 + 0.3);
    // Railings along the riverside sidewalks
    const post = new THREE.BoxGeometry(0.12, 1, 0.12);
    post.translate(0, 0.5, 0);
    const posts = new InstanceBatch(post, Materials.metal, { lodDistance: 'prop', castShadow: false });
    const railGeo = new THREE.BoxGeometry(1, 0.08, 0.08);
    const rails = new InstanceBatch(railGeo, Materials.metal, { lodDistance: 'prop', castShadow: false });
    for (const z of [z0 - 0.3, z1 + 0.3]) {
      let cur = WORLD.minX;
      const segs = [];
      for (const [g0, g1] of gaps) { segs.push([cur, g0]); cur = g1; }
      segs.push([cur, BEACH.sandX0]);
      for (const [a, b] of segs) {
        if (b - a < 1) continue;
        for (let x = a; x <= b; x += 2.5) posts.add(x, 0.09, z);
        rails.add((a + b) / 2, 1.0, z, 0, b - a, 1, 1);
        rails.add((a + b) / 2, 0.55, z, 0, b - a, 1, 1);
      }
    }
    this.batches.push(posts, rails);
  }

  _bridges() {
    const gb = new GeoBuilder(0.25);
    const sw = new GeoBuilder(0.25);
    const post = new THREE.BoxGeometry(0.15, 1.1, 0.15);
    post.translate(0, 0.55, 0);
    const posts = new InstanceBatch(post, Materials.white, { lodDistance: 'prop', castShadow: false });
    const rail = new THREE.BoxGeometry(0.12, 0.12, 1);
    const rails = new InstanceBatch(rail, Materials.white, { lodDistance: 'prop', castShadow: false });
    const pillar = new THREE.CylinderGeometry(1.2, 1.4, 1, 10);
    const pillars = new InstanceBatch(pillar, Materials.concrete, { castShadow: false });
    const { z0, z1 } = RIVER;
    for (let i = 0; i <= GRID.N; i++) {
      const n = this.layout.node(i, RIVER_ROW);
      const x = xs[i], hw = n.hx + 4;
      // deck body
      gb.box(x, -0.68, (z0 + z1) / 2, hw * 2, 1.3, z1 - z0); // top at -0.03: below the asphalt (y 0), no z-fight
      // arches (decorative side beams)
      for (const sx of [-1, 1]) gb.box(x + sx * (hw - 0.3), -1.5, (z0 + z1) / 2, 0.6, 0.6, z1 - z0 - 6);
      // bridge sidewalks
      sw.rect(x - hw, z0, x - n.hx, z1, 0.09);
      sw.rect(x + n.hx, z0, x + hw, z1, 0.09);
      for (const sx of [-1, 1]) {
        const rx = x + sx * (hw - 0.15);
        for (let z = z0; z <= z1; z += 2) posts.add(rx, 0.09, z);
        rails.add(rx, 1.15, (z0 + z1) / 2, 0, 1, 1, z1 - z0);
        rails.add(rx, 0.6, (z0 + z1) / 2, 0, 1, 1, z1 - z0);
        this.ctx.physics.addWall(rx, z0 - 0.5, rx, z1 + 0.5, 2.5, 0.4);
      }
      for (const zz of [z0 + (z1 - z0) / 3, z0 + (2 * (z1 - z0)) / 3]) {
        for (const sx of [-1, 1]) pillars.add(x + sx * (hw * 0.55), -2.6, zz, 0, 1, 2.6, 1);
      }
    }
    const deck = new THREE.Mesh(gb.build(), Materials.concrete);
    deck.receiveShadow = true;
    this.group.add(deck);
    const swm = new THREE.Mesh(sw.build(), Materials.sidewalk);
    swm.receiveShadow = true;
    this.group.add(swm);
    this.batches.push(posts, rails, pillars);
    this.landmarkBridge = { x: xs[GRID.N / 2], z: (z0 + z1) / 2 };
  }

  _tunnel() {
    const A = this.layout.node(0, 1), B = this.layout.node(0, 2);
    const x = A.x, za = A.z + A.hz + 1, zb = B.z - B.hz - 1;
    const len = zb - za, zc = (za + zb) / 2;
    const half = A.hx + 0.6;
    const H = 7.5;
    const gb = new GeoBuilder(0.25);
    gb.box(x - half - 0.5, H / 2, zc, 1, H, len);
    gb.box(x + half + 0.5, H / 2, zc, 1, H, len);
    gb.box(x, H + 0.6, zc, half * 2 + 2, 1.2, len);
    // portals
    for (const z of [za, zb]) {
      gb.box(x, H + 2.6, z, half * 2 + 8, 3.2, 1.6);
      gb.box(x - half - 2.5, (H + 4) / 2, z, 4, H + 4, 1.6);
      gb.box(x + half + 2.5, (H + 4) / 2, z, 4, H + 4, 1.6);
    }
    const mat = Materials.concrete;
    const m = new THREE.Mesh(gb.build(), mat);
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
    // grass roof + hill west of it
    const roof = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 2, 0.6, len + 1), Materials.grass);
    roof.position.set(x, H + 1.5, zc);
    this.group.add(roof);
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), Materials.grass);
    hill.scale.set(34, H + 4, len * 0.9);
    hill.position.set(x - half - 34, 0, zc);
    hill.receiveShadow = true;
    this.group.add(hill);
    // lights inside
    const strip = new THREE.BoxGeometry(0.4, 0.1, 3);
    const strips = new InstanceBatch(strip, Materials.lampGlow, { castShadow: false });
    for (let z = za + 3; z < zb; z += 7) { strips.add(x - 4, H - 0.05, z); strips.add(x + 4, H - 0.05, z); }
    this.batches.push(strips);
    this.ctx.physics.addWall(x - half - 0.5, za, x - half - 0.5, zb, H, 1);
    this.ctx.physics.addWall(x + half + 0.5, za, x + half + 0.5, zb, H, 1);
    this.tunnelBounds = { x0: x - half, x1: x + half, z0: za, z1: zb };
  }

  _barriers() {
    const L = this.layout;
    const N = GRID.N;
    // Outer guard rails around the highway ring (west, north, south)
    const gx0 = WORLD.minX + 0.4, gz0 = WORLD.minZ + 0.4, gz1 = WORLD.maxZ - 0.4;
    const post = new THREE.BoxGeometry(0.15, 0.8, 0.15);
    post.translate(0, 0.4, 0);
    const posts = new InstanceBatch(post, Materials.metal, { lodDistance: 'prop', castShadow: false });
    const beam = new THREE.BoxGeometry(1, 0.3, 0.08);
    const beams = new InstanceBatch(beam, Materials.metal, { lodDistance: 'prop', castShadow: false });
    const line = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az);
      const rot = Math.atan2(bz - az, bx - ax);
      for (let s = 0; s <= len; s += 4) posts.add(ax + ((bx - ax) * s) / len, 0, az + ((bz - az) * s) / len);
      beams.add((ax + bx) / 2, 0.65, (az + bz) / 2, -rot, len, 1, 1);
      this.ctx.physics.addWall(ax, az, bx, bz, 3, 0.6);
    };
    // west side split around the river (bridge carries it)
    line(gx0, gz0, gx0, RIVER.z0);
    line(gx0, RIVER.z1, gx0, gz1);
    line(gx0, gz0, xs[N] + L.node(N, 0).hx, gz0);
    line(gx0, gz1, xs[N] + L.node(N, 0).hx, gz1);
    this.ctx.physics.addWall(xs[N] + L.node(N, 0).hx, gz0, BEACH.wallX + 2, gz0, 3, 0.6);
    this.ctx.physics.addWall(xs[N] + L.node(N, 0).hx, gz1, BEACH.wallX + 2, gz1, 3, 0.6);
    // sea wall with an opening for the pier (pier has its own rails)
    this.ctx.physics.addWall(BEACH.wallX, gz0, BEACH.wallX, -4.6, 4, 0.6);
    this.ctx.physics.addWall(BEACH.wallX, 4.6, BEACH.wallX, gz1, 4, 0.6);
    this.batches.push(posts, beams);

    // Jersey median barrier on highways (between junctions)
    const jersey = new THREE.BoxGeometry(1, 0.9, 0.6);
    jersey.translate(0, 0.45, 0);
    const meds = new InstanceBatch(jersey, Materials.concrete, { castShadow: false, lodDistance: 'prop', lodScale: 1.5 });
    for (const e of L.edges) {
      if (!e.highway) continue;
      const A = L.nodes[e.a], B = L.nodes[e.b];
      if (e.axis === 'x') {
        const a = A.x + A.hx + 2, b = B.x - B.hx - 2;
        meds.add((a + b) / 2, 0, A.z, 0, b - a, 1, 1);
        this.ctx.physics.addWall(a, A.z, b, A.z, 0.9, 0.6);
      } else {
        const a = A.z + A.hz + 2, b = B.z - B.hz - 2;
        meds.add(A.x, 0, (a + b) / 2, Math.PI / 2, b - a, 1, 1);
        this.ctx.physics.addWall(A.x, a, A.x, b, 0.9, 0.6);
      }
    }
    this.batches.push(meds);
  }

  // ---------- Traffic lights ----------
  _trafficLights() {
    const L = this.layout;
    const pole = new THREE.CylinderGeometry(0.1, 0.12, 4.2, 6);
    pole.translate(0, 2.1, 0);
    const poles = new InstanceBatch(pole, Materials.darkMetal, { castShadow: true, lodDistance: 'prop' });
    const housing = new THREE.BoxGeometry(0.45, 1.25, 0.35);
    const housings = new InstanceBatch(housing, Materials.darkMetal, { castShadow: false, lodDistance: 'prop' });
    const bulbGeo = new THREE.SphereGeometry(0.15, 8, 6);
    const heads = [];
    for (const n of L.nodes) {
      if (!n.lights) continue;
      const corners = [
        [-1, -1, 'z', 0], [1, 1, 'z', Math.PI], [1, -1, 'x', -Math.PI / 2], [-1, 1, 'x', Math.PI / 2],
      ];
      for (const [sx, sz, axis, rot] of corners) {
        const x = n.x + sx * (n.hx + 0.9), z = n.z + sz * (n.hz + 0.9);
        if (!this._cornerValid(n, sx, sz)) continue;
        poles.add(x, 0, z);
        housings.add(x, 3.6, z, rot);
        heads.push({ node: n, axis, x, z, rot });
      }
    }
    this.batches.push(poles, housings);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.bulbs = new THREE.InstancedMesh(bulbGeo, mat, Math.max(1, heads.length * 3));
    const m = new THREE.Matrix4();
    const off = new THREE.Vector3();
    heads.forEach((h, k) => {
      for (let b = 0; b < 3; b++) {
        off.set(0, 4.0 - b * 0.4, 0.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), h.rot);
        m.makeTranslation(h.x + off.x, off.y, h.z + off.z);
        this.bulbs.setMatrixAt(k * 3 + b, m);
        this.bulbs.setColorAt(k * 3 + b, new THREE.Color(0x222222));
      }
    });
    this.bulbs.instanceMatrix.needsUpdate = true;
    this.bulbs.computeBoundingSphere();
    this.group.add(this.bulbs);
    this.lightHeads = heads;
    this._lastStates = new Array(heads.length).fill('');
  }

  _cornerValid(n, sx, sz) {
    // Skip corners that sit over the river or outside the city ring.
    const x = n.x + sx * (n.hx + 2), z = n.z + sz * (n.hz + 2);
    if (z > RIVER.z0 && z < RIVER.z1) return false;
    if (x < WORLD.minX || z < WORLD.minZ || z > WORLD.maxZ) return false;
    return true;
  }

  updateTrafficLights(time) {
    if (!this.bulbs) return;
    const colors = { red: 0xff2a1a, yellow: 0xffb000, green: 0x22ff66 };
    const dim = new THREE.Color(0x1a1a1a);
    const c = new THREE.Color();
    let changed = false;
    this.lightHeads.forEach((h, k) => {
      const s = this.layout.lightState(h.node, h.axis, time);
      if (s === this._lastStates[k]) return;
      this._lastStates[k] = s;
      changed = true;
      this.bulbs.setColorAt(k * 3, s === 'red' ? c.setHex(colors.red) : dim);
      this.bulbs.setColorAt(k * 3 + 1, s === 'yellow' ? c.setHex(colors.yellow) : dim);
      this.bulbs.setColorAt(k * 3 + 2, s === 'green' ? c.setHex(colors.green) : dim);
    });
    if (changed) this.bulbs.instanceColor.needsUpdate = true;
  }

  // ---------- Street lights ----------
  _streetLights() {
    const L = this.layout;
    const pole = new THREE.CylinderGeometry(0.09, 0.14, 7, 6);
    pole.translate(0, 3.5, 0);
    const poles = new InstanceBatch(pole, Materials.darkMetal, { lodDistance: 'prop' });
    const arm = new THREE.BoxGeometry(0.1, 0.1, 2);
    arm.translate(0, 0, 1);
    const arms = new InstanceBatch(arm, Materials.darkMetal, { lodDistance: 'prop', castShadow: false });
    const head = new THREE.BoxGeometry(0.5, 0.18, 0.9);
    const heads = new InstanceBatch(head, Materials.lampGlow, { castShadow: false, lodDistance: 'prop', lodScale: 1.6 });
    const lamp = (x, z, faceRot) => {
      poles.add(x, 0, z);
      arms.add(x, 6.9, z, faceRot);
      const dx = Math.sin(faceRot) * 2, dz = Math.cos(faceRot) * 2;
      heads.add(x + dx, 6.85, z + dz, faceRot);
      this.ctx.physics.addCylinder(x, 1.5, z, 1.5, 0.18);
    };
    for (const e of L.edges) {
      if (e.tunnel) continue;
      const A = L.nodes[e.a], B = L.nodes[e.b];
      const off = e.width / 2 + 0.8;
      if (e.axis === 'x') {
        const a = A.x + A.hx + 6, b = B.x - B.hx - 6;
        const n = Math.max(1, Math.round((b - a) / 26));
        for (let k = 0; k <= n; k++) {
          const x = a + ((b - a) * k) / n;
          const inRiver = (z) => z > RIVER.z0 - 0.5 && z < RIVER.z1 + 0.5;
          if ((A.j > 0 || !e.highway) && !inRiver(A.z - off)) lamp(x, A.z - off, 0);
          if ((A.j < GRID.N || !e.highway) && (k % 2 === 0 || !e.highway) && !inRiver(A.z + off)) lamp(x, A.z + off, Math.PI);
        }
      } else {
        const a = A.z + A.hz + 6, b = B.z - B.hz - 6;
        const n = Math.max(1, Math.round((b - a) / 26));
        for (let k = 0; k <= n; k++) {
          const z = a + ((b - a) * k) / n;
          if (z > RIVER.z0 - 1 && z < RIVER.z1 + 1) continue;
          if (A.i > 0) lamp(A.x - off, z, Math.PI / 2);
          if (A.i < GRID.N || k % 2 === 0) lamp(A.x + off, z, -Math.PI / 2);
        }
      }
    }
    this.batches.push(poles, arms, heads);
  }
}
