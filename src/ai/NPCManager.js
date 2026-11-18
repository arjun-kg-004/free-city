import * as THREE from 'three';
import { MAX_NPCS } from '../config.js';
import { PedGraph } from './Pathfinding.js';
import { NPCController } from './NPCController.js';
import { getParts, poseFor, BODY, SKIN_TONES, SHIRT_COLORS, PANTS_COLORS, HAIR_COLORS } from '../world/Humanoid.js';
import { Random } from '../utils/Random.js';
import { AnimatedCharacter, CharacterTemplate, applyLook } from '../world/AnimatedCharacter.js';
import { PunchRig, punchWeight, REACT } from '../world/PunchPose.js';

const _base = new THREE.Matrix4();
const _hip = new THREE.Matrix4();
const _tmp = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _qt = new THREE.Quaternion();
const _xAxis = new THREE.Vector3(1, 0, 0);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const _sphere = new THREE.Sphere(new THREE.Vector3(), 1.3);
const _projView = new THREE.Matrix4();

export const NAMED_NPCS = [
  { id: 'ravi', name: 'Ravi', site: 'plaza', dx: -6, dz: 10, colors: { skin: '#a8693f', shirt: '#0ea5e9', pants: '#334155', hair: '#111111' },
    lines: ['Vanakkam! Welcome to the City Centre. The clock tower is over a hundred years old, you know.', 'Try the Downtown Dash race — the start marker is right here near the plaza. Fast car recommended!', 'If you are hungry, Spice Garden on Market Street makes the best biryani in town.'] },
  { id: 'meena', name: 'Meena', site: 'beach', colors: { skin: '#c68642', shirt: '#f472b6', pants: '#f5f5f4', hair: '#1b1b1b' },
    lines: ['Hi! The sea is lovely today. Have you walked to the end of the pier? The Ferris wheel glows at night.', 'Grab a scooter from the promenade stand — they are free to use for everyone.', 'The Coastal Time Trial starts near the lighthouse. Bikes only, and the record is tough!'] },
  { id: 'karthik', name: 'Karthik', site: 'park', colors: { skin: '#8d5524', shirt: '#22c55e', pants: '#1e3a8a', hair: '#2b1b10' },
    lines: ['Morning! I cycle the park loop every day. Grab a bike-share cycle at the park entrance and try the Park Pedal route.', 'Use gears 1, 2 and 3 on a bicycle. Low gear for hills, high gear for speed. Hold Shift to pedal harder!', 'Have you seen the Lotus Fountain? Coins in the pond are supposed to bring good luck.'] },
];

const SMALL_TALK = [
  'Lovely weather today, isn\'t it?', 'I\'m late for work — the traffic on the highway is terrible!', 'Have you tried the filter coffee at Sea Breeze Café?',
  'They say there are shiny tokens hidden all around the city.', 'Mind the traffic lights when you cross!', 'I love walking along the river in the evening.',
  'The view from the pier at sunset is unbeatable.', 'Market Street has everything — books, sweets, gadgets...', 'Sorry, can\'t talk, my bus is coming!',
  'Did you know City Hall has a small museum inside?', 'Drive safe — and always stop for people at the crossings!', 'Nice backpack!',
];

/** Pool of instanced pedestrians: simulation near the player, cheap updates far away, ~5 draw calls. */
export class NPCManager {
  constructor(game) {
    this.game = game;
    this.rng = new Random(1999);
    this.graph = new PedGraph(game.layout);
    this.graph.build(game.ctx);
    this.brain = new NPCController(this);
    this._frustum = new THREE.Frustum();
    this.capacity = MAX_NPCS + NAMED_NPCS.length;
    this.npcs = [];
    this.target = 80;
    this.frame = 0;
    this.time = 0;
    this._buildMeshes(game.scene);
    for (let i = 0; i < this.capacity; i++) this.npcs.push(this._create(i));
    this._spawnNamed();
    this._buildProxies();
  }

