import * as THREE from 'three';
import { VEHICLES, CAR_SHAPES } from './VehicleTypes.js';

const SHAPE_TO_TYPE = { hatchback: 'hatchback', sedan: 'sedan', suv: 'suv', sports: 'sports', taxi: 'taxi', van: 'van', bus: 'bus' };
import { fitVehicleModel, rigWheels, findModelMaterials, prepareVehicleAsset } from './VehicleModels.js';
import { VehicleFactory } from './VehicleFactory.js';
import { Vehicle } from './Vehicle.js';
import { CarController } from './CarController.js';
import { MotorcycleController } from './MotorcycleController.js';
import { BicycleController } from './BicycleController.js';

/** Spawning, garage, bike-share and the shared headlight for player-usable vehicles. */
export class VehicleManager {
  constructor(game) {
    this.game = game;
    this.factory = new VehicleFactory(game.assets);
    this.vehicles = [];
    this.owned = new Map(); // type -> vehicle currently in the world
    // One shared spotlight follows whichever vehicle the player drives (keeps light count constant)
    this.headlight = new THREE.SpotLight(0xfff2d6, 0, 70, 0.55, 0.45, 1.2);
    this.headlight.castShadow = false;
    game.scene.add(this.headlight);
    game.scene.add(this.headlight.target);
  }

  controllerFor(kind) {
    if (kind === 'car') return new CarController();
    if (kind === 'motorcycle') return new MotorcycleController();
    return new BicycleController();
  }

  spawn(type, x, z, heading, opts = {}) {
    const spec = VEHICLES[type];
    if (!spec) throw new Error(`Unknown vehicle type ${type}`);
    const parts = this.factory.build(type, spec, opts.color);
    const model = opts.model || this.game.assets.vehicles.get(type);
    if (model && !opts.forceProcedural) {
      // Realistic GLB replaces the procedural body; physics, handling and seat stay the same.
      const length = spec.kind === 'car' ? CAR_SHAPES[spec.shape].L : parts.halfExtents.z * 2;
      prepareVehicleAsset(model.gltf.scene);
      const holder = fitVehicleModel(model.gltf.scene, length, { kind: spec.kind, ...model.options });
      parts.body.children.forEach((c) => (c.visible = false));
      for (const w of parts.wheels) w.pivot.visible = false;
      if (parts.front) parts.front.children.forEach((c) => (c.visible = false));
      if (parts.crank) parts.crank.visible = false;
      parts.body.add(holder);
      parts.modelWheels = rigWheels(holder);
      if (!parts.modelWheels.length && !model.options.staticWheels) for (const w of parts.wheels) w.pivot.visible = true; // keep simple wheels
      const mats = findModelMaterials(holder);
      if (mats.paint && opts.color) {
        // per-vehicle paint colour on models with a recognisable body-paint material
        const own = mats.paint.clone();
        own.color.set(opts.color);
        holder.traverse((o) => { if (o.isMesh && o.material === mats.paint) o.material = own; });
      }
      // light-weight stand-in for when this vehicle is parked/left far from the camera
      const lodSrc = model.options.lodGltf;
      if (lodSrc) {
        prepareVehicleAsset(lodSrc.scene, true);
        const lod = fitVehicleModel(lodSrc.scene, length, { kind: spec.kind, ...model.options, rotateY: holder.userData.rotateYDeg });
        lod.visible = false;
        if (opts.color && mats.paint) lod.traverse((o) => {
          if (o.isMesh && /lod_paint/.test(o.material.name)) { o.material = o.material.clone(); o.material.color.set(opts.color); }
        });
        parts.body.add(lod);
        parts.lodHolder = lod;
        parts.fullHolder = holder;
      }
      parts.modelLights = mats;
      for (const m of [...mats.brake, ...mats.head]) if (m.emissive) m.emissive.set(mats.brake.includes(m) ? 0xff2020 : 0xfff4d6);
      parts.hideRider = spec.kind === 'car';
      parts.isModel = true;
    }
    const v = new Vehicle({ type, spec, parts, physics: this.game.physics, controller: this.controllerFor(spec.kind), x, z, heading, rental: !!opts.rental });
    v.static = !!opts.static;
    v.borrowed = !!opts.borrowed;
    v.street = !!opts.street;
    this.game.scene.add(v.mesh);
    this.vehicles.push(v);
    if (!opts.rental && !opts.static && !opts.borrowed && !opts.street) this.owned.set(type, v);
    return v;
  }

