import * as THREE from 'three';
import { RIVER, BEACH } from '../config.js';
import { GeoBuilder } from '../utils/GeoBuilder.js';
import { Materials, applyTextureSets } from '../world/Materials.js';
import { RoadSystem } from '../world/RoadSystem.js';
import { BuildingSystem } from '../world/BuildingSystem.js';
import { PropSystem } from '../world/PropSystem.js';
import { BeachSystem } from '../world/BeachSystem.js';
import { LandmarkSystem } from '../world/LandmarkSystem.js';
import { createWaterMaterial } from '../world/WaterMaterial.js';
import { mergeMeshChildren } from '../utils/MergeUtils.js';
import { buildHorizon } from '../world/Horizon.js';

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

/** Builds the static world in stages, yielding between them so the loading bar can update. */
export class WorldBuilder {
  constructor(game) {
    this.game = game;
  }

  async build(onProgress) {
    const g = this.game;
    const ctx = g.ctx;
    ctx.waterMaterial = createWaterMaterial(g.sceneManager.shared);
    applyTextureSets(g.assets.textures);

    onProgress(0.08, 'Laying the ground…');
    await frame();
    this._ground();
    buildHorizon(g.scene, g.sceneManager);

    onProgress(0.16, 'Paving roads and bridges…');
    await frame();
    this.roads = new RoadSystem(ctx);
    this.roads.build();

    onProgress(0.3, 'Raising buildings…');
    await frame();
    this.buildings = new BuildingSystem(ctx);
    ctx.footprints = this.buildings.footprints;
    this.buildings.build();
    ctx.footprintsShops = this.buildings.shopFronts;

    onProgress(0.44, 'Planting trees and parks…');
    await frame();
    this.props = new PropSystem(ctx);
    this.props.build();

    onProgress(0.52, 'Shaping the beach…');
    await frame();
    this.beach = new BeachSystem(ctx);
    this.beach.build();

    onProgress(0.58, 'Building landmarks…');
    await frame();
    this.landmarks = new LandmarkSystem(ctx);
    this.landmarks.build();
    // fewer draw calls: merge static one-off meshes per material
    this.landmarks.optimize();
    for (const grp of [this.roads.group, this.props.group, this.beach.group, this.buildings.group]) mergeMeshChildren(grp);
    return this;
  }

  _ground() {
    const g = this.game;
    // physics ground: one large slab with its top at y = 0
    g.physics.addBox(0, -0.5, 0, 3000, 0.5, 3000);
    const gb = new GeoBuilder(0.12);
    const X0 = -1400, X1 = BEACH.sandX0 + 0.2;
    gb.rect(X0, -1400, X1, RIVER.z0, -0.02);
    gb.rect(X0, RIVER.z1, X1, 1400, -0.02);
    const m = new THREE.Mesh(gb.build(), Materials.grass);
    m.receiveShadow = true;
    g.ctx.root.add(m);
  }

  get batches() {
    return [
      ...this.roads.batches, ...this.buildings.batches, ...this.props.batches, ...this.beach.batches,
    ];
  }
}
