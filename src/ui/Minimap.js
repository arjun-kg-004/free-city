import { GRID, xs, zs, roadWidthV, roadWidthH, RIVER, BEACH, WORLD, DISTRICT_INFO } from '../config.js';

const MAP = { x0: WORLD.minX - 120, z0: WORLD.minZ - 120, x1: BEACH.wallX + 112, z1: WORLD.maxZ + 120, ppm: 1.2 }; // pixels per metre in the base image

/** Pre-rendered city map used by the rotating minimap and the full-screen map (with GPS route). */
export class Minimap {
  constructor(game) {
    this.game = game;
    this.canvas = document.getElementById('minimap');
    this.g = this.canvas.getContext('2d');
    this.full = document.getElementById('map-canvas');
    this.fg = this.full.getContext('2d');
    this.base = this._renderBase();
    this.route = null;
    this.routeTimer = 0;
    this.fullOpen = false;
    this.full.addEventListener('click', (e) => this._onMapClick(e));
    this.full.addEventListener('contextmenu', (e) => { e.preventDefault(); this.game.setWaypoint(null); });
  }

  _px(x) { return (x - MAP.x0) * MAP.ppm; }
  _pz(z) { return (z - MAP.z0) * MAP.ppm; }

  _renderBase() {
    const W = Math.ceil((MAP.x1 - MAP.x0) * MAP.ppm), H = Math.ceil((MAP.z1 - MAP.z0) * MAP.ppm);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const L = this.game.layout;
    const rect = (x0, z0, x1, z1, col) => { g.fillStyle = col; g.fillRect(this._px(x0), this._pz(z0), (x1 - x0) * MAP.ppm, (z1 - z0) * MAP.ppm); };
    rect(MAP.x0, MAP.z0, MAP.x1, MAP.z1, '#3f5a3a');
    // ocean + beach
    rect(BEACH.shoreX, MAP.z0, MAP.x1, MAP.z1, '#2f6f95');
    rect(BEACH.promenadeX0, MAP.z0, BEACH.shoreX, MAP.z1, '#d9c48c');
    // blocks
    for (const b of L.blocks) {
      if (b.type === 'BEACH' || b.type === 'RIVER') continue;
      const info = DISTRICT_INFO[b.type];
      rect(b.x0, b.z0, b.x1, b.z1, '#8f8a82');
      rect(b.x0 + 3, b.z0 + 3, b.x1 - 3, b.z1 - 3, shade(info.color, -0.15));
      if (b.type === 'PARK') rect(b.x0 + 4, b.z0 + 4, b.x1 - 4, b.z1 - 4, '#5e8f4d');
    }
    rect(BEACH.promenadeX0, MAP.z0, BEACH.sandX0, MAP.z1, '#b9b0a0');
    // river
    rect(MAP.x0, RIVER.z0, BEACH.shoreX, RIVER.z1, '#3d7fae');
    // roads
    for (let i = 0; i <= GRID.N; i++) rect(xs[i] - roadWidthV(i) / 2, WORLD.minZ, xs[i] + roadWidthV(i) / 2, WORLD.maxZ, i === 0 ? '#c9c1a8' : '#55595e');
    for (let j = 0; j <= GRID.N; j++) rect(WORLD.minX, zs[j] - roadWidthH(j) / 2, xs[GRID.N] + roadWidthV(GRID.N) / 2, zs[j] + roadWidthH(j) / 2, j === 0 || j === GRID.N ? '#c9c1a8' : '#55595e');
    // pier
    rect(352, -4.5, 452, 4.5, '#8b6b4a');
    rect(452, -15, 485, 15, '#8b6b4a');
    // building footprints
    for (const f of this.game.ctx.footprints) {
      g.fillStyle = 'rgba(40,40,46,0.55)';
      if (f.round) {
        g.beginPath();
        g.arc(this._px((f.x0 + f.x1) / 2), this._pz((f.z0 + f.z1) / 2), ((f.x1 - f.x0) / 2) * MAP.ppm, 0, Math.PI * 2);
        g.fill();
      } else g.fillRect(this._px(f.x0), this._pz(f.z0), (f.x1 - f.x0) * MAP.ppm, (f.z1 - f.z0) * MAP.ppm);
    }
    return c;
  }

