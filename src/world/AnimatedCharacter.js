import * as THREE from 'three';
import { clone as cloneSkinned, retargetClip } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BodyPose, hasBodyPose } from './BodyPose.js';
import { ATTACKS } from './PunchPose.js';

/** Which clip names count as which game state (Mixamo-style names work out of the box). */
const STATE_PATTERNS = {
  idle: [/^idle$/i, /idle/i, /breath/i, /stand/i],
  walk: [/^walk$/i, /walk/i],
  run: [/^run$/i, /run/i, /jog/i],
  sprint: [/sprint/i, /fast.?run/i],
  jump: [/jump/i],
  sit: [/sit/i],
  drive: [/driv/i, /car/i],
  ride: [/ride/i, /motor/i],
  pedal: [/cycl/i, /pedal/i, /bicycl/i],
  talk: [/talk/i, /convers/i, /chat/i],
  wave: [/wave/i],
  flee: [/scared/i, /flee/i, /panic/i],
  fight: [/^fight_idle$/i],
};
// States without their own clip fall back along these chains (null = no realistic clip available).
const FALLBACK = {
  sprint: 'run', flee: 'run', jump: null, talk: 'idle', wave: 'idle', fight: 'idle',
  sit: null, drive: null, ride: null, pedal: null,
};
// Native ground speed of typical mocap clips (m/s) — used to sync feet with movement.
const NATIVE_SPEED = { walk: 1.35, run: 3.9, sprint: 6.0, flee: 3.9 };

/**
 * Prepared, normalised character model (1.8 m tall, feet at y = 0, facing +Z) + its clip table.
 * Clips may come from any file that uses the same skeleton (e.g. every Mixamo download).
 */
