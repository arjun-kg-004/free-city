import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Optional realistic asset loader.
 *
 * The game always works with its built-in procedural models. When `public/models/manifest.json`
 * exists, the listed GLB files replace them:
 *
 * {
 *   "characters": { "player": "Soldier.glb", "npcs": ["Xbot.glb", "Soldier.glb"] },
 *   "animations": ["extra-animations.glb"],          // optional Mixamo animation packs (same rig)
 *   "vehicles": { "sedan": "sedan.glb", "motorcycle": { "file": "bike.glb", "rotateY": 180 } },
 *   "traffic": ["sedan.glb", "hatch.glb"]             // car models used by AI traffic & parked cars
 * }
 *
 * Old-style keys ("player": "x.glb", "vehicle_sedan": "y.glb") are still accepted.
 */
export class AssetLoader {
  constructor() {
    this.loader = new GLTFLoader();
    try {
      const draco = new DRACOLoader();
      draco.setDecoderPath(`${(import.meta.env && import.meta.env.BASE_URL) || './'}draco/`);
      this.loader.setDRACOLoader(draco);
    } catch { /* draco optional */ }
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.cache = new Map();          // file -> gltf
    this.characters = { player: null, npcs: [] };
    this.clips = [];                 // shared animation clips (from every loaded character / pack)
    this.vehicles = new Map();       // type -> { gltf, options }
    this.traffic = [];               // [{ gltf, options }]
    this.base = (import.meta.env && import.meta.env.BASE_URL) || './';
    this.manifest = null;
  }

  /** URL for a model-folder file; base64 ".b64.txt" files (for text-only hosts) become blob URLs. */
  async _url(file) {
    if (!/\.b64(\.txt)?$/i.test(file)) return `${this.base}models/${file}`;
    const res = await fetch(`${this.base}models/${file}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${file}`);
    const bin = Uint8Array.from(atob((await res.text()).trim()), (c) => c.charCodeAt(0));
    return URL.createObjectURL(new Blob([bin]));
  }

  _load(file) {
    if (!this.cache.has(file)) {
      const pr = this._loadFile(file);
      this.cache.set(file, pr);
      pr.catch(() => this.cache.delete(file));
    }
    return this.cache.get(file);
  }

  async _loadFile(file) {
    let gltf;
    const real = file.replace(/\.b64(\.txt)?$/i, '');
    if (/\.fbx$/i.test(real)) {
      // Mixamo downloads can be dropped in as-is (FBX); wrap like a glTF result
      const obj = await new FBXLoader().loadAsync(await this._url(file));
      // Mixamo names every clip "mixamo.com" — use the file name ("Walking.fbx" -> "Walking")
      const base = real.split('/').pop().replace(/\.fbx$/i, '');
      (obj.animations || []).forEach((c, i) => { if (!c.name || /mixamo\.com|^take ?\d*$/i.test(c.name)) c.name = i ? `${base} ${i}` : base; });
      gltf = { scene: obj, animations: obj.animations || [] };
    } else if (/\.b64(\.txt)?$/i.test(file)) {
      const res = await fetch(`${this.base}models/${file}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${file}`);
      const bin = Uint8Array.from(atob((await res.text()).trim()), (c) => c.charCodeAt(0));
      gltf = await this.loader.parseAsync(bin.buffer, `${this.base}models/`);
    } else {
      gltf = await this.loader.loadAsync(`${this.base}models/${file}`);
    }
    gltf.scene.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    return gltf;
  }

  /** Loads many files at once (network + decode overlap), keeping manifest order for results. */
  async _loadAll(jobs, onProgress) {
    let done = 0;
    const run = async (job) => {
      const [kind, entry, type] = job;
      const file = typeof entry === 'string' ? entry : entry.file;
      const options = typeof entry === 'string' ? {} : { ...entry };
      try {
        const gltf = await this._load(file);
        if (options.lod) {
          try { options.lodGltf = await this._load(options.lod); } catch (err) { console.warn(`[AssetLoader] LOD ${options.lod} failed`, err); }
        }
        job.result = { gltf, options };
      } catch (err) {
        console.warn(`[AssetLoader] Could not load ${file}; using the procedural version instead.`, err);
      }
      done++;
      if (onProgress) onProgress(done / jobs.length, file);
    };
    const queue = [...jobs];
    const workers = Array.from({ length: Math.min(6, queue.length) }, async () => { while (queue.length) await run(queue.shift()); });
    await Promise.all(workers);
  }

