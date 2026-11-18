import * as THREE from 'three';
import { Textures, DetailMaps } from '../utils/Textures.js';

const M = {};
const std = (key, params) => (M[key] ||= new THREE.MeshStandardMaterial(params));

export const Materials = {
  get asphalt() { return std('asphalt', { map: Textures.asphalt, normalMap: DetailMaps.asphalt.normal, normalScale: new THREE.Vector2(0.3, 0.3), roughnessMap: DetailMaps.asphalt.rough, roughness: 1, metalness: 0 }); },
  get sidewalk() { return std('sidewalk', { map: Textures.sidewalk, normalMap: DetailMaps.paving.normal, roughnessMap: DetailMaps.paving.rough, roughness: 1 }); },
  get plaza() { return std('plaza', { map: Textures.plaza, normalMap: DetailMaps.tiles.normal, roughnessMap: DetailMaps.tiles.rough, roughness: 1 }); },
  get grass() { return std('grass', { map: Textures.grass, normalMap: DetailMaps.grass.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 1 }); },
  get sand() { return std('sand', { map: Textures.sand, normalMap: DetailMaps.sand.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 1 }); },
  get dirt() { return std('dirt', { map: Textures.dirt, roughness: 1 }); },
  get concrete() { return std('concrete', { map: Textures.concrete, normalMap: DetailMaps.concrete.normal, roughnessMap: DetailMaps.concrete.rough, roughness: 1 }); },
  get wood() { return std('wood', { map: Textures.wood, roughness: 0.8 }); },
  get tiles() { return std('tiles', { map: Textures.tiles, normalMap: DetailMaps.tiles.normal, roughness: 0.45 }); },
  get white() { return std('white', { color: 0xf2f2f2, roughness: 0.6 }); },
  get marking() { return std('marking', { color: 0xf4f4f0, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); },
  get markingYellow() { return std('markingYellow', { color: 0xf0c020, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); },
  get metal() { return std('metal', { color: 0x6d7378, roughness: 0.45, metalness: 0.6 }); },
  get darkMetal() { return std('darkMetal', { color: 0x2c3035, roughness: 0.5, metalness: 0.5 }); },
  get glass() { return std('glass', { color: 0x7fa6c4, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.45 }); },
  get rubber() { return std('rubber', { color: 0x161616, roughness: 0.95 }); },
  get vertexColor() { return std('vertexColor', { vertexColors: true, roughness: 0.8 }); },
  get instColor() { return std('instColor', { color: 0xffffff, roughness: 0.75 }); },
  get foliage() { return std('foliage', { color: 0xffffff, roughness: 0.85, flatShading: true }); },
  get trunk() { return std('trunk', { color: 0x6b4a2f, roughness: 1 }); },
  get water() { return std('water', { color: 0x2b6a8f, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.88 }); },
  get lampGlow() { return std('lampGlow', { color: 0xfff2cc, emissive: 0xffd88a, emissiveIntensity: 0.0, roughness: 0.4 }); },
  get neon() { return std('neon', { color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.2, roughness: 0.4 }); },
  get basicColor() { return (M.basicColor ||= new THREE.MeshBasicMaterial({ color: 0xffffff })); },
};

/** World-UV scale (tiles per metre) each ground material's geometry was built with. */
const UV_SCALE = { asphalt: 0.125, sidewalk: 0.25, plaza: 0.2, grass: 0.12, sand: 1 / 6, concrete: 0.125 };

/** Swap in real PBR texture sets loaded from the manifest (see AssetLoader._loadTextures). */
export function applyTextureSets(sets) {
  for (const [key, set] of Object.entries(sets || {})) {
    const mat = Materials[key];
    if (!mat || !UV_SCALE[key]) continue;
    // geometry UVs advance UV_SCALE per metre; we want one texture tile per `size` metres
    const rep = 1 / (UV_SCALE[key] * set.size);
    for (const t of [set.map, set.normal, set.roughness, set.ao]) if (t) t.repeat.set(rep, rep);
    if (set.map) { mat.map = set.map; mat.color.set(set.tint || 0xffffff); }
    if (set.normal) { mat.normalMap = set.normal; mat.normalScale.set(1, 1); }
    if (set.roughness) { mat.roughnessMap = set.roughness; mat.roughness = 1; }
    if (set.ao) mat.aoMap = set.ao;
    mat.needsUpdate = true;
  }
}