  // ---------- GPS ----------
  computeRoute(from, to) {
    const L = this.game.layout;
    const a = L.nearestNode(from.x, from.z), b = L.nearestNode(to.x, to.z);
    if (!a || !b) return null;
    const dist = new Map([[a.id, 0]]);
    const prev = new Map();
    const open = new Set([a.id]);
    while (open.size) {
      let cur = null, cd = Infinity;
      for (const id of open) { const d = dist.get(id); if (d < cd) { cd = d; cur = id; } }
      open.delete(cur);
      if (cur === b.id) break;
      for (const nb of L.nodes[cur].neighbors) {
        const e = L.edges[nb.edge];
        const nd = cd + e.length / (e.highway ? 1.6 : 1);
        if (nd < (dist.get(nb.node) ?? Infinity)) { dist.set(nb.node, nd); prev.set(nb.node, cur); open.add(nb.node); }
      }
    }
    const pts = [{ x: to.x, z: to.z }];
    let c = b.id;
    pts.push({ x: L.nodes[c].x, z: L.nodes[c].z });
    while (prev.has(c)) { c = prev.get(c); pts.push({ x: L.nodes[c].x, z: L.nodes[c].z }); }
    pts.push({ x: from.x, z: from.z });
    return pts.reverse();
  }

  _focus() {
    const p = this.game.player;
    return p.vehicle ? { x: p.vehicle.x, z: p.vehicle.z } : { x: p.pos.x, z: p.pos.z };
  }

  update(dt) {
    const g = this.game;
    const wp = g.waypoint;
    this.routeTimer -= dt;
    if (wp && this.routeTimer <= 0 && !g.player.interior) {
      this.routeTimer = 1.5;
      this.route = this.computeRoute(this._focus(), wp);
    }
    if (!wp) this.route = null;
    this._drawMini();
    if (this.fullOpen) this._drawFull();
  }

  _markers() {
    const g = this.game;
    const s = g.ctx.sites;
    const list = [];
    if (s.fuel) list.push({ x: s.fuel.x, z: s.fuel.z, icon: '⛽', color: '#ef4444' });
    if (s.dealer) list.push({ x: s.dealer.x, z: s.dealer.z, icon: '🚗', color: '#38bdf8' });
    if (s.restaurant) list.push({ x: s.restaurant.x, z: s.restaurant.z, icon: '🍛', color: '#f97316' });
    if (s.supermarket) list.push({ x: s.supermarket.x, z: s.supermarket.z, icon: '🛒', color: '#22c55e' });
    if (s.cafe) list.push({ x: s.cafe.x, z: s.cafe.z, icon: '☕', color: '#06b6d4' });
    if (s.parking) list.push({ x: s.parking.x, z: s.parking.z, icon: 'P', color: '#3b82f6' });
    if (!g.missions.active) for (const m of g.missions.markers) list.push({ x: m.def.start.x, z: m.def.start.z, icon: '★', color: '#facc15', big: true });
    for (const n of g.npcManager.named || []) list.push({ x: n.x, z: n.z, icon: '!', color: '#fde047' });
    for (const l of g.landmarks.landmarks) {
      const found = g.state.discovered.includes(l.id);
      if (found || g.state.flags.mapRevealed) list.push({ x: l.x, z: l.z, icon: found ? '◆' : '◇', color: found ? '#e879f9' : '#a78bfa' });
    }
    if (g.state.flags.mapRevealed) for (const t of g.missions.tokens) if (!g.state.collected.includes(t.id)) list.push({ x: t.x, z: t.z, icon: '•', color: '#fbbf24' });
    for (const v of g.vehicles.vehicles) if (!v.rental && !v.static && !v.driven && !v.street && !v.borrowed) list.push({ x: v.x, z: v.z, icon: v.kind === 'car' ? '▣' : '◒', color: '#60a5fa' });
    return list;
  }