  _buildMeshes(scene) {
    const P = getParts();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    const mk = (geo, per) => {
      const im = new THREE.InstancedMesh(geo, mat, this.capacity * per);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.castShadow = true;
      for (let i = 0; i < this.capacity * per; i++) { im.setMatrixAt(i, HIDDEN); im.setColorAt(i, new THREE.Color(1, 1, 1)); }
      scene.add(im);
      return im;
    };
    this.mesh = {
      torso: mk(P.torso, 1), head: mk(P.head, 1), hair: mk(P.hair, 1), arms: mk(P.arm, 2), legs: mk(P.leg, 2),
    };
  }

  _create(i) {
    const r = this.rng;
    const npc = {
      idx: i, active: false, hidden: false, named: null,
      x: 0, z: 0, y: 0, yaw: 0, speed: 0, walkSpeed: r.range(1.05, 1.6),
      state: 'idle', anim: 'idle', phase: r.range(0, 6), timer: 0,
      path: null, pi: 0, dest: null, offset: r.range(-0.9, 0.9), crossOk: false,
      scale: r.range(0.9, 1.07), girth: r.range(0.92, 1.12),
      pose: {}, accum: 0,
      // street fights: about one in four people fights back when punched
      tough: r.chance(0.25), hp: 1, fall: 0, punchT: 0, punchSide: 0, attackKind: 'punch', combo: 0, fightCd: 0, landed: false,
    };
    npc.hp = npc.tough ? 3 : 1;
    this._colorize(npc, {
      skin: r.pick(SKIN_TONES), shirt: r.pick(SHIRT_COLORS), pants: r.pick(PANTS_COLORS), hair: r.pick(HAIR_COLORS),
    });
    return npc;
  }

  _colorize(npc, c) {
    const i = npc.idx;
    const M = this.mesh;
    M.torso.setColorAt(i, new THREE.Color(c.shirt));
    M.head.setColorAt(i, new THREE.Color(c.skin));
    M.hair.setColorAt(i, new THREE.Color(c.hair));
    M.arms.setColorAt(i * 2, new THREE.Color(c.shirt));
    M.arms.setColorAt(i * 2 + 1, new THREE.Color(c.shirt));
    M.legs.setColorAt(i * 2, new THREE.Color(c.pants));
    M.legs.setColorAt(i * 2 + 1, new THREE.Color(c.pants));
    for (const im of Object.values(M)) im.instanceColor.needsUpdate = true;
  }

  _spawnNamed() {
    const s = this.game.ctx.sites;
    const spots = {
      plaza: s.plaza ? { x: s.plaza.x - 7, z: s.plaza.z + 10 } : null,
      beach: { x: 330, z: -30 },
      park: this.game.ctx.parkRings[0] ? { x: this.game.ctx.parkRings[0].x + 3, z: this.game.ctx.parkRings[0].z - this.game.ctx.parkRings[0].r - 2.5 } : null,
    };
    this.named = [];
    NAMED_NPCS.forEach((def, k) => {
      const pos = spots[def.site];
      if (!pos) return;
      const npc = this.npcs[MAX_NPCS + k];
      npc.active = true;
      npc.named = def;
      npc.x = pos.x; npc.z = pos.z;
      npc.state = 'station';
      npc.scale = 1.02;
      this._colorize(npc, def.colors);
      this.named.push(npc);
      // floating marker
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      g.fillStyle = '#facc15'; g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#111'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', 32, 34);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: true }));
      spr.scale.set(0.6, 0.6, 0.6);
      spr.position.set(pos.x, 2.45, pos.z);
      this.game.scene.add(spr);
      npc.marker = spr;
    });
  }

  setDensity(n) {
    this.target = Math.min(MAX_NPCS, n);
  }

  init(fx, fz, count) {
    this.target = Math.min(MAX_NPCS, count);
    for (let i = 0; i < this.target; i++) this._spawn(this.npcs[i], fx, fz, 4, 150);
  }