  async loadManifest(onProgress) {
    let manifest = null;
    try {
      const res = await fetchWithTimeout(`${this.base}models/manifest.json`, 3000);
      if (res && res.ok) manifest = await res.json();
    } catch {
      manifest = null; // procedural build: nothing to load
    }
    if (!manifest || typeof manifest !== 'object') return 0;
    this.manifest = manifest;
    const jobs = [];
    const ch = manifest.characters || {};
    const player = ch.player || manifest.player;
    if (player) jobs.push(['player', player]);
    for (const f of ch.npcs || []) jobs.push(['npc', f]);
    for (const f of manifest.animations || []) jobs.push(['anim', f]);
    for (const [type, v] of Object.entries(manifest.vehicles || {})) jobs.push(['vehicle', v, type]);
    for (const [k, v] of Object.entries(manifest)) if (k.startsWith('vehicle_')) jobs.push(['vehicle', v, k.slice(8)]);
    for (const v of manifest.traffic || []) jobs.push(['traffic', v]);
    await Promise.all([this._loadTextures(manifest.textures || {}), this._loadEnvironment(manifest.environment || null), this._loadAll(jobs, onProgress)]);
    for (const job of jobs) {
      if (!job.result) continue;
      const [kind, , type] = job;
      const { gltf, options } = job.result;
      if (kind === 'player') this.characters.player = gltf;
      if (kind === 'npc') this.characters.npcs.push(gltf);
      if (kind === 'player' || kind === 'npc' || kind === 'anim') this._addClips(gltf.animations, gltf.scene);
      if (kind === 'vehicle') this.vehicles.set(type, { gltf, options });
      if (kind === 'traffic') this.traffic.push({ gltf, options });
    }
    return this.cache.size;
  }

  /**
   * PBR texture sets for ground materials, e.g.
   * "textures": { "asphalt": { "map": "asphalt_diff.jpg", "normal": "asphalt_nor.jpg", "roughness": "asphalt_rough.jpg", "size": 6 } }
   * Keys: asphalt, sidewalk, plaza, grass, sand, concrete. "size" = metres covered by one tile.
   */
  async _loadTextures(defs) {
    this.textures = {};
    const tl = new THREE.TextureLoader();
    for (const [key, d] of Object.entries(defs)) {
      try {
        const set = { size: d.size || 4, tint: d.tint || null };
        for (const slot of ['map', 'normal', 'roughness', 'ao']) {
          if (!d[slot]) continue;
          const t = await tl.loadAsync(await this._url(d[slot]));
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = 8;
          if (slot === 'map') t.colorSpace = THREE.SRGBColorSpace;
          set[slot] = t;
        }
        this.textures[key] = set;
      } catch (err) {
        console.warn(`[AssetLoader] texture set "${key}" failed`, err);
      }
    }
  }

  /** Real-world HDR panorama for image-based lighting: { "day": "x.hdr", "rotation": 0 } (a "night" entry is ignored) */
  async _loadEnvironment(def) {
    this.hdri = null;
    if (!def) return;
    const out = { rotation: def.rotation || 0 };
    const loader = new RGBELoader();
    if (!def.day) return;
    try {
      const t = await loader.loadAsync(await this._url(def.day));
      t.mapping = THREE.EquirectangularReflectionMapping;
      out.day = t;
      this.hdri = out;
    } catch (err) {
      console.warn('[AssetLoader] HDRI "day" failed', err);
    }
  }

  _addClips(clips, scene) {
    for (const c of clips || []) {
      if (scene) c.userData = { ...(c.userData || {}), sourceScene: scene };
      if (!this.clips.some((x) => x.name === c.name && x.duration === c.duration)) this.clips.push(c);
    }
  }

  /** Legacy accessor: a clone of a loaded scene by manifest key. */
  get(key) {
    if (key === 'player') return null; // characters are handled by AnimatedCharacter
    if (key.startsWith('vehicle_')) {
      const v = this.vehicles.get(key.slice(8));
      return v ? v.gltf.scene.clone(true) : null;
    }
    return null;
  }
}

async function fetchWithTimeout(url, ms) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl && ctrl.abort(), ms);
  try {
    return await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
  } finally {
    clearTimeout(timer);
  }
}

export { THREE };
