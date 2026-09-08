/**
 * Backend-free replacements for the two API calls the VR scene makes.
 *
 * The full HeatScape app talks to a FastAPI service. This build is a static
 * site, so the zone model comes from the bundled snapshot and live weather is
 * fetched straight from Open-Meteo, which is keyless and sends CORS headers.
 */

const PROFILES_URL = '/vr/profiles.json';
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

let profilesPromise = null;

/** The bundled snapshot, fetched at most once per page load. */
export function loadProfiles(signal) {
  if (!profilesPromise) {
    profilesPromise = fetch(PROFILES_URL, { signal }).then((res) => {
      if (!res.ok) throw new Error(`Bundled zone model unavailable (${res.status})`);
      return res.json();
    }).catch((e) => {
      profilesPromise = null;
      throw e;
    });
  }
  return profilesPromise;
}

/** Zone records in the shape the scene expects, hottest first. */
export async function loadZones(signal) {
  const data = await loadProfiles(signal);
  return Object.values(data.profiles ?? {})
    .map((entry) => entry.zone)
    .filter(Boolean)
    .sort((a, b) => (b.heat_risk_score ?? 0) - (a.heat_risk_score ?? 0));
}

/**
 * There is no API in this build. Rejecting here is deliberate: the scene's own
 * fallback then loads the bundled snapshot and labels the source as a snapshot
 * rather than as live API output.
 */
export function fetchVRBootstrap() {
  return Promise.reject(new Error('Static build — no API; using the bundled snapshot'));
}

/**
 * Live 2m air temperature for every zone, in one Open-Meteo call.
 *
 * Air temperature, not land surface temperature. The panels label it as such
 * and must keep doing so.
 */
export async function fetchLiveClimate() {
  const zones = await loadZones();
  const points = zones.filter((z) => Array.isArray(z.center)).map((z) => [z, z.center]);
  if (!points.length) return { readings: [] };

  const params = new URLSearchParams({
    latitude: points.map(([, c]) => c[0].toFixed(4)).join(','),
    longitude: points.map(([, c]) => c[1].toFixed(4)).join(','),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m',
    timezone: 'UTC',
    wind_speed_unit: 'ms',
  });
  const res = await fetch(`${OPEN_METEO_URL}?${params}`, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error('Live weather unavailable');
  const body = await res.json();
  const entries = Array.isArray(body) ? body : [body];

  const readings = [];
  for (const [i, [zone, requested]] of points.entries()) {
    const current = entries[i]?.current;
    if (!Number.isFinite(current?.temperature_2m)) continue;
    readings.push({
      zone_id: zone.id,
      zone_name: zone.name,
      requested: { latitude: requested[0], longitude: requested[1] },
      grid: { latitude: entries[i].latitude, longitude: entries[i].longitude },
      elevation_m: entries[i].elevation,
      air_temp_c: current.temperature_2m,
      apparent_temp_c: current.apparent_temperature,
      humidity_pct: current.relative_humidity_2m,
      wind_speed_mps: current.wind_speed_10m,
      status: 'current',
      observed_at: current.time,
      measured: false,
      data_kind: 'weather_model',
      quantity: '2m air temperature',
      source: 'Open-Meteo',
      source_url: 'https://open-meteo.com/',
    });
  }
  return {
    readings,
    quantity: '2m air temperature',
    note: 'Measured air temperature on a ~11km grid. Not land surface temperature.',
  };
}
