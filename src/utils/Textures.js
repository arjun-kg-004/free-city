import * as THREE from 'three';
import { Random } from './Random.js';

// Procedural canvas textures — no external image files needed (licensing-safe).
function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function noise(g, size, base, amt, count, rng, minR = 0.5, maxR = 1.6) {
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    const v = Math.floor(rng.range(-amt, amt));
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v / 255})` : `rgba(0,0,0,${-v / 255})`;
    const r = rng.range(minR, maxR);
    g.fillRect(rng.next() * size, rng.next() * size, r, r);
  }
}

const cache = {};
export const Textures = {
  get asphalt() {
    return (cache.asphalt ||= canvasTex(256, (g, s) => noise(g, s, '#3b3d40', 26, 9000, new Random(11))));
  },
  get sidewalk() {
    return (cache.sidewalk ||= canvasTex(256, (g, s) => {
      noise(g, s, '#a9a49b', 14, 4000, new Random(12));
      g.strokeStyle = 'rgba(70,65,60,0.35)';
      g.lineWidth = 2;
      for (let i = 0; i <= 4; i++) {
        g.beginPath(); g.moveTo(i * s / 4, 0); g.lineTo(i * s / 4, s); g.stroke();
        g.beginPath(); g.moveTo(0, i * s / 4); g.lineTo(s, i * s / 4); g.stroke();
      }
    }));
  },
  get plaza() {
    return (cache.plaza ||= canvasTex(256, (g, s) => {
      const rng = new Random(13);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const l = 62 + rng.range(-6, 6);
        g.fillStyle = `hsl(30,18%,${l}%)`;
        g.fillRect(x * 32, y * 32, 31, 31);
      }
    }));
  },
  get grass() {
    return (cache.grass ||= canvasTex(256, (g, s) => {
      const rng = new Random(14);
      g.fillStyle = '#4f6b34'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 9000; i++) {
        g.fillStyle = `hsl(${rng.range(70, 105)},${rng.range(22, 40)}%,${rng.range(20, 36)}%)`;
        g.fillRect(rng.next() * s, rng.next() * s, 1.5, rng.range(1, 4));
      }
    }));
  },
  get sand() {
    return (cache.sand ||= canvasTex(256, (g, s) => noise(g, s, '#dcc58f', 22, 9000, new Random(15), 0.6, 1.4)));
  },
  get dirt() {
    return (cache.dirt ||= canvasTex(256, (g, s) => noise(g, s, '#8b7a5e', 25, 6000, new Random(16))));
  },
  get concrete() {
    return (cache.concrete ||= canvasTex(256, (g, s) => noise(g, s, '#9a9893', 16, 5000, new Random(17))));
  },
  get wood() {
    return (cache.wood ||= canvasTex(256, (g, s) => {
      const rng = new Random(18);
      for (let i = 0; i < 16; i++) {
        g.fillStyle = `hsl(28,${rng.range(35, 45)}%,${rng.range(32, 42)}%)`;
        g.fillRect(0, i * 16, s, 15);
      }
      g.fillStyle = 'rgba(0,0,0,0.25)';
      for (let i = 0; i < 16; i++) g.fillRect(0, i * 16 + 15, s, 1);
    }));
  },
  get tiles() {
    return (cache.tiles ||= canvasTex(256, (g, s) => {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        g.fillStyle = (x + y) % 2 ? '#e9e4da' : '#cfc7b8';
        g.fillRect(x * 32, y * 32, 32, 32);
      }
    }));
  },
  get cloud() {
    return (cache.cloud ||= (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const g = c.getContext('2d');
      const rng = new Random(19);
      for (let i = 0; i < 26; i++) {
        const x = rng.range(50, 206), y = rng.range(90, 166), r = rng.range(28, 62);
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, 'rgba(255,255,255,0.55)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })());
  },
};

// Text label texture (shop signs, plaques).
export function makeLabelTexture(text, { bg = '#222', fg = '#fff', w = 512, h = 128, font = 'bold 64px sans-serif', border = null } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  if (border) { g.strokeStyle = border; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8); }
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = parseInt(font.match(/(\d+)px/)[1], 10);
  while (g.measureText(text).width > w * 0.9 && size > 12) {
    size -= 4;
    g.font = font.replace(/\d+px/, size + 'px');
  }
  g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------- Procedural PBR detail maps (normal + roughness) ----------
function valueNoise(rng, size, cell) {
  const n = Math.ceil(size / cell) + 1;
  const grid = new Float32Array(n * n).map(() => rng.next());
  return (x, y) => {
    const gx = (x / cell) % (n - 1), gy = (y / cell) % (n - 1);
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const m = n - 1;
    const G = (i, j) => grid[(j % m) * n + (i % m)];
    const a = G(x0, y0), b = G(x0 + 1, y0), c = G(x0, y0 + 1), d = G(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/** Builds a tiling normal map (and optional roughness map) from a height function h(x, y) in 0..1. */
function detailMaps(size, height, strength, roughFn) {
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] = height(x, y);
  const nc = document.createElement('canvas');
  nc.width = nc.height = size;
  const ng = nc.getContext('2d');
  const nd = ng.createImageData(size, size);
  const rc = roughFn ? document.createElement('canvas') : null;
  let rg, rd;
  if (rc) { rc.width = rc.height = size; rg = rc.getContext('2d'); rd = rg.createImageData(size, size); }
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 4;
    nd.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
    nd.data[i + 1] = ((dy / l) * 0.5 + 0.5) * 255;
    nd.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
    nd.data[i + 3] = 255;
    if (rd) {
      const r = Math.max(0, Math.min(1, roughFn(x, y, H[y * size + x]))) * 255;
      rd.data[i] = rd.data[i + 1] = rd.data[i + 2] = r;
      rd.data[i + 3] = 255;
    }
  }
  ng.putImageData(nd, 0, 0);
  const mk = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  };
  if (rd) rg.putImageData(rd, 0, 0);
  return { normal: mk(nc), rough: rc ? mk(rc) : null };
}

const dcache = {};
export const DetailMaps = {
  get asphalt() {
    return (dcache.asphalt ||= (() => {
      const r = new Random(101);
      const n1 = valueNoise(r, 256, 32), n2 = valueNoise(r, 256, 8), n3 = valueNoise(r, 256, 2);
      const cracks = valueNoise(r, 256, 64);
      return detailMaps(256, (x, y) => {
        return n1(x, y) * 0.2 + n2(x, y) * 0.3 + n3(x, y) * 0.5 + cracks(x, y) * 0.0;
      }, 2.0, (x, y) => 0.8 + (n1(x, y) - 0.5) * 0.35);
    })());
  },
  get paving() {
    return (dcache.paving ||= (() => {
      const r = new Random(102);
      const n2 = valueNoise(r, 256, 6), n3 = valueNoise(r, 256, 2);
      return detailMaps(256, (x, y) => {
        const gx = Math.min(x % 64, 64 - (x % 64)), gy = Math.min(y % 64, 64 - (y % 64));
        const groove = Math.min(gx, gy) < 2 ? -0.8 : 0;
        return n2(x, y) * 0.25 + n3(x, y) * 0.2 + groove;
      }, 2.5, (x, y, h) => (h < -0.2 ? 0.95 : 0.72 + (n2(x, y) - 0.5) * 0.2));
    })());
  },
  get tiles() {
    return (dcache.tiles ||= (() => {
      const r = new Random(103);
      const n3 = valueNoise(r, 256, 3);
      return detailMaps(256, (x, y) => {
        const gx = Math.min(x % 32, 32 - (x % 32)), gy = Math.min(y % 32, 32 - (y % 32));
        return (Math.min(gx, gy) < 1.5 ? -0.7 : 0) + n3(x, y) * 0.15;
      }, 2.2, (x, y, h) => (h < -0.3 ? 0.95 : 0.6));
    })());
  },
  get concrete() {
    return (dcache.concrete ||= (() => {
      const r = new Random(104);
      const n1 = valueNoise(r, 256, 24), n3 = valueNoise(r, 256, 2);
      return detailMaps(256, (x, y) => n1(x, y) * 0.4 + n3(x, y) * 0.3, 2.0, (x, y) => 0.85 + (n1(x, y) - 0.5) * 0.2);
    })());
  },
  get grass() {
    return (dcache.grass ||= (() => {
      const r = new Random(105);
      const n2 = valueNoise(r, 256, 4), n3 = valueNoise(r, 256, 1.5);
      return detailMaps(256, (x, y) => n2(x, y) * 0.4 + n3(x, y) * 0.6, 4.0, null);
    })());
  },
  get sand() {
    return (dcache.sand ||= (() => {
      const r = new Random(106);
      const n1 = valueNoise(r, 256, 40), n3 = valueNoise(r, 256, 1.5);
      return detailMaps(256, (x, y) => Math.sin((x + n1(x, y) * 60) * 0.12) * 0.25 + n3(x, y) * 0.3, 2.2, null);
    })());
  },
  get foliage() {
    return (dcache.foliage ||= (() => {
      const r = new Random(107);
      const n2 = valueNoise(r, 128, 6), n3 = valueNoise(r, 128, 2.5);
      return detailMaps(128, (x, y) => n2(x, y) * 0.5 + n3(x, y) * 0.5, 6.0, null);
    })());
  },
};
