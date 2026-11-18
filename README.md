# City Life — Open World (Three.js + Rapier)

A browser-based, open-world 3D city simulator. Walk the streets, drive cars, ride motorcycles,
cycle through the park, visit the beach, shop, eat, take on optional missions — or just explore.
Everything (city, models, textures, sounds) is generated procedurally, so there are **no third-party
assets or licences** to worry about.

## Quick start

```bash
npm install          # installs three, @dimforge/rapier3d-compat, vite
npm run dev          # http://localhost:5173 (opens automatically)
```

Production builds:

```bash
npm run build        # multi-file build in dist/   -> serve with `npm run preview`
npm run build:single # ONE self-contained file: dist-single/index.html (host anywhere)
```

Requirements: Node 18+ and a browser with WebGL2 + WebAssembly (current Chrome, Edge, Firefox, Safari).

## Controls

| Action | Keyboard / mouse |
|---|---|
| Move | W A S D or arrow keys |
| Sprint / jump | Shift / Space |
| Interact, enter / exit vehicle | E |
| Look around | Mouse (click to lock), or drag |
| Zoom / change camera | Mouse wheel, + − / C |
| Accelerate, brake & reverse, steer | W, S, A / D |
| Handbrake (drift) | Space |
| Headlights / horn / reset vehicle | L / H / R |
| Bicycle gears | 1 2 3 (Shift = pedal harder) |
| Use fuel can | F |
| Garage (call one of your vehicles) | V |
| City map (click to set GPS) | M |
| Journal / pause | J / Esc or P |

Touch screens get a virtual joystick, a look pad and action buttons automatically.

## What's in the city

- **Districts:** Downtown towers, Market Street shops, Greenfield Homes, Riverside Apartments, the
  Ironworks industrial yard, Arena District, City Centre plaza, Civic Quarter, Central Park,
  Seafront hotels and Golden Sands Beach with a pier.
- **Roads:** a ring highway with median barriers, a cut-and-cover tunnel, nine bridges over the
  Silver River, a roundabout, ~70 signalised intersections, zebra crossings and street lights.
- **Vehicles:** hatchback, sedan, SUV, sports car, taxi, scooter, street & sport motorcycles,
  city & road bicycles — each with its own handling. Free bike-share cycles in the park and
  scooters on the promenade.
- **Living city:** instanced pedestrians that walk sidewalks, wait for the walk signal, sit on
  benches, chat in groups, visit shops, sunbathe and dodge fast vehicles; AI traffic that follows
  lanes, obeys lights, turns on curves, circles the roundabout, keeps its distance and honks.
  Traffic can drive on the left (default, India/UK) or right — see Settings.
- **Places to visit:** Spice Garden restaurant, FreshMart supermarket and Sea Breeze Café
  (enterable interiors with menus and seats), plaza food stalls, QuickFuel petrol station,
  Motor Row dealership, Park & Ride lot.
- **Activities:** Downtown Dash (car race), Coastal Time Trial (motorcycle), Park Pedal (bicycle),
  Park It! (parking), Food Run (delivery), Meet the Locals (talk to Ravi, Meena and Karthik),
  25 hidden tokens, 10 landmarks to discover.
- **Atmosphere:** day/night cycle with sunrise/sunset, procedural sky, stars, clouds, dynamic
  weather with rain, animated ocean with shoreline foam, night-lit windows and street lamps,
  procedural Web Audio (engines, tyres, wind, waves, birds, city hum, rain).

## Project structure

