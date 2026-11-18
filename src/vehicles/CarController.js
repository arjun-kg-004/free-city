import { damp, clamp } from '../utils/Random.js';

/** Four-wheeler handling: heavier inertia, handbrake drifts, body roll and pitch. */
export class CarController {
  constructor() {
    this.steerInput = 0;
    this.steerFalloff = 0.045;
    this.steerSpeed = 7;
    this.handbrakeGrip = 1.4;
  }

  readInput(v, input, dt) {
    this.steerInput = damp(this.steerInput, input.moveX, 9, dt);
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
    // wheels roll + front wheels steer
    for (const w of p.wheels) {
      w.spin.rotation.x += (v.speed * dt) / w.r;
      if (w.front) w.pivot.rotation.y = -v.steer;
    }
    // body roll from lateral acceleration, pitch from longitudinal
    const lat = clamp(v.yawRate * v.speed * 0.012, -0.06, 0.06);
    v.roll = damp(v.roll, lat, 6, dt);
    const lon = clamp((v.throttle - v.brakeInput) * 0.02, -0.03, 0.025);
    v.pitch = damp(v.pitch, -lon, 5, dt);
    p.body.rotation.z = v.roll;
    p.body.rotation.x = v.pitch;
  }
}
