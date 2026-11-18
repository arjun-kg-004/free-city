import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

/**
 * Film-style colour grade applied after tone mapping: gentle S-curve contrast,
 * saturation, split-toning (cool shadows / warm highlights) and a soft vignette.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uContrast: { value: 1.08 },
    uSaturation: { value: 1.12 },
    uWarmth: { value: 0.04 },
    uVignette: { value: 0.28 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uContrast, uSaturation, uWarmth, uVignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      // split toning
      col += vec3(uWarmth, uWarmth * 0.35, -uWarmth) * smoothstep(0.45, 1.0, l);
      col += vec3(-uWarmth * 0.6, 0.0, uWarmth * 0.8) * (1.0 - smoothstep(0.0, 0.35, l));
      // vignette
      vec2 d = vUv - 0.5;
      col *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

/** Post-processing chain whose cost scales with the quality preset. */
export class PostFX {
  constructor(renderer, scene, camera, level) {
    this.level = level; // 'medium' | 'high'
    const w = window.innerWidth, h = window.innerHeight;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    if (level === 'high') {
      this.ao = new GTAOPass(scene, camera, w, h);
      this.ao.output = GTAOPass.OUTPUT.Default;
      this.ao.blendIntensity = 0.85;
      this.ao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.6, thickness: 1.5, scale: 1.0, samples: 12, distanceFallOff: 1.0 });
      this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
      this.composer.addPass(this.ao);
    }
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.smaa = new SMAAPass(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    this.composer.addPass(this.smaa);
  }

  /** Adjust grading to the light: warmer at golden hour. */
  updateMood(golden) {
    this.grade.uniforms.uWarmth.value = 0.03 + golden * 0.05;
  }

  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
  }

  render() {
    this.composer.render();
  }

  dispose() {
    this.composer.dispose();
  }
}
