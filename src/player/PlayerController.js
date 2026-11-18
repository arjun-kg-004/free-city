import { dampAngle } from '../utils/Random.js';
import { ATTACKS, COMBO, IMPACT, REACT } from '../world/PunchPose.js';

/** Turns input into player motion: walking, sprinting, jumping, sitting and riding vehicles. */
export class PlayerController {
  constructor(game, player) {
    this.game = game;
    this.player = player;
    this.walkSpeed = 2.3;
    this.runSpeed = 5.2;
    this.sprintSpeed = 7.6;
    this.footTimer = 0;
    this.punchLanded = false;
    this.combo = 0;        // next move in the punch, punch, kick, kick combo
    this.sinceAttack = 9;  // seconds since the last attack (a pause resets the combo)
  }

  get mode() {
    const p = this.player;
    if (p.vehicle) return p.vehicle.kind;
    if (p.seat) return 'sit';
    return 'foot';
  }

  update(dt) {
    const p = this.player;
    const input = this.game.input;
    // health comes back slowly once you stop getting hit
    p.hurtTime = (p.hurtTime || 0) + dt;
    if (p.hurtTime > 5) p.health = Math.min(100, p.health + dt * 6);
    if (p.vehicle) return this._riding(dt);
    if (p.seat) {
      p.anim = 'sit';
      p.speed = 0;
      if (!this.game.uiBlocking && (Math.abs(input.moveX) + Math.abs(input.moveY) > 0.5 || input.justPressed('jump'))) this.standUp();
      p.animate(dt);
      p.syncMesh();
      return;
    }
    // On foot — movement is relative to the camera
    const cam = this.game.cameraManager;
    const yaw = cam.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let mx = fx * input.moveY + rx * input.moveX;
    let mz = fz * input.moveY + rz * input.moveX;
    const mag = Math.hypot(mx, mz);
    const disabled = this.game.uiBlocking;
    let speed = 0;
    if (mag > 0.05 && !disabled) {
      mx /= mag; mz /= mag;
      const wantSprint = input.down('sprint');
      const canSprint = p.stamina > 1 || p.boostTime > 0;
      speed = wantSprint && canSprint ? this.sprintSpeed : this.runSpeed;
      if (this.game.input.touch.active && mag < 0.6) speed = this.walkSpeed;
      if (input.down('sprint') && p.boostTime <= 0 && speed === this.sprintSpeed) p.stamina = Math.max(0, p.stamina - dt * 14);
      p.yaw = dampAngle(p.yaw, Math.atan2(mx, mz), 12, dt);
    }
    this.sinceAttack += dt;
    // a click during a move is remembered and chains into the next move of the combo
    if (!disabled && input.justPressed('attack')) this.queued = true;
    if (p.punchT > 0) this._updatePunch(dt);
    if (this.queued && p.punchT <= 0) { this.queued = false; if (!disabled && p.grounded) this._startPunch(); }
    if (p.punchT > 0) speed = p.attackClip || p.attackKind === 'kick' ? 0 : Math.min(speed, this.walkSpeed); // plant the feet to strike
    if (speed !== this.sprintSpeed) p.stamina = Math.min(100, p.stamina + dt * 9);
    if (p.boostTime > 0) p.boostTime -= dt;
    const jump = !disabled && input.justPressed('jump');
    const lx = this.lungeX || 0, lz = this.lungeZ || 0;
    this.lungeX = this.lungeZ = 0;
    const moved = p.move(mx * speed * dt * (mag > 0.05 ? 1 : 0) + lx, mz * speed * dt * (mag > 0.05 ? 1 : 0) + lz, dt, jump);
    const actual = lx || lz ? Math.max(0, moved - Math.hypot(lx, lz) / dt) : moved; // a lunge is not running
    p.speed = actual;
    if (!p.grounded) p.anim = 'jump';
    else if (actual > 5.8) p.anim = 'run';
    else if (actual > 3.2) p.anim = 'run';
    else if (actual > 0.4) p.anim = 'walk';
    else p.anim = this.sinceAttack < 3 || p.hurtTime < 3 ? 'fight' : 'idle'; // guard up after a fight
    // footsteps
    if (p.grounded && actual > 0.5) {
      this.footTimer -= dt * actual * (p.anim === 'run' ? 0.42 : 0.6);
      if (this.footTimer <= 0) { this.footTimer = 1; this.game.audio.footstep(this.game.layout.districtAt(p.pos.x, p.pos.z) === 'BEACH'); }
    }
    p.animate(dt);
    p.syncMesh();
  }

