# Making City Life look realistic — asset guide

The game engine side is ready: realistic lighting, post-processing, rigged characters with
motion-capture animation, detailed cars (player, traffic and parked) and PBR ground textures.
What decides how real it looks is the **3D models and textures** you drop in. This guide lists
free sources and the exact steps.

Everything goes into `public/models/` and is switched on by `public/models/manifest.json`.

```json
{
  "characters": { "player": "hero.glb", "npcs": ["man1.glb", "woman1.glb", "man2.glb", "woman2.glb"] },
  "animations": ["city-anims.glb"],
  "vehicles": {
    "hatchback": "hatch.glb",
    "sedan": "sedan.glb",
    "suv": { "file": "suv.glb", "rotateY": 180 },
    "sports": "coupe.glb",
    "taxi": "taxi.glb",
    "motorcycle": "bike.glb"
  },
  "traffic": ["sedan.glb", "hatch.glb", "suv.glb"],
  "textures": {
    "asphalt":  { "map": "asphalt_diff.jpg", "normal": "asphalt_nor.jpg", "roughness": "asphalt_rough.jpg", "size": 6 },
    "sidewalk": { "map": "paving_diff.jpg",  "normal": "paving_nor.jpg",  "roughness": "paving_rough.jpg",  "size": 3 },
    "grass":    { "map": "grass_diff.jpg",   "normal": "grass_nor.jpg", "size": 4 }
  }
}
```

Anything missing or failing to load falls back to the built-in procedural version, so you can add
assets one at a time.

The build now ships **real models**: seven cars and bikes, Ready Player Me pedestrians (each one
gets its own clothes, hair and skin colours), the Mixamo "Soldier" player, Poly Haven asphalt,
a photo grass texture and Poly Haven HDRIs for reflections. See "Credits" below and in the game menu.

**Licence note:** most vehicle models are **CC BY-NC-SA** (non-commercial). Fine for a personal
portfolio site with credits; for ads, paid or client work swap them for CC0 / CC-BY cars.

---

## 1. People + realistic animation (biggest improvement) — Mixamo, free

Site: <https://www.mixamo.com> (free, needs an Adobe account). Characters and animations can be
used in personal and commercial projects; you can't resell them as standalone assets.

1. **Characters → pick 4–8 everyday people** (search "casual", "business", "civilian").
   Download: Format **FBX Binary**, Pose **T-pose**, With Skin.
2. **Animations** (search each, tick **In Place** where offered). Download with **Without Skin**:
   - `Idle` (Breathing Idle) · `Walking` · `Running` · `Fast Run` (sprint) · `Jump`
   - `Sitting Idle` · `Driving` (car) · `Motorcycle Drive` / `Biker Idle` (bike)
   - `Talking` · `Waving` · `Terrified` / `Scared` (for dodging cars)
3. **Easiest:** put the FBX files straight into `public/models/` and list them — no conversion
   needed: `"characters": { "npcs": ["Remy.fbx", "Kate.fbx"] }, "animations": ["Walking.fbx", "Running.fbx", "Idle.fbx"]`.
   The file name becomes the clip name, so name the animation files after what they do.
   Good realistic Mixamo people: Remy, Kate, Claire, Jody, Brian, Regina, Shannon, Malcolm.
   For a smaller download you can still convert **FBX → GLB** with Blender (free):
   File → Import → FBX → then File → Export → glTF 2.0 (.glb), "Include: Selected/Visible",
   Animation ticked. Tip: import one character, then import the animation FBXs into the same
   scene and export once — all clips end up in one GLB.
4. Put files in `public/models/`, list them under `characters` / `animations` in the manifest.

The game matches clip names automatically (idle, walk, run, sprint, jump, sit, drive, ride,
pedal, talk, wave, scared). Clip names just need to contain those words. All Mixamo files share
the same skeleton, so one animation pack drives every character.

Alternative: **Ready Player Me** (readyplayer.me) for free GLB avatars; use them with Mixamo
animations retargeted in Blender.

## 2. Cars and bikes

Pick **game-ready** models: ideally under 30k triangles per car (showroom models with 300k+ will
be limited to the few closest cars to protect frame rate).

| Source | Licence | Notes |
|---|---|---|
| Sketchfab — filter *Downloadable* + *CC BY* / *CC0*, search "low poly car game ready" | CC-BY (credit the author) / CC0 | Most realistic free options |
| Poly Pizza — poly.pizza | CC0 / CC-BY | Lighter, semi-realistic |
| Quaternius — quaternius.com (Cars pack) | CC0 | Stylised but clean |
| Kenney — kenney.nl (Car Kit) | CC0 | Stylised |

Avoid real brand names and logos (Ferrari, BMW…) on a public or commercial site.

How the game fits them:
- Scales to the real vehicle length and puts the wheels on the road automatically.
- Turns the model so the nose points forward (uses wheel/light names like `wheel_fl`, `headlight`).
  If it still drives backwards, add `"rotateY": 180` in the manifest.
- Wheels named `wheel…`, `tire…` or `tyre…` roll and the front ones steer.
- Materials named like `paint` / `body` get a different colour per traffic car; `tail`/`brake`
  materials light up when braking; `headlight` materials light up with L.

## 3. Ground and building surfaces — Poly Haven, CC0

<https://polyhaven.com/textures> — free, no credit required. Download the **1K or 2K JPG** set:
Diffuse, Normal (GL), Roughness. Good picks: *asphalt_02*, *asphalt_track*, *concrete_floor*,
*paving_stones*, *grass* (aerial), *sand*. Add them under `textures` (keys: asphalt, sidewalk,
plaza, grass, sand, concrete; `size` = metres covered by one tile).

## 4. Optimise before uploading (important for a website)

```bash
npx @gltf-transform/cli optimize input.glb output.glb --texture-compress webp --texture-size 1024
```

Targets: character ≤ 20k triangles, car ≤ 30k, textures ≤ 1024 px. The game includes the Draco
decoder, so Draco-compressed GLBs load as well.

## 5. Honest expectations

With good models this reaches a solid "indie web game" look. The reference screenshots come from
Unreal Engine / Unity games with hand-built cities, photo-scanned assets and large art teams;
a browser game can get close in lighting and animation, but not in sheer asset density.
For the last steps up in realism, the next things to replace would be the procedural buildings
and trees with modular building kits and tree models (Sketchfab / Quaternius).

## Credits for the bundled assets

See `CREDITS.md` (also shown in the game under Main menu → Credits).

To re-run the vehicle optimiser on new downloads, see `tools/prep-car.mjs` (unskins, finds and
names wheels by shape, removes stray parts, simplifies, Draco + WebP).