export class CharacterTemplate {
  constructor(gltf, sharedClips = []) {
    this.scene = gltf.scene;
    this.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.scene, true);
    const h = Math.max(0.1, box.max.y - box.min.y);
    this.scale = 1.8 / h;
    this.yOffset = -box.min.y * this.scale;
    const boneNames = new Set();
    this.scene.traverse((o) => { if (o.isBone) boneNames.add(o.name); });
    // Facing: the game expects +Z forward. For a character facing +Z its LEFT side is at +X.
    this.faceFlip = false;
    const find = (re) => { let b = null; this.scene.traverse((o) => { if (!b && o.isBone && re.test(o.name)) b = o; }); return b; };
    const L = find(/left.?(shoulder|arm|upleg|up_leg|thigh)/i), R = find(/right.?(shoulder|arm|upleg|up_leg|thigh)/i);
    if (L && R) {
      const lp = new THREE.Vector3(), rp = new THREE.Vector3();
      L.getWorldPosition(lp); R.getWorldPosition(rp);
      const dx = lp.x - rp.x, dz = lp.z - rp.z;
      if (Math.abs(dx) >= Math.abs(dz)) this.faceFlip = dx < 0;
    }
    const all = [...(gltf.animations || []), ...sharedClips];
    // keep clips whose tracks target bones this skeleton actually has; clips from a Mixamo rig are
    // retargeted onto same-layout rigs that just name bones without the "mixamorig" prefix (Ready Player Me etc.)
    const usable = [];
    for (const c of all) {
      if (c.tracks.some((t) => boneNames.has(t.name.split('.')[0]))) { usable.push(c); continue; }
      const r = retargetAligned(c, this.scene, boneNames) || retargetWorld(c, this.scene, boneNames) || retarget(c, boneNames);
      if (r) usable.push(r);
    }
    this.clips = {};
    for (const [state, pats] of Object.entries(STATE_PATTERNS)) {
      for (const p of pats) {
        const clip = usable.find((c) => p.test(c.name) && !/tpose|t-pose/i.test(c.name));
        if (clip) { this.clips[state] = inPlace(clip); break; }
      }
    }
    // every clip by name, for one-shots (punches, kicks, hit reactions, falling, getting up)
    this.named = {};
    for (const c of usable) if (!this.named[c.name]) this.named[c.name] = inPlace(c);
    // The facing that matters is the ANIMATED one: a retargeted clip can turn the hips around
    // (source rig facing -Z), so measure it with the walk/idle clip applied.
    const probe = this.clips.walk || this.clips.idle;
    if (probe && L && R) {
      const mixer = new THREE.AnimationMixer(this.scene);
      mixer.clipAction(probe).play();
      mixer.update(0.05);
      this.scene.updateMatrixWorld(true);
      const lp = new THREE.Vector3(), rp = new THREE.Vector3();
      L.getWorldPosition(lp); R.getWorldPosition(rp);
      const fz = lp.x - rp.x; // facing = cross(L - R, up) -> z component = (L - R).x
      if (Math.abs(fz) > 1e-4) this.faceFlip = fz < 0;
      mixer.stopAllAction();
      mixer.uncacheRoot(this.scene);
      this.scene.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.pose(); });
      this.scene.updateMatrixWorld(true);
    }
    this._measureImpacts(find);
  }

  /** When does each attack connect? The moment the fist / foot is furthest in front of the hips. */
  _measureImpacts(find) {
    const hips = find(/hips|pelvis/i);
    const ends = { punch: [find(/RightHand$/i), find(/LeftHand$/i)], kick: [find(/RightFoot$/i), find(/LeftFoot$/i)] };
    if (!hips) return;
    const fwd = this.faceFlip ? -1 : 1, a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const [name, A] of Object.entries(ATTACKS)) {
      const clip = this.named[name], bones = ends[A.kind].filter(Boolean);
      if (!clip || !bones.length) continue;
      const mixer = new THREE.AnimationMixer(this.scene);
      mixer.clipAction(clip).play();
      let best = -Infinity, at = A.impact;
      for (let k = 0; k <= 40; k++) {
        mixer.setTime((k / 40) * clip.duration);
        this.scene.updateMatrixWorld(true);
        hips.getWorldPosition(a);
        for (const bone of bones) {
          const reach = (bone.getWorldPosition(b).z - a.z) * fwd;
          if (reach > best) { best = reach; at = k / 40; }
        }
      }
      A.impact = THREE.MathUtils.clamp(at, 0.15, 0.85);
      mixer.stopAllAction();
      mixer.uncacheRoot(this.scene);
    }
    this.scene.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.pose(); });
    this.scene.updateMatrixWorld(true);
  }

  clipFor(state) {
    let s = state;
    for (let i = 0; i < 3 && s; i++) {
      if (this.clips[s]) return s;
      s = FALLBACK[s] ?? null;
    }
    return null;
  }
}

const firstSkinned = (root) => { let m = null; root.traverse((o) => { if (o.isSkinnedMesh && (!m || o.skeleton.bones.length > m.skeleton.bones.length)) m = o; }); return m; };

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _va = new THREE.Vector3(), _vb = new THREE.Vector3();

/** Mixamo / Ready Player Me bone name -> Unreal-mannequin style name (Quaternius / Mesh2Motion rigs). */
function unrealName(n) {
  const fixed = { Hips: 'pelvis', Spine: 'spine_01', Spine1: 'spine_02', Spine2: 'spine_03', Neck: 'neck_01', Head: 'head' };
  if (fixed[n]) return fixed[n];
  const m = n.match(/^(Left|Right)(.+)$/);
  if (!m) return null;
  const s = m[1] === 'Left' ? 'l' : 'r', part = m[2];
  const limb = { Shoulder: 'clavicle', Arm: 'upperarm', ForeArm: 'lowerarm', Hand: 'hand', UpLeg: 'thigh', Leg: 'calf', Foot: 'foot', ToeBase: 'ball' }[part];
  if (limb) return `${limb}_${s}`;
  const f = part.match(/^Hand(Thumb|Index|Middle|Ring|Pinky)([1-3])$/);
  return f ? `${f[1].toLowerCase()}_0${f[2]}_${s}` : null;
}

/**
 * Retarget that copes with rigs whose bones use different local axes (e.g. a Blender-exported
 * Mixamo rig on Ready Player Me) as well as different rest poses (T vs A). Per bone, a constant
 * correction maps the source bone's world rotation onto the target bone: target rest rotation,
 * first turned so the bone points the way the source bone points at rest. The clip is then sampled
 * on the source rig and rebuilt as local quaternion tracks for the target.
 */
