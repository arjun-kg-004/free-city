import { Random, angleDiff } from '../utils/Random.js';
import { ATTACKS, COMBO, REACT } from '../world/PunchPose.js';

const ACTIVITY_WEIGHTS = { shop: 3, bench: 2, talk: 1.6, stall: 1.2, sunbathe: 1.8, picnic: 1.4, busstop: 1, view: 0.8 };

/**
 * Pedestrian brain: picks destinations, walks graph paths with a personal lateral offset,
 * waits for the walk signal at crossings, and performs activities on arrival
 * (sit, chat in groups, shop, sunbathe, wait for the bus...). Also dodges fast vehicles.
 */
export class NPCController {
  constructor(manager) {
    this.m = manager;
    this.graph = manager.graph;
    this.layout = manager.game.layout;
    this.rng = new Random(2024);
  }

  pickDestination(npc) {
    const G = this.graph;
    const r = this.rng;
    for (let k = 0; k < 24; k++) {
      const id = G.pois[Math.floor(r.next() * G.pois.length)];
      const n = G.nodes[id];
      const d = Math.hypot(n.x - npc.x, n.z - npc.z);
      if (d < 20 || d > 170) continue;
      const w = ACTIVITY_WEIGHTS[n.poi] || 1;
      if (r.next() * 3.2 > w) continue;
      if (n.poi === 'bench' && n.bench.occupied) continue;
      if (n.poi === 'talk' && n.members >= 4) continue;
      return id;
    }
    // fall back to a random walkable node nearby
    for (let k = 0; k < 20; k++) {
      const n = G.nodes[Math.floor(r.next() * G.nodes.length)];
      if (n.type === 'poi') continue;
      const d = Math.hypot(n.x - npc.x, n.z - npc.z);
      if (d > 20 && d < 150) return n.id;
    }
    return null;
  }

  startJourney(npc, dest = null) {
    const G = this.graph;
    dest = dest ?? this.pickDestination(npc);
    const start = G.nearestNode(npc.x, npc.z, 80);
    const path = dest != null && start != null ? G.findPath(start, dest) : null;
    if (!path || path.length < 2) {
      npc.state = 'idle';
      npc.timer = 2 + this.rng.next() * 3;
      return false;
    }
    npc.path = path;
    npc.pi = 0;
    npc.dest = dest;
    npc.state = 'walk';
    return true;
  }

