import { WORLD } from '../config.js';
import * as THREE from 'three';
import { Settings } from '../ui/Settings.js';
import { GameState } from './GameState.js';
import { SceneManager } from './SceneManager.js';
import { InputManager } from './InputManager.js';
import { PhysicsManager } from './PhysicsManager.js';
import { CameraManager } from './CameraManager.js';
import { CityLayout } from './CityGenerator.js';
import { WorldBuilder } from './WorldBuilder.js';
import { MissionSystem } from './MissionSystem.js';
import { AssetLoader } from '../utils/AssetLoader.js';
import { PerformanceMonitor } from '../utils/PerformanceMonitor.js';
import { Player } from '../player/Player.js';
import { PlayerController } from '../player/PlayerController.js';
import { VehicleManager } from '../vehicles/VehicleManager.js';
import { VEHICLES } from '../vehicles/VehicleTypes.js';
import { prepareVehicleAsset } from '../vehicles/VehicleModels.js';
import { NPCManager } from '../ai/NPCManager.js';
import { TrafficManager } from '../ai/TrafficManager.js';
import { InteractionSystem } from '../world/InteractionSystem.js';
import { ShopSystem } from '../world/ShopSystem.js';
import { AudioManager } from '../audio/AudioManager.js';
import { HUD } from '../ui/HUD.js';
import { MainMenu } from '../ui/MainMenu.js';
import { Dialogs } from '../ui/Dialogs.js';
import { Minimap } from '../ui/Minimap.js';
import { TouchControls } from '../ui/TouchControls.js';
import { mergeMeshChildren } from '../utils/MergeUtils.js';

class Emitter {
  constructor() { this.map = new Map(); }
  on(ev, fn) { (this.map.get(ev) || this.map.set(ev, []).get(ev)).push(fn); }
  emit(ev, ...a) { for (const fn of this.map.get(ev) || []) { try { fn(...a); } catch (err) { console.error(`[event ${ev}]`, err); } } }
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

/** Owns every subsystem and runs the main loop. */
export class Game {
  constructor(container) {
    this.container = container;
    this.mode = 'loading'; // loading | menu | play
    this.paused = false;
    this.waypoint = null;
    this.events = new Emitter();
    this.clock = new THREE.Clock();
    this.perf = new PerformanceMonitor();
    this.lodTimer = 0;
    this.saveTimer = 0;
    this.miniTimer = 0;
    this.menuAngle = 0;
    try { this.startVehicle = localStorage.getItem('cityLife.startVehicle') || 'hatchback'; } catch { this.startVehicle = 'hatchback'; }
  }