  _spawn(npc, fx, fz, minD, maxD) {
    const G = this.graph;
    for (let k = 0; k < 30; k++) {
      const n = G.nodes[Math.floor(this.rng.next() * G.nodes.length)];
      if (n.type === 'poi') continue;
      const d = Math.hypot(n.x - fx, n.z - fz);
      if (d < minD || d > maxD) continue;
      npc.active = true;
      npc.hidden = false;
      npc.fall = 0; npc.punchT = 0; npc.hits = 0; npc.hp = npc.tough ? 3 : 1;
      npc.x = n.x + this.rng.range(-1, 1);
      npc.z = n.z + this.rng.range(-1, 1);
      npc.path = null;
      npc.poiNode = null;
      // some start mid-activity so the city looks alive immediately
      if (this.rng.chance(0.3)) {
        const dest = this.brain.pickDestination(npc);
        if (dest != null) {
          const poi = G.nodes[dest];
          if (poi.poi !== 'shop' && poi.poi !== 'bench') { npc.x = poi.x; npc.z = poi.z; npc.dest = dest; this.brain._arrive(npc); return true; }
        }
      }
      this.brain.startJourney(npc);
      return true;
    }
    return false;
  }

  /** Puts a pedestrian at (x, z) hurrying away along (ax, az) — e.g. a driver leaving their car. */
  spawnBystander(x, z, ax, az) {
    let npc = this.npcs.find((n, i) => i < MAX_NPCS && !n.active);
    if (!npc) {
      const f = this.game.focus;
      npc = this.npcs.filter((n, i) => i < MAX_NPCS && n.active && !n.named)
        .sort((a, b) => Math.hypot(b.x - f.x, b.z - f.z) - Math.hypot(a.x - f.x, a.z - f.z))[0];
      if (!npc) return null;
      this._despawn(npc);
    }
    npc.active = true;
    npc.hidden = false;
    npc.x = x; npc.z = z;
    npc.path = null;
    npc.poiNode = null;
    npc.dest = this.brain.pickDestination(npc);
    npc.state = 'idle';
    this.brain.flee(npc, ax, az);
    npc.timer = 1.8;
    return npc;
  }

  _despawn(npc) {
    this.brain.release(npc);
    npc.active = false;
    npc.path = null;
  }

  blocked(x, z) {
    return this.game.physics.boxBlocked(x, 0.9, z, 0.25, 0.6, 0.25, 0);
  }

  /** A pedestrian got hit: the first three blows stagger them, the fourth knocks them down; bystanders panic. */
  hit(npc, fromX, fromZ, kind = 'punch') {
    this.game.audio.shout(npc.x, npc.z);
    npc.hits = (npc.hits || 0) + 1;
    if (npc.hits >= 4) { npc.hits = 0; this.brain.knockDown(npc, fromX, fromZ); } else this.brain.stagger(npc, fromX, fromZ, kind === 'kick' ? 0.3 : 0.15);
    for (const n of this.queryNear(npc.x, npc.z, 12)) {
      if (n !== npc && n.state !== 'fight' && Math.random() < 0.7) this.brain.flee(n, n.x - fromX, n.z - fromZ);
    }
  }

  /** A punch that hit nobody: people right there run off, the tough ones square up instead. */
  missed(x, z) {
    for (const n of this.queryNear(x, z, 4)) {
      if (n.state === 'fight' || n.state === 'down' || n.state === 'stagger') continue;
      if (n.tough && n.hp > 0) this.brain.startFight(n);
      else this.brain.flee(n, n.x - x, n.z - z);
    }
  }

  /** Everyone fighting the player goes back to their day (after a knockout). */
  endFights() {
    for (const n of this.npcs) if (n.state === 'fight') { n.punchT = 0; this.brain.startJourney(n, n.dest); }
  }

  /** A fighting pedestrian's punch or kick landed on the player. */
  punchPlayer(npc) {
    const kick = npc.attackKind === 'kick';
    this.game.playerController.takeHit(kick ? 14 + Math.random() * 6 : 9 + Math.random() * 6, npc.x, npc.z, kick);
  }

  queryNear(x, z, r) {
    const out = [];
    const r2 = r * r;
    for (const n of this.npcs) {
      if (!n.active || n.hidden) continue;
      const dx = n.x - x, dz = n.z - z;
      if (dx * dx + dz * dz < r2) out.push(n);
    }
    return out;
  }

