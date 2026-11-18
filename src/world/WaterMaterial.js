import * as THREE from 'three';
import { BEACH } from '../config.js';

/**
 * Animated water: Gerstner-like sine waves displaced in the vertex shader, analytic normals,
 * shoreline foam and depth tint. Built on MeshStandardMaterial so it gets fog, lights and
 * environment reflections for free. Wave height ramps up towards the open ocean.
 */
export function createWaterMaterial(shared) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1f6f95, roughness: 0.08, metalness: 0.05, transparent: true, opacity: 0.93,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uShore = { value: BEACH.shoreX };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform float uShore;
        varying vec3 vWW;
        varying float vCrest;
        float wAmp(vec2 p){ return 0.04 + 0.32 * smoothstep(uShore - 6.0, uShore + 60.0, p.x); }
        vec3 waveAt(vec2 p, out vec3 nrm){
          float a = wAmp(p);
          float h = 0.0; vec2 grad = vec2(0.0);
          vec2 dirs[4]; dirs[0]=normalize(vec2(-1.0,0.15)); dirs[1]=normalize(vec2(-0.8,-0.6)); dirs[2]=normalize(vec2(-0.6,0.8)); dirs[3]=normalize(vec2(0.3,1.0));
          float fr[4]; fr[0]=0.16; fr[1]=0.27; fr[2]=0.45; fr[3]=0.8;
          float am[4]; am[0]=1.0; am[1]=0.5; am[2]=0.25; am[3]=0.12;
          float sp[4]; sp[0]=1.3; sp[1]=1.7; sp[2]=2.3; sp[3]=3.1;
          for (int i=0;i<4;i++){
            float ph = dot(dirs[i], p) * fr[i] + uTime * sp[i];
            h += sin(ph) * am[i];
            grad += dirs[i] * fr[i] * cos(ph) * am[i];
          }
          nrm = normalize(vec3(-grad.x * a, 1.0, -grad.y * a));
          return vec3(0.0, h * a, 0.0);
        }`)
      .replace('#include <beginnormal_vertex>', `
        vec4 wwp = modelMatrix * vec4(position, 1.0);
        vec3 wN;
        vec3 wOff = waveAt(wwp.xz, wN);
        vec3 objectNormal = wN;
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(1.0, 0.0, 0.0);
        #endif`)
      .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
        transformed.z += wOff.y; // plane is rotated -90deg about X, so local z is world up
        vWW = wwp.xyz;
        vCrest = wOff.y / max(wAmp(wwp.xz), 0.001);`);
    // the plane is rotated: local normal (0,1,0) is not world up. Convert world normal to object space.
    shader.vertexShader = shader.vertexShader.replace('vec3 objectNormal = wN;', 'vec3 objectNormal = vec3(wN.x, -wN.z, wN.y);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform float uShore;
        varying vec3 vWW;
        varying float vCrest;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float deep = smoothstep(uShore, uShore + 90.0, vWW.x);
          vec3 shallow = vec3(0.16, 0.62, 0.66);
          vec3 deepC = vec3(0.04, 0.22, 0.38);
          vec3 c = mix(shallow, deepC, deep);
          if (vWW.x < 300.0) c = vec3(0.12, 0.33, 0.36); // river / pond tint
          float shoreFoam = (1.0 - smoothstep(0.0, 7.0, vWW.x - uShore)) * step(uShore - 3.0, vWW.x);
          float band = 0.5 + 0.5 * sin(vWW.x * 1.3 - uTime * 2.2 + sin(vWW.z * 0.15) * 2.0);
          float crestFoam = smoothstep(1.1, 1.6, vCrest) * deep;
          float foam = clamp(shoreFoam * (0.45 + 0.55 * band) + crestFoam * 0.6, 0.0, 1.0);
          diffuseColor.rgb = mix(c, vec3(0.95, 0.97, 0.98), foam);
        }`);
  };
  mat.customProgramCacheKey = () => 'city-water';
  return mat;
}
