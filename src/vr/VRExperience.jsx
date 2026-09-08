import { hasMappedData, currentWeather } from "../utils/dataStatus";
import { useEffect, useRef, useState } from "react";
import { createExperience } from "./scene";
import { money, weatherStatus } from "./model";
import "./vr.css";

/**
 * The flat overlay is a mirror of the game, not a second way to run it.
 *
 * It has two faces, matching the two modes the scene itself runs in: a title
 * screen while the player is holding the globe, and the zone/measure panel
 * once they have dived into the tabletop city. On desktop the same buttons
 * that a pinch would trigger in the headset are exposed here — dive in,
 * spin, pick a zone, lift a measure, drop it on the map.
 */
export default function VRExperience({ zones, supported, onClose }) {
  const host = useRef(null),
    runtime = useRef(null);
  const [status, setStatus] = useState("Preparing Chennai Orbit…"),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [state, setState] = useState(null),
    [entering, setEntering] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    let instance;
    createExperience(host.current, zones, {
      signal: abort.signal,
      onProgress: setStatus,
      onState: (s) => {
        if (!abort.signal.aborted) setState(s);
      },
      onError: setError,
      onExit: () => onClose?.(),
    })
      .then((result) => {
        instance = result;
        if (abort.signal.aborted) {
          result.dispose();
          return;
        }
        runtime.current = result;
        setReady(true);
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setError("Could not load the 3D scene: " + e.message);
      });
    return () => {
      abort.abort();
      runtime.current = null;
      instance?.dispose();
    };
  }, [zones, onClose]);

  function enter() {
    if (!runtime.current || entering) return;
    setError("");
    setEntering(true);
    runtime.current
      .enterVR()
      .catch((e) =>
        setError(
          `VR did not start: ${e.message}. Check headset permissions, then try again.`,
        ),
      )
      .finally(() => setEntering(false));
  }

  const call = (method, ...args) => runtime.current?.[method](...args);
  const mode = state?.mode || "globe";
  const z = state?.zone,
    reading = state?.reading,
    liveStatus = state?.weatherError && reading ? "Cached" : weatherStatus(reading),
    measures = state?.detail?.interventions || [],
    chosen = state?.chosenIds || [],
    result = state?.result,
    available = state?.available ?? 0,
    capacity = state?.capacity;

  const countOf = (id) => chosen.filter((c) => c === id).length;

  return (
    <div className="vr-shell">
      <div
        className="vr-viewport"
        ref={host}
        aria-label="Interactive Chennai Orbit hologram"
      />
      <header className="vr-header">
        {onClose ? (
          <button className="vr-back" onClick={onClose}>
            ← Back
          </button>
        ) : (
          <span className="vr-back-spacer" />
        )}
        <div className="vr-wordmark">
          <span className="vr-dot" /> CHENNAI <span>/ ORBIT</span>
        </div>
        <div className="vr-header-actions">
          {supported && (
            <button
              className="vr-primary"
              onClick={enter}
              disabled={!ready || entering || state?.immersive}
            >
              {entering ? "Entering…" : state?.immersive ? "In VR" : "Enter VR"}
            </button>
          )}
          <button onClick={() => call("sound")} disabled={!ready}>
            Sound {state?.sound ? "on" : "off"}
          </button>
        </div>
      </header>

      {!ready && (
        <div className="vr-loading" role="status">
          <span className="vr-spinner" />
          <h1>Assembling the world</h1>
          <p>{status}</p>
          {error && <p role="alert">{error}</p>}
          {onClose && <button onClick={onClose}>Back</button>}
        </div>
      )}

      {ready && mode !== "city" && (
        <div className="vr-title-screen">
          <div className="vr-globe-card">
            <div className="vr-overline">HOLD THE WORLD</div>
            <h1>
              Spin the planet.
              <br />
              <span>Fall into Chennai.</span>
            </h1>
            <p className="vr-subtle">
              In the headset, grab the globe with one hand to spin it, both
              hands to zoom. Pinch the marker over India — or the{" "}
              <b>ENTER CHENNAI</b> card beside it — to descend into the
              tabletop city and start cooling its 18 hottest zones.
            </p>
            <p className="vr-subtle">
              On desktop, drag to orbit your view and click the marker to
              dive in.
            </p>
            <div className="vr-globe-actions">
              <button
                className="vr-focus"
                onClick={() => call("dive")}
                disabled={mode === "diving"}
              >
                {mode === "diving" ? "Falling toward Chennai…" : "Dive in ↓"}
              </button>
              <button
                onClick={() => call("toggleThermal")}
                aria-pressed={state?.thermalOn}
              >
                🌡 {state?.thermalOn ? "Live thermal: on" : "Live thermal view"}
              </button>
            </div>
            <p className="vr-note">
              Thermal view loads real NASA MODIS land-surface-temperature
              imagery live from NASA's public GIBS service. Dark gaps are
              cloud cover the satellite couldn't see through, not zero
              temperature — and if the fetch fails, the globe stays on the
              stylised map rather than showing a fake reading.
            </p>
          </div>
        </div>
      )}

      {ready && mode === "city" && (
        <>
          <aside className="vr-zones">
            <div className="vr-overline">TARGET ZONE</div>
            <h1>
              18 hotspots.
              <br />
              <span>Cool them down.</span>
            </h1>
            <p className="vr-subtle">
              Pick a zone, then place its three measures on the map.
            </p>
            <div className="vr-zone-list">
              {zones.map((zone, i) => (
                <button
                  key={zone.id}
                  onClick={() => call("select", zone.id)}
                  aria-pressed={zone.id === z?.id}
                >
                  <span className="vr-number">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>
                    {zone.name}
                    <small>
                      {Number.isFinite(zone.lst_celsius)
                        ? `${zone.risk_level} risk · ${zone.lst_celsius}°C modelled`
                        : "Heat data unavailable"}
                    </small>
                  </span>
                  <i style={{ background: zone.heat_color }} />
                </button>
              ))}
            </div>
            <button className="vr-orbit-return" onClick={() => call("ascend")}>
              🌍 Return to orbit
            </button>
          </aside>

          <section className="vr-detail" aria-label="Selected zone">
            <div className="vr-overline">
              ZONE {String(zones.indexOf(z) + 1).padStart(2, "0")} / CHENNAI
            </div>
            <h2>{z?.name}</h2>

            {hasMappedData(z) ? (
              <div className="vr-metric">
                <strong>
                  {(z.lst_celsius - (result?.drop || 0)).toFixed(2)}°
                  <small>C</small>
                </strong>
                <span>
                  Modelled surface temperature
                  {result?.drop > 0 && ` · was ${z.lst_celsius}°C`}
                </span>
              </div>
            ) : (
              <div role="status">
                <p>
                  Zone statistics unavailable: recent verified mapping inputs
                  are missing, and fallback figures are hidden.
                </p>
              </div>
            )}

            <div className="vr-weather">
              <span
                className="vr-dot"
                style={{
                  background: liveStatus === "Live" ? "#64efbd" : "#e1b47c",
                }}
              />
              {liveStatus} air weather{" "}
              <b>
                {currentWeather(reading)
                  ? `${reading.air_temp_c}°C`
                  : "Unavailable"}
              </b>
              <small>
                {reading?.observed_at
                  ? `Open-Meteo · ${reading.observed_at.replace("T", " ")} UTC`
                  : "No live reading substituted"}
              </small>
            </div>

            <h3>Build as many as the land allows</h3>
            <p className="vr-subtle">
              Every measure can be placed more than once — there's no fixed
              limit of one park per zone. What limits you is real: each
              zone's own buildable land (non-built, non-road area, from its
              own coverage data), and each measure's own footprint. Placing
              near the gold-ringed hotspot on the map — the zone's real
              building-density cluster — cools more than the same measure
              placed in a quiet corner.
            </p>
            {state?.carrying && (
              <p className="vr-carrying" role="status">
                Carrying a measure — click on the map to place it. It snaps into its own zone.
              </p>
            )}
            {measures.length === 0 && (
              <p className="vr-note">
                Recommendations unavailable. Reopen the hologram to retry.
              </p>
            )}
            {measures.map((item) => {
              const count = countOf(item.id);
              return (
                <button
                  className="vr-intervention"
                  key={item.id}
                  onClick={() =>
                    count > 0 ? call("toggle", item.id) : call("lift", item.id)
                  }
                  aria-pressed={count > 0}
                >
                  <span>
                    {count > 0 ? `✓ ×${count}` : "+"} {item.name}
                  </span>
                  <strong>
                    −{(item.local_reference_drop_c ?? 0).toFixed(1)}°C locally{" "}
                    <small>{money(item.estimated_cost_inr)} each</small>
                  </strong>
                  <small>
                    −{item.temp_drop}°C spread across the zone ·{" "}
                    {item.effect_radius_m}m radius · {item.authority}-level
                    approval
                  </small>
                  <small>
                    {count > 0
                      ? "Click to remove the most recent one · click the placed object in-world to remove any"
                      : item.source}
                  </small>
                </button>
              );
            })}

            {result && (
              <div className="vr-impact">
                <strong>−{result.drop.toFixed(2)}°C</strong>
                <span>
                  Zone-average cooling · {result.count} measure{result.count === 1 ? "" : "s"} placed
                  {available > 0 &&
                    ` · ${available.toFixed(2)}°C single-of-each ceiling`}
                </span>
                <b>{money(result.total)}</b>
                <span>
                  Including installation, site work &amp; contingency
                </span>
              </div>
            )}

            {capacity && (
              <div className={"vr-capacity" + (capacity.pct >= 0.98 ? " vr-capacity-full" : "")}>
                <div className="vr-overline">LAND CAPACITY, THIS ZONE</div>
                <div className="vr-capacity-bar">
                  <div className="vr-capacity-fill" style={{ width: `${Math.round(capacity.pct * 100)}%` }} />
                </div>
                <span>
                  {Math.round(capacity.usedSqm).toLocaleString()} m² used of{" "}
                  {Math.round(capacity.buildableSqm).toLocaleString()} m² buildable land
                  {" "}({Math.round(capacity.pct * 100)}%)
                </span>
                <strong>
                  {capacity.pct >= 0.98
                    ? "No room left — this zone's non-built, non-road land is fully committed"
                    : `${Math.round(capacity.remainingSqm).toLocaleString()} m² still available`}
                </strong>
              </div>
            )}

            <div className="vr-detail-actions">
              <button onClick={() => call("before")} aria-pressed={state?.before}>
                {state?.before ? "Show after" : "Compare before"}
              </button>
              <button onClick={() => call("resetMeasures")}>Clear zone</button>
              <button className="vr-focus" onClick={() => call("focusZone")}>
                Fly in ↗
              </button>
            </div>

            <p className="vr-note">
              Literature-based model. Overlapping measures keep 75% of their
              summed cooling. Conceptual placement, not a CFD simulation or a
              tendered quote. {state?.source}.
            </p>
          </section>

          <nav className="vr-tools" aria-label="Hologram controls">
            <button onClick={() => call("scale", 1.35)}>↗ Expand</button>
            <button onClick={() => call("scale", 0.75)}>↙ Contract</button>
            <button onClick={() => call("split")}>Separate layers</button>
            <button onClick={() => call("reassemble")}>Reassemble</button>
            <button onClick={() => call("home")}>⌂ Home</button>
            <button onClick={() => call("flight")} aria-pressed={state?.flight}>
              Flight {state?.flight ? "on" : "off"}
            </button>
          </nav>

          <footer className="vr-footer">
            <span>
              {supported
                ? "Immersive VR supported · enter above"
                : "Desktop preview · immersive VR requires a compatible headset"}
            </span>
            <span>
              {state?.geometry} · {state?.fps || "—"} FPS (desktop)
            </span>
            <span>
              ©{" "}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
              >
                OpenStreetMap
              </a>{" "}
              · Esri, Maxar, Earthstar Geographics
            </span>
          </footer>

          {error && (
            <div className="vr-error" role="alert">
              {error}
            </div>
          )}
        </>
      )}
    </div>
  );
}
