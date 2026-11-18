import * as THREE from 'three';
import { SIDEWALK } from '../config.js';
import { Materials } from './Materials.js';
import { GeoBuilder } from '../utils/GeoBuilder.js';
import { InstanceBatch } from '../utils/InstanceBatch.js';
import { makeLabelTexture } from '../utils/Textures.js';
import { createHumanoid, poseFor, applyPose } from './Humanoid.js';
import { VEHICLES, CAR_SHAPES } from '../vehicles/VehicleTypes.js';
import { fitVehicleModel, prepareVehicleAsset } from '../vehicles/VehicleModels.js';
import { Random } from '../utils/Random.js';
import { flattenStatic } from '../utils/MergeUtils.js';

export const MENUS = {
  restaurant: [
    { id: 'dosa', name: 'Masala Dosa', price: 6, desc: 'Crispy, golden, with chutney. Restores stamina.', energy: 100, boost: 45 },
    { id: 'biryani', name: 'Chicken Biryani', price: 9, desc: 'Fragrant and filling — unlimited sprint for 2 minutes.', energy: 100, boost: 120 },
    { id: 'meals', name: 'Veg Meals Thali', price: 8, desc: 'Rice, sambar, rasam, poriyal, curd. Sprint boost 90s.', energy: 100, boost: 90 },
    { id: 'coffee', name: 'Filter Coffee', price: 3, desc: 'Strong South Indian coffee. Quick boost.', energy: 60, boost: 30 },
    { id: 'lassi', name: 'Sweet Lassi', price: 4, desc: 'Cool and refreshing.', energy: 70, boost: 20 },
  ],
  cafe: [
    { id: 'coffee', name: 'Cold Coffee', price: 4, desc: 'Iced and sweet. Sprint boost 40s.', energy: 70, boost: 40 },
    { id: 'sandwich', name: 'Grilled Sandwich', price: 5, desc: 'Cheese and veggies.', energy: 90, boost: 50 },
    { id: 'icecream', name: 'Ice Cream Sundae', price: 4, desc: 'Three scoops by the sea.', energy: 60, boost: 25 },
    { id: 'juice', name: 'Tender Coconut', price: 3, desc: 'Fresh from the beach stall.', energy: 60, boost: 20 },
  ],
  supermarket: [
    { id: 'water', name: 'Water Bottle', price: 1, desc: 'Stay hydrated. Restores some stamina.', energy: 40, boost: 0 },
    { id: 'chips', name: 'Banana Chips', price: 2, desc: 'Crunchy Kerala-style snack.', energy: 50, boost: 10 },
    { id: 'energy', name: 'Energy Drink', price: 5, desc: 'Unlimited sprint for 3 minutes.', energy: 100, boost: 180 },
    { id: 'map', name: 'City Explorer Map', price: 25, desc: 'Marks every hidden token and landmark on your map.', special: 'map' },
    { id: 'fuelcan', name: 'Fuel Can', price: 15, desc: 'Fills your current motor vehicle to 100% when used (press F).', special: 'fuelcan' },
  ],
  stall: [
    { id: 'chai', name: 'Masala Chai', price: 2, desc: 'Hot and spicy.', energy: 60, boost: 15 },
    { id: 'samosa', name: 'Samosa', price: 2, desc: 'Crispy potato samosa.', energy: 60, boost: 15 },
    { id: 'juice', name: 'Fresh Lime Soda', price: 2, desc: 'Sweet or salted.', energy: 50, boost: 10 },
  ],
};

/** Petrol station, dealership, parking lot and the enterable interiors. */
export class ShopSystem {
  constructor(game) {
    this.game = game;
    this.ctx = game.ctx;
    this.group = new THREE.Group();
    this.group.name = 'shops';
    this.ctx.root.add(this.group);
    this.interiorGroup = new THREE.Group();
    this.interiorGroup.name = 'interiors';
    game.scene.add(this.interiorGroup);
    this.interiors = {};
    this.batches = [];
    this.pumps = [];
    this.rng = new Random(55);
    this.interiorLight = new THREE.PointLight(0xffe8c4, 0, 30, 1.4);
    game.scene.add(this.interiorLight);
  }

