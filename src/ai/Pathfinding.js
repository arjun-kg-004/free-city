import { GRID, RIVER_ROW, SIDEWALK } from '../config.js';

/**
 * Pedestrian navigation graph: sidewalk corners, mid-side nodes, crosswalks (gated by the
 * traffic lights), bridge sidewalks, park paths, plaza grid, promenade, beach and pier —
 * plus points of interest (benches, shop doors, talk spots...). A* finds routes.
 */
export class PedGraph {
  constructor(layout) {
    this.layout = layout;
    this.nodes = [];   // { id, x, z, type, poi? }
    this.adj = [];     // id -> [{ to, cost, cross? }]
    this.cornerIdx = new Map();
    this.sides = [];   // { ax, az, bx, bz, mid }
    this.pois = [];
  }

  addNode(x, z, type = 'walk', data = {}) {
    const id = this.nodes.length;
    this.nodes.push({ id, x, z, type, ...data });
    this.adj.push([]);
    return id;
  }

  link(a, b, extra = null) {
    if (a === b || a == null || b == null) return;
    const A = this.nodes[a], B = this.nodes[b];
    const cost = Math.hypot(A.x - B.x, A.z - B.z) * (extra && extra.cross ? 1.3 : 1);
    if (this.adj[a].some((e) => e.to === b)) return;
    this.adj[a].push({ to: b, cost, cross: extra && extra.cross });
    this.adj[b].push({ to: a, cost, cross: extra && extra.cross });
  }

  quadrantWalkable(i, j, sx, sz) {
    const bi = i + (sx < 0 ? -1 : 0), bj = j + (sz < 0 ? -1 : 0);
    if (bj < 0 || bj >= GRID.N || bi < 0 || bi > GRID.N) return false;
    if (bi === GRID.N) return bj !== RIVER_ROW;   // seafront promenade
    if (bj === RIVER_ROW) return true;             // bridge sidewalk
    return true;
  }

  corner(i, j, sx, sz) {
    return this.cornerIdx.get(`${i},${j},${sx},${sz}`);
  }

