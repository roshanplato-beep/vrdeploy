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
