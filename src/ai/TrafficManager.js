import { MAX_TRAFFIC, COLLISION, DISTRICT_INFO, RIVER } from '../config.js';
import { CAR_SHAPES } from '../vehicles/VehicleTypes.js';
import { HybridCarRenderer } from './CarInstancer.js';
import { prepareTrafficModel } from '../vehicles/VehicleModels.js';
import { VEHICLES } from '../vehicles/VehicleTypes.js';
import { Random, clamp } from '../utils/Random.js';
import { quatY } from '../game/PhysicsManager.js';

const COLORS = ['#e8e8e8', '#1c1c1c', '#9aa0a6', '#b71c1c', '#0d47a1', '#2e7d32', '#f9a825', '#6d4c41', '#37474f', '#ad1457', '#ffffff', '#455a64', '#c62828', '#1565c0'];

/**
 * AI traffic. Cars follow lanes along the road graph, obey traffic lights, turn through
 * intersections on curves, circle the roundabout, keep distance to whatever is ahead
 * (cars, the player, pedestrians) and are recycled around the player for performance.
 */
export class TrafficManager {
  constructor(game) {
    this.game = game;
    this.layout = game.layout;
    this.rng = new Random(31337);
    this.models = this._prepareModels();
    this.modelShapes = [...new Set(this.models.map((m) => m.shape))];
    const heavy = this.models.reduce((m, x) => Math.max(m, x.tris), 0) > 60000;
    this.nearDist = heavy ? 45 : 80;
    this.inst = new HybridCarRenderer(game.scene, MAX_TRAFFIC, this.models, { dynamic: true, nearDist: this.nearDist });
    this._parkedFocus = { x: 1e9, z: 1e9 };
    this.parked = null;
    this.cars = [];
    this.time = 0;
    this.active = 0;
    this.hornCooldown = 0;
    this.edgeWeights = this.layout.edges.map((e) => (e.district === 'HWY' ? 2.2 : DISTRICT_INFO[e.district]?.traffic || 1) * e.length);
    this.totalWeight = this.edgeWeights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < MAX_TRAFFIC; i++) this.cars.push(this._createCar(i));
  }

  /** Realistic car models for traffic: the manifest's "traffic" list, else any car models provided. */
  _prepareModels() {
    const a = this.game.assets;
    const srcs = [...(a.traffic || [])];
    if (!srcs.length) for (const [type, v] of a.vehicles || []) if (VEHICLES[type] && VEHICLES[type].kind === 'car') srcs.push(v);
    const out = [];
    for (const src of srcs) {
      try { const m = prepareTrafficModel(src.gltf.scene, src.options || {}); m.src = src; out.push(m); } catch (err) { console.warn('[Traffic] model skipped', err); }
    }
    return out;
  }

  get side() {
    return this.game.settings.trafficSide === 'right' ? -1 : 1; // +1 = drive on the left
  }

  _createCar(slot) {
    const r = this.rng;
    const roll = r.next();
    const modelShapes = this.modelShapes && this.modelShapes.length ? this.modelShapes : null;
    const shape = roll < 0.06 ? 'bus' : roll < 0.13 ? 'taxi' : roll < 0.2 ? 'van'
      : modelShapes ? r.pick(modelShapes) : r.pick(['hatchback', 'sedan', 'sedan', 'suv', 'hatchback', 'sports']);
    const s = CAR_SHAPES[shape];
    const color = shape === 'taxi' ? '#f5c518' : shape === 'bus' ? r.pick(['#1e88e5', '#e53935', '#43a047']) : r.pick(COLORS);
    this.inst.setStyle(slot, shape, color);
    const he = { x: s.W / 2, y: (s.clearance + s.bodyH + s.cabH) / 2, z: s.L / 2 };
    const desc = this.game.physics.RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z);
    const kin = this.game.physics.createKinematic(0, -50 - slot * 5, 0, desc, COLLISION.TRAFFIC, COLLISION.VEHICLE | COLLISION.PLAYER);
    return {
      slot, shape, color, he, body: kin.body, collider: kin.collider,
      active: false, x: 0, z: 0, heading: 0, speed: 0,
      path: null, s: 0, phase: 'edge', from: 0, to: 0, edge: null, lane: 0,
      nextTo: -1, turnPath: null, stoppedFor: 0, ghost: 0, braking: false,
      maxSpeedFactor: shape === 'bus' ? 0.75 : shape === 'sports' ? 1.12 : r.range(0.85, 1.05),
    };
  }

  laneOffset(edge, lane) {
    if (edge.highway) return lane === 0 ? 3.3 : 7.5;
    return 2.4;
  }

  /** Lane centre-line from node a to node b. Returns [startPoint, endPoint, dir]. */
  lanePoints(a, b, edge, lane) {
    const A = this.layout.nodes[a], B = this.layout.nodes[b];
    const dx = B.x - A.x, dz = B.z - A.z;
    const len = Math.hypot(dx, dz);
    const fx = dx / len, fz = dz / len;
    const lx = fz * this.side, lz = -fx * this.side; // left of travel (for left-hand traffic)
    const off = this.laneOffset(edge, lane);
    const ha = edge.axis === 'x' ? A.hx : A.hz;
    const hb = edge.axis === 'x' ? B.hx : B.hz;
    const start = { x: A.x + fx * ha + lx * off, z: A.z + fz * ha + lz * off };
    const end = { x: B.x - fx * hb + lx * off, z: B.z - fz * hb + lz * off };
    return { start, end, fx, fz, len: Math.hypot(end.x - start.x, end.z - start.z) };
  }

  _pickEdgeNear(px, pz, minD, maxD) {
    for (let tries = 0; tries < 40; tries++) {
      let r = this.rng.next() * this.totalWeight;
      let ei = 0;
      while (r > this.edgeWeights[ei] && ei < this.edgeWeights.length - 1) { r -= this.edgeWeights[ei]; ei++; }
      const e = this.layout.edges[ei];
      const A = this.layout.nodes[e.a], B = this.layout.nodes[e.b];
      const t = this.rng.range(0.15, 0.85);
      const x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t;
      const d = Math.hypot(x - px, z - pz);
      if (d >= minD && d <= maxD) return { e, t };
    }
    return null;
  }

  spawnCar(car, px, pz, minD, maxD) {
    const pick = this._pickEdgeNear(px, pz, minD, maxD);
    if (!pick) return false;
    const { e, t } = pick;
    const forward = this.rng.chance(0.5);
    const from = forward ? e.a : e.b, to = forward ? e.b : e.a;
    const lane = e.highway ? this.rng.int(0, 1) : 0;
    const lp = this.lanePoints(from, to, e, lane);
    const s = lp.len * t;
    // keep spacing to cars already on this lane
    for (const o of this.cars) {
      if (!o.active || o === car || o.edge !== e || o.to !== to || o.lane !== lane || o.phase !== 'edge') continue;
      if (Math.abs(o.s - s) < 14) return false;
    }
    if (car.shape === 'bus' && e.highway) return false;
    car.edge = e; car.from = from; car.to = to; car.lane = lane;
    car.path = [lp.start, lp.end]; car.pathLen = lp.len; car.s = s; car.phase = 'edge';
    car.speed = e.speed * 0.6;
    car.nextTo = this._chooseNext(from, to);
    car.active = true;
    car.ghost = 0; car.stoppedFor = 0;
    this._placeOnPath(car);
    car.body.setTranslation({ x: car.x, y: car.he.y + 0.05, z: car.z }, true);
    return true;
  }

  _chooseNext(from, at) {
    const node = this.layout.nodes[at];
    const opts = node.neighbors.filter((n) => n.node !== from);
    if (!opts.length) return from;
    // prefer continuing straight a bit more often
    const A = this.layout.nodes[from];
    const dx = node.x - A.x, dz = node.z - A.z;
    let total = 0;
    const w = opts.map((o) => {
      const C = this.layout.nodes[o.node];
      const straight = Math.sign(C.x - node.x) === Math.sign(dx) && Math.sign(C.z - node.z) === Math.sign(dz);
      const e = this.layout.edges[o.edge];
      const ww = (straight ? 2 : 1) * (e.district === 'HWY' ? 1.5 : DISTRICT_INFO[e.district]?.traffic || 1);
      total += ww;
      return ww;
    });
    let r = this.rng.next() * total;
    for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i].node; }
    return opts[opts.length - 1].node;
  }

  _edgeBetween(a, b) {
    const n = this.layout.nodes[a].neighbors.find((x) => x.node === b);
    return n ? this.layout.edges[n.edge] : null;
  }

  _buildTurn(car) {
    const L = this.layout;
    const nextEdge = this._edgeBetween(car.to, car.nextTo);
    const nextLane = nextEdge.highway ? (car.edge.highway ? car.lane : this.rng.int(0, 1)) : 0;
    const out = this.lanePoints(car.to, car.nextTo, nextEdge, nextLane);
    const P0 = car.path[car.path.length - 1];
    const P2 = out.start;
    const node = L.nodes[car.to];
    const pts = [P0];
    if (node.roundabout) {
      const R = 5.4;
      const a0 = Math.atan2(P0.z - node.z, P0.x - node.x);
      const a1 = Math.atan2(P2.z - node.z, P2.x - node.x);
      const dir = this.side; // left-hand traffic circulates clockwise (increasing angle here)
      let d = (a1 - a0) * dir;
      while (d <= 0.2) d += Math.PI * 2;
      const steps = Math.max(4, Math.round(d / 0.3));
      for (let k = 1; k < steps; k++) {
        const a = a0 + dir * d * (k / steps);
        pts.push({ x: node.x + Math.cos(a) * R, z: node.z + Math.sin(a) * R });
      }
    } else {
      const inX = car.edge.axis === 'x';
      const outX = nextEdge.axis === 'x';
      if (inX !== outX) {
        const P1 = inX ? { x: P2.x, z: P0.z } : { x: P0.x, z: P2.z };
        for (let k = 1; k < 8; k++) {
          const t = k / 8, u = 1 - t;
          pts.push({ x: u * u * P0.x + 2 * u * t * P1.x + t * t * P2.x, z: u * u * P0.z + 2 * u * t * P1.z + t * t * P2.z });
        }
      }
    }
    pts.push(P2);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    car.turn = { pts, len, nextEdge, nextLane, out };
  }

  _placeOnPath(car) {
    const pts = car.phase === 'edge' ? car.path : car.turn.pts;
    let s = car.s;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const l = Math.hypot(b.x - a.x, b.z - a.z);
      if (s <= l || i === pts.length - 1) {
        const t = l > 0 ? clamp(s / l, 0, 1) : 0;
        car.x = a.x + (b.x - a.x) * t;
        car.z = a.z + (b.z - a.z) * t;
        if (l > 0.01) car.heading = Math.atan2(b.x - a.x, b.z - a.z);
        return;
      }
      s -= l;
    }
  }

  setDensity(n) {
    this.target = Math.min(MAX_TRAFFIC, n);
  }

  init(px, pz, count) {
    this.target = Math.min(MAX_TRAFFIC, count);
    let made = 0;
    for (const car of this.cars) {
      if (made >= this.target) break;
      for (let k = 0; k < 6 && !car.active; k++) this.spawnCar(car, px, pz, 10, 240);
      if (car.active) made++;
    }
  }

  update(dt, focus) {
    this.time += dt;
    this.hornCooldown -= dt;
    const L = this.layout;
    const player = this.game.player;
    const pv = player.vehicle;
    const npcs = this.game.npcManager;
    let activeCount = 0;
    for (const car of this.cars) if (car.active) activeCount++;
    // top up / trim to target density
    if (activeCount < this.target) {
      for (const car of this.cars) {
        if (car.active) continue;
        if (this.spawnCar(car, focus.x, focus.z, 110, 230)) activeCount++;
        break;
      }
    }
    let trimmed = activeCount - this.target;

    for (const car of this.cars) {
      if (!car.active) continue;
      const dFocus = Math.hypot(car.x - focus.x, car.z - focus.z);
      if (dFocus > 270 || (trimmed > 0 && dFocus > 120)) {
        if (trimmed > 0) { trimmed--; this._deactivate(car); continue; }
        if (!this.spawnCar(car, focus.x, focus.z, 110, 230)) { this._deactivate(car); }
        continue;
      }
      // ------- desired speed -------
      const edgeSpeed = (car.phase === 'edge' ? car.edge.speed : 7.5) * car.maxSpeedFactor;
      let gap = 60;
      let reason = '';
      // traffic light / give way at the end of the edge
      if (car.phase === 'edge') {
        const node = L.nodes[car.to];
        const toEnd = car.pathLen - car.s;
        if (node.lights && toEnd < 40) {
          const st = L.lightState(node, car.edge.axis, this.time);
          const stopGap = toEnd - 5.2;
          if (st === 'red' || (st === 'yellow' && stopGap > 4)) {
            if (stopGap > -1.5) { gap = Math.min(gap, Math.max(0, stopGap)); reason = 'light'; }
          }
        }
      }
      // obstacles ahead (other cars, player, pedestrians)
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      const look = 9 + car.speed * 2.2;
      const check = (ox, oz, halfLen, halfW, isCar) => {
        const dx = ox - car.x, dz = oz - car.z;
        const along = dx * fx + dz * fz;
        if (along <= 0 || along > look + halfLen) return;
        const lat = Math.abs(dx * fz - dz * fx);
        if (lat > car.he.x + halfW + 0.35) return;
        const g = along - car.he.z - halfLen - 1.8;
        if (g < gap) { gap = Math.max(0, g); reason = isCar ? 'car' : 'person'; }
      };
      if (car.ghost <= 0) {
        for (const o of this.cars) {
          if (o === car || !o.active) continue;
          if (Math.abs(o.x - car.x) > 40 || Math.abs(o.z - car.z) > 40) continue;
          // ignore oncoming cars on the other lane
          const hd = Math.cos(o.heading - car.heading);
          if (hd < -0.5 && car.phase === 'edge' && o.phase === 'edge') continue;
          check(o.x, o.z, o.he.z, o.he.x, true);
        }
      } else car.ghost -= dt;
      if (pv) check(pv.x, pv.z, pv.halfExtents.z, pv.halfExtents.x, false);
      else if (!player.interior) check(player.pos.x, player.pos.z, 0.4, 0.4, false);
      if (npcs) {
        const near = npcs.queryNear(car.x + fx * 8, car.z + fz * 8, 12);
        for (const n of near) check(n.x, n.z, 0.35, 0.35, false);
      }
      // honk at the player when blocked by them
      if (reason === 'person' && gap < 3 && car.speed < 1 && this.hornCooldown <= 0 && dFocus < 30) {
        this.hornCooldown = 4;
        this.game.audio.horn(car.x, car.z, 0.5);
      }
      let target = edgeSpeed;
      if (car.phase === 'edge' && car.pathLen - car.s < 18) target = Math.min(target, L.nodes[car.to].roundabout ? 6 : 9 + (car.pathLen - car.s) * 0.5);
      const safe = Math.sqrt(2 * 6.5 * Math.max(0, gap - 0.5));
      target = Math.min(target, safe);
      const acc = target > car.speed ? 3.2 : -9;
      car.speed = clamp(car.speed + acc * dt, 0, Math.max(car.speed, target));
      if (gap < 0.3 && reason !== 'light') car.speed = Math.min(car.speed, 0.2);
      car.braking = target < car.speed + 0.5 && car.speed < edgeSpeed * 0.8 || car.speed < 0.3;

      // deadlock breaker
      if (car.speed < 0.15 && reason === 'car') {
        car.stoppedFor += dt;
        if (car.stoppedFor > 7) { car.ghost = 3; car.stoppedFor = 0; }
      } else car.stoppedFor = 0;

      // ------- advance along the path -------
      car.s += car.speed * dt;
      if (car.phase === 'edge' && car.s >= car.pathLen) {
        // entering the intersection
        if (car.nextTo < 0) car.nextTo = this._chooseNext(car.from, car.to);
        this._buildTurn(car);
        car.s -= car.pathLen;
        car.phase = 'turn';
      }
      if (car.phase === 'turn' && car.s >= car.turn.len) {
        const t = car.turn;
        car.s -= t.len;
        car.from = car.to; car.to = car.nextTo;
        car.edge = t.nextEdge; car.lane = t.nextLane;
        car.path = [t.out.start, t.out.end]; car.pathLen = t.out.len;
        car.phase = 'edge';
        car.nextTo = this._chooseNext(car.from, car.to);
      }
      this._placeOnPath(car);
      car.body.setNextKinematicTranslation({ x: car.x, y: car.he.y + 0.05, z: car.z });
      car.body.setNextKinematicRotation(quatY(car.heading));
      // render (skip far cars)
      if (dFocus < this.game.settings.drawDistanceValue * 0.75) {
        this.inst.setTransform(car.slot, car.x, car.z, car.heading);
        if (car.braking !== car._lastBrake) { this.inst.setBrake(car.slot, car.braking); car._lastBrake = car.braking; }
      } else this.inst.hide(car.slot);
    }
    this.inst.commit(focus);
    if (this.parked && Math.hypot(focus.x - this._parkedFocus.x, focus.z - this._parkedFocus.z) > 3) {
      this._parkedFocus = { x: focus.x, z: focus.z };
      this.parked.commit(focus);
    }
    this.active = activeCount;
  }

  _deactivate(car) {
    car.active = false;
    this.inst.hide(car.slot);
    car.body.setTranslation({ x: 0, y: -50 - car.slot * 5, z: 0 }, true);
    car.body.setNextKinematicTranslation({ x: 0, y: -50 - car.slot * 5, z: 0 });
  }

  /** Nearest traffic car to a point (for audio). */
  nearestDistance(x, z) {
    let d = Infinity;
    for (const c of this.cars) if (c.active) d = Math.min(d, Math.hypot(c.x - x, c.z - z));
    return d;
  }

  // ---------- Parked cars (static decoration) ----------
  buildParked(spots) {
    const r = new Random(4242);
    const capacity = Math.min(spots.length, 220);
    this.parked = new HybridCarRenderer(this.game.scene, capacity, this.models, { dynamic: false, nearDist: this.nearDist * 0.8, triBudget: 450000, fullDist: 12, maxFull: 2, midDist: 75, farDist: 300 });
    this.parkedCars = [];
    for (let i = 0; i < capacity; i++) {
      const sp = spots[i];
      const shape = this.modelShapes.length ? (r.next() > 0.12 ? r.pick(this.modelShapes) : r.pick(['van', 'taxi'])) : r.pick(['hatchback', 'sedan', 'suv', 'hatchback', 'van', 'sedan', 'sports']);
      const color = r.pick(COLORS);
      this.parked.setStyle(i, shape, color);
      this.parked.setTransform(i, sp.x, sp.z, sp.heading);
      const s = CAR_SHAPES[shape];
      const collider = this.game.physics.addBox(sp.x, (s.clearance + s.bodyH + s.cabH) / 2, sp.z, s.W / 2, (s.clearance + s.bodyH + s.cabH) / 2, s.L / 2, sp.heading);
      this.parkedCars.push({ slot: i, shape, color, x: sp.x, z: sp.z, heading: sp.heading, he: { x: s.W / 2, z: s.L / 2 }, collider, taken: false });
    }
    this.parked.finalizeStatic();
  }

  // ---------- Borrowing cars from the street ----------
  _footprintDist(px, pz, c) {
    const cs = Math.cos(c.heading), sn = Math.sin(c.heading);
    const dx = px - c.x, dz = pz - c.z;
    const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
    return Math.hypot(Math.max(0, Math.abs(lx) - c.he.x), Math.max(0, Math.abs(lz) - c.he.z));
  }

  /** Nearest moving/stopped AI car or parked car the player can get into. */
  nearestBorrowable(px, pz, maxDist = 2.4) {
    let best = null, bd = maxDist;
    for (const c of this.cars) {
      if (!c.active) continue;
      const d = this._footprintDist(px, pz, c);
      if (d < bd) { bd = d; best = { kind: 'traffic', car: c }; }
    }
    for (const c of this.parkedCars || []) {
      if (c.taken || Math.abs(c.x - px) > 8 || Math.abs(c.z - pz) > 8) continue;
      const d = this._footprintDist(px, pz, c);
      if (d < bd) { bd = d; best = { kind: 'parked', car: c }; }
    }
    return best;
  }

  /** Removes the car from the AI/parked set and returns its pose so a drivable vehicle can replace it. */
  take(ref) {
    const c = ref.car;
    const out = { shape: c.shape, color: c.color, x: c.x, z: c.z, heading: c.heading, speed: ref.kind === 'traffic' ? c.speed : 0 };
    // keep the exact same real model (and its colour) when the car becomes drivable
    const pose = (ref.kind === 'traffic' ? this.inst : this.parked)?.pose?.[c.slot];
    if (pose && pose.modelIdx >= 0 && this.models[pose.modelIdx]) { out.model = this.models[pose.modelIdx].src; out.color = pose.color; }
    if (ref.kind === 'traffic') {
      this._deactivate(c);
    } else {
      c.taken = true;
      this.parked.hide(c.slot);
      this.parked.commit(this._parkedFocus.x < 1e8 ? this._parkedFocus : null);
      if (c.collider) this.game.physics.world.removeCollider(c.collider, true);
      c.collider = null;
    }
    return out;
  }

  computeParkingSpots(extra = []) {
    const L = this.layout;
    const r = new Random(5150);
    const spots = [...extra];
    for (const e of L.edges) {
      if (e.highway || e.bridge || e.tunnel) continue;
      if (!['RES', 'APT', 'COM', 'SEA', 'CIVIC', 'PLAZA'].includes(e.district)) continue;
      const A = L.nodes[e.a], B = L.nodes[e.b];
      const fx = Math.sign(B.x - A.x), fz = Math.sign(B.z - A.z);
      const ha = e.axis === 'x' ? A.hx : A.hz, hb = e.axis === 'x' ? B.hx : B.hz;
      const len = e.length - ha - hb;
      const off = e.width / 2 - 1.15;
      for (const side of [1, -1]) {
        for (let s = 14; s < len - 14; s += 6.5) {
          if (!r.chance(0.42)) continue;
          const cx = A.x + fx * (ha + s), cz = A.z + fz * (ha + s);
          const x = cx + (e.axis === 'x' ? 0 : side * off);
          const z = cz + (e.axis === 'x' ? side * off : 0);
          if (z > RIVER.z0 - 3 && z < RIVER.z1 + 3) continue;
          if (L.overWater(x, z, e.axis === 'x' ? Math.PI / 2 : 0, 3)) continue;
          // heading: parked in the direction of traffic on that side
          const lf = side * (e.axis === 'x' ? -fx : fz);
          const heading = e.axis === 'x' ? (lf * this.side > 0 ? Math.PI / 2 : -Math.PI / 2) : (lf * this.side > 0 ? 0 : Math.PI);
          spots.push({ x, z, heading });
        }
      }
    }
    return spots;
  }
}
