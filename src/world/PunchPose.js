import * as THREE from 'three';

export const PUNCH_TIME = 0.42; // seconds per punch (wind-up, hit, recover)
export const KICK_TIME = 0.6;   // seconds per kick
export const attackTime = (kind) => (kind === 'kick' ? KICK_TIME : PUNCH_TIME);
/** Fraction of the move at which it connects (the fist / foot is fully out). */
export const IMPACT = { punch: 0.32, kick: 0.4 };

/**
 * Motion-captured attacks (clips from the fight-*.glb packs), played at game speed. `impact` is the
 * fraction of the move where the fist / foot is furthest out; CharacterTemplate measures it from
 * the clip when it loads. Without the clips the procedural PunchRig is used with IMPACT timing.
 */
export const ATTACKS = {
  punch_jab: { kind: 'punch', time: 0.55, impact: 0.45 },
  punch_cross: { kind: 'punch', time: 0.6, impact: 0.45 },
  kick: { kind: 'kick', time: 0.85, impact: 0.5 },
};
/** Every fighter's combo: jab, cross, kick, kick. */
export const COMBO = ['punch_jab', 'punch_cross', 'kick', 'kick'];
/** Reactions: [clip, seconds]. */
export const REACT = { hit: [['hit_chest', 0.45], ['hit_head', 0.5]], knockdown: ['knockdown_c', 0.9], getup: ['getup', 1.3] };

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _t = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _id = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/** 0..1 limb extension for an attack with `left` seconds to go: quick strike out, slower pull back. */
export function punchWeight(left, kind = 'punch', total = attackTime(kind)) {
  if (left <= 0) return 0;
  const t = 1 - left / total, p = IMPACT[kind];
  const w = t < p ? t / p : 1 - (t - p) / (1 - p);
  return w * w * (3 - 2 * w);
}

/**
 * Punches and kicks layered over a rigged character's mocap clip. Punch: twist the chest and aim
 * the upper arm and forearm at a point in front of the shoulders. Kick: lean back and swing the
 * straight leg up at a point in front of the stomach. Works on any Mixamo-style rig (world-space aim,
 * no assumptions about bone axes). Call restore() before the next mixer update, because the
 * mixer only rewrites bones whose clip value changed.
 */
export class PunchRig {
  constructor(model) {
    const find = (re) => { let b = null; model.traverse((o) => { if (!b && o.isBone && re.test(o.name)) b = o; }); return b; };
    const side = (s) => ({ arm: find(new RegExp(`${s}Arm$`, 'i')), fore: find(new RegExp(`${s}ForeArm$`, 'i')), hand: find(new RegExp(`${s}Hand$`, 'i')) });
    this.arms = [side('Right'), side('Left')].map((a) => (a.arm && a.fore && a.hand ? a : null));
    this.spine = find(/Spine2$/i) || find(/Spine1$/i) || find(/Spine$/i);
    this.lowSpine = find(/Spine$/i) || this.spine;
    const leg = (s) => ({ up: find(new RegExp(`${s}UpLeg$`, 'i')), leg: find(new RegExp(`${s}Leg$`, 'i')), foot: find(new RegExp(`${s}Foot$`, 'i')), toe: find(new RegExp(`${s}ToeBase$`, 'i')) });
    this.legs = [leg('Right'), leg('Left')].map((l) => (l.up && l.leg && l.foot ? l : null));
    this.saved = null;
  }

  restore() {
    if (!this.saved) return;
    for (const [b, q] of this.saved) b.quaternion.copy(q);
    this.saved = null;
  }

  /** root: the object placed at the feet and turned by yaw. side 0 = right, 1 = left. */
  apply(root, x, y, z, yaw, side, w, kind = 'punch') {
    if (kind === 'kick') { this._kick(root, x, y, z, yaw, side, w); return; }
    const a = this.arms[side];
    if (!a || w <= 0) return;
    const bones = [a.arm, a.fore];
    if (this.spine) bones.push(this.spine);
    this.saved = bones.map((b) => [b, b.quaternion.clone()]);
    root.updateWorldMatrix(true, true);
    // twist the chest so the punching shoulder comes forward
    if (this.spine) {
      _q.setFromAxisAngle(_up, (side ? -0.5 : 0.5) * w);
      this._turn(this.spine, _q);
    }
    // target: straight ahead at shoulder height, slightly towards the centre line
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const sx = side ? 0.08 : -0.08;
    _t.set(x + fx * 0.85 + fz * sx, y + 1.42, z + fz * 0.85 - fx * sx);
    this._aim(a.arm, a.fore, w);
    this._aim(a.fore, a.hand, w);
  }

  _kick(root, x, y, z, yaw, side, w) {
    const l = this.legs[side];
    if (!l || w <= 0) return;
    const bones = [l.up, l.leg, l.foot];
    if (this.lowSpine) bones.push(this.lowSpine);
    this.saved = bones.map((b) => [b, b.quaternion.clone()]);
    root.updateWorldMatrix(true, true);
    // lean the upper body back for balance (rotation about the character's left axis)
    if (this.lowSpine) {
      _a.set(Math.cos(yaw), 0, -Math.sin(yaw));
      this._turn(this.lowSpine, _q.setFromAxisAngle(_a, -0.3 * w));
    }
    // target: in front of the opponent's stomach
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const sx = side ? 0.12 : -0.12;
    _t.set(x + fx * 1.15 + fz * sx, y + 1.0, z + fz * 1.15 - fx * sx);
    this._aim(l.up, l.leg, w);
    this._aim(l.leg, l.foot, w);
    if (l.toe) { _t.addScaledVector(_a.set(fx, 0, fz), 0.6); this._aim(l.foot, l.toe, w * 0.8); }
  }

  _aim(bone, child, w) {
    bone.getWorldPosition(_a);
    child.getWorldPosition(_b);
    _b.sub(_a).normalize();
    _a.subVectors(_t, _a).normalize();
    _qp.setFromUnitVectors(_b, _a); // full world-space correction
    this._turn(bone, _q.copy(_id).slerp(_qp, w));
  }

  /** Apply a world-space rotation to a bone. */
  _turn(bone, q) {
    bone.getWorldQuaternion(_qw).premultiply(q);
    bone.parent.getWorldQuaternion(_qp);
    bone.quaternion.copy(_qp.invert().multiply(_qw));
    bone.updateWorldMatrix(false, true);
  }
}
