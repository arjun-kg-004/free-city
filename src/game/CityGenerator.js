import {
  GRID, xs, zs, roadWidthV, roadWidthH, isHighwayV, isHighwayH, DISTRICT_MAP, DISTRICT_INFO, BEACH, RIVER, RIVER_ROW,
} from '../config.js';

/**
 * Pure layout data for the city: blocks, road nodes (intersections) and road edges.
 * Visual systems (roads, buildings, props) and AI systems (traffic, pedestrians) all build on this.
 */
export class CityLayout {
  constructor() {
    this.blocks = [];
    this.nodes = [];
    this.edges = [];
    this.roundabouts = new Set();
    this._build();
  }

  nodeId(i, j) {
    return j * (GRID.N + 1) + i;
  }

  node(i, j) {
    return this.nodes[this.nodeId(i, j)];
  }

  _build() {
    const N = GRID.N;
    // Blocks
    for (let bj = 0; bj < N; bj++) {
      for (let bi = 0; bi < N; bi++) {
        const type = DISTRICT_MAP[bj][bi];
        const x0 = xs[bi] + roadWidthV(bi) / 2;
        const x1 = xs[bi + 1] - roadWidthV(bi + 1) / 2;
        const z0 = zs[bj] + roadWidthH(bj) / 2;
        const z1 = zs[bj + 1] - roadWidthH(bj + 1) / 2;
        this.blocks.push({ bi, bj, type, x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 });
      }
      if (bj !== RIVER_ROW) {
        const z0 = zs[bj] + roadWidthH(bj) / 2;
        const z1 = zs[bj + 1] - roadWidthH(bj + 1) / 2;
        this.blocks.push({ bi: N, bj, type: 'BEACH', x0: BEACH.promenadeX0, x1: BEACH.wallX, z0, z1, cx: (BEACH.promenadeX0 + BEACH.wallX) / 2, cz: (z0 + z1) / 2, w: BEACH.wallX - BEACH.promenadeX0, d: z1 - z0 });
      }
    }

    this.roundabouts.add(this.nodeId(1, 5));

    // Nodes
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const id = this.nodeId(i, j);
        this.nodes.push({
          id, i, j, x: xs[i], z: zs[j],
          hx: roadWidthV(i) / 2, hz: roadWidthH(j) / 2,
          neighbors: [],
          roundabout: this.roundabouts.has(id),
          lights: false,
          phaseOffset: ((i * 7 + j * 13) % 10) * 3.1,
        });
      }
    }

    // Edges
    const addEdge = (a, b, axis) => {
      const A = this.nodes[a], B = this.nodes[b];
      let highway = false, width = 14, bridge = false, tunnel = false;
      if (axis === 'x') { highway = isHighwayH(A.j); width = roadWidthH(A.j); }
      else {
        highway = isHighwayV(A.i); width = roadWidthV(A.i);
        bridge = A.j === RIVER_ROW && B.j === RIVER_ROW + 1;
        tunnel = A.i === 0 && A.j === 1;
      }
      const district = this._edgeDistrict(A, B, axis);
      const e = {
        id: this.edges.length, a, b, axis, highway, width, bridge, tunnel, district,
        speed: highway ? 24 : (A.i === N && axis === 'z') ? 15 : 13,
        lanes: highway ? 2 : 1,
        length: Math.hypot(B.x - A.x, B.z - A.z),
      };
      this.edges.push(e);
      A.neighbors.push({ node: b, edge: e.id });
      B.neighbors.push({ node: a, edge: e.id });
    };
    for (let j = 0; j <= N; j++) for (let i = 0; i < N; i++) addEdge(this.nodeId(i, j), this.nodeId(i + 1, j), 'x');
    for (let j = 0; j < N; j++) for (let i = 0; i <= N; i++) addEdge(this.nodeId(i, j), this.nodeId(i, j + 1), 'z');

    for (const n of this.nodes) n.lights = n.neighbors.length >= 3 && !n.roundabout;
  }

  _edgeDistrict(A, B, axis) {
    const cand = [];
    if (axis === 'x') {
      const bi = Math.min(A.i, B.i);
      if (A.j > 0) cand.push(this.blockType(bi, A.j - 1));
      if (A.j < GRID.N) cand.push(this.blockType(bi, A.j));
      if (A.j === 0 || A.j === GRID.N) return 'HWY';
    } else {
      const bj = Math.min(A.j, B.j);
      if (A.i > 0) cand.push(this.blockType(A.i - 1, bj));
      if (A.i < GRID.N) cand.push(this.blockType(A.i, bj));
      if (A.i === 0) return 'HWY';
      if (A.i === GRID.N) return 'SEA';
    }
    const scored = cand.filter(Boolean).sort((p, q) => (DISTRICT_INFO[q]?.traffic || 1) - (DISTRICT_INFO[p]?.traffic || 1));
    return scored[0] || 'RES';
  }

  blockType(bi, bj) {
    if (bi < 0 || bj < 0 || bi >= GRID.N || bj >= GRID.N) return null;
    return DISTRICT_MAP[bj][bi];
  }

  block(bi, bj) {
    return this.blocks.find((b) => b.bi === bi && b.bj === bj);
  }

  blocksOfType(type) {
    return this.blocks.filter((b) => b.type === type);
  }

  /** True over the river (except bridge decks) or the sea: nothing should be parked there. */
  isWater(x, z) {
    if (x > BEACH.wallX) return true;
    if (z <= RIVER.z0 || z >= RIVER.z1) return false;
    for (let i = 0; i <= GRID.N; i++) {
      const n = this.node(i, RIVER_ROW);
      if (Math.abs(x - n.x) < n.hx + 4) return false; // bridge deck incl. its sidewalks
    }
    return true;
  }

  /** True if any part of a vehicle footprint (centre ± half length along heading) is over water. */
  overWater(x, z, heading, halfLen) {
    const fx = Math.sin(heading) * halfLen, fz = Math.cos(heading) * halfLen;
    return this.isWater(x, z) || this.isWater(x + fx, z + fz) || this.isWater(x - fx, z - fz);
  }

  /** District key at a world position (used by HUD + audio). */
  districtAt(x, z) {
    if (x > BEACH.promenadeX0) return 'BEACH';
    for (const b of this.blocks) {
      if (x >= b.x0 - 8 && x <= b.x1 + 8 && z >= b.z0 - 8 && z <= b.z1 + 8) return b.type;
    }
    return 'HWY';
  }

  nearestNode(x, z) {
    let best = null, bd = Infinity;
    for (const n of this.nodes) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /** Nearest point on any road centre-line with its heading — used for vehicle spawning / recovery. */
  nearestRoadPoint(x, z) {
    let best = null, bd = Infinity;
    for (const e of this.edges) {
      const A = this.nodes[e.a], B = this.nodes[e.b];
      const dx = B.x - A.x, dz = B.z - A.z;
      const t = Math.max(0.15, Math.min(0.85, ((x - A.x) * dx + (z - A.z) * dz) / (dx * dx + dz * dz)));
      const px = A.x + dx * t, pz = A.z + dz * t;
      const d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < bd) { bd = d; best = { x: px, z: pz, heading: Math.atan2(dx, dz), edge: e }; }
    }
    return best;
  }

  /** Traffic light state for an axis at a node: 'green' | 'yellow' | 'red'. */
  lightState(node, axis, time) {
    if (!node.lights) return 'green';
    const t = (time + node.phaseOffset) % 30;
    // axis 'z' = vehicles travelling north/south on a vertical road.
    if (axis === 'z') {
      if (t < 12) return 'green';
      if (t < 14.5) return 'yellow';
      return 'red';
    }
    if (t >= 15 && t < 27) return 'green';
    if (t >= 27 && t < 29.5) return 'yellow';
    return 'red';
  }

  /** May pedestrians cross the road that runs along `roadAxis` at this node? */
  pedestrianMayCross(node, roadAxis, time) {
    if (!node.lights) return true;
    const t = (time + node.phaseOffset) % 30;
    // Crossing a vertical road (axis z) is safe while north/south traffic is stopped.
    if (roadAxis === 'z') return t >= 15.5 && t < 25.5;
    return t >= 0.5 && t < 10.5;
  }
}