```
src/
  main.js                    boot + WebGL check + error screen
  config.js                  city grid, districts, quality presets
  game/      Game.js (loop & flow), SceneManager.js (renderer, sky, day/night, weather),
             PhysicsManager.js (Rapier), InputManager.js, CameraManager.js, GameState.js (save),
             CityGenerator.js (layout data), WorldBuilder.js, MissionSystem.js
  world/     RoadSystem, BuildingSystem (+ BuildingMaterial window shader), PropSystem,
             BeachSystem (+ WaterMaterial), LandmarkSystem, ShopSystem, InteractionSystem, Humanoid
  player/    Player.js (body + capsule), PlayerController.js (walk, sit, enter/exit vehicles)
  vehicles/  Vehicle.js, CarController.js, MotorcycleController.js, BicycleController.js,
             VehicleFactory.js (procedural meshes), VehicleTypes.js, VehicleManager.js
  ai/        NPCManager.js (instanced pedestrians), NPCController.js (behaviour),
             Pathfinding.js (sidewalk graph + A*), TrafficManager.js, CarInstancer.js
  audio/     AudioManager.js (procedural Web Audio)
  ui/        HUD.js, MainMenu.js, Dialogs.js, Minimap.js, Settings.js, TouchControls.js
  utils/     AssetLoader.js, PerformanceMonitor.js, InstanceBatch.js, GeoBuilder.js,
             MergeUtils.js, Textures.js, Random.js
public/models, textures, audio, fonts   optional asset drop-in folders
```

## Performance notes

- Repeated objects (buildings, trees, lamps, benches, markings…) use chunked `InstancedMesh`es
  with per-chunk frustum culling and distance-based LOD; static one-off meshes are merged per
  material; vehicle bodies are merged into a handful of meshes.
- Pedestrians render with 5 instanced draw calls total; traffic with 7. Both are pooled and
  recycled around the player, and distant pedestrians use a cheaper update rate.
- Everything that moves is a kinematic body resolved by Rapier's character controller, which keeps
  the simulation stable at any frame rate.
- Quality presets (Low / Medium / High) change resolution scale, shadows, bloom, view distance and
  crowd/traffic sizes. Desktop GPUs typically run Medium/High at 60 fps; integrated GPUs and phones
  should use Low. Performance varies by device.

## Realistic graphics

- **Rendering:** lighting baked live from the sky (reflections match the time of day), soft sun
  shadows, ambient occlusion (High), film-style colour grading, SMAA anti-aliasing, glow at night,
  PBR detail maps on roads/pavements and wet, reflective streets in the rain.
- **Characters:** rigged GLB characters with motion-capture clips (idle, walk, run, sprint, jump,
  sit, drive, talk, wave…). The player and the ~10–36 nearest pedestrians use them; people further
  away stay on cheap instanced bodies.
- **Cars:** GLB car models for your vehicles, AI traffic and parked cars, with rolling/steering
  wheels, working brake and head lights, per-car paint colours and a triangle budget.

Real models ship with the build: Range Rover-style SUV, Jeep, Spider V8, GT300 coupe, GT3 (traffic),
naked roadster bike and a retro scooter; Ready Player Me pedestrians with per-person clothing
colours; Poly Haven asphalt, photo grass and HDRI reflections. Credits: `CREDITS.md` and the
in-game Credits screen (most cars are CC BY-NC-SA, non-commercial). **See `ASSETS.md`** to add
photoreal Mixamo people (FBX files can be dropped in directly) or swap any model.

## Rendering performance

- **Cars, 3 tiers:** the original detailed model only for the 2–3 cars right next to you; a baked
  mid-distance LOD (`*.lod.glb`, textures baked into vertex colours, 3–4 draw calls, ~7–18k
  triangles) out to ~110 m; instanced sculpted box cars beyond. Your own / parked vehicles swap
  to the LOD past ~26 m, the showroom past 40 m.
- **People:** skinned pedestrians outside the camera view are skipped; only the closest cast shadows.
- **Packing:** hidden box cars no longer draw (visible instances are packed each frame).
- **Loading:** models load in parallel; every shader is compiled on the loading screen so nothing
  hitches the first time it appears.
- Measured on a downtown view (High): draw calls 2,852 → ~1,300, triangles 6.3M → 3.7M, while
  the view distance went up (Low 420 m, Medium 600 m, High 850 m).
- New cars: run `tools/prep-car.mjs` then `tools/make-lod.mjs` and add `"lod": "name.lod.glb"`.

## Saving

Progress (money, owned vehicles, tokens, landmarks, best times, position, time of day) is saved to
`localStorage` automatically every minute, after missions and purchases, and from the pause menu.