  async init() {
    this.settings = new Settings();
    this.state = new GameState();
    this.state.load();
    if (!this.state.owned.includes(this.startVehicle)) this.startVehicle = this.state.owned[0];
    this.sceneManager = new SceneManager(this.container, this.settings);
    this.scene = this.sceneManager.scene;
    this.renderer = this.sceneManager.renderer;
    this.input = new InputManager(this.sceneManager.canvas);
    this.input.lockWanted = this.settings.lockMouse;
    this.audio = new AudioManager(this.settings);
    this.menus = new MainMenu(this);
    this.ui = new Dialogs(this);
    this.hud = new HUD(this);
    this.menus.setLoading(0.02, 'Starting physics engine…');
    await frame();
    this.physics = await PhysicsManager.init();
    this.assets = new AssetLoader();
    this.menus.setLoading(0.05, 'Checking optional 3D models…');
    await this.assets.loadManifest((f, file) => this.menus.setLoading(0.05 + f * 0.05, `Loading 3D models… ${file}`));
    if (this.assets.hdri) this.sceneManager.setHDRI(this.assets.hdri);
    // real models can bring their own display names
    for (const [type, v] of this.assets.vehicles) {
      if (!VEHICLES[type]) continue;
      if (v.options.name) VEHICLES[type].name = v.options.name;
      if (v.options.desc) VEHICLES[type].desc = v.options.desc;
    }

    this.distanceLods = []; // { x, z, near, far, dist, max } swapped by camera distance
    this.layout = new CityLayout();
    this.ctx = {
      root: new THREE.Group(), physics: this.physics, layout: this.layout, sceneManager: this.sceneManager,
      sites: {}, treeSpots: [], benches: [], busStops: [], parkRings: [], parkLawns: [], talkSpots: [], stalls: [],
    };
    this.ctx.root.name = 'world';
    this.scene.add(this.ctx.root);
    this.world = await new WorldBuilder(this).build((p, t) => this.menus.setLoading(p, t));
    this.landmarks = this.world.landmarks;
    this.sceneManager.setWeatherMode(this.settings.weather);

    this.menus.setLoading(0.64, 'Opening shops…');
    await frame();
    this.interactions = new InteractionSystem(this);
    this.vehicles = new VehicleManager(this);
    this.shops = new ShopSystem(this);
    this.shops.build();
    mergeMeshChildren(this.shops.group);
    this.shops.interiorGroup.visible = false;

    this.menus.setLoading(0.72, 'Waking up the citizens…');
    await frame();
    this.player = new Player(this.physics, this.scene, this.assets);
    this.playerController = new PlayerController(this, this.player);
    this.cameraManager = new CameraManager(this);
    this.npcManager = new NPCManager(this);

    this.menus.setLoading(0.82, 'Starting traffic…');
    await frame();
    this.traffic = new TrafficManager(this);
    this.traffic.buildParked(this.traffic.computeParkingSpots(this.ctx.extraParked || []));

    this.menus.setLoading(0.9, 'Placing missions and secrets…');
    await frame();
    this.missions = new MissionSystem(this);
    this.missions.build();
    this.missions.talked = new Set(this.state.talked || []);
    this.minimap = new Minimap(this);
    this.touch = new TouchControls(this);
    this.vehicles.spawnBikeShare();
    this.physics.step(1 / 60);

    // initial population around the city centre (attract mode)
    const spawn = this.spawnPoint;
    this.player.setPosition(spawn.x, 0, spawn.z);
    this.player.yaw = Math.PI;
    this.npcManager.init(spawn.x, spawn.z, this.settings.npcCount);
    this.traffic.init(spawn.x, spawn.z, this.settings.trafficCount);
    this.sceneManager.timeOfDay = 17.2; // golden hour for the menu backdrop

    this.menus.setLoading(0.97, 'Preparing shaders…');
    await this._warmShaders();
    this.menus.setLoading(1, 'Ready!');
    // Auto quality: sustained low fps steps the preset down (high → medium → low) and remembers it
    this.perf.onLowPerformance = (fps) => {
      const s = this.settings;
      const next = { high: 'medium', medium: 'low' }[s.quality];
      if (this.mode !== 'play' || this.paused || !next) { this.perf.reset(); return; }
      s.quality = next;
      s.save();
      this.applySettings('quality');
      this.perf.reset();
      this.hud.toast(`Running at ${Math.round(fps)} fps — switched to ${next} quality`, 5000);
    };
    this.input.onPointerUnlock = () => { if (this.mode === 'play' && !this.paused && !this.uiBlocking) this.pause(); };
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.mode === 'play' && !this.paused) this.pause(); });
    await frame();
    this.menus.hideLoading();
    this.mode = 'menu';
    this.menus.showMain();
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.loop());
  }

  get spawnPoint() {
    const p = this.ctx.sites.plaza;
    return p ? { x: p.x - 6, z: p.z + 13 } : { x: 0, z: 0 };
  }

  get uiBlocking() {
    return this.paused || (this.ui && this.ui.open) || (this.minimap && this.minimap.fullOpen) || this.mode !== 'play';
  }

  // ---------- flow ----------
  startGame(cont) {
    this.audio.init();
    if (!cont) {
      GameState.clear();
      this.state.reset();
      this.missions.talked = new Set();
      this.state.listeners.clear?.();
      this.state.onChange(() => this.hud.updateMoney(true));
      this.hud.updateMoney();
    }
    this.menus.hideMain();
    this.mode = 'play';
    this.paused = false;
    // position
    const saved = this.state.player;
    // saves from the old, bigger city may sit outside the current one
    const inCity = saved && saved.x > WORLD.minX && saved.x < WORLD.maxX && saved.z > WORLD.minZ && saved.z < WORLD.maxZ;
    const sp = cont && inCity ? saved : { ...this.spawnPoint, yaw: Math.PI };
    if (this.player.vehicle) this.playerController.exitVehicle(true);
    if (this.player.interior) this._leaveInteriorNow();
    this.player.setPosition(sp.x, 0, sp.z);
    this.player.yaw = sp.yaw ?? Math.PI;
    this.cameraManager.snapBehind(this.player.yaw + Math.PI);
    this.cameraManager.target.set(sp.x, 1.5, sp.z);
    this.cameraManager.smoothTarget.copy(this.cameraManager.target);
    this.sceneManager.timeOfDay = 9; // always daytime
    // starting ride parked nearby
    const startType = this.state.owned.includes(this.startVehicle) ? this.startVehicle : this.state.owned[0];
    const existing = this.vehicles.owned.get(startType);
    if (!existing) {
      const spot = this.vehicles.findSpawnSpot(sp.x, sp.z, VEHICLES[startType]);
      if (spot) this.vehicles.spawn(startType, spot.x, spot.z, spot.heading);
    }
    this.npcManager.init(sp.x, sp.z, this.settings.npcCount);
    this.hud.show(true);
    this.touch.show(true);
    this.hud.banner('Welcome to the city', cont ? 'Picking up where you left off.' : `Your ${VEHICLES[startType].name} is parked nearby — press E next to it. V calls your garage.`, 'info');
    if (this.settings.lockMouse && !this.input.isTouchDevice) this.input.requestLock();
  }

  pause() {
    if (this.mode !== 'play' || this.paused) return;
    this.paused = true;
    this.input.releaseLock();
    this.menus.showPause();
    this.audio.update(0, this);
  }

  resume() {
    if (this.ui.open) this.ui.close();
    this.minimap.openFull(false);
    this.menus.hidePause();
    this.paused = false;
    this.clock.getDelta();
    if (this.settings.lockMouse && !this.input.isTouchDevice) this.input.requestLock();
  }

  quitToMenu() {
    this.save();
    this.menus.hidePause();
    this.paused = false;
    if (this.missions.active) this.missions.abandon('Mission abandoned');
    this.mode = 'menu';
    this.hud.show(false);
    this.touch.show(false);
    this.menus.showMain();
  }

  onModalOpen() {
    this.input.releaseLock();
  }

  onModalClose() {
    if (this.mode === 'play' && !this.paused && !this.minimap.fullOpen && this.settings.lockMouse && !this.input.isTouchDevice) this.input.requestLock();
  }

  toggleMap(open = !this.minimap.fullOpen) {
    if (this.mode !== 'play') return;
    this.minimap.openFull(open);
    if (open) this.input.releaseLock();
    else if (!this.paused) this.onModalClose();
    if (!open && this.paused) this.menus.showPause();
  }

  setWaypoint(p, fromMission = false) {
    if (!p && !fromMission && this.missions.active) return;
    this.waypoint = p ? { x: p.x, z: p.z } : null;
    this.minimap.routeTimer = 0;
    if (p && !fromMission) this.hud.toast('GPS route set', 1200);
  }

  respawn() {
    if (this.player.vehicle) this.playerController.exitVehicle(true);
    if (this.player.interior) this._leaveInteriorNow();
    if (this.player.seat) this.playerController.standUp();
    const sp = this.spawnPoint;
    this.player.setPosition(sp.x, 0, sp.z);
    this.cameraManager.snapBehind(0);
  }

  enterInterior(room, site) {
    const p = this.player;
    if (p.vehicle) return;
    this.returnSpot = { x: site.x + (site.nx || 0) * 0.6, z: site.z + (site.nz || 0) * 0.6, yaw: Math.atan2(site.nx || 0, site.nz || 1) };
    p.interior = room;
    p.setPosition(room.spawn.x, 0, room.spawn.z);
    p.yaw = room.spawn.yaw;
    this.cameraManager.snapBehind(room.spawn.yaw + Math.PI);
    this.cameraManager.footDistance = Math.min(this.cameraManager.footDistance, 4);
    this.ctx.root.visible = false;
    this.shops.interiorGroup.visible = true;
    this.shops.setInteriorLight(room);
    this.hud.toast(`Welcome to ${room.name}`, 1800);
    this.events.emit('enterInterior', room);
  }

  exitInterior() {
    this._leaveInteriorNow();
  }

  _leaveInteriorNow() {
    const p = this.player;
    if (!p.interior) return;
    if (p.seat) this.playerController.standUp();
    p.interior = null;
    const r = this.returnSpot || this.spawnPoint;
    p.setPosition(r.x, 0, r.z);
    p.yaw = r.yaw || 0;
    this.cameraManager.snapBehind(p.yaw + Math.PI);
    this.ctx.root.visible = true;
    this.shops.interiorGroup.visible = false;
    this.shops.setInteriorLight(null);
  }

  save() {
    const p = this.player;
    const pos = p.interior ? this.returnSpot : p.vehicle ? { x: p.vehicle.x, z: p.vehicle.z } : { x: p.pos.x, z: p.pos.z };
    this.state.player = { x: pos.x, z: pos.z, yaw: p.yaw };
    this.state.timeOfDay = this.sceneManager.timeOfDay;
    this.state.talked = [...(this.missions?.talked || [])];
    return this.state.save();
  }

  applySettings(key) {
    const s = this.settings;
    if (['quality', 'shadows', 'bloom', 'drawDistance'].includes(key)) {
      this.sceneManager.applyQuality(s);
      this.npcManager.setDensity(s.npcCount);
      this.traffic.setDensity(s.trafficCount);
    }
    if (key === 'npcDensity') this.npcManager.setDensity(s.npcCount);
    if (key === 'trafficDensity') this.traffic.setDensity(s.trafficCount);
    if (['masterVolume', 'sfxVolume', 'ambientVolume', 'muted'].includes(key)) this.audio.applyVolumes();
    if (key === 'weather') this.sceneManager.setWeatherMode(s.weather);
    if (key === 'lockMouse') this.input.lockWanted = s.lockMouse;
    if (key === 'trafficSide') {
      // re-seat all cars on the new side of the road
      const f = this.focus;
      for (const c of this.traffic.cars) if (c.active) this.traffic._deactivate(c);
      this.traffic.init(f.x, f.z, s.trafficCount);
    }
  }

  get focus() {
    const p = this.player;
    if (p.interior && this.returnSpot) return this.returnSpot;
    return p.vehicle ? { x: p.vehicle.x, z: p.vehicle.z } : { x: p.pos.x, z: p.pos.z };
  }

  // ---------- per-frame ----------
  _globalKeys() {
    const i = this.input;
    if (i.justPressed('pause')) {
      if (this.ui.open) this.ui.close();
      else if (this.minimap.fullOpen) this.toggleMap(false);
      else if (this.paused) this.resume();
      else this.pause();
      return;
    }
    if (i.justPressed('map')) { this.toggleMap(); return; }
    if (this.uiBlocking) return;
    const p = this.player;
    const v = p.vehicle;
    if (i.justPressed('camera')) this.cameraManager.cycle();
    if (i.justPressed('missions')) this.ui.journal();
    if (i.justPressed('garage') && !v) this.ui.garage();
    if (v) {
      if (i.justPressed('lights')) { v.lightsOn = !v.lightsOn; this.audio.click(); }
      if (i.justPressed('horn')) { if (v.kind === 'bicycle') this.audio.bell(); else this.audio.horn(); }
      if (i.justPressed('reset')) this._resetVehicle(v);
      if (i.justPressed('useItem')) {
        if ((this.state.inventory.fuelcan || 0) > 0 && v.kind !== 'bicycle') {
          this.state.inventory.fuelcan--;
          v.fuel = 100;
          this.hud.toast('Fuel can used — tank full', 1800);
        } else this.hud.toast(v.kind === 'bicycle' ? 'Bicycles run on leg power!' : 'No fuel cans — buy one at FreshMart', 1800);
      }
      if (v.fuel <= 0 && v.kind !== 'bicycle' && !this._fuelWarned) { this._fuelWarned = true; this.hud.toast('Out of fuel! Use a fuel can (F) or call another vehicle (V)', 4000); }
      if (v.fuel > 5) this._fuelWarned = false;
      if (v.stuckTime > 2.5 && !this._stuckHint) { this._stuckHint = true; this.hud.toast('Stuck? Press R to reset your vehicle onto the road', 3000); }
      if (v.stuckTime === 0) this._stuckHint = false;
    }
  }

  _resetVehicle(v) {
    const r = this.layout.nearestRoadPoint(v.x, v.z);
    if (!r) return;
    const fx = Math.sin(r.heading), fz = Math.cos(r.heading);
    const side = this.settings.trafficSide === 'right' ? -1 : 1;
    const off = r.edge.highway ? 3.3 : 2.4;
    v.teleport(r.x + fz * side * off, r.z - fx * side * off, r.heading);
    this.cameraManager.snapBehind(r.heading + Math.PI);
    this.hud.toast('Vehicle reset', 1200);
  }

  loop() {
    const rawDt = Math.min(this.clock.getDelta(), 0.1);
    const dt = Math.max(rawDt, 1 / 240);
    const now = this.clock.elapsedTime;
    this.perf.tick(rawDt, now);
    try {
      if (this.mode === 'menu') this._menuFrame(dt);
      else if (this.mode === 'play') this._playFrame(dt);
      this.sceneManager.render();
    } catch (err) {
      console.error(err);
      if (!this._errorShown) { this._errorShown = true; this.hud.toast(`Error: ${err.message}`, 6000); }
    }
    this.input.endFrame();
  }

  _menuFrame(dt) {
    this.menuAngle += dt * 0.04;
    const c = this.ctx.sites.plaza || { x: 0, z: 0 };
    const cam = this.sceneManager.camera;
    cam.position.set(c.x + Math.sin(this.menuAngle) * 150, 70, c.z + Math.cos(this.menuAngle) * 150);
    cam.lookAt(c.x + 40, 10, c.z - 60);
    const focus = { x: c.x, z: c.z };
    this.traffic.update(dt, focus);
    this.npcManager.update(dt, focus);
    this.physics.step(dt);
    this.sceneManager.update(dt, focus);
    this.world.roads.updateTrafficLights(this.traffic.time);
    this.landmarks.update(this.clock.elapsedTime, dt);
    this._lod(dt, cam.position, true);
    this.input.consumeLook();
  }

  /**
   * Compile every material's shader and upload every texture / geometry up front, so the first
   * time a car, character or LOD comes into view there is no hitch.
   */
  async _warmShaders() {
    // The sky environment map is part of every lit shader: bake it before compiling, or every
    // program gets rebuilt on the first real frame.
    this.sceneManager.update(0, this.spawnPoint);
    // Drivable vehicle models are cloned on spawn and share these materials: show the sources too.
    const extra = new THREE.Group();
    for (const model of new Set([...this.assets.vehicles.values(), ...(this.assets.traffic || [])])) {
      prepareVehicleAsset(model.gltf.scene);
      extra.add(model.gltf.scene);
      const lod = model.options && model.options.lodGltf;
      if (lod) { prepareVehicleAsset(lod.scene, true); extra.add(lod.scene); }
    }
    this.scene.add(extra);
    const restore = [];
    this.scene.traverse((o) => {
      if (!o.visible) { restore.push([o, 'visible', false]); o.visible = true; }
      if (o.isInstancedMesh && o.count === 0) { restore.push([o, 'count', 0]); o.count = 1; }
      if (o.frustumCulled) { restore.push([o, 'frustumCulled', true]); o.frustumCulled = false; }
    });
    try {
      if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, this.sceneManager.camera);
      // Draw it all once, exactly like a game frame (post-FX target, shadow pass), behind the
      // loading screen: this uploads textures and buffers and builds the shadow shaders.
      this.sceneManager.render();
    } catch (err) {
      console.warn('[Game] shader warm-up skipped', err);
    }
    for (const [o, k, v] of restore) o[k] = v;
    this.scene.remove(extra);
    for (const c of [...extra.children]) extra.remove(c);
  }

  /** Swap detailed static objects for their light versions by camera distance (every ~10 frames). */
  _updateDistanceLods() {
    this._dlTick = ((this._dlTick || 0) + 1) % 10;
    if (this._dlTick) return;
    const c = this.sceneManager.camera.position;
    for (const L of this.distanceLods) {
      const d = Math.hypot(L.x - c.x, L.z - c.z);
      const near = d < L.dist, far = !near && d < (L.max || Infinity);
      if (L.near.visible !== near) L.near.visible = near;
      if (L.far && L.far.visible !== far) L.far.visible = far;
    }
  }

  _playFrame(dt) {
    this._globalKeys();
    if (this.paused) {
      this.input.consumeLook();
      if (this.minimap.fullOpen) this.minimap.update(0);
      return;
    }
    this.state.playSeconds += dt;
    this.interactions.update();
    this.playerController.update(dt);
    this.vehicles.update(dt);
    this.vehicles.maintainStreetBikes(dt);
    const focus = this.focus;
    this.traffic.update(dt, focus);
    this.npcManager.update(dt, focus);
    this.physics.step(dt);
    this.cameraManager.update(dt);
    this._updateDistanceLods();
    this.sceneManager.update(dt, focus);
    this.world.roads.updateTrafficLights(this.traffic.time);
    this.landmarks.update(this.clock.elapsedTime, dt);
    this.missions.update(dt);
    this.hud.update(dt);
    this.touch.update();
    this.miniTimer -= dt;
    if (this.miniTimer <= 0) { this.miniTimer = 1 / 30; this.minimap.update(1 / 30); }
    this.audio.update(dt, this);
    this._lod(dt, this.sceneManager.camera.position);
    this.saveTimer += dt;
    if (this.saveTimer > 60) { this.saveTimer = 0; this.save(); }
  }

  _lod(dt, camPos, force = false) {
    this.lodTimer -= dt;
    if (this.lodTimer > 0 && !force) return;
    this.lodTimer = 0.25;
    const pd = this.settings.qualityPreset.propDistance;
    for (const b of this.world.batches) b.updateLOD(camPos.x, camPos.z, pd);
    for (const b of this.shops.batches) b.updateLOD(camPos.x, camPos.z, pd);
  }
}
