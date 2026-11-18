import * as THREE from 'three';

/**
 * Realistic procedural facade shader (MeshStandardMaterial + onBeforeCompile).
 *
 * - Interior mapping: every window shows a fake 3D room (walls, floor, ceiling, furniture,
 *   blinds) that shifts correctly with the camera, softly lit by daylight.
 * - Real glass: dark, glossy, dielectric, so the sky reflection appears at grazing angles.
 * - Window frames + mullions, recessed-edge shading, sills, floor bands.
 * - Facade materials: plaster/concrete panels, brick (some apartments & houses),
 *   weathering streaks and dirt near the ground.
 * - Shop fronts with lit, deep interiors on the ground floor.
 * Distance-aware anti-aliasing fades fine detail into averages to avoid shimmering.
 *
 * Per-instance attributes: aStyle (0 office · 1 apartment · 2 house · 3 industrial
 * · 4 shops/hotel · 5 civic · 6 plain) and aSeed (random variety).
 */
export function createBuildingMaterial({ cylinder = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aStyle;
        attribute float aSeed;
        varying vec3 vSP;
        varying vec3 vON;
        varying vec3 vWPos;
        flat varying float vStyle;
        flat varying float vSeed;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 bScale = vec3(1.0);
        vec4 bw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          bScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          bw = instanceMatrix * bw;
        #endif
        vWPos = (modelMatrix * bw).xyz;
        vSP = transformed * bScale;
        vON = objectNormal;
        vStyle = aStyle;
        vSeed = aSeed;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSP;
        varying vec3 vON;
        varying vec3 vWPos;
        flat varying float vStyle;
        flat varying float vSeed;
        float bHash(vec2 p){
          p += vec2(vSeed * 0.731, vSeed * 1.37);
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        float bNoise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(bHash(i), bHash(i + vec2(1.0, 0.0)), f.x), mix(bHash(i + vec2(0.0, 1.0)), bHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        // box mask with anti-aliased edges; e = edge widths (in cell units), aa = pixel footprint
        float bBox(vec2 f, vec2 e, vec2 aa){
          vec2 a = smoothstep(e - aa, e + aa, f) * (1.0 - smoothstep(1.0 - e - aa, 1.0 - e + aa, f));
          return a.x * a.y;
        }
        // fake room behind a window: p = point on glass in metres (0..w, 0..h), r = view ray in facade space
        vec3 bRoom(vec3 p, vec3 r, float w, float h, float d, vec2 id, float lit, out float ceilingGlow){
          float tb = d / max(r.z, 1e-3);
          float tx = ((r.x > 0.0 ? w : 0.0) - p.x) / (abs(r.x) < 1e-4 ? 1e-4 : r.x);
          float ty = ((r.y > 0.0 ? h : 0.0) - p.y) / (abs(r.y) < 1e-4 ? 1e-4 : r.y);
          float t = min(tb, min(tx, ty));
          vec3 hp = p + r * t;
          float rh = bHash(id * 1.7 + 3.0);
          vec3 wallC = mix(vec3(0.82, 0.78, 0.70), vec3(0.62, 0.70, 0.78), step(0.6, rh));
          wallC = mix(wallC, vec3(0.80, 0.66, 0.55), step(0.85, rh));
          vec3 col;
          ceilingGlow = 0.0;
          if (t == tb) {
            col = wallC;
            // furniture: a sofa / desk silhouette and a picture frame
            float fx = hp.x / w;
            if (hp.y < h * 0.32 && fx > 0.18 + rh * 0.2 && fx < 0.62 + rh * 0.2) col *= 0.45 + 0.2 * bHash(id + 9.0);
            if (hp.y > h * 0.45 && hp.y < h * 0.7 && fx > 0.6 && fx < 0.82) col = mix(col, vec3(0.25, 0.32, 0.4), 0.7);
          } else if (t == tx) {
            col = wallC * 0.78;
          } else if (r.y < 0.0) {
            col = mix(vec3(0.32, 0.22, 0.14), vec3(0.45, 0.42, 0.40), step(0.5, rh)); // floor: wood or tiles
          } else {
            col = vec3(0.9);
            vec2 c = vec2(hp.x / w - 0.5, hp.z / d - 0.5);
            ceilingGlow = smoothstep(0.18, 0.0, length(c)) * lit;
          }
          col *= mix(1.0, 0.45, clamp(hp.z / d, 0.0, 1.0)); // darker deeper inside
          return col;
        }
        float bWin = 0.0;     // glass coverage (0..1)
        float bFrame = 0.0;   // window frame coverage
        float bOffice = 0.0;  // curtain-wall offices use tinted, more reflective glass
        vec3 bRoomEmis = vec3(0.0);`)

      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 n = normalize(vON);
          bool side = abs(n.y) < 0.5;
          ${cylinder
            ? 'vec3 tU = normalize(vec3(n.z, 0.0, -n.x)); float u = atan(vSP.x, vSP.z) * length(vSP.xz);'
            : 'vec3 tU = abs(n.x) > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0); float u = dot(vSP, tU);'}
          float v = vSP.y;
          float st = floor(vStyle + 0.5);
          float cw = 3.0, ch = 3.4, mx = 0.18, my = 0.22, gf = 0.6;
          if (st < 0.5) { cw = 2.2; ch = 3.6; mx = 0.05; my = 0.1; gf = 4.2; }
          else if (st < 1.5) { cw = 3.6; ch = 3.0; mx = 0.24; my = 0.26; gf = 3.0; }
          else if (st < 2.5) { cw = 3.2; ch = 3.0; mx = 0.3; my = 0.28; gf = 0.8; }
          else if (st < 3.5) { cw = 4.0; ch = 6.0; mx = 0.2; my = 0.62; gf = 3.5; }
          else if (st < 4.5) { cw = 3.0; ch = 3.3; mx = 0.2; my = 0.24; gf = 4.0; }
          else if (st < 5.5) { cw = 2.6; ch = 5.0; mx = 0.3; my = 0.15; gf = 1.0; }
          vec2 cell = vec2(u / cw, (v - gf) / ch);
          vec2 fw = fwidth(cell);
          float farAA = smoothstep(0.2, 0.5, max(fw.x, fw.y));
          vec3 wall = diffuseColor.rgb;
          float matSel = bHash(vec2(vSeed, 7.7));
          bOffice = st < 0.5 ? 1.0 : 0.0;

          if (side) {
            // ---- facade material ----
            if ((st > 0.5 && st < 2.5 && matSel > 0.45) || (st > 2.5 && st < 3.5 && matSel > 0.7)) {
              // brick: rows 7.5 cm, bricks 25 cm, half-bond
              float row = floor(v / 0.075);
              vec2 bc = vec2(u / 0.25 + mod(row, 2.0) * 0.5, v / 0.075);
              vec2 bf = fract(bc);
              vec2 bfw = fwidth(bc);
              float mortar = 1.0 - bBox(bf, vec2(0.04, 0.09), bfw);
              float tone = 0.8 + 0.35 * bHash(floor(bc));
              vec3 brick = mix(vec3(0.55, 0.27, 0.19), vec3(0.62, 0.42, 0.30), step(0.5, matSel)) * tone;
              brick = mix(brick, vec3(0.70, 0.67, 0.62), mortar);
              float fade = smoothstep(0.25, 0.6, max(bfw.x, bfw.y));
              wall = mix(brick, mix(vec3(0.55, 0.30, 0.22), vec3(0.62, 0.45, 0.33), step(0.5, matSel)) * 0.95, fade);
            } else if (st < 0.5 || st > 4.5) {
              // concrete / stone panels
              vec2 pc = vec2(u / 1.5, v / 1.2);
              vec2 pf = fract(pc);
              float seam = 1.0 - bBox(pf, vec2(0.012, 0.015), fwidth(pc));
              wall *= (0.94 + 0.08 * bHash(floor(pc))) * mix(1.0, 0.82, seam * (1.0 - farAA));
            }
            // weathering: soft blotches, vertical rain streaks, dirt near the ground
            float blot = bNoise(vec2(u, v) * 0.35);
            float streak = bNoise(vec2(u * 1.7, v * 0.06 + vSeed));
            wall *= 0.88 + 0.12 * blot;
            wall *= 1.0 - 0.12 * smoothstep(0.55, 0.95, streak);
            wall *= mix(0.72, 1.0, smoothstep(0.0, 1.4, v));

            if (st < 5.5) {
              vec2 f = fract(cell);
              vec2 id = floor(cell) + vec2(sign(n.x) * 31.0 + sign(n.z) * 17.0, 0.0);
              if (v > gf + 0.3) {
                vec2 aa = fw * 0.75 + 1e-4;
                float glass = bBox(f, vec2(mx, my), aa);
                // frame: a thin border just inside the opening + a mullion on wide windows
                vec2 fr = vec2(0.055 / cw, 0.055 / ch);
                float inner = bBox(f, vec2(mx, my) + fr, aa);
                float mull = (cw * (1.0 - 2.0 * mx) > 1.6) ? (1.0 - smoothstep(fr.x * 0.5, fr.x * 0.5 + aa.x, abs(f.x - 0.5))) : 0.0;
                float frame = clamp(glass - inner + mull * inner, 0.0, 1.0);
                // recess shadow on the wall around the opening + sill below it
                float halo = bBox(f, vec2(mx, my) - vec2(0.03 / cw, 0.04 / ch), aa) - glass;
                float sill = (1.0 - smoothstep(0.0, aa.y + 0.02, abs(f.y - (my - 0.025)))) * step(mx, f.x) * step(f.x, 1.0 - mx);
                wall *= 1.0 - 0.35 * halo * (1.0 - farAA);
                wall = mix(wall, vec3(0.78, 0.76, 0.72), sill * 0.8 * (1.0 - farAA) * step(0.5, st));
                float avgCov = (1.0 - 2.0 * mx) * (1.0 - 2.0 * my);
                bWin = mix(inner * (1.0 - mull), avgCov * 0.9, farAA);
                bFrame = frame * (1.0 - farAA);
                // ---- interior ----
                float lit = step(0.5, bHash(id));
                float blinds = step(0.62, bHash(id + 4.0)) * (0.25 + 0.6 * bHash(id + 5.0));
                vec3 V = normalize(vWPos - cameraPosition);
                vec3 r = vec3(dot(V, tU), V.y, dot(V, -n));
                float ww = cw * (1.0 - 2.0 * mx), wh = ch * (1.0 - 2.0 * my);
                vec3 p = vec3((f.x - mx) / (1.0 - 2.0 * mx) * ww, (f.y - my) / (1.0 - 2.0 * my) * wh, 0.0);
                float glow;
                vec3 room = bRoom(p, r, ww, wh * 1.15, max(3.0, cw * 1.2), id, lit, glow);
                float gy = (f.y - my) / (1.0 - 2.0 * my);
                vec3 blindC = mix(vec3(0.85, 0.82, 0.74), vec3(0.55, 0.6, 0.66), step(0.5, bHash(id + 6.0)));
                float slat = 0.85 + 0.15 * step(0.5, fract(gy * wh / 0.06));
                room = mix(room, blindC * slat, step(1.0 - blinds, gy));
                bRoomEmis = mix(room * 0.32, vec3(0.55, 0.5, 0.45) * 0.32, farAA);
              }
              // shop front (ground floor of shops / hotels): deep, always-lit interiors
              if (st > 3.5 && st < 4.5 && v < 3.0 && v > 0.35) {
                vec2 sc = vec2(u / 2.4, (v - 0.35) / 2.65);
                vec2 sf = fract(sc);
                float sg = mix(bBox(sf, vec2(0.04, 0.0), fwidth(sc) * 0.75 + 1e-4), 0.9, farAA);
                vec3 V = normalize(vWPos - cameraPosition);
                vec3 r = vec3(dot(V, tU), V.y, dot(V, -n));
                float glow;
                vec3 room = bRoom(vec3(sf.x * 2.4, sf.y * 2.65, 0.0), r, 2.4, 2.65, 6.0, floor(sc) + 50.0, 1.0, glow);
                room = mix(room, room * vec3(1.1, 0.95, 0.8) + vec3(0.1, 0.05, 0.0) * bHash(floor(sc)), 0.5);
                // shelves / racks inside the shop
                float shelf = step(0.5, fract(sf.y * 5.0)) * step(0.15, sf.x) * step(sf.x, 0.85);
                room *= mix(1.0, 0.7 + 0.6 * bHash(floor(sc) + floor(sf.x * 6.0)), shelf * 0.6);
                bRoomEmis = mix(bRoomEmis, room * 0.22 + vec3(1.0, 0.9, 0.7) * glow * 0.8, sg);
                bWin = max(bWin, sg);
              }
            }
            // horizontal floor bands on offices / apartments
            if ((st < 1.5) && v > gf) {
              float bandY = fract((v - gf) / ch);
              float band = 1.0 - smoothstep(0.0, fw.y * 1.5 + 0.01, abs(bandY - 0.0));
              wall *= 1.0 - 0.15 * band * (1.0 - farAA);
            }
          } else if (n.y > 0.5) {
            // roofs: tar / gravel, darker
            wall = vec3(0.32, 0.31, 0.30) * (0.85 + 0.15 * bNoise(vSP.xz * 0.5));
          }
          vec3 frameC = mix(vec3(0.16, 0.17, 0.18), vec3(0.88, 0.88, 0.85), step(0.55, bHash(vec2(vSeed, 2.0))));
          diffuseColor.rgb = mix(wall, frameC, bFrame);
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.02, 0.025, 0.03), vec3(0.28, 0.36, 0.42), bOffice), bWin);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.06, bWin);
        roughnessFactor = mix(roughnessFactor, 0.45, bFrame);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.45 * bOffice, bWin);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += bRoomEmis * bWin * mix(1.0, 0.6, bOffice);`);
  };
  mat.customProgramCacheKey = () => (cylinder ? 'bld2-cyl' : 'bld2-box');
  return mat;
}