function retargetAligned(clip, targetScene, boneNames) {
  const srcScene = clip.userData && clip.userData.sourceScene;
  if (!srcScene) return null;
  const target = firstSkinned(targetScene), source = firstSkinned(srcScene);
  if (!target || !source) return null;
  const srcBones = new Map(source.skeleton.bones.map((b) => [b.name, b]));
  const srcOf = (bone) => {
    const bare = bone.name.replace(/^mixamorig[:_]?/i, '');
    for (const n of [bone.name, `mixamorig${bone.name}`, `mixamorig:${bone.name}`, bare, unrealName(bare)]) if (n && srcBones.has(n)) return srcBones.get(n);
    return null;
  };
  const pairs = [];
  try {
    source.skeleton.pose(); target.skeleton.pose();
    srcScene.updateMatrixWorld(true); targetScene.updateMatrixWorld(true);
    for (const tb of target.skeleton.bones) { // parent-first order
      const sb = srcOf(tb);
      if (!sb || !boneNames.has(tb.name)) continue;
      const tc = tb.children.find((c) => c.isBone && srcOf(c));
      const align = new THREE.Quaternion();
      if (tc) {
        const dT = tc.getWorldPosition(_va).sub(tb.getWorldPosition(_vb)).normalize().clone();
        const dS = srcOf(tc).getWorldPosition(_va).sub(sb.getWorldPosition(_vb)).normalize();
        if (dT.lengthSq() > 0.5 && dS.lengthSq() > 0.5) align.setFromUnitVectors(dT, dS);
      }
      const corr = sb.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(align).multiply(tb.getWorldQuaternion(_qa));
      const parentRest = tb.parent.getWorldQuaternion(new THREE.Quaternion());
      pairs.push({ tb, sb, corr, parentRest, world: new THREE.Quaternion(), values: [] });
    }
    if (pairs.length < 10) return null;
    const byBone = new Map(pairs.map((p) => [p.tb, p]));
    // hips height above the ground (crouching, falling, getting up), scaled by leg length. Ground and
    // leg length are measured on the clip's first frame (feet down), never the rest pose: Xbot's rest
    // skeleton is in different units from its clips
    const hp = pairs.find((p) => /hips|pelvis/i.test(p.tb.name));
    const legLen = (up, leg, foot) => (up && leg && foot ? up.getWorldPosition(_va).distanceTo(leg.getWorldPosition(_vb)) + leg.getWorldPosition(_va).distanceTo(foot.getWorldPosition(_vb)) : 0);
    const tLeg = ['LeftUpLeg', 'LeftLeg', 'LeftFoot'].map((n) => target.skeleton.bones.find((b) => b.name.replace(/^mixamorig[:_]?/i, '') === n));
    const sLeg = tLeg.map((b) => b && srcOf(b));
    const tl = legLen(...tLeg);
    const sFeet = ['LeftFoot', 'RightFoot'].map((n) => target.skeleton.bones.find((b) => b.name.replace(/^mixamorig[:_]?/i, '') === n)).map((b) => b && srcOf(b));
    if (hp && tl > 0 && sLeg.every(Boolean) && sFeet.every(Boolean)) {
      hp.tRest = hp.tb.getWorldPosition(new THREE.Vector3());
      hp.tFootY = tLeg[2].getWorldPosition(new THREE.Vector3()).y;
      hp.sFeet = sFeet;
      hp.pos = [];
    }
    const hips = hp && hp.pos ? hp : null;
    const has = new Set(srcBones.keys());
    const src = new THREE.AnimationClip(clip.name, clip.duration, clip.tracks.filter((t) => has.has(t.name.split('.')[0])));
    const mixer = new THREE.AnimationMixer(srcScene);
    mixer.clipAction(src).play();
    const fps = 30, frames = Math.max(2, Math.round(clip.duration * fps) + 1), times = [];
    for (let f = 0; f < frames; f++) {
      const t = Math.min(clip.duration, f / fps);
      times.push(t);
      mixer.setTime(t);
      srcScene.updateMatrixWorld(true);
      for (const p of pairs) {
        p.world.copy(p.sb.getWorldQuaternion(_qa)).multiply(p.corr);
        // parent's world rotation this frame: a retargeted bone, or (unmapped) its rest rotation
        const par = byBone.get(p.tb.parent);
        _qb.copy(par ? par.world : p.parentRest).invert().multiply(p.world);
        p.values.push(_qb.x, _qb.y, _qb.z, _qb.w);
      }
      if (hips) {
        if (f === 0) {
          hips.ground = Math.min(hips.sFeet[0].getWorldPosition(_va).y, hips.sFeet[1].getWorldPosition(_vb).y);
          hips.ratio = tl / Math.max(1e-6, legLen(...sLeg));
        }
        const above = Math.max(0, hips.sb.getWorldPosition(_vb).y - hips.ground) * hips.ratio;
        _va.copy(hips.tRest);
        _va.y = hips.tFootY + above;
        hips.tb.parent.worldToLocal(_va);
        hips.pos.push(_va.x, _va.y, _va.z);
      }
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(srcScene);
    source.skeleton.pose();
    srcScene.updateMatrixWorld(true);
    const tracks = pairs.map((p) => new THREE.QuaternionKeyframeTrack(`${p.tb.name}.quaternion`, times, p.values));
    // only clips that really raise / drop the body (falls, getting up) get a hips height track;
    // standing moves keep the target's own hip height so the feet stay planted
    if (hips) {
      const ys = hips.pos.filter((v, i) => i % 3 === 1);
      if (Math.max(...ys) - Math.min(...ys) > 0.15) tracks.push(new THREE.VectorKeyframeTrack(`${hips.tb.name}.position`, times, hips.pos));
    }
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
  } catch (err) {
    console.warn('[Character] aligned retarget failed', err);
    return null;
  }
}

/**
 * World-space retarget (handles different rest poses, e.g. a Mixamo T-pose clip on an A-pose avatar).
 * Needs the clip's source rig, which AssetLoader attaches as clip.userData.sourceScene.
 */
function retargetWorld(clip, targetScene, boneNames) {
  const srcScene = clip.userData && clip.userData.sourceScene;
  if (!srcScene) return null;
  const target = firstSkinned(targetScene), source = firstSkinned(srcScene);
  if (!target || !source) return null;
  const srcNames = new Set(source.skeleton.bones.map((b) => b.name));
  const nameOf = (bone) => {
    for (const n of [bone.name, `mixamorig${bone.name}`, bone.name.replace(/^mixamorig[:_]?/i, '')]) if (srcNames.has(n)) return n;
    return undefined;
  };
  const mapped = target.skeleton.bones.filter((b) => nameOf(b)).length;
  if (mapped < 10) return null;
  const hip = target.skeleton.bones.find((b) => /hips|pelvis/i.test(b.name));
  try {
    srcScene.updateMatrixWorld(true);
    targetScene.updateMatrixWorld(true);
    // only tracks for bones the source rig really has (avoids binding warnings)
    const has = new Set(source.skeleton.bones.map((b) => b.name));
    const src = new THREE.AnimationClip(clip.name, clip.duration, clip.tracks.filter((t) => has.has(t.name.split('.')[0])));
    const out = retargetClip(target, source, src, { getBoneName: nameOf, hip: hip ? nameOf(hip) : 'Hips', fps: 30 });
    // keep rotations only (bone lengths differ); retargetClip names tracks ".bones[name]"
    out.tracks = out.tracks.filter((t) => t.name.endsWith('.quaternion')).map((t) => {
      const m = t.name.match(/\.bones\[(.+)\]\.quaternion$/);
      if (m) { const nt = t.clone(); nt.name = `${m[1]}.quaternion`; return nt; }
      return t;
    }).filter((t) => boneNames.has(t.name.split('.')[0]));
    out.name = clip.name;
    target.skeleton.pose();
    return out.tracks.length >= 10 ? out : null;
  } catch (err) {
    console.warn('[Character] retarget failed', err);
    return null;
  }
}

function retarget(clip, boneNames) {
  const tracks = [];
  for (const t of clip.tracks) {
    const dot = t.name.indexOf('.');
    const bone = t.name.slice(0, dot), prop = t.name.slice(dot);
    let target = null;
    const bare = bone.replace(/^mixamorig[:_]?/i, '');
    if (boneNames.has(bare)) target = bare;
    else if (boneNames.has(`mixamorig${bone}`)) target = `mixamorig${bone}`;
    else if (boneNames.has(`mixamorig:${bone}`)) target = `mixamorig:${bone}`;
    if (!target || prop !== '.quaternion') continue; // rotations only: bone lengths differ between rigs
    const nt = t.clone();
    nt.name = target + prop;
    tracks.push(nt);
  }
  if (tracks.length < 10) return null;
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/** Per-instance look: clothing / hair colours and skin tone, so a crowd built from one model varies. */
const LOOK = {
  top: /outfit_top|shirt|top|torso|jacket|upper|hoodie/i,
  bottom: /outfit_bottom|bottom|pants|trouser|jeans|lower|skirt|short/i,
  shoes: /footwear|shoe|boot|sneaker/i,
  hair: /hair|beard|headwear|hat|cap/i,
  skin: /skin|body|head/i,
};
const TOPS = ['#f4f4f2', '#1f2937', '#9a3412', '#1d4ed8', '#15803d', '#7c2d12', '#be123c', '#a16207', '#4c1d95', '#0f766e', '#d4d4d8', '#334155'];
const BOTTOMS = ['#1e293b', '#3f3f46', '#1e3a8a', '#44403c', '#d6d3d1', '#14532d', '#0c0a09', '#57534e'];
const HAIRS = ['#1a1410', '#2b1d14', '#3d2b1f', '#0e0e0e', '#5b4636', '#8a8a8a'];
const SKINS = ['#ffffff', '#f1d3c0', '#d8a886', '#b98463', '#8f5f43', '#6d4532'];

export function applyLook(root, rng = Math.random) {
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const look = { top: pick(TOPS), bottom: pick(BOTTOMS), shoes: pick(['#111111', '#f5f5f5', '#5b4636', '#1e293b']), hair: pick(HAIRS), skin: pick(SKINS) };
  const hideHat = false, hideBeard = rng() < 0.5; // hair sits under the hat on some avatars
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (/headwear|hat/i.test(o.name) && hideHat) { o.visible = false; return; }
    if (/beard/i.test(o.name) && hideBeard) { o.visible = false; return; }
    o.material = [].concat(o.material).map((m) => {
      const key = Object.keys(LOOK).find((k) => LOOK[k].test(m.name));
      if (!key || /eye|teeth/i.test(m.name)) return m;
      const c = m.clone();
      // textured parts are multiplied; keep them from going muddy
      c.color.set(look[key]);
      if (c.map && key !== 'skin') c.color.lerp(new THREE.Color(1, 1, 1), 0.25);
      return c;
    });
    if (o.material.length === 1) o.material = o.material[0];
  });
}

