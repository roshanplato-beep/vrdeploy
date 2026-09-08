export function project([lat, lon]) {
  // Local equirectangular projection, 1 scene unit = 1 km at latitude 13°.
  return [(lon - 80.19) * 108.45, -(lat - 13.01) * 111.32];
}

export const money = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value || 0);

export function impact(interventions, chosen) {
  const selected = interventions.filter((i) => chosen.includes(i.id));
  const material = selected.reduce(
    (s, i) => s + (i.estimated_cost_inr || 0),
    0,
  );
  const drop =
    selected.reduce((s, i) => s + (i.temp_drop || 0), 0) *
    (selected.length > 1 ? 0.75 : 1);
  return {
    drop: Math.round(drop * 100) / 100,
    material,
    total: Math.round(material * 1.3 * 1.1),
    selected,
  };
}

/**
 * Real-world capacity: how much of a zone's land is even available to build
 * cooling measures on.
 *
 * A study zone is not empty land — most of it is already buildings and
 * roads. `buildableAreaSqm` is what's left after both are subtracted, using
 * the same coverage percentages the dataset already reports (or flags as
 * assumed) for that zone. This is the number that makes "place as many
 * parks as you like" a real constraint rather than an unlimited resource:
 * a zone only has as much room as its own land actually allows.
 */
export function zoneAreaSqm(zone) {
  const a = project(zone.bounds[0]),
    b = project(zone.bounds[1]);
  // project() returns kilometres; 1 km² = 1,000,000 m².
  return Math.abs(a[0] - b[0]) * Math.abs(a[1] - b[1]) * 1e6;
}

export function buildableAreaSqm(zone) {
  const built = (zone.building_density_pct || 0) + (zone.road_coverage_pct || 0);
  const availablePct = Math.max(0, 100 - built);
  return zoneAreaSqm(zone) * (availablePct / 100);
}

// Four of the dataset's twelve measures (misting corridors, shade
// structures, water-body restoration, street tree planting) never got a
// footprint computed — they attach to infrastructure that already exists
// rather than claiming new open land, so the original data pipeline simply
// didn't size them. A rate borrowed from this same dataset's own priced
// sibling in the same category (₹/m² for a measure that *does* carry a
// footprint) turns their cost into an area the same way those siblings'
// own cost-per-area rates were built — not a number invented from nothing,
// but clearly a stand-in, so `footprintSqm` reports which case it used.
const CATEGORY_RATE_FALLBACK_INR_PER_SQM = { green: 3000, cool_surface: 155, water: 800 };

/** A measure's physical footprint in m², and whether the dataset measured it or this had to estimate one. */
export function footprintSqm(item) {
  if (Number.isFinite(item.estimated_area_sqm))
    return { sqm: item.estimated_area_sqm, source: "measured" };
  const rate = CATEGORY_RATE_FALLBACK_INR_PER_SQM[item.category];
  if (rate && Number.isFinite(item.estimated_cost_inr))
    return { sqm: item.estimated_cost_inr / rate, source: "estimated" };
  return { sqm: 400, source: "estimated" };
}

/** How many of this one measure could physically fit in the zone's remaining land. */
export function maxCountFor(item, buildableSqm) {
  const footprint = footprintSqm(item).sqm || 1;
  return Math.max(0, Math.floor(buildableSqm / footprint));
}

/**
 * The result of an arbitrary number of placed measures, of any mix of the
 * three categories, each placed at its own spot.
 *
 * `placements` is `[{ interventionId, effectiveness }]` — one entry per
 * physically placed object, duplicates of the same measure allowed.
 * `effectiveness` (0.5–1) comes from where in the zone it was dropped: at
 * the zone's real building-density hotspot it's 1, fading toward 0.5 at the
 * zone's edge, because a cooling measure sitting where the heat actually
 * concentrates does more good than the same measure in a quiet corner —
 * that's the "optimal placement" the game rewards.
 *
 * Cooling still keeps only 75% of its sum once more than one *category* is
 * in play (the original overlap rule), and the total is additionally capped
 * so a zone can never be modelled as cooling past the study's own rural
 * baseline — you can green an entire zone, but you cannot out-cool the
 * climate it sits in.
 */
export function impactPlacements(interventions, placements, { baselineC, lstC } = {}) {
  const byId = new Map(interventions.map((i) => [i.id, i]));
  const rows = placements
    .map((p) => ({ ...p, item: byId.get(p.interventionId) }))
    .filter((p) => p.item);
  const categories = new Set(rows.map((r) => r.item.category));
  const rawDrop = rows.reduce(
    (s, r) => s + (r.item.temp_drop || 0) * (r.effectiveness ?? 1),
    0,
  );
  const damped = rawDrop * (categories.size > 1 ? 0.75 : 1);
  const ceiling = Number.isFinite(baselineC) && Number.isFinite(lstC)
    ? Math.max(0, lstC - baselineC)
    : Infinity;
  const drop = Math.min(damped, ceiling);
  const material = rows.reduce((s, r) => s + (r.item.estimated_cost_inr || 0), 0);
  return {
    drop: Math.round(drop * 100) / 100,
    cappedByBaseline: damped > ceiling,
    material,
    total: Math.round(material * 1.3 * 1.1),
    count: rows.length,
    byCategory: [...categories],
  };
}

export function weatherStatus(reading, now = Date.now()) {
  if (!Number.isFinite(reading?.air_temp_c)) return "Unavailable";
  const stamp = Date.parse(
    reading.observed_at +
      (/[Z+]/.test(reading.observed_at?.slice(10)) ? "" : "Z"),
  );
  return Number.isFinite(stamp) &&
    now - stamp < 90 * 60 * 1000 &&
    now - stamp > -15 * 60 * 1000
    ? "Live"
    : "Cached";
}

export const TUTORIAL = [
  [
    "A city in your hands",
    "Point at a numbered zone and pinch or press the trigger to inspect it.",
  ],
  [
    "Expand Chennai",
    "Pinch the cyan city handle with both hands and spread them apart. Controllers: hold both grips.",
  ],
  [
    "See the invisible",
    "Grab a coloured layer handle and lift it. Or select Separate layers.",
  ],
  [
    "Explore & cool",
    "Left stick: fly. Right stick: turn / altitude. Choose an intervention on the panel. Home returns to the table.",
  ],
];

// Liang–Barsky clipping keeps complete OSM ways inside the study tabletop.
export function clipSegment(a, b, rect) {
  const [xmin, zmin, xmax, zmax] = rect,
    dx = b[0] - a[0],
    dz = b[1] - a[1];
  let lo = 0,
    hi = 1;
  for (const [p, q] of [
    [-dx, a[0] - xmin],
    [dx, xmax - a[0]],
    [-dz, a[1] - zmin],
    [dz, zmax - a[1]],
  ]) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) lo = Math.max(lo, r);
    else hi = Math.min(hi, r);
    if (lo > hi) return null;
  }
  return [
    [a[0] + lo * dx, a[1] + lo * dz],
    [a[0] + hi * dx, a[1] + hi * dz],
  ];
}
