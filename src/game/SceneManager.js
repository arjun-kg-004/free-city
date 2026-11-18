import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { PostFX } from './PostFX.js';
import { Textures } from '../utils/Textures.js';
import { clamp, lerp, smoothstep } from '../utils/Random.js';

/** Renderer, camera, lighting, sky and weather (fixed daytime). */
export class SceneManager {
  constructor(container, settings) {
    this.container = container;
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ antialias: settings.quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 2600);
    this.camera.position.set(0, 10, 20);

    this.shared = {
      uTime: { value: 0 },
    };

    this.fog = new THREE.Fog(0xbfd6e8, 120, 650);
    this.scene.fog = this.fog;

    // Image-based lighting: the environment map is rendered from the live sky (see _updateEnvironment),
    // so reflections on cars, glass and wet roads always match the time of day.
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTarget = null;
    this.envTimer = 0;
    this._envSun = new THREE.Vector3(0, -2, 0);
    this._envCloud = -1;
    this.scene.environmentIntensity = 0.8;

    // Lights
    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5b5040, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.45;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Sky
    this.sky = new Sky();
    this.sky.scale.setScalar(2000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 6;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.8;
    this.scene.add(this.sky);
    this.sunDir = new THREE.Vector3();
    // A second sky (sharing the same material/uniforms) + a ground disc, used only to bake the environment map
    this.envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.material = this.sky.material;
    envSky.scale.setScalar(50);
    this.envScene.add(envSky);
    this.envGroundMat = new THREE.MeshBasicMaterial({ color: 0x4a4a44, side: THREE.DoubleSide });
    const envGround = this.envGround = new THREE.Mesh(new THREE.CircleGeometry(60, 24), this.envGroundMat);
    envGround.rotation.x = -Math.PI / 2;
    envGround.position.y = -1.5;
    this.envScene.add(envGround);

    this._buildClouds();

    this.timeOfDay = 9; // hours (fixed daylight)
    this.cloudiness = 0.2;
    this.targetCloud = 0.2;
    this.weatherName = 'Clear';

    this.composer = null;
    this.applyQuality(settings);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  applyQuality(settings) {
    const q = settings.qualityPreset;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.shadowMap.enabled = !!(settings.shadows && q.shadows);
    this.sun.castShadow = this.renderer.shadowMap.enabled;
    if (this.sun.shadow.mapSize.x !== q.shadowMap) {
      this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    const far = settings.drawDistance || q.drawDistance;
    this.camera.far = Math.max(2600, far * 2);
    this.camera.updateProjectionMatrix();
    this.baseFogFar = far;
    // Materials must recompile when shadow state changes.
    this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); });
    // Shadow frustum: tighter = crisper shadows near the player
    const ext = q.shadowMap >= 4096 ? 60 : q.shadowMap >= 2048 ? 70 : 80;
    const sc = this.sun.shadow.camera;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
    sc.updateProjectionMatrix();
    const level = settings.bloom !== false && q.post ? q.post : null;
    if (this.postfx && this.postfx.level !== level) { this.postfx.dispose(); this.postfx = null; }
    if (level && !this.postfx) this.postfx = new PostFX(this.renderer, this.scene, this.camera, level);
    if (this.postfx) this.postfx.setSize(window.innerWidth, window.innerHeight, this.renderer.getPixelRatio());
    this.composer = this.postfx ? this.postfx.composer : null;
  }

  /**
   * Real photographed surroundings for reflections: the lower part of an HDR panorama (streets,
   * buildings) wraps the environment-bake scene below the live procedural sky, so cars and glass
   * reflect a real city above the ground while the sky stays live.
   */
  setHDRI(hdri) {
    if (!hdri) return;
    this.hdri = hdri;
    const top = THREE.MathUtils.degToRad(72); // from 18° above the horizon down to the ground
    const geo = new THREE.SphereGeometry(45, 64, 24, 0, Math.PI * 2, top, Math.PI - top);
    // equirect v for each vertex from its actual direction
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 45;
      uv.setY(i, 0.5 + Math.asin(THREE.MathUtils.clamp(y, -1, 1)) / Math.PI);
    }
    this.hdriMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, map: hdri.day, fog: false, depthWrite: false });
    this.hdriMesh = new THREE.Mesh(geo, this.hdriMat);
    this.hdriMesh.rotation.y = THREE.MathUtils.degToRad(hdri.rotation || 0);
    this.envScene.add(this.hdriMesh);
    this.envGround.visible = false;
    this._envSun.set(9, 9, 9); // force a re-bake
    this.envTimer = 0;
  }

  /** Re-bake the image-based lighting from the sky when the sun or weather changed noticeably. */
  _updateEnvironment(dt, sunUp) {
    this.envTimer -= dt;
    if (this.envTimer > 0) return;
    if (this._envSun.distanceTo(this.sunDir) < 0.015 && Math.abs(this._envCloud - this.cloudiness) < 0.05) return;
    this.envTimer = 0.5;
    this._envSun.copy(this.sunDir);
    this._envCloud = this.cloudiness;
    const g = 0.05 + 0.28 * sunUp;
    this.envGroundMat.color.setRGB(g * 1.0, g * 0.97, g * 0.88);
    // daylight panorama dims with the sun and under cloud
    if (this.hdriMat) this.hdriMat.color.setScalar(Math.max(0.04, sunUp) * (1 - this.cloudiness * 0.35) * 0.55);
    const old = this.envTarget;
    this.envTarget = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 200);
    this.scene.environment = this.envTarget.texture;
    if (old) old.dispose();
  }

  _buildClouds() {
    const n = 46;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.cloudMat = new THREE.MeshBasicMaterial({ map: Textures.cloud, transparent: true, opacity: 0.8, depthWrite: false, fog: false, side: THREE.DoubleSide });
    this.clouds = new THREE.InstancedMesh(geo, this.cloudMat, n);
    this.clouds.frustumCulled = false;
    this.cloudData = [];
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const d = { x: (Math.random() - 0.5) * 2400, z: (Math.random() - 0.5) * 2400, y: 260 + Math.random() * 120, s: 180 + Math.random() * 260, r: Math.random() * 6 };
      this.cloudData.push(d);
      m.makeRotationY(d.r).scale(new THREE.Vector3(d.s, 1, d.s * 0.6)).setPosition(d.x, d.y, d.z);
      this.clouds.setMatrixAt(i, m);
    }
    this.scene.add(this.clouds);
  }

  setWeatherMode(mode) {
    this.weatherMode = mode;
    // only clear or cloudy; old 'dynamic'/'rain' settings fall back to clear
    if (mode !== 'cloudy') this.weatherMode = 'clear';
    this.targetCloud = mode === 'cloudy' ? 0.85 : 0.15;
  }

  update(dt, focus) {
    this.shared.uTime.value += dt;
    const t = this.timeOfDay; // fixed: there is no day/night cycle

    this.cloudiness = lerp(this.cloudiness, this.targetCloud, 1 - Math.exp(-0.15 * dt));
    this.weatherName = this.cloudiness > 0.6 ? 'Cloudy' : 'Clear';

    // Sun position
    const elev = (Math.PI / 2) * Math.sin(((t - 6) / 12) * Math.PI);
    const az = ((t - 12) / 24) * Math.PI * 2 + 0.6;
    this.sunDir.set(Math.cos(elev) * Math.sin(az), Math.sin(elev), Math.cos(elev) * Math.cos(az)).normalize();
    const sunUp = smoothstep(-0.12, 0.2, this.sunDir.y);
    const golden = smoothstep(0.45, 0.05, Math.abs(this.sunDir.y)) * smoothstep(-0.15, 0.02, this.sunDir.y);

    const cloudDim = 1 - this.cloudiness * 0.55;
    this.sun.intensity = 3.4 * sunUp * cloudDim;
    this.sun.color.setRGB(1, lerp(1, 0.72, golden), lerp(1, 0.5, golden));
    // sky IBL carries most of the ambient light now; the hemisphere light just fills in
    this.hemi.intensity = lerp(0.14, 0.3, sunUp) * lerp(1, 1.5, this.cloudiness);
    this.hemi.color.setRGB(lerp(0.32, 0.8, sunUp), lerp(0.38, 0.88, sunUp), lerp(0.6, 1.0, sunUp));
    this.hemi.groundColor.setRGB(lerp(0.08, 0.36, sunUp), lerp(0.08, 0.32, sunUp), lerp(0.12, 0.26, sunUp));
    this.scene.environmentIntensity = lerp(0.08, 0.55, sunUp) * lerp(1, 1.15, this.cloudiness);
    this.renderer.toneMappingExposure = lerp(0.72, 0.86, sunUp);

    // Light follows the focus for crisp shadows near the player
    const fx = focus.x, fz = focus.z;
    const src = this.sunDir.y > 0 ? this.sunDir : new THREE.Vector3(-this.sunDir.x, 0.5, -this.sunDir.z).normalize();
    this.sun.position.set(fx + src.x * 200, Math.max(20, src.y * 200), fz + src.z * 200);
    this.sun.target.position.set(fx, 0, fz);

    // Sky shader
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.rayleigh.value = lerp(1.2, 3.2, golden) + this.cloudiness * 0.6;
    u.turbidity.value = 5 + this.cloudiness * 9;
    this.sky.position.copy(this.camera.position);

    // Fog / horizon colour
    const day = new THREE.Color(0xaec6dc);
    const dusk = new THREE.Color(0xe0a383);
    const grey = new THREE.Color(0x8d969e);
    const c = day.clone().lerp(dusk, golden);
    c.lerp(grey, this.cloudiness * 0.6);
    this.fog.color.copy(c);
    if (this.horizon) {
      const hu = this.horizon.uniforms;
      hu.uFog.value.copy(c);
      hu.uSun.value.copy(this.sunDir.y > 0 ? this.sunDir : new THREE.Vector3(0.3, 0.6, 0.2));
      hu.uLight.value = Math.max(0.12, sunUp) * (1 - this.cloudiness * 0.4);
    }
    this.renderer.setClearColor(c);
    const fogFar = (this.baseFogFar || 420) * lerp(1, 0.85, this.cloudiness);
    this.fog.far = fogFar;
    this.fog.near = fogFar * 0.35;
    if (this.postfx) this.postfx.updateMood(golden);
    this.golden = golden;
    this._updateEnvironment(dt, sunUp);

    // Clouds
    this.cloudMat.opacity = 0.25 + this.cloudiness * 0.7;
    this.cloudMat.color.setRGB(lerp(1, 0.55, this.cloudiness), lerp(1, 0.57, this.cloudiness), lerp(1, 0.6, this.cloudiness));
    this.clouds.position.x = (this.shared.uTime.value * 3) % 600;

  }

  render() {
    if (this.postfx) this.postfx.render();
    else this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.postfx) this.postfx.setSize(w, h, this.renderer.getPixelRatio());
  }

  get clockString() {
    const h = Math.floor(this.timeOfDay);
    const m = Math.floor((this.timeOfDay - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}

export { clamp };
