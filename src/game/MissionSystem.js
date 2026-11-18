import * as THREE from 'three';
import { Random } from '../utils/Random.js';

const KIND_NAMES = { car: 'a car', motorcycle: 'a motorcycle', bicycle: 'a bicycle', any: 'any vehicle' };

/**
 * Optional missions (races, time trials, parking, deliveries, meet-the-locals),
 * collectible tokens and landmark discovery. The player can ignore all of it.
 */
export class MissionSystem {
  constructor(game) {
    this.game = game;
    this.defs = [];
    this.active = null;
    this.markers = [];
    this.group = new THREE.Group();
    this.group.name = 'missions';
    game.scene.add(this.group);
    this.cpMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false });
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    this.cpRing = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.35, 8, 40), this.cpMat);
    this.cpBeam = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 60, 32, 1, true), this.beamMat);
    this.cpNext = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.2, 6, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, side: THREE.DoubleSide }));
    this.cpRing.visible = this.cpBeam.visible = this.cpNext.visible = false;
    this.group.add(this.cpRing, this.cpBeam, this.cpNext);
    this.bay = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 5.2), new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.45, depthWrite: false }));
    this.bay.rotation.x = -Math.PI / 2;
    this.bay.visible = false;
    this.group.add(this.bay);
    this.vehicleGrace = 0;
    this.talked = new Set();
    this.time = 0;
  }

  build() {
    const g = this.game;
    const L = g.layout;
    const node = (i, j) => { const n = L.node(i, j); return { x: n.x, z: n.z }; };
    const route = (list) => list.map(([i, j]) => node(i, j));
    const s = g.ctx.sites;

    this.defs.push({
      id: 'dash', name: 'Downtown Dash', type: 'race', vehicle: 'car', reward: 300, par: 70, limit: 120,
      desc: 'Checkpoint race through the downtown towers. Any car will do — faster is better.',
      start: { x: L.node(3, 2).x + 9, z: L.node(3, 2).z - 14 },
      checkpoints: route([[2, 2], [1, 2], [1, 1], [2, 1], [3, 1], [4, 1], [4, 2], [3, 2]]),
    });
    this.defs.push({
      id: 'coastal', name: 'Coastal Time Trial', type: 'race', vehicle: 'motorcycle', reward: 350, par: 52, limit: 95,
      desc: 'Blast down the beach boulevard, over the river and along the south highway. Motorcycles only.',
      start: { x: L.node(6, 0).x + 12, z: L.node(6, 0).z + 20 },
      checkpoints: route([[6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [6, 6], [5, 6], [4, 6], [3, 6]]),
    });
    const rings = g.ctx.parkRings;
    if (rings.length >= 4) {
      const pt = (r, a) => ({ x: r.x + Math.sin(a) * r.r, z: r.z + Math.cos(a) * r.r });
      const byPos = (bi, bj) => rings.find((r) => r.block.bi === bi && r.block.bj === bj);
      const r13 = byPos(0, 4), r23 = byPos(1, 4), r14 = byPos(0, 5), r24 = byPos(1, 5);
      this.defs.push({
        id: 'pedal', name: 'Park Pedal', type: 'race', vehicle: 'bicycle', reward: 200, par: 110, limit: 200, small: true,
        desc: 'A relaxed (but timed!) bicycle loop through all four corners of Central Park.',
        start: { x: r13.block.x0 + 2.5, z: r13.z - 6 },
        checkpoints: [pt(r13, Math.PI), pt(r13, Math.PI / 2), pt(r23, -Math.PI / 2), pt(r23, Math.PI), pt(r23, Math.PI / 2), pt(r23, 0), pt(r24, Math.PI), pt(r24, 0), pt(r14, Math.PI / 2), pt(r14, 0), pt(r14, -Math.PI / 2), pt(r13, 0), pt(r13, -Math.PI / 2)],
      });
    }
    if (s.parking && g.ctx.parkingBays && g.ctx.parkingBays.length) {
      this.defs.push({
        id: 'parking', name: 'Park It!', type: 'parking', vehicle: 'car', reward: 150, limit: 60,
        desc: 'Drive into the highlighted bay at the Park & Ride and come to a complete stop.',
        start: { x: s.parking.x, z: g.layout.blocksOfType('PARKING')[0].z0 + 2 },
      });
    }
    if (s.restaurant) {
      this.defs.push({
        id: 'food', name: 'Food Run', type: 'delivery', vehicle: 'any', reward: 120, limit: 120,
        desc: 'Spice Garden needs a hot biryani delivered to a home in the suburbs before it gets cold.',
        start: { x: s.restaurant.x + 6, z: g.layout.blocksOfType('COM').find((b) => b.bi === 3 && b.bj === 1).z0 + 1.5 },
      });
    }
    this.defs.push({
      id: 'hello', name: 'Meet the Locals', type: 'talk', vehicle: 'none', reward: 100,
      desc: 'Say hello to Ravi in the City Centre, Meena on the beach and Karthik in Central Park.',
      targets: ['ravi', 'meena', 'karthik'],
    });

    for (const d of this.defs) if (d.start) this._marker(d);
    this._tokens();
    g.events.on('talk', (id) => this._onTalk(id));
  }

  _marker(def) {
    const color = { race: 0xfacc15, parking: 0x22c55e, delivery: 0xf97316 }[def.type] || 0x38bdf8;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 14, 20, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.set(def.start.x, 7, def.start.z);
    const base = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.6, 28), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    base.rotation.x = -Math.PI / 2;
    base.position.set(def.start.x, 0.13, def.start.z);
    this.group.add(beam, base);
    this.markers.push({ def, beam, base });
    this.game.interactions.register({
      id: `mission-${def.id}`, x: def.start.x, z: def.start.z, radius: 4, when: 'any', priority: 6,
      enabled: () => !this.active,
      label: () => `Start mission: ${def.name}`,
      action: () => this.game.ui.missionCard(def, () => this.start(def)),
    });
  }

  _tokens() {
    const g = this.game;
    const G = g.npcManager.graph;
    const rng = new Random(8080);
    const cands = G.nodes.filter((n) => ['corner', 'side', 'park', 'plaza', 'beach', 'pier'].includes(n.type));
    this.tokens = [];
    const used = [];
    for (let k = 0; k < 400 && this.tokens.length < 25; k++) {
      const n = cands[Math.floor(rng.next() * cands.length)];
      if (used.some((u) => Math.hypot(u.x - n.x, u.z - n.z) < 70)) continue;
      used.push(n);
      this.tokens.push({ id: this.tokens.length, x: n.x + rng.range(-1, 1), z: n.z + rng.range(-1, 1) });
    }
    const geo = new THREE.OctahedronGeometry(0.45, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffaa00, emissiveIntensity: 0.9, metalness: 0.6, roughness: 0.25 });
    this.tokenMesh = new THREE.InstancedMesh(geo, mat, this.tokens.length);
    this.tokenMesh.frustumCulled = false;
    this.group.add(this.tokenMesh);
  }

  get collected() {
    return this.game.state.collected;
  }

  start(def) {
    const g = this.game;
    const v = g.player.vehicle;
    if (def.vehicle !== 'none' && def.vehicle !== 'any' && (!v || v.kind !== def.vehicle)) {
      g.hud.toast(`You need ${KIND_NAMES[def.vehicle]} for this mission — press V to call one`, 3200);
      g.audio.error();
      return;
    }
    if (def.vehicle === 'any' && !v) {
      g.hud.toast('Get a vehicle first — press V to open your garage', 3000);
      return;
    }
    const a = { def, t: 0, idx: 0, failTimer: 0 };
    if (def.type === 'race') {
      a.points = def.checkpoints;
    } else if (def.type === 'parking') {
      const bays = g.ctx.parkingBays;
      a.bay = bays[Math.floor(Math.random() * bays.length)];
      this.bay.position.set(a.bay.x, 0.06, a.bay.z);
      this.bay.rotation.z = 0;
      this.bay.visible = true;
      a.points = [{ x: a.bay.x, z: a.bay.z }];
      a.hold = 0;
    } else if (def.type === 'delivery') {
      const houses = (g.ctx.sites.houses || []).filter((h) => h.street && Math.hypot(h.x - g.player.pos.x, h.z - g.player.pos.z) > 220);
      const h = houses[Math.floor(Math.random() * houses.length)] || g.ctx.sites.houses[0];
      a.points = [{ x: h.x, z: h.z }];
      a.small = true;
    } else if (def.type === 'talk') {
      this.active = null;
      return;
    }
    this.active = a;
    g.hud.banner(def.name, def.type === 'race' ? 'GO!' : def.type === 'parking' ? 'Find the green bay' : 'Deliver while it\'s hot!');
    g.audio.missionStart();
    g.setWaypoint(a.points[0], true);
    g.events.emit('missionStart', def);
  }

  abandon(reason = 'Mission abandoned') {
    if (!this.active) return;
    this.game.hud.banner(this.active.def.name, reason, 'fail');
    this.game.audio.error();
    this._clear();
  }

  _clear() {
    this.active = null;
    this.cpRing.visible = this.cpBeam.visible = this.cpNext.visible = false;
    this.bay.visible = false;
    this.game.setWaypoint(null, true);
    this.game.hud.setObjective(null);
  }

  _complete() {
    const a = this.active;
    const g = this.game;
    const def = a.def;
    let reward = def.reward;
    let extra = '';
    if (def.par && a.t < def.par) { reward += 100; extra = ' + under-par bonus!'; }
    if (def.type === 'delivery') { const tip = Math.max(0, Math.round((def.limit - a.t) * 0.8)); reward += tip; extra = ` (tip $${tip})`; }
    const best = g.state.bestTimes[def.id];
    const isBest = def.type === 'race' && (!best || a.t < best);
    if (isBest) g.state.bestTimes[def.id] = a.t;
    g.state.earn(reward);
    g.state.completed[def.id] = (g.state.completed[def.id] || 0) + 1;
    g.hud.banner(`${def.name} complete!`, `${formatTime(a.t)} — earned $${reward}${extra}${isBest ? ' · NEW BEST' : ''}`, 'success');
    g.audio.missionComplete();
    this._clear();
    g.save();
  }

  _onTalk(id) {
    const def = this.defs.find((d) => d.id === 'hello');
    if (!def || this.talked.has(id) || this.game.state.completed.hello) return;
    this.talked.add(id);
    this.game.state.talked = [...this.talked];
    if (this.talked.size >= def.targets.length) {
      this.game.state.earn(def.reward);
      this.game.state.completed.hello = 1;
      this.game.hud.banner('Meet the Locals complete!', `You made three new friends — earned $${def.reward}`, 'success');
      this.game.audio.missionComplete();
      this.game.save();
    } else {
      this.game.hud.toast(`Meet the Locals: ${this.talked.size}/${def.targets.length}`, 2200);
    }
  }

  update(dt) {
    const g = this.game;
    this.time += dt;
    const p = g.player;
    const px = p.vehicle ? p.vehicle.x : p.pos.x;
    const pz = p.vehicle ? p.vehicle.z : p.pos.z;
    // marker animation
    for (const m of this.markers) {
      const show = !this.active;
      m.beam.visible = m.base.visible = show && !p.interior;
      m.beam.material.opacity = 0.2 + Math.sin(this.time * 2) * 0.08;
    }
    this._updateTokens(px, pz, dt);
    this._updateLandmarks(px, pz);
    const a = this.active;
    if (!a) return;
    a.t += dt;
    const def = a.def;
    // vehicle requirement
    const v = p.vehicle;
    const okVehicle = def.vehicle === 'none' || (def.vehicle === 'any' ? !!v : v && v.kind === def.vehicle);
    if (!okVehicle) {
      a.failTimer += dt;
      g.hud.setObjective(`${def.name}`, `Get back on ${KIND_NAMES[def.vehicle]}! ${Math.ceil(10 - a.failTimer)}s`, formatTime(Math.max(0, def.limit - a.t)));
      if (a.failTimer > 10) return this.abandon('Mission failed — you left the vehicle');
    } else a.failTimer = 0;
    if (def.limit && a.t > def.limit) return this.abandon('Out of time!');

    const target = a.points[a.idx];
    const dist = Math.hypot(target.x - px, target.z - pz);
    if (def.type === 'race' || def.type === 'delivery') {
      const r = def.small || a.small ? 4.5 : 9;
      this.cpRing.visible = this.cpBeam.visible = true;
      this.cpRing.scale.setScalar(r / 4.2);
      this.cpBeam.scale.set(r / 4.2, 1, r / 4.2);
      this.cpRing.position.set(target.x, r * 0.75 + 0.3, target.z);
      this.cpBeam.position.set(target.x, 30, target.z);
      const nxt = a.points[a.idx + 1];
      this.cpNext.visible = !!nxt;
      if (nxt) { this.cpNext.position.set(nxt.x, r * 0.75 + 0.3, nxt.z); this.cpNext.scale.setScalar(r / 4.2); this.cpNext.lookAt(target.x, r * 0.75 + 0.3, target.z); }
      this.cpRing.lookAt(px, r * 0.75 + 0.3, pz);
      this.cpMat.color.setHex(a.idx === a.points.length - 1 ? 0x22c55e : 0xfacc15);
      if (dist < r) {
        a.idx++;
        if (a.idx >= a.points.length) return this._complete();
        g.audio.checkpoint();
        g.setWaypoint(a.points[a.idx], true);
      }
      const label = def.type === 'race' ? `Checkpoint ${a.idx + 1}/${a.points.length}` : 'Deliver the biryani to the marked house';
      if (okVehicle) g.hud.setObjective(def.name, `${label} · ${Math.round(dist)} m`, formatTime(Math.max(0, def.limit - a.t)));
    } else if (def.type === 'parking') {
      const b = a.bay;
      let inside = false;
      if (v) {
        const dx = v.x - b.x, dz = v.z - b.z;
        const cs = Math.cos(b.heading), sn = Math.sin(b.heading);
        const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
        const ang = Math.abs(Math.cos(v.heading - b.heading));
        inside = Math.abs(lx) < 0.8 && Math.abs(lz) < 1.2 && ang > 0.94 && Math.abs(v.speed) < 0.4;
      }
      a.hold = inside ? a.hold + dt : 0;
      this.bay.material.color.setHex(inside ? 0x4ade80 : 0x22c55e);
      this.bay.rotation.z = b.heading;
      if (okVehicle) g.hud.setObjective(def.name, inside ? `Hold still… ${Math.max(0, 2 - a.hold).toFixed(1)}s` : `Park in the green bay · ${Math.round(dist)} m`, formatTime(Math.max(0, def.limit - a.t)));
      if (a.hold > 2) this._complete();
    }
  }

  _updateTokens(px, pz, dt) {
    const g = this.game;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    const spin = this.time * 2;
    const radius = g.player.vehicle ? 3.2 : 1.6;
    for (const t of this.tokens) {
      if (this.collected.includes(t.id) || g.player.interior) { this.tokenMesh.setMatrixAt(t.id, hidden); continue; }
      const d = Math.hypot(t.x - px, t.z - pz);
      if (d < radius) {
        this.collected.push(t.id);
        g.state.earn(25);
        g.audio.coin();
        const n = this.collected.length;
        if (n === this.tokens.length) { g.state.earn(500); g.hud.banner('All tokens found!', 'Bonus $500 — you really know this city.', 'success'); }
        else g.hud.toast(`Token ${n}/${this.tokens.length} found  +$25`, 1800);
        g.save();
        continue;
      }
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin + t.id);
      m.compose(new THREE.Vector3(t.x, 1.2 + Math.sin(this.time * 2 + t.id) * 0.15 + (t.x > 352 && Math.abs(t.z) < 15 ? 0.38 : 0), t.z), q, s);
      this.tokenMesh.setMatrixAt(t.id, m);
    }
    this.tokenMesh.instanceMatrix.needsUpdate = true;
    void dt;
  }

  _updateLandmarks(px, pz) {
    const g = this.game;
    for (const l of g.landmarks.landmarks) {
      if (g.state.discovered.includes(l.id)) continue;
      if (Math.hypot(l.x - px, l.z - pz) < l.radius) {
        g.state.discovered.push(l.id);
        g.state.earn(l.reward);
        g.hud.banner(`Discovered: ${l.name}`, `${l.desc}  +$${l.reward}`, 'discover');
        g.audio.discover();
        if (g.state.discovered.length === g.landmarks.landmarks.length) {
          g.state.earn(500);
          setTimeout(() => g.hud.banner('City Explorer!', 'You found every landmark. Bonus $500.', 'success'), 4500);
        }
        g.save();
      }
    }
  }
}

export function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t % 1) * 10);
  return `${m}:${String(s).padStart(2, '0')}.${cs}`;
}