/**
 * The player's fixed outfit: brown leather jacket, black jeans, dark brown boots and short dark
 * hair (no hat or beard). Material settings per part: [colour, roughness].
 */
const PLAYER_LOOK = {
  top: ['#7a4a30', 0.5],     // leather: a little sheen
  bottom: ['#202329', 0.9],  // dark denim
  shoes: ['#3f2719', 0.6],
  skin: ['#ffe6d2', null],   // lightens the skin texture a touch
};

export function applyPlayerLook(root) {
  let head = null, hasHair = false;
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (/headwear|hat|cap|beard/i.test(o.name)) { o.visible = false; return; }
    if (/hair/i.test(o.name)) hasHair = true;
    if (/head/i.test(o.name) && o.isSkinnedMesh) head = o;
    o.material = [].concat(o.material).map((m) => {
      const key = Object.keys(PLAYER_LOOK).find((k) => LOOK[k].test(m.name));
      if (!key || /eye|teeth/i.test(m.name)) return m;
      const [color, rough] = PLAYER_LOOK[key];
      const c = m.clone();
      c.color.set(color);
      if (key === 'skin') c.color.multiplyScalar(1.15);
      if (rough !== null) {
        c.roughness = rough; c.metalness = 0; c.metalnessMap = null;
        if (c.map) c.map = neutralTexture(c.map); // the outfit's own colours would muddy the tint
      }
      return c;
    });
    if (o.material.length === 1) o.material = o.material[0];
    // waist-length jacket: drop the coat tails below the hips (the jeans are underneath)
    if (LOOK.top.test(o.name) && o.geometry.index) {
      const g = o.geometry.clone(), p = g.attributes.position, idx = g.index.array, keep = [];
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t], b = idx[t + 1], c = idx[t + 2];
        const y = (p.getY(a) + p.getY(b) + p.getY(c)) / 3, x = Math.abs(p.getX(a) + p.getX(b) + p.getX(c)) / 3;
        if (y > 0.9 || x > 0.3) keep.push(a, b, c);
      }
      g.setIndex(keep);
      o.geometry = g;
    }
  });
  if (head && !hasHair) {
    const hair = shortHair(head);
    hair.position.copy(head.position);
    hair.quaternion.copy(head.quaternion);
    hair.scale.copy(head.scale);
    head.parent.add(hair);
  }
}

