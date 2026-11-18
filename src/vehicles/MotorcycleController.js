import { damp, clamp } from '../utils/Random.js';

/** Two-wheeled motorbike: quick steering, leans into corners, slight wheelie on launch. */
export class MotorcycleController {
  constructor() {
    this.steerInput = 0;
    this.steerFalloff = 0.06;
    this.steerSpeed = 10;
    this.handbrakeGrip = 2.5;
  }

  readInput(v, input, dt) {
    this.steerInput = damp(this.steerInput, input.moveX, 11, dt);
    v.throttle = Math.max(0, input.moveY);
    v.brakeInput = Math.max(0, -input.moveY);
    v.handbrake = input.down('jump');
  }

  maxSpeed(v) {
    return v.spec.maxSpeed;
  }

  accel(v) {
    return v.spec.accel;
  }

  updateVisual(v, dt) {
    const p = v.parts;
    for (const w of p.wheels) w.spin.rotation.x += (v.speed * dt) / w.r;
    if (p.front) p.front.rotation.y = -v.steer * 0.6;
    const targetLean = clamp(v.yawRate * Math.abs(v.speed) * 0.09, -0.75, 0.75);
    v.lean = damp(v.lean, targetLean, 7, dt);
    p.body.rotation.z = v.lean;
    const wheelie = v.throttle > 0.9 && v.speed > 1 && v.speed < 9 ? -0.08 : 0;
    v.pitch = damp(v.pitch, wheelie, 4, dt);
    p.body.rotation.x = v.pitch;
  }
}
