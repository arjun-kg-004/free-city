import * as THREE from 'three';
import { Random } from '../utils/Random.js';

/**
 * Distant mountain ring around the city (west, north and south — the east is open sea),
 * shaded with simple sun lighting and blended into the sky haze for aerial perspective.
 */
export function buildHorizon(scene, sceneManager) {
  const rng = new Random(909);
  const seg = 256, rings = 7;
  const r0 = 950, r1 = 1900;
  const pos = [], idx = [];
  // a few octaves of angular noise for the ridge line
  const oct = [];
  for (let k = 0; k < 5; k++) oct.push({ f: 2 + k * 3 + rng.range(0, 2), a: 1 / (k + 1), p: rng.range(0, 6.28) });
  const ridge = (a) => {
    let h = 0;
    for (const o of oct) h += Math.sin(a * o.f + o.p) * o.a;
    return h;
  };
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const rad = r0 + (r1 - r0) * t;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const seaSide = THREE.MathUtils.smoothstep(Math.cos(a), 0.15, 0.55); // east = ocean
      const profile = Math.sin(t * Math.PI) * (1 - 0.3 * t);         // rise then fall across the ring
      let h = (130 + ridge(a + t * 0.6) * 90 + rng.range(-12, 12)) * profile;
      h = h * (1 - seaSide) - 40 * seaSide;
      pos.push(x, Math.max(-50, h), z);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i, b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const uniforms = {
    uFog: { value: new THREE.Color(0xaec6dc) },
    uSun: { value: new THREE.Vector3(0, 1, 0) },
    uLight: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vP;
      void main() {
        vN = normal; vP = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uFog; uniform vec3 uSun; uniform float uLight;
      varying vec3 vN; varying vec3 vP;
      void main() {
        vec3 n = normalize(vN);
        float slope = 1.0 - n.y;
        vec3 forest = vec3(0.16, 0.24, 0.15);
        vec3 rock = vec3(0.36, 0.34, 0.31);
        vec3 col = mix(forest, rock, smoothstep(0.35, 0.7, slope) + smoothstep(140.0, 220.0, vP.y) * 0.6);
        float diff = max(dot(n, normalize(uSun)), 0.0);
        col *= (0.35 + 0.9 * diff) * uLight + 0.04;
        float dist = length(vP.xz);
        float haze = clamp(0.5 + (dist - 950.0) / 2200.0 + (1.0 - smoothstep(0.0, 160.0, vP.y)) * 0.12, 0.0, 0.92);
        gl_FragColor = vec4(mix(col, uFog, haze), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -0.5;
  scene.add(mesh);
  sceneManager.horizon = { mesh, uniforms };
  return mesh;
}
