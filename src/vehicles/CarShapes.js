import * as THREE from 'three';

/**
 * Unit-sized car body parts (fit in a 1×1×1 box centred on the origin, front = +Z).
 * They are scaled per car shape, so every traffic car, parked car and player car
 * gets a rounded, sculpted silhouette instead of stacked boxes — without extra draw calls.
 */
let bodyGeo = null, cabinGeo = null;

function normalize(g) {
  g.computeBoundingBox();
  const b = g.boundingBox, s = new THREE.Vector3();
  b.getSize(s);
  g.center();
  g.scale(1 / s.x, 1 / s.y, 1 / s.z);
  return g;
}

/** Lower body: side profile with rounded nose and tail, extruded across the width with a bevel. */
export function unitCarBody() {
  if (bodyGeo) return bodyGeo;
  const p = new THREE.Shape();
  // (shape x = car length axis, y = height), front at +x
  p.moveTo(-0.44, -0.5);
  p.lineTo(0.44, -0.5);
  p.quadraticCurveTo(0.5, -0.5, 0.5, -0.32);   // front lower lip
  p.lineTo(0.5, 0.02);                          // front fascia
  p.quadraticCurveTo(0.5, 0.36, 0.36, 0.42);   // rounded nose into the bonnet
  p.lineTo(0.16, 0.5);                          // bonnet rises to the windscreen
  p.lineTo(-0.36, 0.5);
  p.quadraticCurveTo(-0.5, 0.48, -0.5, 0.26);  // boot lid rounding into the tail
  p.lineTo(-0.5, -0.34);
  p.quadraticCurveTo(-0.5, -0.5, -0.44, -0.5);
  const g = new THREE.ExtrudeGeometry(p, { depth: 1, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.03, bevelSegments: 1, curveSegments: 3 });
  g.rotateY(-Math.PI / 2);
  bodyGeo = normalize(g);
  bodyGeo.deleteAttribute('uv');
  bodyGeo.computeVertexNormals();
  return bodyGeo;
}

/** Glasshouse: narrower at the roof, raked windscreen and rear window. */
export const CABIN_TOP = { w: 0.8, front: 0.18, back: -0.36 };
export function unitCarCabin() {
  if (cabinGeo) return cabinGeo;
  const g = new THREE.BoxGeometry(1, 1, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      pos.setX(i, pos.getX(i) * CABIN_TOP.w);
      pos.setZ(i, pos.getZ(i) > 0 ? CABIN_TOP.front : CABIN_TOP.back);
    }
  }
  g.computeVertexNormals();
  cabinGeo = g;
  return g;
}

/** Roof panel placement (relative to cabin centre) for a shape. */
export const isBoxy = (s) => s.cabL > 3; // vans and buses keep an upright glasshouse
export function roofPlacement(s) {
  if (isBoxy(s)) return { z: s.cabZ, w: s.W * 0.86, l: s.cabL * 0.96 };
  return {
    z: s.cabZ + ((CABIN_TOP.front + CABIN_TOP.back) / 2) * s.cabL,
    w: s.W * 0.88 * CABIN_TOP.w * 1.02,
    l: (CABIN_TOP.front - CABIN_TOP.back) * s.cabL * 1.04,
  };
}
