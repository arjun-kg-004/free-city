import * as THREE from 'three';

/**
 * Seated / riding / waving poses for rigged characters that only have idle-walk-run clips.
 * The idle clip keeps playing underneath (breathing, head motion); this layer lowers the hips
 * to the seat and aims each limb bone along a direction given in the character's own frame
 * (+z forward, +y up, +x to the character's left). Bone-axis agnostic, like PunchRig.
 */

// Limb directions per pose. Arrays are [left, right] when the sides differ.
const POSES = {
  sit: () => ({ hip: 'seat', lean: -0.06, thigh: [0, -0.06, 1], shin: [0, -1, 0.1], foot: [0, -0.4, 1], arm: [0, -0.8, 0.35], fore: [0, -0.45, 1], spread: 0.13 }),
  drive: () => ({ hip: 'seat', lean: -0.02, thigh: [0, -0.02, 1], shin: [0, -1, 0.3], foot: [0, -0.3, 1], arm: [0, -0.3, 1], fore: [0, 0.05, 1], spread: 0.16, hands: 0.19 }),
  ride: () => ({ hip: 'rider', lean: 0.35, thigh: [0, -0.55, 0.85], shin: [0, -1, -0.2], foot: [0, -0.3, 1], arm: [0, -0.4, 1], fore: [0, -0.15, 1], spread: 0.17, hands: 0.3 }),
  pedal: (ph) => {
    // left and right legs half a crank turn apart
    const leg = (s) => { const a = 0.9 + 0.55 * Math.sin(ph + s); return { thigh: [0, -Math.cos(a), Math.sin(a)], shin: [0, -1, 0.35 * Math.cos(ph + s) - 0.05] }; };
    const L = leg(0), R = leg(Math.PI);
    return { hip: 'rider', lean: 0.3, thigh: [L.thigh, R.thigh], shin: [L.shin, R.shin], foot: [0, -0.35, 1], arm: [0, -0.45, 1], fore: [0, -0.2, 1], spread: 0.11, hands: 0.25 };
  },
  wave: (ph) => ({ upperOnly: true, arm: [null, [-0.25, 0.95, 0.15]], fore: [null, [0.35 * Math.sin(ph * 3) - 0.1, 1, 0.1]] }),
};

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qr = new THREE.Quaternion();

export const hasBodyPose = (state) => !!POSES[state];

export class BodyPose {
  constructor(model) {
    const find = (re) => { let b = null; model.traverse((o) => { if (!b && o.isBone && re.test(o.name)) b = o; }); return b; };
    const side = (s) => ({
      upLeg: find(new RegExp(`${s}UpLeg$`, 'i')), leg: find(new RegExp(`${s}Leg$`, 'i')), foot: find(new RegExp(`${s}Foot$`, 'i')), toe: find(new RegExp(`${s}ToeBase$`, 'i')),
      arm: find(new RegExp(`${s}Arm$`, 'i')), fore: find(new RegExp(`${s}ForeArm$`, 'i')), hand: find(new RegExp(`${s}Hand$`, 'i')),
    });
    this.sides = [side('Left'), side('Right')];
    this.hips = find(/Hips$/i);
    this.spine = find(/Spine$/i);
    this.ok = !!(this.hips && this.sides.every((s) => s.upLeg && s.leg && s.foot && s.arm && s.fore && s.hand));
    this.saved = null;
  }

  restore() {
    if (!this.saved) return;
    for (const [b, q] of this.saved) b.quaternion.copy(q);
    this.saved = null;
  }

  /**
   * root: the character's frame (feet at origin, +z forward); model: the scaled rig under it.
   * opts.hipY: hip height above the feet for riding poses (in root units); opts.phase: pedalling / waving.
   */
  apply(state, root, model, baseY, opts = {}) {
    model.position.y = baseY;
    if (!this.ok || !POSES[state]) return;
    const P = POSES[state](opts.phase || 0);
    const S = this.sides;
    const touched = [this.spine, ...S.flatMap((s) => [s.upLeg, s.leg, s.foot, s.arm, s.fore])].filter(Boolean);
    this.saved = touched.map((b) => [b, b.quaternion.clone()]);
    root.updateWorldMatrix(true, true);
    root.getWorldQuaternion(_qr);
    const scale = root.getWorldScale(_a).y;
    if (!P.upperOnly) {
      // lower the hips: to the seat (thigh level = shin length) or to the vehicle's saddle height
      const rootY = root.getWorldPosition(_b).y;
      const hipNow = this.hips.getWorldPosition(_a).y - rootY;
      let hipWant;
      if (P.hip === 'seat') {
        const s = S[0];
        hipWant = s.leg.getWorldPosition(_a).distanceTo(s.foot.getWorldPosition(_b)) + (s.foot.getWorldPosition(_b).y - rootY); // shin + ankle height
      } else hipWant = (opts.hipY || 0.9) * scale;
      model.position.y = baseY - (hipNow - hipWant) / scale;
      root.updateWorldMatrix(false, true);
    }
    if (P.lean && this.spine) {
      _up.set(1, 0, 0).applyQuaternion(_qr); // character's left axis: positive = lean forward
      this._turn(this.spine, _q.setFromAxisAngle(_up, P.lean));
    }
    S.forEach((s, k) => {
      const pick = (v) => (v && v.length === 2 ? v[k] : v); // [left, right] pair vs one [x, y, z]
      const sx = k === 0 ? 1 : -1; // left side is +x
      if (!P.upperOnly) {
        const th = pick(P.thigh);
        this._aim(s.upLeg, s.leg, [th[0] + sx * (P.spread || 0), th[1], th[2]]);
        this._aim(s.leg, s.foot, pick(P.shin));
        if (s.toe) this._aim(s.foot, s.toe, pick(P.foot));
      }
      const arm = pick(P.arm), fore = pick(P.fore);
      if (arm) this._aim(s.arm, s.fore, [arm[0] + sx * (P.hands || 0), arm[1], arm[2]]);
      if (fore) this._aim(s.fore, s.hand, [fore[0] - sx * (P.hands ? 0.12 : 0), fore[1], fore[2]]);
    });
  }

  /** Turn `bone` so that the bone → child direction points along `dir` (character frame). */
  _aim(bone, child, dir) {
    bone.getWorldPosition(_a);
    child.getWorldPosition(_b);
    _b.sub(_a).normalize();
    _d.set(dir[0], dir[1], dir[2]).normalize().applyQuaternion(_qr);
    this._turn(bone, _q.setFromUnitVectors(_b, _d));
  }

  _turn(bone, q) {
    bone.getWorldQuaternion(_qw).premultiply(q);
    bone.parent.getWorldQuaternion(_qp);
    bone.quaternion.copy(_qp.invert().multiply(_qw));
    bone.updateWorldMatrix(false, true);
  }
}
