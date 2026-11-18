import { damp, clamp } from '../utils/Random.js';

/** Pedal bike: speed depends on cadence and gear (1/2/3), Shift to pedal harder. */
export class BicycleController {
  constructor() {
    this.steerInput = 0;
    this.steerFalloff = 0.08;
    this.steerSpeed = 9;
    this.handbrakeGrip = 3;
    this.sprint = false;
    this.pedalling = false;
  }

  readInput(v, input, dt) {
    this.steerInput = damp(this.steerInput, input.moveX, 10, dt);
    this.pedalling = input.moveY > 0.1;
    this.sprint = input.down('sprint');
    v.throttle = this.pedalling ? (this.sprint ? 1 : 0.75) : 0;
    v.brakeInput = Math.max(0, -input.moveY);
    v.handbrake = input.down('jump');
    if (input.justPressed('gear1')) v.gear = 1;
    if (input.justPressed('gear2')) v.gear = 2;
    if (input.justPressed('gear3')) v.gear = 3;
  }

  gearFactor(v) {
    return [0, 0.55, 0.78, 1][v.gear];
  }

  maxSpeed(v) {
    return v.spec.maxSpeed * this.gearFactor(v) * (this.sprint ? 1.25 : 1);
  }

  accel(v) {
    // low gear = punchy, high gear = slow to build speed
    return v.spec.accel * [0, 1.45, 1.1, 0.8][v.gear] * (this.sprint ? 1.3 : 1);
  }

  updateVisual(v, dt) {
    const p = v.parts;
    for (const w of p.wheels) w.spin.rotation.x += (v.speed * dt) / w.r;
    if (p.front) p.front.rotation.y = -v.steer * 0.7;
    if (this.pedalling || v.throttle > 0) v.crankAngle += (Math.max(1.5, v.speed) * dt * 2.2) / this.gearFactor(v);
    if (p.crank) p.crank.rotation.x = v.crankAngle;
    const targetLean = clamp(v.yawRate * Math.abs(v.speed) * 0.08, -0.5, 0.5);
    v.lean = damp(v.lean, targetLean, 7, dt);
    p.body.rotation.z = v.lean;
  }
}
