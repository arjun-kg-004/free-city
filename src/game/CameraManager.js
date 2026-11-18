import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../utils/Random.js';

/**
 * Third-person orbit camera on foot, chase / far-chase / cockpit cameras in vehicles.
 * Smooth follow, mouse/touch orbit, scroll zoom, and collision avoidance via raycasts.
 */
export class CameraManager {
  constructor(game) {
    this.game = game;
    this.camera = game.sceneManager.camera;
    this.yaw = Math.PI;
    this.pitch = 0.32;
    this.distance = 5.5;
    this.footDistance = 5.5;
    this.vehicleDistance = 8;
    this.mode = 'chase'; // chase | far | cockpit (vehicles); foot cams cycle near/normal/far
    this.footPreset = 1;
    this.target = new THREE.Vector3();
    this.smoothTarget = new THREE.Vector3();
    this.currentDist = 5.5;
    this.lookYawOffset = 0;
    this.lastManualLook = 0;
    this.shake = 0;
    this._tmp = new THREE.Vector3();
  }

  get sensitivity() {
    return 0.0024 * (this.game.settings.mouseSensitivity || 1);
  }

  cycle() {
    const v = this.game.player.vehicle;
    if (v) {
      const order = ['chase', 'far', 'cockpit'];
      this.mode = order[(order.indexOf(this.mode) + 1) % order.length];
      this.game.hud.toast(`Camera: ${{ chase: 'Chase', far: 'Far chase', cockpit: v.kind === 'car' ? 'Cockpit' : 'First person' }[this.mode]}`, 1200);
    } else {
      this.footPreset = (this.footPreset + 1) % 3;
      this.footDistance = [3.4, 5.5, 8.5][this.footPreset];
      this.game.hud.toast(`Camera: ${['Close', 'Normal', 'Far'][this.footPreset]}`, 1200);
    }
  }

  onEnterVehicle(v) {
    this.yaw = v.heading + Math.PI;
    this.vehicleDistance = v.kind === 'car' ? (v.spec.shape === 'suv' ? 8.5 : 7.5) : 5.2;
    if (this.mode === 'cockpit' && v.kind === 'bicycle') this.mode = 'chase';
  }

  onExitVehicle(v) {
    this.yaw = v.heading + Math.PI;
    this.game.player.h.head.visible = true;
  }

  snapBehind(yaw) {
    this.yaw = yaw;
    this.smoothTarget.copy(this.target);
  }

  update(dt) {
    const input = this.game.input;
    const look = input.consumeLook();
    const blocking = this.game.uiBlocking;
    const sens = this.sensitivity;
    const inv = this.game.settings.invertY ? -1 : 1;
    if (!blocking) {
      this.yaw -= look.dx * sens;
      this.pitch = clamp(this.pitch + look.dy * sens * inv, -0.35, 1.25);
      if (look.wheel) {
        if (this.game.player.vehicle) this.vehicleDistance = clamp(this.vehicleDistance + look.wheel * 0.8, 4, 16);
        else this.footDistance = clamp(this.footDistance + look.wheel * 0.6, 2.2, 12);
      }
      if (input.down('zoomIn')) this.footDistance = clamp(this.footDistance - dt * 4, 2.2, 12);
      if (input.down('zoomOut')) this.footDistance = clamp(this.footDistance + dt * 4, 2.2, 12);
      if (look.dx || look.dy) this.lastManualLook = performance.now();
    }

    const p = this.game.player;
    const v = p.vehicle;
    let desiredDist;
    if (v) {
      const he = v.halfExtents;
      this.target.set(v.x, he.y * 2 + (v.kind === 'car' ? 0.6 : 1.2), v.z);
      // auto-centre behind the vehicle when the player isn't steering the camera
      const idle = performance.now() - this.lastManualLook > 1400;
      if (idle && Math.abs(v.speed) > 1.5) {
        const behind = v.speed > -1 ? v.heading + Math.PI : v.heading;
        this.yaw = dampAngle(this.yaw, behind, 3.2, dt);
        this.pitch = damp(this.pitch, 0.22, 2, dt);
      }
      desiredDist = this.mode === 'far' ? this.vehicleDistance * 1.6 : this.vehicleDistance;
      if (this.mode === 'cockpit') return this._cockpit(v, dt);
    } else {
      const h = p.seat ? 1.1 : 1.55;
      this.target.set(p.pos.x, p.pos.y + h, p.pos.z);
      desiredDist = this.footDistance;
      // gentle auto-follow when walking forward with no mouse input (helps touch / drag users)
      const idle = performance.now() - this.lastManualLook > 2500;
      if (idle && p.speed > 2 && Math.abs(input.moveX) < 0.1 && input.moveY > 0.3) this.yaw = dampAngle(this.yaw, p.yaw + Math.PI, 0.8, dt);
    }
    p.h.head.visible = true;

    // smooth the follow point (vertical faster than horizontal)
    const lam = v ? 14 : 18;
    this.smoothTarget.x = damp(this.smoothTarget.x, this.target.x, lam, dt);
    this.smoothTarget.z = damp(this.smoothTarget.z, this.target.z, lam, dt);
    this.smoothTarget.y = damp(this.smoothTarget.y, this.target.y, 10, dt);
    if (this.smoothTarget.distanceToSquared(this.target) > 400) this.smoothTarget.copy(this.target);

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dir = this._tmp.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp).normalize();
    // collision: pull the camera in front of walls
    let dist = desiredDist;
    const hit = this.game.physics.raycastStatic(this.smoothTarget, dir, desiredDist + 0.3);
    if (hit !== null) dist = Math.max(0.8, hit - 0.35);
    this.currentDist = dist < this.currentDist ? dist : damp(this.currentDist, dist, 4, dt);
    const cam = this.camera;
    cam.position.copy(this.smoothTarget).addScaledVector(dir, this.currentDist);
    if (cam.position.y < 0.35) cam.position.y = 0.35;
    // speed feel: widen FOV a little at speed
    const fovTarget = v ? 65 + clamp(Math.abs(v.speed) - 10, 0, 40) * 0.35 : 62;
    cam.fov = damp(cam.fov, fovTarget, 3, dt);
    cam.updateProjectionMatrix();
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2);
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.3;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.3;
    }
    cam.lookAt(this.smoothTarget);
  }

  _cockpit(v, dt) {
    const p = this.game.player;
    const local = v.parts.cockpit.clone();
    v.mesh.updateMatrixWorld();
    const world = local.applyMatrix4(v.mesh.matrixWorld);
    const cam = this.camera;
    cam.position.copy(world);
    // look direction = vehicle heading + limited free look
    const rel = clamp(((this.yaw - (v.heading + Math.PI) + Math.PI * 3) % (Math.PI * 2)) - Math.PI, -1.6, 1.6);
    const idle = performance.now() - this.lastManualLook > 1200;
    if (idle) this.yaw = dampAngle(this.yaw, v.heading + Math.PI, 4, dt);
    const lookYaw = v.heading + rel;
    const pitch = clamp(this.pitch - 0.25, -0.5, 0.6);
    const f = new THREE.Vector3(Math.sin(lookYaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(lookYaw) * Math.cos(pitch));
    cam.fov = damp(cam.fov, 72, 3, dt);
    cam.updateProjectionMatrix();
    cam.lookAt(world.clone().add(f));
    if (v.kind === 'motorcycle' || v.kind === 'bicycle') cam.rotateZ(-v.lean * 0.6);
    p.h.head.visible = false;
    this.smoothTarget.set(v.x, 1.5, v.z);
  }
}