  build(ctx) {
    const L = this.layout;
    const N = GRID.N;
    // corners
    for (const n of L.nodes) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        if (!this.quadrantWalkable(n.i, n.j, sx, sz)) continue;
        const off = SIDEWALK / 2;
        const id = this.addNode(n.x + sx * (n.hx + off), n.z + sz * (n.hz + off), 'corner', { node: n.id });
        this.cornerIdx.set(`${n.i},${n.j},${sx},${sz}`, id);
      }
    }
    // block sides with a middle node (POIs attach to it)
    const side = (a, b) => {
      if (a == null || b == null) return;
      const A = this.nodes[a], B = this.nodes[b];
      const mid = this.addNode((A.x + B.x) / 2, (A.z + B.z) / 2, 'side');
      this.link(a, mid); this.link(mid, b);
      this.sides.push({ ax: A.x, az: A.z, bx: B.x, bz: B.z, mid });
    };
    for (let bj = 0; bj < N; bj++) {
      for (let bi = 0; bi <= N; bi++) {
        const nw = this.corner(bi, bj, 1, 1), ne = this.corner(bi + 1, bj, -1, 1);
        const sw = this.corner(bi, bj + 1, 1, -1), se = this.corner(bi + 1, bj + 1, -1, -1);
        if (bj === RIVER_ROW) continue;
        if (bi === N) { side(nw, sw); continue; } // promenade (west edge only)
        const type = L.blockType(bi, bj);
        if (!type || type === 'RIVER') continue;
        side(nw, ne); side(ne, se); side(se, sw); side(sw, nw);
      }
    }
    // promenade continues past the T-junctions on the beach side
    for (let j = 0; j <= N; j++) this.link(this.corner(N, j, 1, -1), this.corner(N, j, 1, 1));
    // bridge sidewalks
    for (let i = 0; i <= N; i++) for (const sx of [-1, 1]) side(this.corner(i, RIVER_ROW, sx, 1), this.corner(i, RIVER_ROW + 1, sx, -1));
    // crosswalks
    for (const n of L.nodes) {
      const arms = [
        [n.j > 0, [-1, -1], [1, -1], 'z'],
        [n.j < N, [-1, 1], [1, 1], 'z'],
        [n.i > 0, [-1, -1], [-1, 1], 'x'],
        [n.i < N, [1, -1], [1, 1], 'x'],
      ];
      for (const [exists, a, b, axis] of arms) {
        if (!exists) continue;
        const ca = this.corner(n.i, n.j, a[0], a[1]), cb = this.corner(n.i, n.j, b[0], b[1]);
        if (ca == null || cb == null) continue;
        this.link(ca, cb, { cross: { node: n.id, axis } });
      }
    }
    this._park(ctx);
    this._plaza(ctx);
    this._beach(ctx);
    this._pois(ctx);
  }

  _nearestOfType(x, z, types, maxD = 1e9) {
    let best = null, bd = maxD * maxD;
    for (const n of this.nodes) {
      if (!types.includes(n.type)) continue;
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n.id; }
    }
    return best;
  }

  /** Attach a sidewalk POI to the side it stands on. */
  _attachToSide(id) {
    const P = this.nodes[id];
    let best = null, bd = 4.5;
    for (const s of this.sides) {
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const l2 = dx * dx + dz * dz;
      const t = ((P.x - s.ax) * dx + (P.z - s.az) * dz) / l2;
      if (t < -0.02 || t > 1.02) continue;
      const d = Math.hypot(s.ax + dx * t - P.x, s.az + dz * t - P.z);
      if (d < bd) { bd = d; best = s; }
    }
    if (best) this.link(id, best.mid);
    else this.link(id, this._nearestOfType(P.x, P.z, ['corner', 'side', 'park', 'plaza', 'beach'], 30));
  }

  _park(ctx) {
    for (const ring of ctx.parkRings) {
      const b = ring.block;
      const ids = [];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        ids.push(this.addNode(ring.x + Math.sin(a) * ring.r, ring.z + Math.cos(a) * ring.r, 'park'));
      }
      for (let k = 0; k < 8; k++) this.link(ids[k], ids[(k + 1) % 8]);
      // entrances on the four sidewalks: k=0 -> +z (south), 2 -> +x, 4 -> -z, 6 -> -x
      const ents = [[ring.x, b.z1 - 2, 0], [b.x1 - 2, ring.z, 2], [ring.x, b.z0 + 2, 4], [b.x0 + 2, ring.z, 6]];
      for (const [x, z, k] of ents) {
        const e = this.addNode(x, z, 'parkEntrance');
        this._attachToSide(e);
        this.link(e, ids[k]);
      }
      ring.nodes = ids;
    }
  }

  _plaza(ctx) {
    const pl = ctx.sites.plaza;
    if (!pl) return;
    const grid = [];
    for (let gz = -1; gz <= 1; gz++) for (let gx = -1; gx <= 1; gx++) {
      if (gx === 0 && gz === -1) { grid.push(null); continue; } // clock tower
      grid.push(this.addNode(pl.x + gx * 15, pl.z + gz * 15 + (gz === 0 ? -2 : 0), 'plaza'));
    }
    const at = (gx, gz) => grid[(gz + 1) * 3 + (gx + 1)];
    for (let gz = -1; gz <= 1; gz++) for (let gx = -1; gx <= 1; gx++) {
      if (gx < 1) this.link(at(gx, gz), at(gx + 1, gz));
      if (gz < 1 && !(gx === 0 && gz === 0)) this.link(at(gx, gz), at(gx, gz + 1)); // skip: fountain in the way
    }
    // edge nodes join the sidewalks
    const b = ctx.layout.blocks.find((x) => x.type === 'PLAZA');
    for (const [x, z, g] of [[pl.x, b.z1 - 2, at(0, 1)], [pl.x, b.z0 + 2, at(-1, -1)], [b.x0 + 2, pl.z, at(-1, 0)], [b.x1 - 2, pl.z, at(1, 0)]]) {
      const e = this.addNode(x, z, 'plaza');
      this._attachToSide(e);
      this.link(e, g);
    }
  }

  _beach(ctx) {
    const ids = ctx.beachWalk.map((p) => this.addNode(p.x, p.z, 'beach'));
    for (let k = 1; k < ids.length; k++) {
      const A = this.nodes[ids[k - 1]], B = this.nodes[ids[k]];
      if (Math.abs(A.z - B.z) < 40) this.link(ids[k - 1], ids[k]);
    }
    for (const id of ids) {
      const n = this.nodes[id];
      // path across the sand to the promenade
      const prom = this._nearestOfType(n.x - 50, n.z, ['corner', 'side'], 40);
      if (prom != null && this.nodes[prom].x > 290) this.link(id, prom);
    }
    // pier
    if (ctx.sites.pierWalk) {
      let prev = this._nearestOfType(352, 0, ['beach'], 60);
      for (const p of ctx.sites.pierWalk) {
        const id = this.addNode(p.x, p.z, 'pier');
        this.link(prev, id);
        prev = id;
      }
      this.pierEnd = prev;
    }
  }

  _pois(ctx) {
    const add = (x, z, poi, data = {}) => {
      const id = this.addNode(x, z, 'poi', { poi, ...data });
      this.pois.push(id);
      return id;
    };
    for (const bench of ctx.benches) {
      const id = add(bench.x, bench.z, 'bench', { bench });
      const park = this._nearestOfType(bench.x, bench.z, ['park', 'plaza'], 6.5);
      if (park != null) this.link(id, park); else this._attachToSide(id);
    }
    for (const f of ctx.footprintsShops || []) {
      const id = add(f.x + f.nx * 1.6, f.z + f.nz * 1.6, 'shop', { door: f });
      this._attachToSide(id);
    }
    for (const s of ctx.talkSpots) {
      const id = add(s.x, s.z, 'talk', { spot: s, members: 0 });
      this.link(id, this._nearestOfType(s.x, s.z, ['plaza', 'park', 'side', 'beach'], 40));
    }
    for (const s of ctx.stalls) {
      const id = add(s.x, s.z, 'stall', { stall: s });
      this.link(id, this._nearestOfType(s.x, s.z, ['plaza'], 30));
    }
    for (const s of ctx.beachSpots || []) {
      if (Math.random() < 0.5) continue;
      const id = add(s.x, s.z, 'sunbathe');
      this.link(id, this._nearestOfType(s.x, s.z, ['beach'], 40));
    }
    for (const l of ctx.parkLawns) {
      for (let k = 0; k < 3; k++) {
        const x = l.x + (Math.random() - 0.5) * 8, z = l.z + (Math.random() - 0.5) * 8;
        const id = add(x, z, 'picnic');
        this.link(id, this._nearestOfType(x, z, ['park'], 30));
      }
    }
    for (const bs of ctx.busStops) {
      const id = add(bs.x, bs.z, 'busstop');
      this._attachToSide(id);
    }
    if (this.pierEnd != null) {
      const id = add(this.nodes[this.pierEnd].x + 10, 0, 'view');
      this.link(id, this.pierEnd);
    }
  }

  nearestNode(x, z, maxD = 60) {
    return this._nearestOfType(x, z, ['corner', 'side', 'park', 'plaza', 'beach', 'parkEntrance', 'pier'], maxD);
  }

  /** A* from node a to node b. Returns array of node ids or null. */
  findPath(a, b) {
    if (a == null || b == null) return null;
    if (a === b) return [a];
    const N = this.nodes;
    const g = new Map([[a, 0]]);
    const came = new Map();
    const open = [{ id: a, f: 0 }];
    const closed = new Set();
    const h = (id) => Math.hypot(N[id].x - N[b].x, N[id].z - N[b].z);
    let iter = 0;
    while (open.length && iter++ < 4000) {
      // small graphs: linear min-extraction is fast enough
      let mi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[mi].f) mi = i;
      const cur = open.splice(mi, 1)[0].id;
      if (cur === b) {
        const path = [b];
        let c = b;
        while (came.has(c)) { c = came.get(c); path.push(c); }
        return path.reverse();
      }
      if (closed.has(cur)) continue;
      closed.add(cur);
      for (const e of this.adj[cur]) {
        // only POI nodes that are the destination can be passed through
        if (N[e.to].type === 'poi' && e.to !== b) continue;
        const ng = g.get(cur) + e.cost;
        if (ng < (g.get(e.to) ?? Infinity)) {
          g.set(e.to, ng);
          came.set(e.to, cur);
          open.push({ id: e.to, f: ng + h(e.to) });
        }
      }
    }
    return null;
  }

  edgeInfo(a, b) {
    return this.adj[a].find((e) => e.to === b);
  }
}
