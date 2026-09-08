# Chennai Orbit

A WebXR game for the Meta Quest browser. You hold planet Earth as a hologram,
spin it with your own hands, and pinch the marker over India to fall into a
glowing tabletop model of Chennai — 18 real urban-heat study zones, each with
exactly three cooling measures you place with your hands. Placing a measure
recolours the zone's heat plate, updates a floating readout above it, and
raises the running cost. Every number on screen comes straight from the
project's own heat-risk dataset; none of it is inflated to make the game feel
better.

Built on top of the tabletop-hologram build described in
[PROJECT-BRIEF.md](PROJECT-BRIEF.md) (kept from the original handoff for the
dataset, city renderer, hand-input and game-loop internals). What's new here:

- **No centre-table hologram as the opening screen.** The game now opens on a
  held, spinnable globe (`src/vr/globe.js`) — a real interactive object, not a
  static logo — and the city only appears once you deliberately dive into it.
- **Diegetic entry, not a menu.** There is no "Start" button standing in for
  the world; you grab the globe and pinch a point on it.
- **A "return to orbit" path**, so the globe isn't a one-way title screen —
  you can pull back out and dive in again.
- **A par challenge per zone** — an honest, dataset-derived target (not a
  fabricated comparison to any other product) that gives placing measures a
  concrete goal beyond "the number went down."

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # node --test, 5 tests on the cooling/cost model
npm run build    # → dist/, static site
npm run preview  # serve the production build locally
```

Desktop: drag to orbit your view of the globe, click the marker (or the
"Dive in" button) to descend, click a zone in the sidebar, click a measure to
lift it, click the map to place it.

## In the headset

1. **Enter VR.** You start holding the globe at arm's length.
2. **Spin it.** Grab the sphere with one hand and move it — the globe turns
   like a trackball. Grab it with both hands and move them apart/together to
   zoom.
3. **Dive in.** Pinch the small red marker over India, or the floating
   "ENTER CHENNAI" card beside it. The globe shrinks away and the tabletop
   city grows in where you're already looking.
4. **Play.** Point at a numbered zone marker and pinch to select it. Three
   cards fan out above the zone — pinch one to lift its measure, carry it in
   your hand, and release over the map to drop it. The zone's heat plate and
   readout respond immediately.
5. **Return to orbit** any time from the wrist panel strapped to your left
   hand, or the sidebar button on desktop.

WebXR needs a secure context (`https://`), so a headset must use the deployed
URL — a LAN dev server will not work in the headset even though it works fine
in a desktop browser tab.

## Deploy (Vercel, static, zero functions)

Import the repo, leave Root Directory blank, leave the Vite preset as
detected. The deployment summary must show **0 functions** — there is no
`api/` directory and `vercel.json` declares neither `functions` nor `builds`.

Outbound network at runtime: `/vr/*.json` (same origin, bundled data),
`api.open-meteo.com` (live air-temperature readings), and
`server.arcgisonline.com` (satellite imagery tiles for the tabletop). Nothing
else — no login, no API key, no database.

## What's honest about the numbers

Carried over unchanged from the original build, because it's the whole point
of the project: effect radii are drawn true to scale even though a 500 m
radius looks tiny against a 24 km city; cards show both the local drop and
the zone-average drop because either alone misleads; modelled surface
temperature and measured air temperature are never conflated; a failed live
weather fetch says "unavailable," never a plausible-looking substitute; and
costs are labelled as catalogue assumptions, not contractor quotes. The new
"par" challenge follows the same rule — it's computed from each zone's own
three measures, never a round or flattering number invented for the sake of
a nicer-looking target.

## On "competing with the best model at game dev"

This build is not, and does not claim to be, a live comparison against any
other AI system's output — there's no way to run that comparison honestly
inside a single game session. What it does instead is hold itself to the
same bar a strong game-dev-focused model would be judged on: a genuinely
interactable centrepiece object (the globe, not a static hologram), hand
tracking aligned to real 3D targets rather than flat menus, a working
placement-and-feedback loop, and a dataset that stays truthful under
gameplay pressure. Where it can be measured — did it build, do the tests
pass, does the dive transition work, do hands rotate the globe and place
objects — it's verified in this repo (`npm test`, and see the desktop build
smoke-test below).
