# Chennai Orbit — Unity port

A C# / Unity port of the WebXR game in the repo root. Same dataset, same
cooling / cost / land-capacity model, same globe → tabletop flow, same rule:
**never dress up a number.**

The WebXR original is 100% procedural — every mesh, panel and card is built
from code and the bundled dataset — so this port has **no art assets to
import**. It is scripts plus the two JSON datasets, and an editor command
that generates the handful of prefabs and a demo scene.

---

## 1. What's here

```
unity/
├── SETUP.md                        ← this file
├── .gitignore                      ← Unity's standard ignores
├── packages-to-add.md              ← the Package Manager entries you need
└── Assets/
    ├── StreamingAssets/vr/
    │   ├── profiles.json           105 KB — 18 zones, their measures, baseline
    │   └── chennai-osm.json         6.5 MB — 29,399 OSM features
    └── ChennaiOrbit/
        ├── Scripts/
        │   ├── Data/               ProfilesData, OsmData, DataLoader (Newtonsoft)
        │   ├── Core/               HeatModel (projection + cooling + capacity),
        │   │                       Palette, HoloFactory (additive materials,
        │   │                       procedural meshes, polygon extrusion)
        │   ├── World/              ChennaiOrbitApp (orchestrator / state machine),
        │   │                       GlobeController (globe + live NASA thermal),
        │   │                       CityBuilder (OSM → tabletop), GameLoop
        │   │                       (capacity-limited placement), SolutionFactory,
        │   │                       WeatherService (Open-Meteo)
        │   ├── Interaction/        XrPointer (pinch-from-joints, poke, hover),
        │   │                       WorldPanel (world-space uGUI), Interactables
        │   └── Audio/              AmbientAudio (procedural drone + ping)
        └── Editor/
            └── ChennaiOrbitSetup.cs   Menu: Chennai Orbit ▸ Build Prefabs & Demo Scene
```

Everything under `Core/` and `Data/HeatModel`-adjacent is a **direct,
verified port** of `src/vr/model.js` — the projection, `impactPlacements`,
`buildableAreaSqm`, `footprintSqm` (including the estimated-footprint
fallback for the four measures the source dataset never sized), the rural
baseline cap, and the Liang–Barsky clip. The same nine checks the JS test
suite runs pass against the C# version.

The `World/` and `Interaction/` scripts are a working architecture that
still needs Unity-editor iteration — see §5.

---

## 2. Requirements

- **Unity 2022.3 LTS or Unity 6**, URP.
- Build target: **Android (Meta Quest)**. Desktop play-in-editor also works
  for checking logic without a headset.

## 3. Packages to add (Window ▸ Package Manager)

| Package | Why |
|---|---|
| `com.unity.nuget.newtonsoft-json` | parses the keyed `profiles` map and the jagged OSM coordinates (JsonUtility can't) |
| `com.unity.xr.openxr` | the Quest runtime |
| `com.unity.xr.hands` | hand-joint poses for the pinch / poke detection |
| `com.unity.xr.interaction.toolkit` (3.x) | XR Origin rig, controller input |
| `com.unity.inputsystem` | pulled in by XRI |
| `com.unity.render-pipelines.universal` | URP |

`packages-to-add.md` has the lines to paste into `Packages/manifest.json`.

## 4. First run

1. Create/open a URP project, add the packages above.
2. Copy `unity/Assets/ChennaiOrbit` and `unity/Assets/StreamingAssets` into
   your project's `Assets/`.
3. **Edit ▸ Project Settings ▸ XR Plug-in Management** → enable **OpenXR** for
   Android, add the **Meta Quest** feature group and the **Hand Tracking
   Subsystem**.
4. Menu **Chennai Orbit ▸ Build Prefabs & Demo Scene**. This writes:
   - `Assets/ChennaiOrbit/Prefabs/FloatingPanel.prefab`
   - `Assets/ChennaiOrbit/Prefabs/SolutionCard.prefab`
   - `Assets/ChennaiOrbit/Prefabs/ZoneMarker.prefab`
   - `Assets/ChennaiOrbit/Prefabs/ChennaiOrbitRig.prefab`
   - `Assets/ChennaiOrbit/Scenes/ChennaiOrbit.unity`
5. Open that scene and press **Play** (in-editor, with an XR device
   connected via Link, or build to the Quest).

## 5. What still needs editor work

Honest list — this is a foundation, not a finished build:

- **XR rig wiring.** `ChennaiOrbitRig.prefab` has the pointers and the app
  component but not a full XRI `XR Origin`. Replace its root with a proper
  **XR Origin (XR Rig)**, then drag the Main Camera, the two `XrPointer`
  objects and a left-hand anchor onto `ChennaiOrbitApp`'s fields. Feed the
  hand-tracking joint transforms (index tip, thumb tip) into each
  `XrPointer.IndexTip` / `ThumbTip` from an XR Hands driver.
- **Colliders / layers.** The pointer raycasts `Physics.Raycast` against a
  `hitMask`. Put the tabletop, markers, cards, panels and the globe on a
  layer the mask includes, and make sure each has a collider (the generated
  meshes mostly don't — `CityBuilder` and `SolutionFactory` add a few, but
  you'll want a mesh/box collider on the tabletop slab and the globe).
- **Grab to spin.** `Grabbable` tags exist; the one-hand-spin / two-hand-
  scale gesture handling from `scene.js`'s `gestures()` is not ported yet.
  XRI's `XRGrabInteractable` on the globe and city root is the quick path.
- **Panel polish.** `WorldPanel` uses legacy uGUI `Text`. Swap to
  TextMeshPro for crisp text at 1–2 m.
- **LOD.** `city.js`'s apparent-size LOD swap isn't ported; the full merged
  building mesh is always shown. Add a simple distance/`LODGroup` if frame
  time needs it on-device.

## 6. The live NASA thermal layer

`GlobeController.ToggleThermal` fetches a real MODIS
`Land_Surface_Temp_Day` image from NASA's public GIBS WMS service (keyless,
CORS-open) and paints it on the globe. If the request fails it keeps the
stylised map and says the live layer is unavailable — it never invents a
thermal image. Dark gaps in the real layer are cloud cover, not zero
temperature; the card says so. Add
`https://gibs.earthdata.nasa.gov` and `https://api.open-meteo.com` to any
network allow-list your build uses.

## 7. The honesty rules (unchanged from the WebXR build)

- Buildable land per zone = `area × (1 − building_density% − road_coverage%)`,
  from that zone's own coverage figures.
- Four measures (misting corridor, shade structures, water-body restoration,
  street tree planting) were never sized in the source data. Their footprint
  is estimated from a ₹/m² rate borrowed from a **priced sibling in the same
  category**, and every surface that shows it says "(estimated)".
- Cooling can approach but never pass the study's own rural baseline
  temperature.
- Placement effectiveness (0.5–1.0) is read from each zone's real
  building-footprint hotspot, not a tuned slider.
- Modelled surface temperature and measured air temperature are never
  conflated; a failed weather fetch shows "unavailable", never a substitute.