  nearestTalkable(x, z, maxD = 2.4) {
    let best = null, bd = maxD;
    for (const n of this.npcs) {
      if (!n.active || n.hidden || n.state === 'fight' || n.state === 'down' || n.state === 'stagger') continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  talkTo(npc) {
    const p = this.game.player;
    if (npc.named) {
      npc.lineIdx = ((npc.lineIdx ?? -1) + 1) % npc.named.lines.length;
      this.game.ui.dialog(npc.named.name, npc.named.lines[npc.lineIdx]);
      this.game.events.emit('talk', npc.named.id);
      return;
    }
    this.brain.release(npc);
    npc.state = 'chat';
    npc.timer = 4.5;
    const line = SMALL_TALK[Math.floor(Math.random() * SMALL_TALK.length)];
    this.game.ui.dialog('Pedestrian', line, 3500);
    void p;
  }

  /**
   * Hybrid LOD: the nearest pedestrians are drawn as rigged, motion-captured characters
   * (when models are provided); everyone further away stays on the cheap instanced bodies.
   */
  _buildProxies() {
    this.proxies = [];
    const assets = this.game.assets;
    if (!assets || !assets.characters.npcs.length) return;
    const templates = assets.characters.npcs
      .map((g) => new CharacterTemplate(g, assets.clips))
      .filter((t) => t.clips.idle && t.clips.walk);
    if (!templates.length) return;
    const count = this.game.settings.qualityPreset.skinnedNpcs || 12;
    for (let k = 0; k < count; k++) {
      const ch = new AnimatedCharacter(templates[k % templates.length]);
      applyLook(ch.model, () => this.rng.next());
      ch.visible = false;
      ch.mixer.setTime(k * 0.37); // de-sync walk cycles
      this.game.scene.add(ch.root);
      this.proxies.push({ ch, npc: null });
    }
    this.proxyRange = 70;
  }

  _assignProxies(focus) {
    if (!this.proxies || !this.proxies.length) return;
    const R = this.proxyRange;
    const cands = [];
    for (const n of this.npcs) {
      if (!n.active || n.hidden) continue;
      const d = Math.hypot(n.x - focus.x, n.z - focus.z);
      if (d > R) continue;
      const anim = n.anim === 'flee' ? 'flee' : n.anim;
      if (!this.proxies[0].ch.has(anim)) continue; // e.g. no sit clip -> keep the procedural body
      cands.push([d, n]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    const want = new Set(cands.slice(0, this.proxies.length).map((c) => c[1]));
    for (const p of this.proxies) {
      if (p.npc && !want.has(p.npc)) { p.npc.proxy = null; p.npc._hidden = false; p.npc = null; p.ch.visible = false; }
    }
    for (const n of want) {
      if (n.proxy) continue;
      const free = this.proxies.find((p) => !p.npc);
      if (!free) break;
      free.npc = n;
      n.proxy = free;
    }
  }

  update(dt, focus) {
    this.time += dt;
    const cam = this.game.sceneManager.camera;
    cam.updateMatrixWorld();
    _projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(_projView);
    if ((this.frame & 3) === 0) this._assignProxies(focus);
    this.frame++;
    const player = this.game.player;
    const pv = player.vehicle;
    const settings = this.game.settings;
    const renderR = Math.min(170, settings.drawDistanceValue * 0.45);
    let active = 0;
    for (let i = 0; i < MAX_NPCS; i++) if (this.npcs[i].active) active++;
    if (active < this.target) {
      const npc = this.npcs.find((n, i) => i < MAX_NPCS && !n.active);
      if (npc && this._spawn(npc, focus.x, focus.z, 70, 150)) active++;
    }
    let extra = active - this.target;
    const M = this.mesh;
    for (const npc of this.npcs) {
      if (!npc.active) { this._hide(npc); continue; }
      const d = Math.hypot(npc.x - focus.x, npc.z - focus.z);
      if (!npc.named) {
        if (extra > 0 && d > 60) { extra--; this._despawn(npc); this._hide(npc); continue; }
        if (d > 190) { this._despawn(npc); if (!this._spawn(npc, focus.x, focus.z, 80, 160)) this._hide(npc); continue; }
      }
      // simplified simulation when far away
      npc.accum += dt;
      const far = d > 110;
      if (far && (this.frame + npc.idx) % 4 !== 0) { if (d > renderR) this._hide(npc); continue; }
      const sdt = npc.accum;
      npc.accum = 0;
      this.brain.update(npc, sdt, this.time);
      // react to fast vehicles
      if (!far && pv && Math.abs(pv.speed) > 4 && npc.state !== 'flee' && !npc.hidden && npc.state !== 'station') {
        const dx = npc.x - pv.x, dz = npc.z - pv.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 9) {
          const fx = Math.sin(pv.heading), fz = Math.cos(pv.heading);
          const along = dx * fx + dz * fz;
          const lat = dx * fz - dz * fx;
          if (along > -1 && Math.abs(lat) < 3) {
            this.brain.flee(npc, fz * Math.sign(lat || 1), -fx * Math.sign(lat || 1));
            if (Math.random() < 0.4) this.game.audio.shout(npc.x, npc.z);
          }
        }
      }
      // gentle push from the player on foot
      if (!far && !pv && !player.interior) {
        const dx = npc.x - player.pos.x, dz = npc.z - player.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.75 && dist > 0.01 && npc.state !== 'sit' && npc.state !== 'station') {
          npc.x += (dx / dist) * (0.75 - dist);
          npc.z += (dz / dist) * (0.75 - dist);
        }
      }
      if (npc.hidden || d > renderR) { this._hide(npc); if (npc.proxy) npc.proxy.ch.visible = false; continue; }
      const yPier = npc.x > 352 && Math.abs(npc.z) < 15 ? 0.38 : 0;
      if (npc.proxy) {
        const ch = npc.proxy.ch;
        if (!ch.has(npc.anim)) { npc.proxy.npc = null; ch.visible = false; npc.proxy = null; npc._hidden = false; }
        else {
          this._hide(npc);
          // skinned characters are expensive: skip ones outside the camera view entirely,
          // and only let the closest ones cast shadows
          _v.set(npc.x, 0.9, npc.z);
          _sphere.center.copy(_v);
          if (!this._frustum.intersectsSphere(_sphere)) { ch.visible = false; continue; }
          ch.visible = true;
          const shadow = d < 24;
          if (ch._shadow !== shadow) { ch._shadow = shadow; ch.model.traverse((o) => { if (o.isMesh) o.castShadow = shadow; }); }
          // fight moves and reactions as motion-captured one-shots (only the simple bodies tilt over)
          if (ch._npc !== npc) { ch._npc = npc; ch._reactSeq = npc.reactSeq; ch._attackSeq = npc.attackSeq; ch.release(); }
          if (ch._reactSeq !== npc.reactSeq) { ch._reactSeq = npc.reactSeq; ch.play(npc.react, { duration: npc.reactDur, hold: npc.reactHold }); }
          if (ch._attackSeq !== npc.attackSeq) { ch._attackSeq = npc.attackSeq; if (npc.punchT > 0) ch.play(npc.attackClip, { duration: npc.attackDur }); }
          const tilt = ch.hasClip(REACT.knockdown[0]) ? 0 : npc.fall;
          ch.root.position.set(npc.x, yPier + tilt * 0.12, npc.z);
          ch.root.rotation.set(-tilt * Math.PI / 2, npc.yaw, 0, 'YXZ'); // knocked down: lie on the back
          ch.setState(npc.anim, npc.anim === 'flee' ? 4.6 : npc.anim === 'walk' ? npc.walkSpeed : 0);
          if (ch.punchRig) ch.punchRig.restore();
          ch.poseOpts.phase = this.time;
          ch.update(sdt);
          if (npc.punchT > 0 && !ch.hasClip(npc.attackClip)) (ch.punchRig ||= new PunchRig(ch.model)).apply(ch.root, npc.x, yPier, npc.z, npc.yaw, npc.punchSide, punchWeight(npc.punchT, npc.attackKind, npc.attackDur), npc.attackKind);
          if (npc.marker) npc.marker.position.set(npc.x, 2.45 + Math.sin(this.time * 3) * 0.08, npc.z);
          continue;
        }
      }
      // animate + write matrices
      const rate = npc.anim === 'walk' ? npc.walkSpeed * 3.1 : npc.anim === 'flee' ? 11 : 2;
      npc.phase += sdt * rate;
      poseFor(npc.anim, npc.phase, npc.pose);
      if (npc.punchT > 0) npc.pose[(npc.attackKind === 'kick' ? 'leg' : 'arm') + (npc.punchSide ? 'L' : 'R')] = 1.5 * punchWeight(npc.punchT, npc.attackKind, npc.attackDur);
      this._write(npc, yPier);
      if (npc.marker) npc.marker.position.set(npc.x, 2.45 + Math.sin(this.time * 3) * 0.08, npc.z);
    }
    for (const im of Object.values(M)) im.instanceMatrix.needsUpdate = true;
    this.active = active;
  }

  _hide(npc) {
    if (npc._hidden) return;
    npc._hidden = true;
    const i = npc.idx, M = this.mesh;
    M.torso.setMatrixAt(i, HIDDEN); M.head.setMatrixAt(i, HIDDEN); M.hair.setMatrixAt(i, HIDDEN);
    M.arms.setMatrixAt(i * 2, HIDDEN); M.arms.setMatrixAt(i * 2 + 1, HIDDEN);
    M.legs.setMatrixAt(i * 2, HIDDEN); M.legs.setMatrixAt(i * 2 + 1, HIDDEN);
  }

  _write(npc, y) {
    npc._hidden = false;
    const i = npc.idx, M = this.mesh, p = npc.pose;
    const sc = npc.scale;
    _q.setFromAxisAngle(_v.set(0, 1, 0), npc.yaw);
    if (npc.fall > 0) _q.multiply(_qt.setFromAxisAngle(_xAxis, -npc.fall * Math.PI / 2)); // knocked down
    _base.compose(_v.set(npc.x, y + npc.fall * 0.12, npc.z), _q, _s.set(sc * npc.girth, sc, sc * npc.girth));
    // hips frame
    _q.setFromEuler(_e.set(p.lean, 0, 0));
    _tmp.compose(_v.set(0, p.hipY, 0), _q, _s.set(1, 1, 1));
    _hip.multiplyMatrices(_base, _tmp);
    M.torso.setMatrixAt(i, _hip);
    // head + hair
    _q.setFromEuler(_e.set(0, p.headY, 0));
    _tmp.compose(_v.set(0, BODY.headY, 0), _q, _s.set(1, 1, 1));
    _m.multiplyMatrices(_hip, _tmp);
    M.head.setMatrixAt(i, _m);
    M.hair.setMatrixAt(i, _m);
    // arms
    _q.setFromEuler(_e.set(-p.armL, 0, -p.armLz));
    _tmp.compose(_v.set(-BODY.shoulderX, BODY.shoulderY, 0), _q, _s.set(1, 1, 1));
    M.arms.setMatrixAt(i * 2, _m.multiplyMatrices(_hip, _tmp));
    _q.setFromEuler(_e.set(-p.armR, 0, -p.armRz));
    _tmp.compose(_v.set(BODY.shoulderX, BODY.shoulderY, 0), _q, _s.set(1, 1, 1));
    M.arms.setMatrixAt(i * 2 + 1, _m.multiplyMatrices(_hip, _tmp));
    // legs hang from the hips but don't lean with the torso
    _q.setFromEuler(_e.set(-p.legL, 0, 0));
    _tmp.compose(_v.set(-BODY.hipX, p.hipY, 0), _q, _s.set(1, 1, 1));
    M.legs.setMatrixAt(i * 2, _m.multiplyMatrices(_base, _tmp));
    _q.setFromEuler(_e.set(-p.legR, 0, 0));
    _tmp.compose(_v.set(BODY.hipX, p.hipY, 0), _q, _s.set(1, 1, 1));
    M.legs.setMatrixAt(i * 2 + 1, _m.multiplyMatrices(_base, _tmp));
  }
}