  // ---------- Any car or bike in the city can be driven ----------
  /** Take over an AI traffic car or a parked car: it becomes a drivable vehicle and the player gets in. */
  borrow(ref) {
    const g = this.game;
    if (g.player.vehicle) return;
    const c = ref.car;
    if (ref.kind === 'traffic' && Math.abs(c.speed) > 2.5) {
      g.hud.toast('Step in front of the car to make it stop first', 2200);
      return;
    }
    const pose = g.traffic.take(ref);
    const type = SHAPE_TO_TYPE[pose.shape] || 'sedan';
    const v = this.spawn(type, pose.x, pose.z, pose.heading, { borrowed: true, color: pose.color, model: pose.model });
    v.fuel = 40 + Math.random() * 55;
    if (ref.kind === 'traffic') {
      // the driver climbs out on the kerb side and walks off
      const side = g.settings.trafficSide === 'right' ? -1 : 1;
      const lx = Math.cos(pose.heading) * side, lz = -Math.sin(pose.heading) * side;
      g.npcManager.spawnBystander(pose.x + lx * 2.2, pose.z + lz * 2.2, lx, lz);
      g.audio.horn(pose.x, pose.z, 0.6);
    }
    g.playerController.enterVehicle(v);
    g.hud.toast(`${ref.kind === 'traffic' ? 'Borrowed' : 'Got into'} a ${VEHICLES[type].name}`, 2000);
    this._trimBorrowed();
  }

  _trimBorrowed() {
    // keep at most 6 abandoned borrowed vehicles around; drop the farthest ones
    const f = this.game.focus;
    const list = this.vehicles.filter((v) => v.borrowed && !v.driven).sort((a, b) => Math.hypot(b.x - f.x, b.z - f.z) - Math.hypot(a.x - f.x, a.z - f.z));
    while (list.length > 6) this.despawn(list.shift());
  }

  /** Candidate kerb-side spots (on the pavement next to the road) for parked two-wheelers. */
  _kerbSpots() {
    if (this._kerb) return this._kerb;
    const L = this.game.layout;
    const out = [];
    for (const e of L.edges) {
      if (e.highway || e.bridge || e.tunnel) continue;
      const A = L.nodes[e.a], B = L.nodes[e.b];
      const ha = e.axis === 'x' ? A.hx : A.hz, hb = e.axis === 'x' ? B.hx : B.hz;
      const len = e.length - ha - hb;
      for (const side of [1, -1]) {
        for (let t = 9; t < len - 9; t += 11) {
          const off = (e.width / 2 + 1.1) * side;
          const x = e.axis === 'x' ? A.x + ha + t : A.x + off;
          const z = e.axis === 'x' ? A.z + off : A.z + ha + t;
          const heading = (e.axis === 'x' ? Math.PI / 2 : 0) + (Math.random() < 0.5 ? Math.PI : 0);
          if (L.overWater(x, z, heading, 1.3) || L.isWater(x, z + 1) || L.isWater(x, z - 1)) continue; // the river-side "sidewalk" is water
          out.push({ x, z, heading });
        }
      }
    }
    this._kerb = out;
    return out;
  }

  /** Keeps a handful of motorbikes, scooters and bicycles parked along the streets near the player. */
  maintainStreetBikes(dt) {
    this._streetTimer = (this._streetTimer || 0) - dt;
    if (this._streetTimer > 0) return;
    this._streetTimer = 1.5;
    const g = this.game;
    if (g.player.interior) return;
    const f = g.focus;
    // recycle far-away street bikes and abandoned borrowed cars
    for (const v of [...this.vehicles]) {
      if ((v.street || v.borrowed) && !v.driven && Math.hypot(v.x - f.x, v.z - f.z) > 260) this.despawn(v);
    }
    const target = 12;
    const near = this.vehicles.filter((v) => v.street && Math.hypot(v.x - f.x, v.z - f.z) < 200).length;
    if (near >= target) return;
    const spots = this._kerbSpots();
    const types = ['motorcycle', 'scooter', 'scooter', 'bicycle', 'sportbike', 'roadbike', 'motorcycle', 'bicycle'];
    const colors = ['#e74c3c', '#2c3e50', '#16a085', '#f39c12', '#8e44ad', '#ecf0f1', '#2980b9', '#27ae60', '#c0392b'];
    for (let tries = 0; tries < 25; tries++) {
      const sp = spots[Math.floor(Math.random() * spots.length)];
      const d = Math.hypot(sp.x - f.x, sp.z - f.z);
      if (d < 25 || d > 150) continue;
      if (this.vehicles.some((v) => Math.hypot(v.x - sp.x, v.z - sp.z) < 6)) continue;
      if (g.physics.boxBlocked(sp.x, 0.7, sp.z, 0.45, 0.55, 1.15, sp.heading)) continue;
      const type = types[Math.floor(Math.random() * types.length)];
      this.spawn(type, sp.x, sp.z, sp.heading, { street: true, color: colors[Math.floor(Math.random() * colors.length)] });
      return;
    }
  }

  despawn(v) {
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
    if (this.owned.get(v.type) === v) this.owned.delete(v.type);
    v.dispose(this.game.scene);
  }

  /** Bring an owned vehicle to the player (garage / vehicle selection). */
  deliver(type) {
    const p = this.game.player;
    if (p.vehicle) { this.game.hud.toast('Get out of your current vehicle first', 1800); return null; }
    if (p.interior) { this.game.hud.toast('Go outside to call a vehicle', 1800); return null; }
    const spot = this.findSpawnSpot(p.pos.x, p.pos.z, VEHICLES[type]);
    if (!spot) { this.game.hud.toast('No space nearby — move to a road', 1800); return null; }
    let v = this.owned.get(type);
    if (v && v.driven) return v;
    if (v) v.teleport(spot.x, spot.z, spot.heading);
    else v = this.spawn(type, spot.x, spot.z, spot.heading);
    this.game.hud.toast(`${VEHICLES[type].name} is waiting for you nearby`, 2200);
    this.game.events.emit('vehicleDelivered', v);
    return v;
  }

