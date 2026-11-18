// Global tuning constants for the city layout and game systems.

// Small 6 x 6 city. The east edge (beach boulevard at x 288) and the river (z 72-144) stay where
// the original 8 x 8 layout had them, so the beach, pier and river code keep their coordinates.
export const GRID = {
  N: 6,               // blocks per side
  PITCH: 72,          // distance between road centre lines (m)
  ORIGIN_X: -144,     // x of the first (west) road line
  ORIGIN_Z: -144,     // z of the first (north) road line
};

export const xs = [];
export const zs = [];
for (let i = 0; i <= GRID.N; i++) {
  xs.push(GRID.ORIGIN_X + i * GRID.PITCH);
  zs.push(GRID.ORIGIN_Z + i * GRID.PITCH);
}

// Width of the vertical road at column i (runs north-south, along z)
export function roadWidthV(i) {
  if (i === 0) return 22;          // west highway
  if (i === GRID.N) return 16;     // east beach boulevard
  return 14;
}
// Width of the horizontal road at row j (runs east-west, along x)
export function roadWidthH(j) {
  if (j === 0 || j === GRID.N) return 22; // north / south highway
  return 14;
}
export const isHighwayV = (i) => i === 0;
export const isHighwayH = (j) => j === 0 || j === GRID.N;

export const SIDEWALK = 4;          // sidewalk width inside each block (m)
export const RIVER_ROW = 3;         // block row that is a river
export const BEACH = {
  promenadeX0: xs[GRID.N] + roadWidthV(GRID.N) / 2,      // 296
  sandX0: xs[GRID.N] + roadWidthV(GRID.N) / 2 + 5,       // 301
  flatUntil: 358,
  shoreX: 362,
  wallX: 368,
};
export const RIVER = {
  z0: zs[RIVER_ROW] + roadWidthH(RIVER_ROW) / 2,      // north bank
  z1: zs[RIVER_ROW + 1] - roadWidthH(RIVER_ROW + 1) / 2, // south bank
  waterY: -1.1,
  bedY: -3.2,
};
export const WORLD = {
  minX: xs[0] - roadWidthV(0) / 2 - 0.5,
  maxX: BEACH.wallX,
  minZ: zs[0] - roadWidthH(0) / 2 - 0.5,
  maxZ: zs[GRID.N] + roadWidthH(GRID.N) / 2 + 0.5,
};

// District map: rows = bj (north -> south), cols = bi (west -> east)
// Special blocks (looked up by these positions): sky needle DT(1,1), supermarket COM(3,0),
// restaurant COM(3,1), café SEA(5,1), park pond (1,4), playground (0,5).
export const DISTRICT_MAP = [
  ['IND', 'DT', 'DT', 'COM', 'PARKING', 'SEA'],
  ['STAD', 'DT', 'DT', 'COM', 'FUEL', 'SEA'],
  ['RES', 'PLAZA', 'CIVIC', 'DEALER', 'RES', 'SEA'],
  ['RIVER', 'RIVER', 'RIVER', 'RIVER', 'RIVER', 'RIVER'],
  ['PARK', 'PARK', 'RES', 'APT', 'RES', 'SEA'],
  ['PARK', 'PARK', 'APT', 'RES', 'APT', 'SEA'],
];

export const DISTRICT_INFO = {
  IND: { name: 'Ironworks Industrial', color: '#8a7f72', traffic: 0.8 },
  DT: { name: 'Downtown', color: '#7a8aa6', traffic: 3.0 },
  COM: { name: 'Market Street', color: '#c79a6b', traffic: 2.0 },
  SEA: { name: 'Seafront', color: '#d8c79a', traffic: 1.5 },
  STAD: { name: 'Arena District', color: '#9a8fb3', traffic: 1.2 },
  RES: { name: 'Greenfield Homes', color: '#b6a58e', traffic: 0.7 },
  APT: { name: 'Riverside Apartments', color: '#a89a8a', traffic: 0.9 },
  PARK: { name: 'Central Park', color: '#6f9a5b', traffic: 0.8 },
  PLAZA: { name: 'City Centre', color: '#c9b9a0', traffic: 1.5 },
  CIVIC: { name: 'Civic Quarter', color: '#b8b0a0', traffic: 1.5 },
  PARKING: { name: 'Park & Ride', color: '#8e8e8e', traffic: 1.4 },
  FUEL: { name: 'Fuel Stop', color: '#9e9e9e', traffic: 1.4 },
  DEALER: { name: 'Motor Row', color: '#a0a0a8', traffic: 1.2 },
  RIVER: { name: 'Silver River', color: '#4f86b0', traffic: 1 },
  BEACH: { name: 'Golden Sands Beach', color: '#e6d39a', traffic: 0 },
};

export const QUALITY = {
  low: { post: null, skinnedNpcs: 10, pixelRatio: 0.75, shadows: false, shadowMap: 1024, npcs: 45, traffic: 22, drawDistance: 420, bloom: false, antialias: false, propDistance: 220 },
  medium: { post: 'medium', skinnedNpcs: 22, pixelRatio: 1.0, shadows: true, shadowMap: 2048, npcs: 85, traffic: 36, drawDistance: 600, bloom: false, antialias: true, propDistance: 300 },
  high: { post: 'high', skinnedNpcs: 36, pixelRatio: 1.5, shadows: true, shadowMap: 4096, npcs: 140, traffic: 52, drawDistance: 850, bloom: true, antialias: true, propDistance: 400 },
};

export const MAX_NPCS = 160;
export const MAX_TRAFFIC = 60;

export const COLLISION = {
  STATIC: 0x0001,
  PLAYER: 0x0002,
  VEHICLE: 0x0004,
  TRAFFIC: 0x0008,
};
// Rapier interaction groups: (membership << 16) | filter
export const groups = (membership, filter = 0xffff) => ((membership & 0xffff) << 16) | (filter & 0xffff);

export const START_MONEY = 750;
export const SAVE_KEY = 'cityLife.save.v1';
export const SETTINGS_KEY = 'cityLife.settings.v1';
