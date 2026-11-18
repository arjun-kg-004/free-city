import * as THREE from 'three';

/**
 * Low-poly procedural humanoid (no external rig needed).
 * Part geometries are shared with the instanced NPC renderer so player and pedestrians match.
 * Each limb geometry is translated so its pivot (shoulder / hip) sits at the origin.
 */
export const BODY = {
  hipY: 0.92,
  torso: { w: 0.46, h: 0.62, d: 0.26 },
  shoulderY: 0.56, shoulderX: 0.31,
  hipX: 0.12,
  legLen: 0.9, armLen: 0.66,
  headY: 0.86, headR: 0.15,
};

export function createPartGeometries() {
  const torso = new THREE.BoxGeometry(BODY.torso.w, BODY.torso.h, BODY.torso.d);
  torso.translate(0, BODY.torso.h / 2 + 0.02, 0);
  const head = new THREE.SphereGeometry(BODY.headR, 10, 8);
  head.scale(0.9, 1.05, 0.95);
  const hair = new THREE.SphereGeometry(BODY.headR * 1.08, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
  hair.translate(0, 0.02, -0.012);
  const arm = new THREE.BoxGeometry(0.13, BODY.armLen, 0.14);
  arm.translate(0, -BODY.armLen / 2, 0);
  const leg = new THREE.BoxGeometry(0.17, BODY.legLen, 0.19);
  leg.translate(0, -BODY.legLen / 2, 0);
  const foot = new THREE.BoxGeometry(0.16, 0.08, 0.27);
  foot.translate(0, -BODY.legLen + 0.02, 0.05);
  // merge leg + shoe into one geometry so legs stay 1 draw call
  const legFull = mergeSimple([leg, foot]);
  return { torso, head, hair, arm, leg: legFull };
}

function mergeSimple(geos) {
  const pos = [], nrm = [], idx = [];
  let off = 0;
  for (const g of geos) {
    const gi = g.index ? g : g.toIndexed?.() || g;
    const p = gi.attributes.position.array, n = gi.attributes.normal.array;
    pos.push(...p); nrm.push(...n);
    for (const i of gi.index.array) idx.push(i + off);
    off += p.length / 3;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setIndex(idx);
  return out;
}

export const SKIN_TONES = ['#8d5524', '#a8693f', '#c68642', '#e0ac69', '#f1c27d', '#ffdbac', '#6b3e26', '#b07850'];
export const SHIRT_COLORS = ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#264653', '#ffffff', '#8338ec', '#ff006e', '#3a86ff', '#fb8500', '#606c38', '#9b2226', '#f1fa8c', '#1d3557', '#c9184a', '#06d6a0'];
export const PANTS_COLORS = ['#1d3557', '#343a40', '#6c584c', '#283618', '#495057', '#22223b', '#5e548e', '#a68a64', '#2b2d42'];
export const HAIR_COLORS = ['#1b1b1b', '#2b1b10', '#3b2414', '#5a3825', '#0f0f0f', '#7a6a58', '#b5651d', '#d9d9d9'];

let PARTS = null;
export function getParts() {
  return (PARTS ||= createPartGeometries());
}

/** Stand-alone humanoid (player, shopkeepers). Returns { root, parts, setPose(...) }. */
export function createHumanoid(colors = {}) {
  const P = getParts();
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 });
  const skin = mat(colors.skin || '#c68642');
  const shirt = mat(colors.shirt || '#3a86ff');
  const pants = mat(colors.pants || '#1d3557');
  const hairM = mat(colors.hair || '#1b1b1b');
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = BODY.hipY;
  root.add(hips);
  const torso = new THREE.Mesh(P.torso, shirt);
  hips.add(torso);
  const head = new THREE.Mesh(P.head, skin);
  head.position.y = BODY.headY;
  hips.add(head);
  const hair = new THREE.Mesh(P.hair, hairM);
  head.add(hair);
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-BODY.shoulderX, BODY.shoulderY, 0);
  armR.position.set(BODY.shoulderX, BODY.shoulderY, 0);
  armL.add(new THREE.Mesh(P.arm, shirt));
  armR.add(new THREE.Mesh(P.arm, shirt));
  // hands
  const handGeo = new THREE.SphereGeometry(0.07, 6, 5);
  for (const a of [armL, armR]) {
    const h = new THREE.Mesh(handGeo, skin);
    h.position.y = -BODY.armLen - 0.02;
    a.add(h);
  }
  hips.add(armL, armR);
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-BODY.hipX, 0, 0);
  legR.position.set(BODY.hipX, 0, 0);
  legL.add(new THREE.Mesh(P.leg, pants));
  legR.add(new THREE.Mesh(P.leg, pants));
  hips.add(legL, legR);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return { root, hips, torso, head, armL, armR, legL, legR };
}