/** Grey-scale copy of a texture, brightened so a material colour shows through as chosen. */
function neutralTexture(tex) {
  const img = tex.image;
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const cx = cv.getContext('2d');
  cx.drawImage(img, 0, 0);
  const d = cx.getImageData(0, 0, cv.width, cv.height), px = d.data;
  let sum = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) { const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; px[i] = l; if (px[i + 3] > 8) { sum += l; n++; } }
  const k = n ? Math.min(3, 205 / (sum / n)) : 1; // average texel ends up light grey
  for (let i = 0; i < px.length; i += 4) { const l = Math.min(255, px[i] * k); px[i] = px[i + 1] = px[i + 2] = l; }
  cx.putImageData(d, 0, 0);
  const t = tex.clone();
  t.image = cv;
  t.needsUpdate = true;
  return t;
}

/**
 * Close-cropped hair for a bald (hat-wearing) avatar: the scalp part of the head mesh, pushed out
 * a few millimetres and skinned to the same skeleton, so it follows every animation.
 */
function shortHair(head) {
  const src = head.geometry;
  const pos = src.attributes.position, nor = src.attributes.normal;
  src.computeBoundingBox();
  const bb = src.boundingBox;
  const H = bb.max.y - bb.min.y, top = bb.max.y;
  const cz = (bb.min.z + bb.max.z) / 2, depth = bb.max.z - bb.min.z;
  // hairline: low at the back and sides (nape, above the ears), high at the forehead (face is +z)
  const isHair = (i) => {
    const front = THREE.MathUtils.smoothstep((pos.getZ(i) - cz) / depth, 0.05, 0.35);
    return pos.getY(i) > top - H * (0.47 - 0.25 * front);
  };
  const idx = src.index ? src.index.array : [...Array(pos.count).keys()];
  const keep = [];
  for (let t = 0; t < idx.length; t += 3) {
    if (isHair(idx[t]) && isHair(idx[t + 1]) && isHair(idx[t + 2])) keep.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  const geo = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'skinIndex', 'skinWeight']) geo.setAttribute(name, src.attributes[name].clone());
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const n = 0.007; // shell thickness (m, bind pose)
    p.setXYZ(i, p.getX(i) + nor.getX(i) * n, p.getY(i) + nor.getY(i) * n, p.getZ(i) + nor.getZ(i) * n);
  }
  geo.setIndex(keep);
  const mat = new THREE.MeshStandardMaterial({ color: 0x1c140f, roughness: 0.8, metalness: 0 });
  mat.name = 'PlayerHair';
  const hair = new THREE.SkinnedMesh(geo, mat);
  hair.name = 'PlayerHair';
  hair.castShadow = true;
  hair.frustumCulled = false;
  hair.bind(head.skeleton, head.bindMatrix);
  return hair;
}

