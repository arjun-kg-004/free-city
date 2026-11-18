import { COLLISION } from '../config.js';
import { quatY } from '../game/PhysicsManager.js';
import { clamp, damp } from '../utils/Random.js';

let NEXT_ID = 1;

/**
 * A player-usable vehicle. Movement is arcade-physics (inertia, grip, drift, speed-sensitive
 * steering) resolved against the world with Rapier's kinematic character controller.
 * The handling "feel" is delegated to a controller (car / motorcycle / bicycle).
 */
export class Vehicle {
  constructor({ type, spec, parts, physics, controller, x, z, heading = 0, rental = false }) {
    this.id = NEXT_ID++;
    this.type = type;
    this.spec = spec;
    this.kind = spec.kind;
    this.parts = parts;
    this.mesh = parts.root;
    this.physics = physics;
    this.controller = controller;
    this.rental = rental;
    this.x = x; this.z = z; this.heading = heading;
    this.vx = 0; this.vz = 0;
    this.speed = 0;          // signed forward speed (m/s)
    this.steer = 0;          // current steer angle (rad, +right)
    this.yawRate = 0;
    this.throttle = 0; this.brakeInput = 0; this.handbrake = false;
    this.lean = 0; this.pitch = 0; this.roll = 0;
    this.slip = 0;
    this.fuel = spec.kind === 'bicycle' ? Infinity : 100;
    this.lightsOn = false;
    this.driven = false;
    this.rpm = 0;
    this.gear = spec.kind === 'bicycle' ? 2 : 1;
    this.crankAngle = 0;
    this.impact = 0;
    this.stuckTime = 0;
    this.idleTimer = 0;

    const he = parts.halfExtents;
    this.halfExtents = he;
    this.rideHeight = 0.06;
    const desc = physics.RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z);
    const kin = physics.createKinematic(x, he.y + this.rideHeight, z, desc, COLLISION.VEHICLE, COLLISION.STATIC | COLLISION.VEHICLE | COLLISION.TRAFFIC | COLLISION.PLAYER);
    this.body = kin.body;
    this.collider = kin.collider;
    this.body.setRotation(quatY(heading), true);
    this.cc = physics.createController(0.05);
    this.cc.setSlideEnabled(true);
    this.cc.setMaxSlopeClimbAngle(0.4);
    this.syncMesh();
  }

  get position() {
    return { x: this.x, y: 0, z: this.z };
  }

  get forward() {
    return { x: Math.sin(this.heading), z: Math.cos(this.heading) };
  }

  get kmh() {
    return Math.abs(this.speed) * 3.6;
  }

  update(dt, input) {
    const c = this.controller;
    if (this.driven && input) c.readInput(this, input, dt);
    else { this.throttle = 0; this.brakeInput = this.speed > 0.2 ? 0.4 : 0; this.handbrake = !this.driven; }

    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -Math.cos(this.heading), rz = Math.sin(this.heading);
    let vF = this.vx * fx + this.vz * fz;
    let vR = this.vx * rx + this.vz * rz;

    // Longitudinal
    const hasFuel = this.fuel > 0;
    let a = 0;
    const thr = hasFuel ? this.throttle : 0;
    const maxF = c.maxSpeed(this);
    if (thr > 0) {
      if (vF < -0.5) a += this.spec.brake * thr;
      else a += c.accel(this) * thr * Math.max(0, 1 - (vF / maxF) ** 2);
    }
    if (this.brakeInput > 0) {
      if (vF > 0.5) a -= this.spec.brake * this.brakeInput;
      else if (this.driven) {
        // cars reverse properly; riders push two-wheelers back at walking pace
        const rev = this.kind === 'car' ? this.spec.reverse : 2.5;
        const maxRev = this.kind === 'car' ? 8 : 1.6;
        a -= rev * this.brakeInput * Math.max(0, 1 - (vF / -maxRev) ** 2);
      }
      else a -= Math.sign(vF) * Math.min(Math.abs(vF) / dt, this.spec.brake * this.brakeInput);
    }
    // rolling resistance + aero drag
    const drag = (this.kind === 'bicycle' ? 0.35 : 0.5) + 0.0016 * vF * vF;
    if (Math.abs(vF) > 0.01) a -= Math.sign(vF) * Math.min(drag, Math.abs(vF) / dt);
    if (this.handbrake && Math.abs(vF) > 0.5) a -= Math.sign(vF) * 4.5;
    vF += a * dt;
    if (!this.driven && Math.abs(vF) < 0.15) vF = 0;

    // Steering: angle limited at speed, yaw from bicycle model
    const maxSteer = this.spec.steer / (1 + Math.abs(vF) * c.steerFalloff);
    const target = (this.driven ? c.steerInput : 0) * maxSteer;
    this.steer = damp(this.steer, target, c.steerSpeed, dt);
    let yaw = -(vF * Math.tan(this.steer)) / Math.max(0.8, this.parts.wheelBase);
    if (this.handbrake && Math.abs(vF) > 4 && this.kind === 'car') yaw *= 1.35;

    // Lateral grip (drift when handbraking)
    const grip = this.handbrake ? c.handbrakeGrip : this.spec.grip;
    vR *= Math.exp(-grip * dt);
    this.slip = Math.abs(vR) + (this.handbrake ? Math.abs(vF) * 0.15 : 0) + (this.brakeInput > 0.8 && Math.abs(vF) > 12 ? 2 : 0);

    // Heading change — refuse rotations that would push us into a wall
    let newHeading = this.heading + yaw * dt;
    if (Math.abs(yaw * dt) > 1e-4 && this.physics.boxBlocked(this.x, this.halfExtents.y + this.rideHeight, this.z, this.halfExtents.x * 0.98, this.halfExtents.y * 0.9, this.halfExtents.z * 0.98, newHeading, this.collider)) {
      newHeading = this.heading;
      yaw = 0;
    }
    this.yawRate = yaw;
    this.heading = newHeading;
    const nfx = Math.sin(this.heading), nfz = Math.cos(this.heading);
    const nrx = -Math.cos(this.heading), nrz = Math.sin(this.heading);
    this.vx = nfx * vF + nrx * vR;
    this.vz = nfz * vF + nrz * vR;

    // Resolve movement against the world
    const want = { x: this.vx * dt, y: 0, z: this.vz * dt };
    this.impact = 0;
    if (Math.abs(want.x) + Math.abs(want.z) > 1e-5) {
      this.body.setRotation(quatY(this.heading), true);
      this.cc.computeColliderMovement(this.collider, want, undefined, undefined, (col) => col.handle !== this.collider.handle);
      const got = this.cc.computedMovement();
      const lost = Math.hypot(want.x - got.x, want.z - got.z) / dt;
      if (lost > 0.5) {
        this.impact = lost;
        // keep the sliding component, bleed energy, small bounce
        this.vx = (got.x / dt) * 0.92 - (want.x - got.x) / dt * 0.18;
        this.vz = (got.z / dt) * 0.92 - (want.z - got.z) / dt * 0.18;
      }
      this.x += got.x;
      this.z += got.z;
    }
    this.body.setNextKinematicTranslation({ x: this.x, y: this.halfExtents.y + this.rideHeight, z: this.z });
    this.body.setNextKinematicRotation(quatY(this.heading));
    this.speed = this.vx * nfx + this.vz * nfz;

    // Fuel
    if (this.driven && this.spec.fuelUse > 0) {
      this.fuel = Math.max(0, this.fuel - this.spec.fuelUse * (0.1 + this.throttle * Math.abs(this.speed) * 0.08) * dt * 10);
    }
    // Stuck detection (for HUD hint)
    if (this.driven && this.throttle > 0.5 && Math.abs(this.speed) < 0.4) this.stuckTime += dt; else this.stuckTime = 0;

    c.updateVisual(this, dt);
    if (this.parts.modelWheels) {
      for (const w of this.parts.modelWheels) {
        w.spinner.rotation.x += (this.speed * dt) / w.r;
        w.pivot.rotation.y = w.front ? -this.steer : 0;
      }
    }
    this.syncMesh();
  }

  syncMesh() {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
    const L = this.parts.lights;
    if (L) {
      L.head.emissiveIntensity = this.lightsOn ? 3.2 : 0.15;
      L.brake.emissiveIntensity = this.brakeInput > 0.1 && this.speed > 0.3 ? 3.5 : this.lightsOn ? 1.0 : 0.2;
    }
    const ML = this.parts.modelLights;
    if (ML) {
      const braking = this.brakeInput > 0.1 && this.speed > 0.3;
      for (const m of ML.brake) if (m.emissive) m.emissiveIntensity = braking ? 4 : this.lightsOn ? 1.2 : 0.15;
      for (const m of ML.head) if (m.emissive) m.emissiveIntensity = this.lightsOn ? 3 : 0.1;
    }
  }

  teleport(x, z, heading) {
    this.x = x; this.z = z; this.heading = heading;
    this.vx = this.vz = this.speed = 0;
    this.steer = 0;
    this.body.setTranslation({ x, y: this.halfExtents.y + this.rideHeight, z }, true);
    this.body.setRotation(quatY(heading), true);
    this.body.setNextKinematicTranslation({ x, y: this.halfExtents.y + this.rideHeight, z });
    this.body.setNextKinematicRotation(quatY(heading));
    this.syncMesh();
  }

  /** Engine rev estimate 0..1 for audio. */
  updateRpm(dt) {
    const max = this.controller.maxSpeed(this);
    const v = Math.abs(this.speed) / max;
    const gears = this.kind === 'motorcycle' ? [0, 0.18, 0.36, 0.55, 0.75] : [0, 0.22, 0.42, 0.62, 0.82];
    let g = 0;
    while (g < gears.length - 1 && v > gears[g + 1]) g++;
    const lo = gears[g], hi = g < gears.length - 1 ? gears[g + 1] : 1.05;
    const inGear = clamp((v - lo) / (hi - lo), 0, 1);
    const target = 0.15 + inGear * 0.75 + this.throttle * 0.1;
    this.rpm = damp(this.rpm, this.fuel > 0 ? target : 0, 10, dt);
    this.autoGear = g + 1;
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.physics.world.removeCharacterController(this.cc);
    this.physics.world.removeRigidBody(this.body);
    this.mesh.traverse((o) => {
      if (o.isMesh) o.geometry.dispose(); // materials may be shared — leave them
    });
  }
}