  findSpawnSpot(x, z, spec) {
    const L = this.game.layout;
    const road = L.nearestRoadPoint(x, z);
    const tries = [];
    if (road && Math.hypot(road.x - x, road.z - z) < 60) {
      // kerb-side, on the correct side of the road, a few metres along
      const e = road.edge;
      const fx = Math.sin(road.heading), fz = Math.cos(road.heading);
      const side = this.game.settings.trafficSide === 'right' ? -1 : 1;
      const lx = fz * side, lz = -fx * side;
      const off = e.highway ? 3.3 : 2.4; // centre of the driving lane (kerb lane holds parked cars)
      for (const along of [0, 6, -6, 12, -12, 18]) {
        tries.push({ x: road.x + fx * along + lx * off, z: road.z + fz * along + lz * off, heading: road.heading });
        tries.push({ x: road.x + fx * along - lx * off, z: road.z + fz * along - lz * off, heading: road.heading + Math.PI });
      }
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      tries.push({ x: x + Math.sin(a) * 4, z: z + Math.cos(a) * 4, heading: a });
    }
    const half = spec.kind === 'car' ? [1.1, 0.8, 2.6] : [0.5, 0.6, 1.2];
    for (const t of tries) {
      if (L.overWater(t.x, t.z, t.heading, half[2] + 0.5)) continue;
      if (!this.game.physics.boxBlocked(t.x, half[1] + 0.1, t.z, half[0], half[1], half[2], t.heading)) return t;
    }
    return null;
  }

  spawnBikeShare() {
    const s = this.game.ctx;
    // bike-share docks at the park entrances, scooters on the promenade
    const place = (type, x, z, heading, color) => {
      for (const dz of [0, 1.5, -1.5, 3, -3, 4.5, -4.5, 6]) {
        if (!this.game.layout.overWater(x, z + dz, heading, 1.2) && !this.game.physics.boxBlocked(x, 0.7, z + dz, 0.45, 0.55, 1.1, heading)) return this.spawn(type, x, z + dz, heading, { rental: true, color });
      }
      return null;
    };
    for (const ring of s.parkRings.slice(0, 2)) {
      const b = ring.block;
      for (let k = 0; k < 3; k++) place('bicycle', b.x0 + 2.4, b.cz + 6 + k * 1.6, Math.PI / 2, '#1abc9c');
    }
    for (let k = 0; k < 3; k++) place('scooter', 299.5, -26 - k * 2.4, Math.PI / 2, '#e67e22');
    for (let k = 0; k < 2; k++) place('bicycle', 299.5, 26 + k * 1.6, Math.PI / 2, '#1abc9c');
  }

  nearestEnterable(x, z, maxDist = 3.4) {
    let best = null, bd = maxDist;
    for (const v of this.vehicles) {
      if (v.static || v.driven) continue;
      const he = v.halfExtents;
      // distance to the vehicle's footprint, not its centre
      const cs = Math.cos(v.heading), sn = Math.sin(v.heading);
      const dx = x - v.x, dz = z - v.z;
      const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
      const ox = Math.max(0, Math.abs(lx) - he.x), oz = Math.max(0, Math.abs(lz) - he.z);
      const d = Math.hypot(ox, oz);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  update(dt) {
    const active = this.game.player.vehicle;
    // detailed model only near the camera; the baked LOD (a few draw calls) further away
    this._lodTick = ((this._lodTick || 0) + 1) % 8;
    if (this._lodTick === 0) {
      const cam = this.game.sceneManager.camera.position;
      for (const v of this.vehicles) {
        const P = v.parts;
        if (!P.lodHolder) continue;
        const far = v !== active && Math.hypot(v.x - cam.x, v.z - cam.z) > 26;
        if (P.lodHolder.visible !== far) {
          P.lodHolder.visible = far;
          P.fullHolder.visible = !far;
          for (const w of P.modelWheels || []) w.pivot.visible = !far;
        }
      }
    }
    for (const v of this.vehicles) {
      if (v.static) continue;
      if (v === active) v.update(dt, this.game.uiBlocking ? null : this.game.input);
      else if (Math.abs(v.speed) > 0.05 || Math.abs(v.vx) + Math.abs(v.vz) > 0.05) v.update(dt, null);
      if (v === active) v.updateRpm(dt);
    }
    const hl = this.headlight;
    if (active && active.lightsOn) {
      const fx = Math.sin(active.heading), fz = Math.cos(active.heading);
      const hp = active.parts.headlightPos;
      hl.position.set(active.x + fx * hp.z, hp.y + 0.2, active.z + fz * hp.z);
      hl.target.position.set(active.x + fx * (hp.z + 20), 0, active.z + fz * (hp.z + 20));
      hl.intensity = active.kind === 'bicycle' ? 25 : 90;
    } else hl.intensity = 0;
  }
}
