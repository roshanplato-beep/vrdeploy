export function freshTimestamp(stamp, maxAge, now = Date.now()) {
  if (!stamp) return false;
  const parsed = Date.parse(/[Z+]|-\d\d:\d\d$/.test(stamp.slice(10)) ? stamp : stamp + 'Z');
  return Number.isFinite(parsed) && now - parsed >= -900000 && now - parsed <= maxAge;
}

/** Measured canyon geometry from the bundled OSM footprints, if this zone has any. */
export function hasMeasuredMorphology(zone) {
  return zone?.morphology?.available === true;
}

/** A live Overpass fetch, less than a day old. */
export function hasFreshOsmFetch(zone, now = Date.now()) {
  return zone?.osm_fetched === true && freshTimestamp(zone.osm_fetched_at, 86400000, now);
}

/**
 * Does this zone have morphology we are willing to show?
 *
 * This used to require a fresh Overpass fetch and nothing else. No zone has
 * one — `zone_osm_data.json` carries `osm_fetched: false` throughout — so
 * every zone was blanked, every marker was grey, and the header read
 * "0 modelled hotspots" permanently.
 *
 * Measured footprint geometry now also qualifies. That is not a loosened
 * standard: those figures come from counting real OSM buildings rather than
 * from the fallback percentages, so they are better evidence than the fetch
 * this function was originally waiting for.
 */
export function hasMappedData(zone, now = Date.now()) {
  return hasFreshOsmFetch(zone, now) || hasMeasuredMorphology(zone);
}

export function currentWeather(reading, now = Date.now()) {
  return reading?.status !== 'stale' && Number.isFinite(reading?.air_temp_c)
    && freshTimestamp(reading?.observed_at, 5400000, now);
}

/**
 * Coverage provenance, best evidence first:
 *
 *   'fetched'  a live Overpass fetch under 24 hours old
 *   'measured' counted from the bundled OSM footprint snapshot
 *   'assumed'  the project's fallback constants -- shown, but labelled
 *
 * The 'assumed' tier exists because blanking a zone entirely left screens
 * dead for any zone the live fetch missed, and Meenambakkam has only four
 * mapped footprints (it is an airfield) so it can never reach 'measured'.
 * Showing a labelled assumption is more useful than showing nothing, as long
 * as every surface that displays it says which tier it came from -- which is
 * what `coverage_source` is for. It must never be presented as measurement.
 */
export const SOURCE_LABEL = {
  fetched: 'Live OpenStreetMap fetch',
  measured: 'Measured from OSM building footprints',
  assumed: 'Unverified project assumption — not measured',
};

export function displayZone(zone) {
  const result = { ...zone };
  const fresh = hasFreshOsmFetch(zone);
  const measured = hasMeasuredMorphology(zone);

  if (fresh) {
    result.coverage_source = 'fetched';
  } else if (measured) {
    // Substitute the measured coverage for the assumed percentages, so the
    // screens are driven by counted footprints rather than by a constant
    // somebody typed. Everything else stays as the model produced it and
    // stays labelled as model output.
    const m = zone.morphology;
    result.building_density_pct = m.building_cover_pct_measured;
    result.green_cover_pct = m.green_cover_pct_measured;
    result.coverage_source = 'measured';
  } else {
    // Fallback constants, passed through unchanged and flagged.
    result.coverage_source = 'assumed';
  }

  // Building count is not a population survey; institutional land is not public
  // ownership. Never inferred, at any tier.
  result.estimated_population = null;
  result.estimated_households = null;
  return result;
}