  build() {
    const L = this.ctx.layout;
    const fuel = L.blocksOfType('FUEL')[0];
    const dealer = L.blocksOfType('DEALER')[0];
    const parking = L.blocksOfType('PARKING')[0];
    if (fuel) this._petrolStation(fuel);
    if (dealer) this._dealership(dealer);
    if (parking) this._parkingLot(parking);
    const s = this.ctx.sites;
    if (s.restaurant) this._restaurant(s.restaurant);
    if (s.supermarket) this._supermarket(s.supermarket);
    if (s.cafe) this._cafe(s.cafe);
    for (const st of this.ctx.stalls) {
      this.game.interactions.register({ id: `stall-${st.name}`, x: st.x, z: st.z, radius: 2.2, label: `Buy from ${st.name}`, action: () => this.openMenu(st.name, MENUS.stall) });
    }
    for (const b of this.batches) b.build(this.group);
  }

  _paved(b, mat = Materials.asphalt) {
    const gb = new GeoBuilder(0.125);
    gb.rect(b.x0 + SIDEWALK, b.z0 + SIDEWALK, b.x1 - SIDEWALK, b.z1 - SIDEWALK, 0.035);
    const m = new THREE.Mesh(gb.build(), mat);
    m.receiveShadow = true;
    this.group.add(m);
  }