  _startPunch() {
    const p = this.player;
    // turn toward the closest person within reach
    let best = null, bd = 2.6;
    for (const n of this.game.npcManager.queryNear(p.pos.x, p.pos.z, bd)) {
      if (n.state === 'down') continue;
      const d = Math.hypot(n.x - p.pos.x, n.z - p.pos.z);
      if (d < bd) { bd = d; best = n; }
    }
    if (best) {
      p.yaw = Math.atan2(best.x - p.pos.x, best.z - p.pos.z);
      // close the gap a little so the combo keeps connecting as they stagger back
      if (bd > 1.3) { const step = Math.min(0.5, bd - 1.2); this.lungeX = Math.sin(p.yaw) * step; this.lungeZ = Math.cos(p.yaw) * step; }
    }
    // combo: jab, cross, kick, kick; a 1.4 s pause starts over
    if (this.sinceAttack > 1.4) this.combo = 0;
    const name = COMBO[this.combo], A = ATTACKS[name];
    p.attackKind = A.kind;
    p.punchSide = this.combo % 2;
    this.combo = (this.combo + 1) % 4;
    this.sinceAttack = 0;
    p.attackDur = p.punchT = A.time;
    // motion-captured move when the avatar has it, else the procedural arm / leg swing
    p.attackClip = p.skinned && p.skinned.hasClip(name) ? name : null;
    if (p.attackClip) p.skinned.play(name, { duration: A.time });
    p.impactAt = A.time * (p.attackClip ? A.impact : IMPACT[A.kind]);
    this.punchLanded = false;
    this.game.audio.swing();
  }

  _updatePunch(dt) {
    const p = this.player;
    p.punchT = Math.max(0, p.punchT - dt);
    if (p.punchT === 0) p.attackClip = null;
    // the fist / foot connects when it is fully out
    const kick = p.attackKind === 'kick';
    if (this.punchLanded || p.attackDur - p.punchT < p.impactAt) return;
    this.punchLanded = true;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    for (const n of this.game.npcManager.queryNear(p.pos.x, p.pos.z, kick ? 2.2 : 1.9)) {
      if (n.state === 'down') continue; // no kicking people when they're down
      const dx = n.x - p.pos.x, dz = n.z - p.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      if ((dx * fx + dz * fz) / d < 0.35) continue; // not in front
      this.game.npcManager.hit(n, p.pos.x, p.pos.z, p.attackKind);
      if (kick) this.game.audio.kick(); else this.game.audio.punch();
      this.game.cameraManager.shake = Math.max(this.game.cameraManager.shake, kick ? 0.4 : 0.25);
      return;
    }
    this.game.npcManager.missed(p.pos.x + fx, p.pos.z + fz);
  }

  /** Hit by a pedestrian who fights back: lose health, stagger back, get knocked out at zero. */
  takeHit(dmg, fromX, fromZ, kick = false) {
    const p = this.player, g = this.game;
    if (p.vehicle || p.interior) return;
    if (p.seat) this.standUp();
    p.health = Math.max(0, p.health - dmg);
    p.hurtTime = 0;
    if (kick) g.audio.kick(); else g.audio.punch();
    g.cameraManager.shake = Math.max(g.cameraManager.shake, kick ? 0.6 : 0.45);
    // flinch: a hit reaction interrupts whatever move you were making
    const [clip, secs] = REACT.hit[Math.random() < 0.5 ? 0 : 1];
    if (p.skinned && p.skinned.hasClip(clip)) { p.punchT = 0; p.attackClip = null; p.skinned.play(clip, { duration: secs }); }
    const dx = p.pos.x - fromX, dz = p.pos.z - fromZ, l = Math.hypot(dx, dz) || 1;
    p.move((dx / l) * 0.35, (dz / l) * 0.35, 1 / 60, false);
    if (p.health <= 0) {
      p.health = 100;
      p.punchT = 0;
      g.npcManager.endFights();
      g.respawn();
      g.hud.toast('You got knocked out! You wake up at the City Centre.', 3500);
    }
  }