  _drawMini() {
    const c = this.canvas, g = this.g;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = c.clientWidth || 180;
    if (c.width !== Math.round(size * dpr)) { c.width = c.height = Math.round(size * dpr); }
    const W = c.width;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, W);
    const p = this.game.player;
    if (p.interior) {
      g.fillStyle = 'rgba(15,20,28,0.85)';
      g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e5e7eb'; g.font = `${12 * dpr}px system-ui`; g.textAlign = 'center';
      g.fillText('Indoors', W / 2, W / 2);
      return;
    }
    const f = this._focus();
    const v = p.vehicle;
    const radiusM = v ? 85 + Math.min(70, Math.abs(v.speed) * 2.5) : 60;
    const scale = (W / 2) / radiusM; // px per metre
    const yaw = this.game.cameraManager.yaw;
    g.save();
    g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#2b3b2b'; g.fillRect(0, 0, W, W);
    g.translate(W / 2, W / 2);
    g.rotate(yaw);
    g.scale(scale, scale);
    g.translate(-f.x, -f.z);
    g.drawImage(this.base, MAP.x0, MAP.z0, (MAP.x1 - MAP.x0), (MAP.z1 - MAP.z0));
    // route
    if (this.route) {
      g.strokeStyle = '#a855f7'; g.lineWidth = 5; g.lineJoin = 'round'; g.globalAlpha = 0.9;
      g.beginPath();
      this.route.forEach((pt, i) => (i ? g.lineTo(pt.x, pt.z) : g.moveTo(pt.x, pt.z)));
      g.stroke();
      g.globalAlpha = 1;
    }
    // traffic dots
    g.fillStyle = 'rgba(255,255,255,0.75)';
    for (const car of this.game.traffic.cars) if (car.active && Math.abs(car.x - f.x) < radiusM && Math.abs(car.z - f.z) < radiusM) g.fillRect(car.x - 1.4, car.z - 1.4, 2.8, 2.8);
    g.restore();
    // markers (screen-space so icons stay upright)
    const toScreen = (x, z) => {
      const dx = (x - f.x) * scale, dz = (z - f.z) * scale;
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      return { x: W / 2 + dx * cs - dz * sn, y: W / 2 + dx * sn + dz * cs };
    };
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const m of this._markers()) {
      const s = toScreen(m.x, m.z);
      if (Math.hypot(s.x - W / 2, s.y - W / 2) > W / 2 - 10) continue;
      this._icon(g, s.x, s.y, m, dpr);
    }
    // waypoint / mission target clamped to the edge
    const wp = this.game.waypoint;
    if (wp) {
      let s = toScreen(wp.x, wp.z);
      const d = Math.hypot(s.x - W / 2, s.y - W / 2);
      const maxR = W / 2 - 9 * dpr;
      if (d > maxR) s = { x: W / 2 + ((s.x - W / 2) / d) * maxR, y: W / 2 + ((s.y - W / 2) / d) * maxR };
      g.fillStyle = this.game.missions.active ? '#facc15' : '#a855f7';
      g.strokeStyle = '#111'; g.lineWidth = 2 * dpr;
      g.beginPath(); g.arc(s.x, s.y, 6 * dpr, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    // player arrow
    const heading = v ? v.heading : p.yaw;
    g.save();
    g.translate(W / 2, W / 2);
    g.rotate(Math.PI - heading + yaw); // world heading rotated into minimap space
    g.fillStyle = '#ffffff'; g.strokeStyle = '#0f172a'; g.lineWidth = 2 * dpr;
    g.beginPath(); g.moveTo(0, -9 * dpr); g.lineTo(6 * dpr, 7 * dpr); g.lineTo(0, 3.5 * dpr); g.lineTo(-6 * dpr, 7 * dpr); g.closePath();
    g.fill(); g.stroke();
    g.restore();
    // north marker
    const n = toScreen(f.x, f.z - radiusM * 0.86);
    g.fillStyle = '#f87171'; g.font = `bold ${11 * dpr}px system-ui`;
    g.fillText('N', n.x, n.y);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2 * dpr;
    g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2); g.stroke();
  }

  _icon(g, x, y, m, dpr) {
    const r = (m.big ? 8 : 7) * dpr;
    g.fillStyle = 'rgba(15,23,42,0.85)';
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = m.color;
    g.font = `bold ${(m.icon.length > 1 || m.icon.charCodeAt(0) > 255 ? 9 : 10) * dpr}px system-ui, "Segoe UI Emoji"`;
    g.fillText(m.icon, x, y + 0.5);
  }

  // ---------- full map ----------
  openFull(open) {
    this.fullOpen = open;
    document.getElementById('map-overlay').classList.toggle('hidden', !open);
    if (open) this._drawFull();
  }

  _fullTransform() {
    const c = this.full;
    const rect = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(rect.width * dpr)) { c.width = Math.round(rect.width * dpr); c.height = Math.round(rect.height * dpr); }
    const scale = Math.min(c.width / (MAP.x1 - MAP.x0 - 60), c.height / (MAP.z1 - MAP.z0 - 120));
    const ox = c.width / 2 - ((MAP.x0 + MAP.x1) / 2 - 10) * scale;
    const oz = c.height / 2 - ((MAP.z0 + MAP.z1) / 2) * scale;
    return { scale, ox, oz, dpr };
  }

  _drawFull() {
    const c = this.full, g = this.fg;
    const T = this._fullTransform();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0b1220'; g.fillRect(0, 0, c.width, c.height);
    g.setTransform(T.scale, 0, 0, T.scale, T.ox, T.oz);
    g.drawImage(this.base, MAP.x0, MAP.z0, MAP.x1 - MAP.x0, MAP.z1 - MAP.z0);
    if (this.route) {
      g.strokeStyle = '#a855f7'; g.lineWidth = 4; g.lineJoin = 'round';
      g.beginPath(); this.route.forEach((p, i) => (i ? g.lineTo(p.x, p.z) : g.moveTo(p.x, p.z))); g.stroke();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    const toS = (x, z) => ({ x: x * T.scale + T.ox, y: z * T.scale + T.oz });
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // district labels
    g.font = `600 ${11 * T.dpr}px system-ui`;
    g.fillStyle = 'rgba(255,255,255,0.8)';
    const labeled = new Set();
    for (const b of this.game.layout.blocks) {
      if (b.type === 'RIVER' || b.type === 'BEACH' || labeled.has(b.type)) continue;
      labeled.add(b.type);
      const s = toS(b.cx, b.cz);
      g.fillText(DISTRICT_INFO[b.type].name, s.x, s.y);
    }
    const sb = toS(400, 160); g.fillText('Golden Sands Beach', sb.x, sb.y);
    const sr = toS(-200, (RIVER.z0 + RIVER.z1) / 2); g.fillText('Silver River', sr.x, sr.y);
    for (const m of this._markers()) { const s = toS(m.x, m.z); this._icon(g, s.x, s.y, m, T.dpr); }
    const wp = this.game.waypoint;
    if (wp) { const s = toS(wp.x, wp.z); g.fillStyle = '#a855f7'; g.beginPath(); g.arc(s.x, s.y, 7 * T.dpr, 0, Math.PI * 2); g.fill(); }
    const f = this._focus();
    const ps = toS(f.x, f.z);
    const p = this.game.player;
    const heading = p.vehicle ? p.vehicle.heading : p.yaw;
    g.save(); g.translate(ps.x, ps.y); g.rotate(-heading + Math.PI);
    g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -10 * T.dpr); g.lineTo(7 * T.dpr, 8 * T.dpr); g.lineTo(-7 * T.dpr, 8 * T.dpr); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }

  _onMapClick(e) {
    const T = this._fullTransform();
    const rect = this.full.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * T.dpr, sy = (e.clientY - rect.top) * T.dpr;
    const x = (sx - T.ox) / T.scale, z = (sy - T.oz) / T.scale;
    if (x < WORLD.minX - 20 || x > BEACH.shoreX + 100 || z < WORLD.minZ - 20 || z > WORLD.maxZ + 20) return;
    this.game.setWaypoint({ x, z });
    this.routeTimer = 0;
    this.update(0);
  }
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.round(Math.min(255, Math.max(0, r + r * amt)));
  g = Math.round(Math.min(255, Math.max(0, g + g * amt)));
  b = Math.round(Math.min(255, Math.max(0, b + b * amt)));
  return `rgb(${r},${g},${b})`;
}