  _sign(text, x, y, z, rotY, w = 8, bg = '#1d4ed8') {
    const tex = makeLabelTexture(text, { bg, fg: '#ffffff', font: 'bold 70px "Trebuchet MS", sans-serif', border: 'rgba(255,255,255,0.8)' });
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.15, side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), mat);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    this.group.add(m);
    return m;
  }

  // ---------- Petrol station ----------
  _petrolStation(b) {
    this._paved(b);
    const cx = b.cx, cz = b.cz - 3;
    const red = new THREE.MeshStandardMaterial({ color: 0xd62828, roughness: 0.5 });
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(26, 1.1, 14), red);
    canopy.position.set(cx, 5.6, cz);
    canopy.castShadow = true;
    this.group.add(canopy);
    const under = new THREE.Mesh(new THREE.PlaneGeometry(25, 13), Materials.lampGlow);
    under.rotation.x = Math.PI / 2;
    under.position.set(cx, 5.04, cz);
    this.group.add(under);
    for (const sx of [-10, 10]) for (const sz of [-4.5, 4.5]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5.2, 0.5), Materials.white);
      col.position.set(cx + sx, 2.6, cz + sz);
      this.group.add(col);
      this.game.physics.addBox(cx + sx, 2.6, cz + sz, 0.25, 2.6, 0.25);
    }
    const pumpGeo = new GeoBuilder(1);
    pumpGeo.box(0, 0.15, 0, 1.4, 0.3, 2.4);
    pumpGeo.box(0, 1.1, 0, 0.7, 1.6, 0.9);
    const pumpMesh = pumpGeo.build();
    const pumpMat = new THREE.MeshStandardMaterial({ color: 0xf1f1f1, roughness: 0.5 });
    let k = 0;
    for (const sx of [-5, 5]) {
      const p = new THREE.Mesh(pumpMesh, pumpMat);
      p.position.set(cx + sx, 0, cz);
      p.castShadow = true;
      this.group.add(p);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.35), new THREE.MeshBasicMaterial({ color: 0x22d3ee }));
      screen.position.set(cx + sx + 0.36, 1.5, cz);
      screen.rotation.y = Math.PI / 2;
      this.group.add(screen);
      this.game.physics.addBox(cx + sx, 0.9, cz, 0.6, 0.9, 1.15);
      for (const side of [-1, 1]) {
        const pump = { x: cx + sx + side * 2.6, z: cz, id: k++ };
        this.pumps.push(pump);
        this.game.interactions.register({
          id: `pump-${pump.id}`, x: pump.x, z: pump.z, radius: 3.6, when: 'vehicle', priority: 5,
          enabled: () => { const v = this.game.player.vehicle; return v && v.kind !== 'bicycle'; },
          label: () => {
            const v = this.game.player.vehicle;
            const litres = Math.ceil((100 - v.fuel) * 0.45);
            return v.fuel > 99 ? 'Tank is full' : `Refuel ${litres} L for $${Math.max(1, Math.ceil(litres * 0.4))}`;
          },
          action: () => this.refuel(),
        });
      }
    }
    // mini-mart
    const mart = new THREE.Mesh(new THREE.BoxGeometry(14, 4.2, 8), new THREE.MeshStandardMaterial({ color: 0xf5f5f4, roughness: 0.8 }));
    mart.position.set(cx, 2.1, b.z1 - SIDEWALK - 5);
    mart.castShadow = true;
    this.group.add(mart);
    this.game.physics.addBox(cx, 2.1, b.z1 - SIDEWALK - 5, 7, 2.1, 4);
    this.ctx.footprints.push({ x0: cx - 7, z0: b.z1 - SIDEWALK - 9, x1: cx + 7, z1: b.z1 - SIDEWALK - 1, h: 4, color: '#f5f5f4' });
    this._sign('QuickFuel', cx, 6.2, cz - 7.05, Math.PI, 8, '#b91c1c');
    this._sign('QuickFuel Mart', cx, 3.6, b.z1 - SIDEWALK - 9.05, Math.PI, 6, '#b91c1c');
    // price totem
    const totem = new THREE.Mesh(new THREE.BoxGeometry(1.2, 6, 0.4), red);
    totem.position.set(b.x0 + SIDEWALK + 1.5, 3, b.z0 + SIDEWALK + 1.5);
    this.group.add(totem);
    this.ctx.sites.fuel = { x: cx, z: cz };
  }

  refuel() {
    const v = this.game.player.vehicle;
    if (!v || v.kind === 'bicycle') return;
    if (v.fuel > 99) { this.game.hud.toast('Tank is already full', 1500); return; }
    if (Math.abs(v.speed) > 0.5) { this.game.hud.toast('Stop the vehicle to refuel', 1500); return; }
    const litres = Math.ceil((100 - v.fuel) * 0.45);
    const cost = Math.max(1, Math.ceil(litres * 0.4));
    if (!this.game.state.spend(cost)) { this.game.hud.toast(`You need $${cost} to refuel`, 1800); return; }
    v.fuel = 100;
    this.game.audio.cash();
    this.game.hud.toast(`Refuelled ${litres} L for $${cost}`, 2000);
    this.game.events.emit('refuel', v);
  }

  // ---------- Dealership ----------
  _dealership(b) {
    this._paved(b, Materials.concrete);
    const cx = b.cx;
    const z0 = b.z0 + SIDEWALK;
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fc3d9, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35 });
    const frame = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4, metalness: 0.6 });
    const showroomZ = z0 + 9;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(30, 0.2, 16), Materials.tiles);
    floor.position.set(cx, 0.1, showroomZ);
    this.group.add(floor);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(31, 0.6, 17), frame);
    roof.position.set(cx, 6.3, showroomZ);
    roof.castShadow = true;
    this.group.add(roof);
    const front = new THREE.Mesh(new THREE.BoxGeometry(30, 6, 0.1), glass);
    front.position.set(cx, 3.1, showroomZ + 8);
    this.group.add(front);
    const back = new THREE.Mesh(new THREE.BoxGeometry(30, 6, 0.3), frame);
    back.position.set(cx, 3.1, showroomZ - 8);
    this.group.add(back);
    for (const sx of [-15, 15]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.1, 6, 16), glass);
      side.position.set(cx + sx, 3.1, showroomZ);
      this.group.add(side);
    }
    this.game.physics.addBox(cx, 3.1, showroomZ, 15, 3.1, 8);
    this.ctx.footprints.push({ x0: cx - 15, z0: showroomZ - 8, x1: cx + 15, z1: showroomZ + 8, h: 6.5, color: '#94a3b8' });
    this._sign('Motor Row Dealership', cx, 7.6, showroomZ + 8.6, 0, 14, '#0f172a');
    // display vehicles inside and on the forecourt
    const factory = this.game.vehicles.factory;
    const show = ['sports', 'suv', 'sportbike', 'roadbike', 'sedan', 'taxi'];
    show.forEach((type, k) => {
      const spec = VEHICLES[type];
      const parts = factory.build(type, spec);
      let m = parts.root;
      let lodM = null;
      const model = this.game.assets.vehicles.get(type);
      if (model) prepareVehicleAsset(model.gltf.scene);
      if (model) {
        // showroom shows the realistic model when one is provided
        const len = spec.kind === 'car' ? CAR_SHAPES[spec.shape].L : parts.halfExtents.z * 2;
        m = new THREE.Group();
        const full = fitVehicleModel(model.gltf.scene, len, { kind: spec.kind, ...model.options });
        m.add(full);
        if (model.options.lodGltf) {
          prepareVehicleAsset(model.options.lodGltf.scene, true);
          lodM = new THREE.Group();
          lodM.add(fitVehicleModel(model.options.lodGltf.scene, len, { kind: spec.kind, ...model.options, rotateY: full.userData.rotateYDeg }));
        }
      }
      const place = (o) => {
        if (k < 4) o.position.set(cx - 10.5 + k * 7, 0.2, showroomZ - 1);
        else o.position.set(cx - 6 + (k - 4) * 12, 0.03, showroomZ + 16);
        o.rotation.y = 0.5 + k * 0.4;
      };
      place(m);
      const fullFlat = flattenStatic(m);
      this.group.add(fullFlat);
      if (lodM) {
        place(lodM);
        const lodFlat = flattenStatic(lodM);
        this.group.add(lodFlat);
        // detailed display cars only when you're at the dealership
        this.game.distanceLods.push({ x: m.position.x, z: m.position.z, near: fullFlat, far: lodFlat, dist: 40, max: 260 });
      }
      if (k >= 4) this.game.physics.addBox(m.position.x, 0.8, m.position.z, parts.halfExtents.z, 0.8, parts.halfExtents.z, 0);
    });
    const door = { x: cx, z: showroomZ + 9.4 };
    this.game.interactions.register({ id: 'dealer', x: door.x, z: door.z, radius: 3, priority: 4, label: 'Browse Motor Row Dealership', action: () => this.game.ui.dealership() });
    this.ctx.sites.dealer = { x: door.x, z: door.z, deliverX: cx, deliverZ: b.z1 + 1 };
    this.doorMarker(door.x, door.z, 0x38bdf8);
  }

  // ---------- Parking lot ----------
  _parkingLot(b) {
    this._paved(b);
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    const lines = new InstanceBatch(plane, Materials.marking, { castShadow: false });
    this.ctx.parkingBays = [];
    const extraParked = [];
    const x0 = b.x0 + SIDEWALK + 4, x1 = b.x1 - SIDEWALK - 4;
    const rows = [b.z0 + SIDEWALK + 6, b.cz - 3, b.cz + 3, b.z1 - SIDEWALK - 6];
    const bayW = 3.2;
    rows.forEach((rz, ri) => {
      const facing = ri % 2 === 0 ? 0 : Math.PI;
      for (let x = x0; x + bayW <= x1; x += bayW) {
        lines.add(x, 0.045, rz, 0, 0.12, 1, 5.5);
        const bay = { x: x + bayW / 2, z: rz, heading: facing };
        if ((this.rng.next() < 0.55)) extraParked.push(bay); else this.ctx.parkingBays.push(bay);
      }
      lines.add(x1, 0.045, rz, 0, 0.12, 1, 5.5);
    });
    this.batches.push(lines);
    this.ctx.extraParked = extraParked;
    // booth
    const booth = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.6, 2.5), new THREE.MeshStandardMaterial({ color: 0xfacc15 }));
    booth.position.set(b.x0 + SIDEWALK + 2, 1.3, b.cz);
    this.group.add(booth);
    this.game.physics.addBox(b.x0 + SIDEWALK + 2, 1.3, b.cz, 1.25, 1.3, 1.25);
    this._sign('P  Park & Ride', b.x0 + SIDEWALK + 2, 4, b.cz, -Math.PI / 2, 6, '#1d4ed8');
    this.ctx.sites.parking = { x: b.cx, z: b.cz };
  }

  doorMarker(x, z, color = 0xfacc15) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.95, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.12, z);
    this.group.add(ring);
    return ring;
  }

  // ---------- Interiors ----------
  _room(id, name, ox, oz, w, d, floorMat, wallColor) {
    const g = new THREE.Group();
    g.name = `interior-${id}`;
    this.interiorGroup.add(g);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(ox, 0.01, oz);
    floor.receiveShadow = true;
    g.add(floor);
    const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.9, side: THREE.DoubleSide, emissive: wallColor, emissiveIntensity: 0.08 });
    const H = 4.2;
    const walls = [
      [ox, oz - d / 2, w, 0], [ox, oz + d / 2, w, 0], [ox - w / 2, oz, d, Math.PI / 2], [ox + w / 2, oz, d, Math.PI / 2],
    ];
    for (const [x, z, len, rot] of walls) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, H), wallMat);
      m.position.set(x, H / 2, z);
      m.rotation.y = rot;
      g.add(m);
    }
    this.game.physics.addWall(ox - w / 2, oz - d / 2, ox + w / 2, oz - d / 2, H, 0.4);
    this.game.physics.addWall(ox - w / 2, oz + d / 2, ox + w / 2, oz + d / 2, H, 0.4);
    this.game.physics.addWall(ox - w / 2, oz - d / 2, ox - w / 2, oz + d / 2, H, 0.4);
    this.game.physics.addWall(ox + w / 2, oz - d / 2, ox + w / 2, oz + d / 2, H, 0.4);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: 0xf8f8f8, emissive: 0xfff6e0, emissiveIntensity: 0.35 }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(ox, H, oz);
    g.add(ceil);
    // light panels
    for (let x = -w / 2 + 3; x < w / 2 - 1; x += 5) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.6), new THREE.MeshBasicMaterial({ color: 0xfffbeb }));
      p.rotation.x = Math.PI / 2;
      p.position.set(ox + x, H - 0.02, oz);
      g.add(p);
    }
    // exit door on the +z wall
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2.6), new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 0.7 }));
    door.position.set(ox, 1.3, oz + d / 2 - 0.05);
    door.rotation.y = Math.PI;
    g.add(door);
    const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.35), new THREE.MeshBasicMaterial({ map: makeLabelTexture('EXIT', { bg: '#15803d', fg: '#fff', w: 256, h: 74, font: 'bold 52px sans-serif' }) }));
    exitSign.position.set(ox, 2.95, oz + d / 2 - 0.06);
    exitSign.rotation.y = Math.PI;
    g.add(exitSign);
    const room = { id, name, ox, oz, w, d, group: g, spawn: { x: ox, z: oz + d / 2 - 1.6, yaw: Math.PI } };
    this.interiors[id] = room;
    this.game.interactions.register({ id: `${id}-exit`, x: ox, z: oz + d / 2 - 0.8, radius: 1.8, priority: 5, label: `Leave ${name}`, action: () => this.game.exitInterior() });
    return room;
  }

  _keeper(x, z, yaw, colors) {
    const h = createHumanoid(colors);
    h.root.position.set(x, 0, z);
    h.root.rotation.y = yaw;
    applyPose(h, poseFor('idle', 0, {}));
    this.interiorGroup.add(h.root);
    return h;
  }

  _entrance(site, room, verb = 'Enter') {
    this.game.interactions.register({
      id: `${room.id}-enter`, x: site.x, z: site.z, radius: 2.4, priority: 4, label: `${verb} ${room.name}`,
      action: () => this.game.enterInterior(room, site),
    });
    this.doorMarker(site.x, site.z);
  }

  _tables(room, positions, chairMat) {
    const top = new THREE.CylinderGeometry(0.6, 0.6, 0.06, 16);
    const leg = new THREE.CylinderGeometry(0.06, 0.08, 0.75, 6);
    const seat = new GeoBuilder(1);
    seat.box(0, 0.45, 0, 0.45, 0.06, 0.45);
    seat.box(0, 0.7, -0.2, 0.45, 0.5, 0.05);
    for (const sx of [-0.18, 0.18]) for (const sz of [-0.18, 0.18]) seat.box(sx, 0.22, sz, 0.04, 0.45, 0.04);
    const chairGeo = seat.build();
    for (const [x, z] of positions) {
      const t = new THREE.Mesh(top, Materials.wood);
      t.position.set(x, 0.78, z);
      room.group.add(t);
      const l = new THREE.Mesh(leg, Materials.darkMetal);
      l.position.set(x, 0.38, z);
      room.group.add(l);
      this.game.physics.addCylinder(x, 0.4, z, 0.4, 0.6);
      for (const [dx, dz, rot] of [[0, -1, 0], [0, 1, Math.PI]]) {
        const c = new THREE.Mesh(chairGeo, chairMat);
        c.position.set(x + dx, 0, z + dz);
        c.rotation.y = rot;
        room.group.add(c);
        const seatSpot = { x: x + dx * 0.95, z: z + dz * 0.95, rot, occupied: false, y: 0 };
        this.game.interactions.register({ id: `${room.id}-chair-${x}-${z}-${dz}`, x: seatSpot.x, z: seatSpot.z, radius: 1.1, priority: 2, label: 'Sit down', action: () => this.game.playerController.sit(seatSpot) });
      }
    }
  }

  _restaurant(site) {
    const room = this._room('restaurant', 'Spice Garden', 1000, 1000, 20, 16, Materials.wood, 0xe9c79a);
    const { ox, oz } = room;
    this._tables(room, [[ox - 5, oz - 2], [ox, oz - 2], [ox + 5, oz - 2], [ox - 5, oz + 3], [ox + 5, oz + 3]], new THREE.MeshStandardMaterial({ color: 0x8b2e16 }));
    const counter = new THREE.Mesh(new THREE.BoxGeometry(8, 1.1, 1), new THREE.MeshStandardMaterial({ color: 0x6b3b1f }));
    counter.position.set(ox, 0.55, oz - 6.2);
    room.group.add(counter);
    this.game.physics.addBox(ox, 0.55, oz - 6.2, 4, 0.55, 0.5);
    this._keeper(ox, oz - 7, 0, { skin: '#8d5524', shirt: '#ffffff', pants: '#1f2937', hair: '#111' });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.2), new THREE.MeshBasicMaterial({ map: this._menuBoard('Spice Garden', MENUS.restaurant) }));
    board.position.set(ox, 2.7, oz - 7.95);
    room.group.add(board);
    this.game.interactions.register({ id: 'restaurant-counter', x: ox, z: oz - 5.2, radius: 2.2, priority: 4, label: 'Order food', action: () => this.openMenu('Spice Garden', MENUS.restaurant) });
    this._entrance(site, room);
    // outdoor terrace tables
    if (site.terrace) {
      for (let k = 0; k < 3; k++) {
        const tx = site.terrace.x - 4 + k * 4, tz = site.terrace.z;
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.06, 14), Materials.white);
        t.position.set(tx, 0.78, tz);
        this.group.add(t);
        const u = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.6, 8, 1, true), new THREE.MeshStandardMaterial({ color: k % 2 ? 0x15803d : 0xb91c1c, side: THREE.DoubleSide }));
        u.position.set(tx, 2.6, tz);
        this.group.add(u);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 5), Materials.white);
        pole.position.set(tx, 1.3, tz);
        this.group.add(pole);
        this.game.physics.addCylinder(tx, 0.4, tz, 0.4, 0.6);
        this.ctx.benches.push({ x: tx, z: tz + 0.95, rot: Math.PI, occupied: false });
      }
    }
  }

  _supermarket(site) {
    const room = this._room('supermarket', 'FreshMart', 1100, 1000, 28, 22, Materials.tiles, 0xf3f4f6);
    const { ox, oz } = room;
    const shelfGeo = new GeoBuilder(1);
    shelfGeo.box(0, 1, 0, 9, 2, 1.1);
    const shelf = shelfGeo.build();
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0xe5e7eb });
    const box = new THREE.BoxGeometry(0.32, 0.38, 0.28);
    const products = new InstanceBatch(box, Materials.instColor, { colors: true, castShadow: false });
    const colors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#84cc16', '#06b6d4', '#facc15'];
    for (let r = 0; r < 4; r++) {
      const sz = oz - 7 + r * 4;
      for (const sx of [-6.5, 6.5]) {
        const m = new THREE.Mesh(shelf, shelfMat);
        m.position.set(ox + sx, 0, sz);
        room.group.add(m);
        this.game.physics.addBox(ox + sx, 1, sz, 4.5, 1, 0.55);
        for (let lvl = 0; lvl < 3; lvl++) for (let k = 0; k < 24; k++) {
          for (const face of [-1, 1]) products.add(ox + sx - 4.2 + k * 0.36, 0.25 + lvl * 0.62 + 0.19 + 0.0, sz + face * 0.62, 0, 1, 1, 1, new THREE.Color(colors[(k + lvl * 3 + r) % colors.length]));
        }
        this.game.interactions.register({ id: `shelf-${r}-${sx}`, x: ox + sx, z: sz + 1.2, radius: 2.2, priority: 2, label: 'Browse shelves', action: () => this.openMenu('FreshMart', MENUS.supermarket) });
      }
    }
    const pb = products.build(room.group);
    void pb;
    // fridges along the back wall
    const fridge = new THREE.Mesh(new THREE.BoxGeometry(24, 2.4, 1), new THREE.MeshStandardMaterial({ color: 0xdbeafe, emissive: 0xbfdbfe, emissiveIntensity: 0.4 }));
    fridge.position.set(ox, 1.2, oz - 10.4);
    room.group.add(fridge);
    this.game.physics.addBox(ox, 1.2, oz - 10.4, 12, 1.2, 0.5);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 1.4), new THREE.MeshStandardMaterial({ color: 0x15803d }));
    counter.position.set(ox + 9, 0.5, oz + 7);
    room.group.add(counter);
    this.game.physics.addBox(ox + 9, 0.5, oz + 7, 2, 0.5, 0.7);
    this._keeper(ox + 9, oz + 8.2, Math.PI, { skin: '#c68642', shirt: '#16a34a', pants: '#1f2937', hair: '#2b1b10' });
    this.game.interactions.register({ id: 'super-counter', x: ox + 9, z: oz + 5.8, radius: 2.2, priority: 4, label: 'Checkout counter', action: () => this.openMenu('FreshMart', MENUS.supermarket) });
    this._entrance(site, room);
  }

  _cafe(site) {
    const room = this._room('cafe', 'Sea Breeze Café', 1200, 1000, 16, 12, Materials.wood, 0xd6f0f5);
    const { ox, oz } = room;
    this._tables(room, [[ox - 4, oz], [ox + 4, oz], [ox, oz + 2.5]], new THREE.MeshStandardMaterial({ color: 0x0e7490 }));
    const counter = new THREE.Mesh(new THREE.BoxGeometry(6, 1.1, 1), new THREE.MeshStandardMaterial({ color: 0x155e75 }));
    counter.position.set(ox, 0.55, oz - 4.4);
    room.group.add(counter);
    this.game.physics.addBox(ox, 0.55, oz - 4.4, 3, 0.55, 0.5);
    this._keeper(ox, oz - 5.3, 0, { skin: '#e0ac69', shirt: '#0891b2', pants: '#334155', hair: '#5a3825' });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 1.8), new THREE.MeshBasicMaterial({ map: this._menuBoard('Sea Breeze Café', MENUS.cafe) }));
    board.position.set(ox, 2.7, oz - 5.95);
    room.group.add(board);
    // "window" painting of the sea
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(6, 2), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
    sea.position.set(ox - 7.95, 2.2, oz);
    sea.rotation.y = Math.PI / 2;
    room.group.add(sea);
    this.game.interactions.register({ id: 'cafe-counter', x: ox, z: oz - 3.4, radius: 2.2, priority: 4, label: 'Order at the counter', action: () => this.openMenu('Sea Breeze Café', MENUS.cafe) });
    this._entrance(site, room);
  }

  _menuBoard(title, items) {
    const c = document.createElement('canvas');
    c.width = 768; c.height = 288;
    const g = c.getContext('2d');
    g.fillStyle = '#1f2a1f'; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#8b6b3e'; g.lineWidth = 12; g.strokeRect(6, 6, c.width - 12, c.height - 12);
    g.fillStyle = '#fde68a'; g.font = 'bold 40px "Trebuchet MS", sans-serif'; g.textAlign = 'center';
    g.fillText(title, c.width / 2, 52);
    g.font = '26px "Trebuchet MS", sans-serif'; g.textAlign = 'left';
    items.forEach((it, k) => {
      const col = k % 2, row = Math.floor(k / 2);
      g.fillStyle = '#f8fafc';
      g.fillText(it.name, 40 + col * 370, 104 + row * 52);
      g.fillStyle = '#86efac';
      g.fillText(`$${it.price}`, 300 + col * 370, 104 + row * 52);
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  openMenu(title, items) {
    this.game.ui.shop(title, items, (item) => this.buy(item));
  }

  buy(item) {
    const g = this.game;
    if (!g.state.spend(item.price)) { g.hud.toast(`Not enough money for ${item.name}`, 1800); g.audio.error(); return false; }
    g.audio.cash();
    const p = g.player;
    if (item.energy) p.stamina = Math.min(100, p.stamina + item.energy);
    if (item.boost) p.boostTime = Math.max(p.boostTime, 0) + item.boost;
    if (item.special === 'map') { g.state.flags.mapRevealed = true; g.hud.toast('Tokens and landmarks are now marked on your map (M)', 3000); }
    else if (item.special === 'fuelcan') { g.state.inventory.fuelcan = (g.state.inventory.fuelcan || 0) + 1; g.hud.toast('Fuel can added — press F while driving to use it', 3000); }
    else g.hud.toast(`${item.name} — ${item.boost ? `sprint boost ${item.boost}s` : 'stamina restored'}`, 2200);
    g.events.emit('purchase', item);
    g.save();
    return true;
  }

  setInteriorLight(room) {
    if (!room) { this.interiorLight.intensity = 0; return; }
    this.interiorLight.position.set(room.ox, 3.5, room.oz);
    this.interiorLight.intensity = 40;
  }
}