  _riding(dt) {
    const p = this.player;
    const v = p.vehicle;
    p.anim = v.parts.riderPose;
    p.speed = Math.abs(v.speed);
    p.animate(dt);
    p.pos.set(v.x, 0, v.z);
    // keep the capsule near the vehicle so exiting is seamless
    p.body.setNextKinematicTranslation({ x: v.x, y: p.centerY, z: v.z });
  }

  sit(seat) {
    const p = this.player;
    if (seat.occupied) return false;
    seat.occupied = true;
    p.seat = seat;
    p.setPosition(seat.x, 0, seat.z);
    p.yaw = seat.rot;
    p.seat.y = seat.y || 0;
    this.game.hud.toast('Sitting — move or press E to stand up', 2500);
    return true;
  }

  standUp() {
    const p = this.player;
    if (!p.seat) return;
    const s = p.seat;
    s.occupied = false;
    p.seat = null;
    // step forward off the bench
    const nx = s.x + Math.sin(s.rot) * 0.8, nz = s.z + Math.cos(s.rot) * 0.8;
    p.setPosition(nx, 0, nz);
  }

  enterVehicle(v) {
    const p = this.player;
    if (p.vehicle || v.driven) return;
    p.vehicle = v;
    v.driven = true;
    p.setCollisionEnabled(false);
    v.mesh.add(p.mesh);
    p.mesh.position.copy(v.parts.seat);
    p.mesh.rotation.set(0, 0, 0);
    if (v.parts.body) {
      // ride with the leaning body on two-wheelers
      v.parts.body.add(p.mesh);
    }
    p.mesh.scale.setScalar(v.parts.riderScale || 1);
    p.mesh.visible = !v.parts.hideRider; // inside a detailed car model the driver is hidden
    this.game.audio.vehicleEnter(v);
    this.game.cameraManager.onEnterVehicle(v);
    this.game.events.emit('vehicleEnter', v);
  }

  exitVehicle(force = false) {
    const p = this.player;
    const v = p.vehicle;
    if (!v) return true;
    if (!force && Math.abs(v.speed) > 6) {
      this.game.hud.toast('Slow down before getting off!', 1500);
      return false;
    }
    // try left, right, behind, front
    const cs = Math.cos(v.heading), sn = Math.sin(v.heading);
    const side = v.parts.exitSide;
    const he = v.halfExtents;
    const candidates = [
      [side.x, side.z], [-side.x, side.z], [0, -he.z - 1.2], [0, he.z + 1.2], [side.x * 1.8, 0], [-side.x * 1.8, 0],
    ];
    let spot = null;
    for (const [lx, lz] of candidates) {
      const wx = v.x + lx * cs + lz * sn;
      const wz = v.z - lx * sn + lz * cs;
      if (!this.game.physics.boxBlocked(wx, 0.95, wz, 0.3, 0.75, 0.3, 0, v.collider)) { spot = [wx, wz]; break; }
    }
    if (!spot && !force) {
      this.game.hud.toast('No room to get out here', 1500);
      return false;
    }
    if (!spot) spot = [v.x, v.z];
    v.driven = false;
    v.throttle = 0;
    p.mesh.parent && p.mesh.parent.remove(p.mesh);
    p.mesh.scale.setScalar(1);
    p.mesh.visible = true;
    this.game.scene.add(p.mesh);
    p.vehicle = null;
    p.h.head.visible = true;
    p.setCollisionEnabled(true);
    p.setPosition(spot[0], 0, spot[1]);
    p.yaw = v.heading;
    p.anim = 'idle';
    this.game.audio.vehicleExit(v);
    this.game.cameraManager.onExitVehicle(v);
    this.game.events.emit('vehicleExit', v);
    return true;
  }
}
