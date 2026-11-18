import * as THREE from 'three';
import { CAR_SHAPES } from './VehicleTypes.js';
import { Materials } from '../world/Materials.js';
import { mergeMeshChildren } from '../utils/MergeUtils.js';
import { unitCarBody, unitCarCabin, roofPlacement, isBoxy } from './CarShapes.js';

const _up = new THREE.Vector3(0, 1, 0);

function tube(a, b, r, mat) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(_up, dir.normalize());
  return m;
}

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function paint(color) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.45, clearcoat: 0.8, clearcoatRoughness: 0.2 });
}

/** Builds detailed meshes for player-controlled vehicles. Forward is +Z. */
export class VehicleFactory {
  constructor(assets) {
    this.assets = assets;
  }

  build(type, spec, colorOverride) {
    const color = colorOverride || spec.color;
    if (spec.kind === 'car') return this.car(spec.shape, color);
    if (spec.kind === 'motorcycle') return this.motorcycle(spec.style, color);
    return this.bicycle(spec.style, color);
  }

  lights() {
    const head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 0.2, roughness: 0.2 });
    const brake = new THREE.MeshStandardMaterial({ color: 0x7a0b0b, emissive: 0xff1a1a, emissiveIntensity: 0.25, roughness: 0.3 });
    return { head, brake };
  }

  car(shapeKey, color) {
    const s = CAR_SHAPES[shapeKey];
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const pm = paint(color);
    const dark = Materials.darkMetal;
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x1a2430, roughness: 0.04, metalness: 0.5, transparent: true, opacity: 0.86 });
    const by = s.clearance + s.bodyH / 2;
    // sculpted lower body and raked glasshouse (shared unit shapes, scaled per model)
    const shell = new THREE.Mesh(unitCarBody(), pm);
    shell.scale.set(s.W, s.bodyH, s.L);
    shell.position.set(0, by, 0);
    body.add(shell);
    const cy = s.clearance + s.bodyH + s.cabH / 2;
    const cab = new THREE.Mesh(isBoxy(s) ? new THREE.BoxGeometry(1, 1, 1) : unitCarCabin(), glass);
    cab.scale.set(s.W * 0.88, s.cabH, s.cabL);
    cab.position.set(0, cy, s.cabZ);
    body.add(cab);
    const rf = roofPlacement(s);
    body.add(box(rf.w, 0.06, rf.l, pm, 0, cy + s.cabH / 2 + 0.02, rf.z));
    // bumpers + grille
    body.add(box(s.W * 1.01, 0.22, 0.18, dark, 0, s.clearance + 0.14, s.L / 2 + 0.04));
    body.add(box(s.W * 1.01, 0.22, 0.18, dark, 0, s.clearance + 0.14, -s.L / 2 - 0.04));
    body.add(box(s.W * 0.45, s.bodyH * 0.35, 0.04, dark, 0, by + 0.02, s.L / 2 + 0.01));
    // lights
    const L = this.lights();
    for (const sx of [-1, 1]) {
      body.add(box(0.36, 0.12, 0.06, L.head, sx * (s.W / 2 - 0.27), by + s.bodyH * 0.04, s.L / 2 + 0.01));
      body.add(box(0.34, 0.14, 0.06, L.brake, sx * (s.W / 2 - 0.25), by + s.bodyH * 0.18, -s.L / 2 - 0.02));
      body.add(box(0.06, 0.1, 0.18, pm, sx * (s.W / 2 + 0.08), cy - s.cabH * 0.25, s.cabZ + s.cabL / 2 - 0.1)); // mirrors
    }
    if (s.sign) {
      const sign = box(0.7, 0.22, 0.25, new THREE.MeshStandardMaterial({ color: 0xfff1a8, emissive: 0xffd000, emissiveIntensity: 0.6 }), 0, cy + s.cabH / 2 + 0.17, s.cabZ);
      body.add(sign);
    }
    // interior: seats + steering wheel
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 });
    for (const sx of [-1, 1]) {
      body.add(box(0.5, 0.15, 0.5, seatMat, sx * 0.38, s.clearance + s.bodyH - 0.05, s.cabZ - 0.05));
      body.add(box(0.5, 0.6, 0.12, seatMat, sx * 0.38, s.clearance + s.bodyH + 0.25, s.cabZ - 0.33));
    }
    const sw = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 6, 16), seatMat);
    sw.position.set(-0.38, s.clearance + s.bodyH + 0.28, s.cabZ + 0.42);
    sw.rotation.x = -0.4;
    body.add(sw);
    // wheels
    const wheels = [];
    const tyre = new THREE.CylinderGeometry(s.wheelR, s.wheelR, 0.26, 18);
    tyre.rotateZ(Math.PI / 2);
    const rim = new THREE.CylinderGeometry(s.wheelR * 0.62, s.wheelR * 0.62, 0.27, 10);
    rim.rotateZ(Math.PI / 2);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.8, roughness: 0.3 });
    const wz = s.L / 2 - Math.max(0.65, s.wheelR * 2.1);
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * (s.W / 2 - 0.12), s.wheelR, sz * wz);
      const spin = new THREE.Group();
      spin.add(new THREE.Mesh(tyre, Materials.rubber));
      spin.add(new THREE.Mesh(rim, rimMat));
      pivot.add(spin);
      root.add(pivot);
      wheels.push({ pivot, spin, front: sz > 0, r: s.wheelR });
    }
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    cab.castShadow = false;
    mergeMeshChildren(body);
    for (const w of wheels) mergeMeshChildren(w.spin);
    return {
      root, body, wheels, lights: L,
      seat: new THREE.Vector3(-0.38, s.clearance - 0.22, s.cabZ - 0.05),
      riderScale: Math.min(1, (s.clearance + s.bodyH + s.cabH - 0.12 - (s.clearance + 0.28)) / 1.02),
      cockpit: new THREE.Vector3(-0.38, s.clearance + s.bodyH + s.cabH * 0.62, s.cabZ + 0.05),
      riderPose: 'drive', halfExtents: { x: s.W / 2, y: (s.clearance + s.bodyH + s.cabH) / 2, z: s.L / 2 },
      exitSide: new THREE.Vector3(-(s.W / 2 + 1.1), 0, s.cabZ),
      wheelBase: wz * 2, headlightPos: new THREE.Vector3(0, by, s.L / 2),
      hideRider: false,
    };
  }

  motorcycle(style, color) {
    const root = new THREE.Group();
    const body = new THREE.Group(); // leans
    root.add(body);
    const pm = paint(color);
    const dark = Materials.darkMetal;
    const chrome = new THREE.MeshStandardMaterial({ color: 0xd0d4d8, metalness: 0.9, roughness: 0.25 });
    const R = style === 'scooter' ? 0.25 : 0.33;
    const wb = style === 'scooter' ? 1.25 : 1.4;
    const wheels = [];
    const tyreGeo = new THREE.TorusGeometry(R - 0.06, 0.07, 8, 20);
    tyreGeo.rotateY(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(R * 0.55, R * 0.55, 0.08, 10);
    hubGeo.rotateZ(Math.PI / 2);
    const front = new THREE.Group(); // steering
    front.position.set(0, 0, wb / 2);
    body.add(front);
    for (const fz of [1, -1]) {
      const spin = new THREE.Group();
      spin.add(new THREE.Mesh(tyreGeo, Materials.rubber));
      spin.add(new THREE.Mesh(hubGeo, chrome));
      const pivot = new THREE.Group();
      pivot.position.set(0, R, fz > 0 ? 0 : -wb / 2);
      pivot.add(spin);
      if (fz > 0) front.add(pivot); else body.add(pivot);
      wheels.push({ pivot, spin, front: fz > 0, r: R, noSteer: true });
    }
    // forks + handlebar
    front.add(tube(new THREE.Vector3(-0.09, R, 0), new THREE.Vector3(-0.07, R + 0.75, -0.18), 0.03, chrome));
    front.add(tube(new THREE.Vector3(0.09, R, 0), new THREE.Vector3(0.07, R + 0.75, -0.18), 0.03, chrome));
    front.add(tube(new THREE.Vector3(-0.38, R + 0.8, -0.2), new THREE.Vector3(0.38, R + 0.8, -0.2), 0.022, dark));
    const L = this.lights();
    const hl = box(0.2, 0.16, 0.08, L.head, 0, R + 0.6, -0.08);
    front.add(hl);
    if (style === 'scooter') {
      body.add(box(0.36, 0.1, 0.8, pm, 0, R + 0.06, 0.05)); // floorboard
      front.add(box(0.42, 0.75, 0.12, pm, 0, R + 0.35, -0.16)); // leg shield
      body.add(box(0.4, 0.42, 0.62, pm, 0, R + 0.33, -0.45)); // rear body
      body.add(box(0.34, 0.1, 0.56, new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.9 }), 0, R + 0.59, -0.4));
    } else {
      // frame
      body.add(tube(new THREE.Vector3(0, R + 0.7, wb / 2 - 0.2), new THREE.Vector3(0, R + 0.25, -0.1), 0.05, dark));
      body.add(tube(new THREE.Vector3(0, R + 0.25, -0.1), new THREE.Vector3(0, R, -wb / 2), 0.04, dark));
      body.add(box(0.36, 0.28, 0.55, pm, 0, R + 0.68, 0.25)); // tank
      body.add(box(0.3, 0.1, 0.62, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }), 0, R + 0.62, -0.28)); // seat
      body.add(box(0.32, 0.32, 0.45, dark, 0, R + 0.22, 0.12)); // engine
      body.add(tube(new THREE.Vector3(0.18, R + 0.1, 0.1), new THREE.Vector3(0.2, R + 0.25, -wb / 2 - 0.1), 0.05, chrome)); // exhaust
      if (style === 'sport') {
        front.add(box(0.48, 0.5, 0.35, pm, 0, R + 0.62, -0.1)); // fairing
        body.add(box(0.36, 0.25, 0.4, pm, 0, R + 0.62, -0.62)); // tail
      }
    }
    const tail = box(0.16, 0.08, 0.05, L.brake, 0, R + 0.55, -wb / 2 - 0.15);
    body.add(tail);
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    mergeMeshChildren(body);
    mergeMeshChildren(front);
    return {
      root, body, wheels, front, lights: L,
      seat: new THREE.Vector3(0, style === 'scooter' ? R + 0.02 : R - 0.25, style === 'scooter' ? -0.3 : -0.18),
      cockpit: new THREE.Vector3(0, R + 1.35, -0.1),
      riderPose: style === 'scooter' ? 'drive' : 'ride',
      riderHipY: style === 'scooter' ? 0.62 : 0.86,
      halfExtents: { x: 0.45, y: 0.6, z: wb / 2 + R + 0.1 },
      exitSide: new THREE.Vector3(-1.0, 0, 0),
      wheelBase: wb, headlightPos: new THREE.Vector3(0, R + 0.6, wb / 2),
    };
  }

  bicycle(style, color) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const fm = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5 });
    const dark = Materials.darkMetal;
    const R = 0.34, wb = 1.05;
    const wheels = [];
    const tyreGeo = new THREE.TorusGeometry(R, 0.03, 6, 24);
    tyreGeo.rotateY(Math.PI / 2);
    const spokeGeo = new THREE.CylinderGeometry(0.008, 0.008, R * 2, 4);
    const front = new THREE.Group();
    front.position.set(0, 0, wb / 2);
    body.add(front);
    for (const fz of [1, -1]) {
      const spin = new THREE.Group();
      spin.add(new THREE.Mesh(tyreGeo, Materials.rubber));
      for (let k = 0; k < 4; k++) {
        const sp = new THREE.Mesh(spokeGeo, Materials.metal);
        sp.rotation.x = (k / 4) * Math.PI;
        spin.add(sp);
      }
      const pivot = new THREE.Group();
      pivot.position.set(0, R, fz > 0 ? 0 : -wb / 2);
      pivot.add(spin);
      if (fz > 0) front.add(pivot); else body.add(pivot);
      wheels.push({ pivot, spin, front: fz > 0, r: R, noSteer: true });
    }
    const v = (x, y, z) => new THREE.Vector3(x, y, z);
    const bb = v(0, R + 0.02, 0); // bottom bracket
    const seatTop = v(0, R + 0.62, -0.18);
    const headTop = v(0, R + 0.62, wb / 2 - 0.08);
    const headBot = v(0, R + 0.4, wb / 2 - 0.04);
    body.add(tube(bb, seatTop, 0.025, fm));
    body.add(tube(bb, headBot, 0.028, fm));
    body.add(tube(seatTop, headTop, 0.025, fm));
    body.add(tube(bb, v(0, R, -wb / 2), 0.02, fm));
    body.add(tube(seatTop, v(0, R, -wb / 2), 0.02, fm));
    front.add(tube(v(0, R, 0), v(0, R + 0.66, -0.08), 0.022, fm));
    front.add(tube(v(-0.28, R + 0.72, -0.12), v(0.28, R + 0.72, -0.12), 0.018, dark));
    body.add(box(0.13, 0.05, 0.25, new THREE.MeshStandardMaterial({ color: 0x111111 }), 0, R + 0.67, -0.2));
    // crank + pedals
    const crank = new THREE.Group();
    crank.position.copy(bb);
    crank.add(box(0.03, 0.34, 0.04, dark, 0.08, 0, 0));
    const pedalA = box(0.1, 0.02, 0.06, dark, 0.13, 0.17, 0);
    const pedalB = box(0.1, 0.02, 0.06, dark, -0.13, -0.17, 0);
    crank.add(pedalA, pedalB);
    crank.add(box(0.03, 0.34, 0.04, dark, -0.08, 0, 0));
    body.add(crank);
    const L = this.lights();
    front.add(box(0.08, 0.06, 0.05, L.head, 0, R + 0.62, 0.0));
    body.add(box(0.06, 0.04, 0.03, L.brake, 0, R + 0.5, -0.36));
    if (style === 'city') {
      const basket = box(0.32, 0.2, 0.25, new THREE.MeshStandardMaterial({ color: 0x8d6e4b, roughness: 1 }), 0, R + 0.52, 0.14);
      front.add(basket);
    }
    root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    mergeMeshChildren(body);
    mergeMeshChildren(front);
    mergeMeshChildren(crank);
    for (const w of wheels) mergeMeshChildren(w.spin);
    return {
      root, body, wheels, front, crank, lights: L,
      seat: v(0, R - 0.22, -0.26),
      cockpit: v(0, R + 1.45, -0.1),
      riderPose: 'pedal', riderHipY: 0.98,
      halfExtents: { x: 0.35, y: 0.55, z: wb / 2 + R },
      exitSide: v(-0.9, 0, 0),
      wheelBase: wb, headlightPos: v(0, R + 0.62, wb / 2),
    };
  }
}