/**
 * Computes limb angles for an animation state. Shared by the player and the instanced NPCs.
 * state: idle | walk | run | sit | talk | drive | ride | pedal | jump | wave
 */
export function poseFor(state, phase, out = {}) {
  out.hipY = BODY.hipY; out.lean = 0;
  out.armL = 0; out.armR = 0; out.legL = 0; out.legR = 0;
  out.armLz = 0; out.armRz = 0; out.headY = 0;
  const s = Math.sin(phase);
  switch (state) {
    case 'walk':
      out.armL = s * 0.55; out.armR = -s * 0.55; out.legL = -s * 0.6; out.legR = s * 0.6;
      out.hipY += Math.abs(Math.cos(phase)) * 0.04;
      break;
    case 'run':
      out.armL = s * 1.1 - 0.2; out.armR = -s * 1.1 - 0.2; out.legL = -s * 1.0; out.legR = s * 1.0;
      out.hipY += Math.abs(Math.cos(phase)) * 0.08; out.lean = 0.18;
      break;
    case 'jump':
      out.armL = 2.6; out.armR = 2.6; out.legL = 0.5; out.legR = -0.3; out.lean = 0.05;
      break;
    case 'sit':
      out.hipY = 0.5; out.legL = 1.45; out.legR = 1.45; out.armL = 0.35; out.armR = 0.35;
      break;
    case 'drive':
      out.hipY = 0.5; out.legL = 1.3; out.legR = 1.3; out.armL = 1.15; out.armR = 1.15; out.armLz = -0.15; out.armRz = 0.15;
      break;
    case 'ride':
      out.hipY = 0.86; out.legL = 1.0; out.legR = 1.0; out.armL = 1.15; out.armR = 1.15; out.lean = 0.35; out.armLz = -0.15; out.armRz = 0.15;
      break;
    case 'pedal':
      out.hipY = 0.98; out.legL = 0.9 + s * 0.55; out.legR = 0.9 - s * 0.55; out.armL = 1.0; out.armR = 1.0; out.lean = 0.3;
      break;
    case 'talk':
      out.armL = 0.25 + Math.sin(phase * 0.7) * 0.25; out.armR = 0.4 + Math.sin(phase * 1.1 + 1) * 0.35; out.headY = Math.sin(phase * 0.5) * 0.3;
      break;
    case 'wave':
      out.armR = 2.8 + Math.sin(phase * 3) * 0.3; out.armRz = 0.3;
      break;
    case 'flee':
      out.armL = s * 1.2 - 0.4; out.armR = -s * 1.2 - 0.4; out.legL = -s * 1.1; out.legR = s * 1.1; out.lean = 0.25;
      out.hipY += Math.abs(Math.cos(phase)) * 0.08;
      break;
    default: // idle
      out.armL = Math.sin(phase * 0.3) * 0.04; out.armR = -out.armL; out.hipY += Math.sin(phase * 0.6) * 0.008;
  }
  return out;
}

export function applyPose(h, pose) {
  h.hips.position.y = pose.hipY;
  h.hips.rotation.x = pose.lean;
  h.armL.rotation.x = -pose.armL;
  h.armR.rotation.x = -pose.armR;
  h.armL.rotation.z = -pose.armLz;
  h.armR.rotation.z = -pose.armRz;
  h.legL.rotation.x = -pose.legL;
  h.legR.rotation.x = -pose.legR;
  h.head.rotation.y = pose.headY;
}
