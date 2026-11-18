import * as THREE from 'three';
import { COLLISION } from '../config.js';
import { createHumanoid, poseFor, applyPose } from '../world/Humanoid.js';
import { AnimatedCharacter, CharacterTemplate, applyPlayerLook } from '../world/AnimatedCharacter.js';
import { PunchRig, punchWeight } from '../world/PunchPose.js';

/** The player's body: humanoid mesh + kinematic capsule in the physics world. */
export class Player {
  constructor(physics, scene, assets) {
    this.physics = physics;
    this.scene = scene;
    this.h = createHumanoid({ skin: '#b98152', shirt: '#ff6b35', pants: '#2b2d42', hair: '#1b1b1b' });
    this.mesh = this.h.root;
    // Realistic rigged character with motion-capture clips (when a model is provided)
    this.skinned = null;
    if (assets && assets.characters.player) {
      const tpl = new CharacterTemplate(assets.characters.player, assets.clips);
      if (tpl.clips.idle && tpl.clips.walk) {
        this.skinned = new AnimatedCharacter(tpl);
        applyPlayerLook(this.skinned.model);
        this.punchRig = new PunchRig(this.skinned.model);
        this.mesh.add(this.skinned.root);
        this.h.hips.visible = false;
      }
    }
    scene.add(this.mesh);
    // A small backpack makes the player easy to spot in crowds
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.38, 0.16), new THREE.MeshStandardMaterial({ color: 0x1f6feb, roughness: 0.8 }));
    pack.position.set(0, 0.36, -0.2);
    pack.castShadow = true;
    this.h.torso.add(pack);

    this.radius = 0.32;
    this.halfHeight = 0.58;
    this.centerY = this.halfHeight + this.radius; // capsule centre above feet
    const desc = physics.RAPIER.ColliderDesc.capsule(this.halfHeight, this.radius);
    const k = physics.createKinematic(0, this.centerY, 0, desc, COLLISION.PLAYER, COLLISION.STATIC | COLLISION.VEHICLE | COLLISION.TRAFFIC);
    this.body = k.body;
    this.collider = k.collider;
    this.cc = physics.createController(0.04);
    this.cc.enableAutostep(0.45, 0.25, false);
    this.cc.enableSnapToGround(0.35);
    this.cc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.cc.setSlideEnabled(true);

    this.pos = new THREE.Vector3(0, 0, 0);
    this.yaw = 0;
    this.vy = 0;
    this.grounded = true;
    this.speed = 0;
    this.phase = 0;
    this.anim = 'idle';
    this.pose = {};
    this.stamina = 100;
    this.boostTime = 0; // food/coffee buff: sprint without draining stamina
    this.punchT = 0;    // time left in the current punch
    this.punchSide = 0; // 0 right hand / leg, 1 left (alternates)
    this.attackKind = 'punch'; // 'punch' | 'kick' (combo: punch, punch, kick, kick)
    this.health = 100;  // street fights; regenerates slowly
    this.vehicle = null;
    this.seat = null;    // bench / chair while sitting
    this.interior = null;
  }

  setPosition(x, y, z) {
    this.pos.set(x, y, z);
    this.body.setTranslation({ x, y: y + this.centerY, z }, true);
    this.body.setNextKinematicTranslation({ x, y: y + this.centerY, z });
    this.vy = 0;
    this.mesh.position.copy(this.pos);
  }

  /** Move by a desired horizontal delta, applying gravity and collisions. */
  move(dx, dz, dt, jump) {
    if (this.grounded && jump) this.vy = 5.2;
    this.vy -= 18 * dt;
    if (this.vy < -30) this.vy = -30;
    const desired = { x: dx, y: this.vy * dt, z: dz };
    this.cc.computeColliderMovement(this.collider, desired, undefined, undefined, (c) => c.handle !== this.collider.handle);
    const m = this.cc.computedMovement();
    this.grounded = this.cc.computedGrounded();
    if (this.grounded && this.vy < 0) this.vy = 0;
    const t = this.body.translation();
    let nx = t.x + m.x, ny = t.y + m.y, nz = t.z + m.z;
    // never fall below the ground plane (safety net)
    if (ny < this.centerY - 0.05) { ny = this.centerY; this.vy = 0; this.grounded = true; }
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    this.pos.set(nx, ny - this.centerY, nz);
    return Math.hypot(m.x, m.z) / Math.max(dt, 1e-4);
  }

  setCollisionEnabled(on) {
    this.collider.setEnabled(on);
  }

  animate(dt) {
    const rate = this.anim === 'run' ? 9.5 : this.anim === 'walk' ? 6.8 : this.anim === 'pedal' ? 0 : 2;
    if (this.anim === 'pedal' && this.vehicle) this.phase = this.vehicle.crankAngle;
    else this.phase += dt * rate * (this.anim === 'walk' || this.anim === 'run' ? Math.max(0.6, this.speed / (this.anim === 'run' ? 6 : 2.2)) : 1);
    // Mocap clip when the rigged model has one for this state, otherwise the procedural body
    if (this.skinned) {
      this.punchRig.restore(); // undo last frame's punch overlay before the mixer runs
      this.skinned.root.position.z = 0;
      const useClip = this.skinned.has(this.anim);
      const state = this.anim === 'run' && this.speed > 6.2 ? 'sprint' : this.anim;
      if (useClip) this.skinned.setState(state, this.speed);
      else if (this.anim === 'jump') this.skinned.setState(this.speed > 3 ? 'run' : 'idle', this.speed);
      const showSkinned = useClip || this.anim === 'jump';
      this.skinned.visible = showSkinned;
      this.h.hips.visible = !showSkinned;
      const v = this.vehicle;
      this.skinned.poseOpts.phase = this.phase;
      this.skinned.poseOpts.hipY = v ? (v.kind === 'car' ? 0.5 / (v.parts.riderScale || 1) : v.parts.riderHipY || 0.9) : 0.9;
      this.skinned.update(dt);
      if (showSkinned) { this._punchSkinned(); return; }
    }
    poseFor(this.anim, this.phase, this.pose);
    const w = this.punchWeight;
    if (w > 0) {
      const limb = (this.attackKind === 'kick' ? 'leg' : 'arm') + (this.punchSide ? 'L' : 'R');
      this.pose[limb] = Math.max(this.pose[limb], (this.attackKind === 'kick' ? 1.4 : 1.55) * w);
    }
    if (this.vehicle && this.vehicle.parts.riderHipY) this.pose.hipY = this.vehicle.parts.riderHipY;
    if (this.vehicle && this.vehicle.kind === 'car') this.pose.hipY = 0.5 / (this.vehicle.parts.riderScale || 1);
    applyPose(this.h, this.pose);
  }

  get punchWeight() {
    return punchWeight(this.punchT, this.attackKind, this.attackDur);
  }

  /** Layer the punch / kick over the mocap clip, with a small lunge forward on punches. */
  _punchSkinned() {
    if (this.attackClip) return; // the motion-captured move is playing instead
    const w = this.punchWeight;
    if (w <= 0) return;
    if (this.attackKind === 'punch') this.skinned.root.position.z = 0.14 * w;
    this.syncMesh();
    this.punchRig.apply(this.mesh, this.pos.x, this.pos.y, this.pos.z, this.yaw, this.punchSide, w, this.attackKind);
  }

  syncMesh() {
    if (this.vehicle) return;
    this.mesh.position.copy(this.pos);
    if (this.seat) this.mesh.position.y = this.seat.y || 0;
    this.mesh.rotation.set(0, this.yaw, 0);
  }
}
