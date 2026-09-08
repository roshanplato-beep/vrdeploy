# Chennai Orbit

A WebXR game for the Meta Quest browser. You hold planet Earth as a hologram,
spin it with your own hands, and pinch the marker over India to fall into a
glowing tabletop model of Chennai — 18 real urban-heat study zones you cool
by hand-placing real interventions (pocket parks, cool roofs, permeable
paving, and more), constrained by each zone's own real buildable land. Every
number on screen comes straight from the project's own heat-risk dataset;
none of it is inflated to make the game feel better.

Built on top of the tabletop-hologram build described in
[PROJECT-BRIEF.md](PROJECT-BRIEF.md) (kept from the original handoff for the
dataset, city renderer, hand-input and game-loop internals). What's new here:

- **No centre-table hologram as the opening screen.** The game now opens on a
  held, spinnable globe (`src/vr/globe.js`) — a real interactive object, not a
  static logo — and the city only appears once you deliberately dive into it.
- **A real thermal-view toggle on the globe.** Pinch the "THERMAL VIEW" card
  to load live NASA MODIS land-surface-temperature satellite imagery straight
  from NASA's public GIBS service onto the globe. If the fetch fails, the
  globe stays on its stylised map and says so — it never fakes a reading.
- **Unlimited placement, capped by real land, not an arbitrary rule.** Any
  measure can be placed more than once in a zone. What limits you is the same
  thing that limits a real planning department: each zone's own buildable
  land — non-built, non-road area, computed from that zone's own coverage
  data — and each measure's own real footprint. Once a zone's land is spoken
  for, a card refuses to lift another instance, clearly, rather than silently
  pretending there's always room.
- **Optimal placement is a real, data-derived thing to chase.** Every zone
  carries a genuine hotspot — the area-weighted centroid of its own mapped
  building footprints, shown as a gold ring on the map. A measure placed near
  it counts at full strength; one dropped in a quiet corner counts for less.
  Nothing here is invented for game feel: it's the same building data the
  tabletop itself is built from.
- **Two floating windows flank the city in-world** (`src/vr/scene.js`) — the
  headset equivalent of the flat build's zone-list and zone-detail sidebars,
  since a headset player never sees flat HTML at all. Left picks a zone;
  right shows its temperature, live weather, land capacity, and every cost
  involved, all poke/pinch-interactable like the wrist panel.
- **Diegetic entry, not a menu**, and **a "return to orbit" path**, so the
  globe isn't a one-way title screen.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # node --test, 9 tests on the cooling/cost/capacity model
npm run build    # → dist/, static site
npm run preview  # serve the production build locally
```

Desktop: drag to orbit your view of the globe, click the marker (or the
"Dive in" button) to descend, click a zone in the sidebar, click a measure to
lift it, click the map to place it. The "🌡 Live thermal view" button on the
title screen works on desktop too.

## In the headset

1. **Enter VR.** You start holding the globe at arm's length.
2. **Spin it.** Grab the sphere with one hand and move it — the globe turns
   like a trackball. Grab it with both hands and move them apart/together to
   zoom. Pinch the "THERMAL VIEW" card to load live NASA satellite imagery.
3. **Dive in.** Pinch the small red marker over India, or the floating
   "ENTER CHENNAI" card beside it. The globe shrinks away and the tabletop
   city grows in where you're already looking.
4. **Play.** Point at a numbered zone marker and pinch to select it. Two
   floating windows appear beside the city — one to pick a zone, one showing
   everything about the selected one. Three cards fan out above the zone —
   pinch one to lift its measure, carry it toward the gold-ringed hotspot for
   full effect, and release to drop it. Place as many as the zone's land
   allows; pinch a placed object directly to remove it.
5. **Return to orbit** any time from the wrist panel strapped to your left
   hand, or the floating left window / sidebar button on desktop.

WebXR needs a secure context (`https://`), so a headset must use the deployed
URL — a LAN dev server will not work in the headset even though it works fine
in a desktop browser tab.

## The black-screen fix

An earlier build showed a black screen on first load in the Quest browser
(fixed by diving in from the flat view first, then entering VR). Root cause:
`VRExperience.jsx` rendered `<div className="vr-shell">`, but `vr.css` only
ever defined `.vr-studio` — a leftover naming mismatch inherited from the
original source project, which had the same bug and never surfaced it,
likely because desktop testing tolerated the resulting layout ambiguity in a
way a mobile browser's viewport handling didn't. Fixed by renaming the CSS to
match. Also hardened: the renderer's initial size now falls back to the
window's own dimensions if the container reports 0×0 on the first paint (a
real risk on mobile browser chrome), and the scene re-measures itself a few
times just after mount rather than only on an explicit resize event.

## Deploy (Vercel, static, zero functions)

Import the repo, leave Root Directory blank, leave the Vite preset as
detected. The deployment summary must show **0 functions** — there is no
`api/` directory and `vercel.json` declares neither `functions` nor `builds`.

Outbound network at runtime: `/vr/*.json` (same origin, bundled data),
`api.open-meteo.com` (live air-temperature readings), `server.arcgisonline.com`
(satellite imagery tiles for the tabletop), and `gibs.earthdata.nasa.gov`
(the optional live thermal layer, fetched only when a player asks for it).
No login, no API key, no database.

## What's honest about the numbers

Carried over unchanged from the original build, because it's the whole point
of the project: effect radii are drawn true to scale even though a 500 m
radius looks tiny against a 24 km city; cards show both the local drop and
the zone-average drop because either alone misleads; modelled surface
temperature and measured air temperature are never conflated; a failed live
weather fetch says "unavailable," never a plausible-looking substitute; and
costs are labelled as catalogue assumptions, not contractor quotes.

The new capacity model follows the same rule:

- **Buildable land** per zone is `zone area × (1 − building density % − road
  coverage %)` — both percentages are the dataset's own.
- **Footprint** per measure is the dataset's own `estimated_area_sqm` where
  it exists. Four of the twelve measures (misting corridors, shade
  structures, water-body restoration, street tree planting) were never sized
  in the source dataset — they attach to existing infrastructure rather than
  claiming new land. For those, a footprint is estimated from a ₹/m² rate
  borrowed from a *priced sibling in the same category* (e.g. a shade
  structure's footprint is estimated from cool-roof-lime's own rate) — never
  invented from nothing, and every card that used this fallback says
  "(estimated)" next to the number.
- **Cooling never exceeds the city's own rural baseline.** A zone's modelled
  temperature can drop toward the dataset's own baseline reading but never
  below it — you can green an entire zone, but the model won't claim you
  out-cooled the climate it sits in.
- **Placement effectiveness** (0.5–1.0) comes from real building-footprint
  geometry, not a slider tuned for feel.

## On "competing with the best model at game dev"

This build is not, and does not claim to be, a live comparison against any
other AI system's output — there's no way to run that comparison honestly
inside a single game session. What it does instead is hold itself to the
same bar a strong game-dev-focused model would be judged on: a genuinely
interactable centrepiece object (a real spinnable globe with a live NASA
data layer, not a static hologram), hand tracking aligned to real 3D targets
(two in-world floating windows, cards, a placed-measure-removal target)
rather than flat menus, a placement model whose limits come from the
project's own land-coverage data rather than an arbitrary rule, and a
dataset that stays truthful under gameplay pressure — including admitting
when four of its twelve measures needed an estimated rather than measured
footprint. Where it can be verified without a headset, it is: `npm test`
covers the capacity math, the baseline cooling cap, and the footprint
fallback; `npm run build` is clean.