  /** Lateral offset target for the current node (keeps people from walking in single file). */
  target(npc) {
    const G = this.graph;
    const n = G.nodes[npc.path[npc.pi]];
    if (n.type === 'poi' || n.type === 'pier' || npc.pi === 0) return { x: n.x, z: n.z };
    const prev = G.nodes[npc.path[npc.pi - 1]];
    const dx = n.x - prev.x, dz = n.z - prev.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: n.x + (-dz / l) * npc.offset, z: n.z + (dx / l) * npc.offset };
  }

  update(npc, dt, time) {
    npc.timer -= dt;
    switch (npc.state) {
      case 'walk': return this._walk(npc, dt, time);
      case 'wait': {
        npc.anim = 'idle';
        const e = this.graph.edgeInfo(npc.path[npc.pi - 1], npc.path[npc.pi]);
        if (!e || !e.cross || this.layout.pedestrianMayCross(this.layout.nodes[e.cross.node], e.cross.axis, time)) npc.state = 'walk';
        return;
      }
      case 'flee': {
        npc.anim = 'flee';
        const nx = npc.x + npc.fleeX * dt * 4.6, nz = npc.z + npc.fleeZ * dt * 4.6;
        if (!this.m.blocked(nx, nz)) { npc.x = nx; npc.z = nz; }
        npc.yaw = Math.atan2(npc.fleeX, npc.fleeZ);
        if (npc.timer <= 0) this.startJourney(npc, npc.dest);
        return;
      }
      case 'down': {
        // knocked flat: lie still, get up at the end (get-up clip, or tilt back for the simple bodies)
        npc.anim = 'idle';
        npc.fall = npc.timer < 0.6 ? Math.max(0, npc.timer / 0.6) : Math.min(1, npc.fall + dt * 6);
        if (!npc.gettingUp && npc.timer <= REACT.getup[1]) { npc.gettingUp = true; this._react(npc, REACT.getup[0], REACT.getup[1]); }
        if (npc.timer <= 0) {
          npc.fall = 0;
          const p = this.m.game.player;
          if (npc.tough && npc.hp > 0) this.startFight(npc);
          else { npc.state = 'idle'; this.flee(npc, npc.x - p.pos.x, npc.z - p.pos.z); npc.timer = 3; }
        }
        return;
      }
      case 'stagger': {
        // first punch: rock back, then run off (or square up) unless a second punch lands
        npc.anim = 'idle';
        const t = 1.2 - npc.timer;
        npc.fall = t < 0.12 ? (t / 0.12) * 0.2 : Math.max(0, 0.2 * (1 - (t - 0.12) / 0.45));
        if (npc.timer <= 0) {
          npc.fall = 0;
          const p = this.m.game.player;
          if (npc.tough && npc.hp > 0) this.startFight(npc);
          else { npc.state = 'idle'; this.flee(npc, npc.x - p.pos.x, npc.z - p.pos.z); npc.timer = 3; }
        }
        return;
      }
      case 'fight': return this._fight(npc, dt);
      case 'chat': {
        npc.anim = 'talk';
        const p = this.m.game.player;
        npc.yaw += angleDiff(npc.yaw, Math.atan2(p.pos.x - npc.x, p.pos.z - npc.z)) * Math.min(1, dt * 6);
        if (npc.timer <= 0) this.startJourney(npc, npc.dest);
        return;
      }
      case 'station': {
        const p = this.m.game.player;
        const d = Math.hypot(p.pos.x - npc.x, p.pos.z - npc.z);
        npc.anim = d < 9 ? 'wave' : 'idle';
        if (d < 12) npc.yaw += angleDiff(npc.yaw, Math.atan2(p.pos.x - npc.x, p.pos.z - npc.z)) * Math.min(1, dt * 3);
        return;
      }
      default:
        if (npc.timer <= 0) this._finishActivity(npc);
    }
  }

  _walk(npc, dt, time) {
    const G = this.graph;
    if (!npc.path) { this.startJourney(npc); return; }
    if (npc.pi >= npc.path.length) { this._arrive(npc); return; }
    // crossing gate
    if (npc.pi > 0 && !npc.crossOk) {
      const e = G.edgeInfo(npc.path[npc.pi - 1], npc.path[npc.pi]);
      if (e && e.cross) {
        const node = this.layout.nodes[e.cross.node];
        if (!this.layout.pedestrianMayCross(node, e.cross.axis, time)) { npc.state = 'wait'; return; }
      }
      npc.crossOk = true;
    }
    const t = this.target(npc);
    const dx = t.x - npc.x, dz = t.z - npc.z;
    const d = Math.hypot(dx, dz);
    const step = npc.walkSpeed * dt;
    if (d <= step + 0.05) {
      npc.x = t.x; npc.z = t.z;
      npc.pi++;
      npc.crossOk = false;
      if (npc.pi >= npc.path.length) this._arrive(npc);
      return;
    }
    npc.x += (dx / d) * step;
    npc.z += (dz / d) * step;
    const want = Math.atan2(dx, dz);
    npc.yaw += angleDiff(npc.yaw, want) * Math.min(1, dt * 8);
    npc.anim = 'walk';
    npc.speed = npc.walkSpeed;
  }

  _arrive(npc) {
    const n = this.graph.nodes[npc.dest];
    const r = this.rng;
    npc.anim = 'idle';
    npc.speed = 0;
    if (!n || n.type !== 'poi') { npc.state = 'idle'; npc.timer = r.range(1, 4); return; }
    npc.poiNode = n;
    switch (n.poi) {
      case 'bench':
        if (n.bench.occupied) { npc.state = 'idle'; npc.timer = 1; return; }
        n.bench.occupied = true;
        npc.x = n.bench.x; npc.z = n.bench.z; npc.yaw = n.bench.rot;
        npc.state = 'sit'; npc.anim = 'sit'; npc.timer = r.range(12, 40);
        return;
      case 'shop':
        npc.state = 'shop'; npc.hidden = true; npc.timer = r.range(8, 25);
        return;
      case 'talk': {
        const k = n.members++;
        const a = k * 2.1 + r.range(-0.2, 0.2);
        npc.x = n.x + Math.sin(a) * 0.95; npc.z = n.z + Math.cos(a) * 0.95;
        npc.yaw = a + Math.PI;
        npc.state = 'talk'; npc.anim = 'talk'; npc.timer = r.range(15, 45);
        return;
      }
      case 'sunbathe': case 'picnic':
        npc.state = 'sit'; npc.anim = 'sit'; npc.timer = r.range(20, 50);
        npc.yaw = n.poi === 'sunbathe' ? Math.PI / 2 : r.range(0, 6.28);
        return;
      case 'stall':
        npc.state = 'stall'; npc.anim = 'talk'; npc.yaw = Math.PI; npc.timer = r.range(5, 12);
        return;
      case 'busstop':
        npc.state = 'busstop'; npc.anim = 'idle'; npc.timer = r.range(8, 22);
        return;
      case 'view':
        npc.state = 'view'; npc.anim = 'idle'; npc.yaw = Math.PI / 2; npc.timer = r.range(8, 15);
        return;
      default:
        npc.state = 'idle'; npc.timer = r.range(2, 5);
    }
  }

  _finishActivity(npc) {
    const n = npc.poiNode;
    if (n) {
      if (n.poi === 'bench') n.bench.occupied = false;
      if (n.poi === 'talk') n.members = Math.max(0, n.members - 1);
    }
    npc.poiNode = null;
    npc.hidden = false;
    this.startJourney(npc);
  }

  /** Leave whatever we're doing (used before fleeing / respawning). */
  release(npc) {
    if (npc.state === 'sit' || npc.state === 'talk' || npc.state === 'shop') {
      const n = npc.poiNode;
      if (n && n.poi === 'bench') n.bench.occupied = false;
      if (n && n.poi === 'talk') n.members = Math.max(0, n.members - 1);
      npc.poiNode = null;
      npc.hidden = false;
    }
  }

  /** Hit (not yet floored): rock back facing the attacker, stunned for a moment. */
  stagger(npc, fromX, fromZ, push = 0.15) {
    if (npc.state === 'station' || npc.hidden) return;
    this.release(npc);
    const dx = npc.x - fromX, dz = npc.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    npc.yaw = Math.atan2(-dx, -dz);
    const nx = npc.x + (dx / l) * push, nz = npc.z + (dz / l) * push;
    if (!this.m.blocked(nx, nz)) { npc.x = nx; npc.z = nz; }
    npc.punchT = 0;
    npc.state = 'stagger';
    npc.timer = 1.2;
    const [clip, secs] = REACT.hit[Math.random() < 0.5 ? 0 : 1];
    this._react(npc, clip, secs);
  }

  /** Ask the rigged body (if this pedestrian has one) to play a reaction clip. */
  _react(npc, clip, secs, hold = false) {
    npc.react = clip; npc.reactDur = secs; npc.reactHold = hold;
    npc.reactSeq = (npc.reactSeq || 0) + 1;
  }

  /** Punched: fall over backwards (away from the attacker) and slide back a little. */
  knockDown(npc, fromX, fromZ) {
    if (npc.state === 'station' || npc.hidden) return;
    this.release(npc);
    const dx = npc.x - fromX, dz = npc.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    npc.yaw = Math.atan2(-dx, -dz); // face the attacker, so "backwards" is away from them
    const nx = npc.x + (dx / l) * 0.6, nz = npc.z + (dz / l) * 0.6;
    if (!this.m.blocked(nx, nz)) { npc.x = nx; npc.z = nz; }
    npc.hp--;
    npc.punchT = 0;
    npc.state = 'down';
    npc.timer = 2.6;
    npc.gettingUp = false;
    this._react(npc, REACT.knockdown[0], REACT.knockdown[1], true);
  }

  /** Square up to the player: chase, then trade punches until beaten, outrun or bored. */
  startFight(npc) {
    if (npc.state === 'station' || npc.hidden) return;
    this.release(npc);
    npc.state = 'fight';
    npc.timer = 25;
    npc.fightCd = 0.5;
    npc.punchT = 0;
    npc.combo = 0;
  }

  _fight(npc, dt) {
    const g = this.m.game, p = g.player;
    const dx = p.pos.x - npc.x, dz = p.pos.z - npc.z;
    const d = Math.hypot(dx, dz);
    if (p.vehicle || p.interior || d > 30 || npc.timer <= 0) { npc.punchT = 0; this.startJourney(npc, npc.dest); return; }
    npc.yaw += angleDiff(npc.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 10);
    if (npc.punchT > 0) {
      npc.punchT = Math.max(0, npc.punchT - dt);
      npc.anim = 'fight';
      // the fist / foot connects when fully out, if the player is still in reach and in front
      const kick = npc.attackKind === 'kick';
      if (!npc.landed && npc.attackDur - npc.punchT >= npc.impactAt) {
        npc.landed = true;
        const facing = (Math.sin(npc.yaw) * dx + Math.cos(npc.yaw) * dz) / (d || 1);
        if (d < (kick ? 1.9 : 1.6) && facing > 0.5) this.m.punchPlayer(npc);
        else g.audio.swing();
      }
      return;
    }
    if (d > 1.15) {
      npc.anim = 'run';
      const step = Math.min(d - 1.1, 4.2 * dt);
      const nx = npc.x + (dx / d) * step, nz = npc.z + (dz / d) * step;
      if (!this.m.blocked(nx, nz)) { npc.x = nx; npc.z = nz; }
    } else npc.anim = 'fight'; // guard up
    npc.fightCd -= dt;
    if (d < 1.5 && npc.fightCd <= 0) {
      // same combo as the player: punch, punch, kick, kick, then a breather
      const name = COMBO[npc.combo], A = ATTACKS[name];
      npc.attackKind = A.kind;
      npc.attackClip = name;
      npc.punchSide = npc.combo % 2;
      npc.combo = (npc.combo + 1) % 4;
      npc.attackDur = npc.punchT = A.time;
      npc.impactAt = A.time * A.impact;
      npc.attackSeq = (npc.attackSeq || 0) + 1; // tells the rigged body to play the move
      npc.landed = false;
      npc.fightCd = npc.combo === 0 ? 1.2 + this.rng.next() * 0.8 : 0.2 + this.rng.next() * 0.25;
    }
  }

  flee(npc, awayX, awayZ) {
    if (npc.state === 'flee' || npc.state === 'station' || npc.state === 'down' || npc.hidden) return;
    this.release(npc);
    const l = Math.hypot(awayX, awayZ) || 1;
    npc.fleeX = awayX / l; npc.fleeZ = awayZ / l;
    npc.state = 'flee';
    npc.timer = 1.3;
  }
}