/** Removes horizontal root motion so the game, not the clip, moves the character. */
function inPlace(clip) {
  const c = clip.clone();
  for (const t of c.tracks) {
    if (!t.name.endsWith('.position')) continue;
    const bone = t.name.split('.')[0];
    if (!/hips|root|pelvis/i.test(bone)) continue;
    const v = t.values;
    const x0 = v[0], z0 = v[2];
    for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
  }
  return c;
}

/** A live, animated instance of a template with smooth cross-fades between states. */
export class AnimatedCharacter {
  constructor(template) {
    this.template = template;
    this.root = new THREE.Group();
    this.model = cloneSkinned(template.scene);
    this.model.scale.setScalar(template.scale);
    this.model.position.y = template.yOffset;
    if (template.faceFlip) this.model.rotation.y = Math.PI;
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false; // skinned bounds don't follow the animation
      }
    });
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const [state, clip] of Object.entries(template.clips)) {
      const a = this.mixer.clipAction(clip);
      a.enabled = true;
      this.actions[state] = a;
    }
    this.current = null;
    this.state = null;
    // sitting, riding, pedalling, waving: the idle clip plus a procedural body pose on the same rig
    this.bodyPose = new BodyPose(this.model);
    this.pose = null;
    this.poseOpts = { phase: 0, hipY: 0.9 };
  }

  _posed(state) {
    return hasBodyPose(state) && this.bodyPose.ok && !!this.template.clips.idle;
  }

  /** True when this state can be shown on the rigged model (otherwise the caller uses its fallback). */
  has(state) {
    return this._posed(state) || !!this.template.clipFor(state);
  }

  /** Does the template have this one-shot clip (e.g. 'punch_jab', 'knockdown_c')? */
  hasClip(name) {
    return !!(name && this.template.named[name]);
  }

  /**
   * Play a clip once over the current state (attacks, hit reactions, falling, getting up).
   * duration: seconds to play it in; hold: stay on the last frame (lying down) until the next play().
   * While it runs, setState() calls are ignored; afterwards the next setState() fades back.
   */
  play(name, { duration = 0, hold = false, fade = 0.08 } = {}) {
    const clip = this.template.named[name];
    if (!clip) return false;
    const action = this.actions[`@${name}`] ||= this.mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.reset();
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(duration ? clip.duration / duration : 1);
    action.play();
    if (this.current && this.current !== action) action.crossFadeFrom(this.current, fade, true);
    this.current = action;
    this.pose = null;
    this.oneShot = { action, clip, hold };
    this.state = `@${name}`;
    return true;
  }

  /** Stop a held one-shot (e.g. someone knocked down leaves the screen and comes back standing). */
  release() {
    this.oneShot = null;
  }

  setState(state, speed = 0) {
    if (this.oneShot) return true; // a punch / fall / get-up is playing
    this.pose = this._posed(state) ? state : null;
    const key = this.pose ? 'idle' : this.template.clipFor(state);
    if (!key) return false;
    const action = this.actions[key];
    if (this.current !== action) {
      action.reset();
      action.setEffectiveWeight(1);
      action.play();
      if (this.current) action.crossFadeFrom(this.current, state === 'jump' ? 0.12 : 0.28, true);
      this.current = action;
    }
    this.state = state;
    const native = NATIVE_SPEED[key];
    action.setEffectiveTimeScale(native && speed > 0 ? THREE.MathUtils.clamp(speed / native, 0.55, 1.8) : 1);
    return true;
  }

  update(dt) {
    this.bodyPose.restore(); // the mixer only rewrites bones whose clip value changed
    this.mixer.update(dt);
    const o = this.oneShot;
    if (o && !o.hold && o.action.time >= o.clip.duration - 1e-3) this.oneShot = null;
    this.bodyPose.apply(this.pose, this.root, this.model, this.template.yOffset, this.poseOpts);
  }

  set visible(v) {
    this.root.visible = v;
  }

  get visible() {
    return this.root.visible;
  }
}
