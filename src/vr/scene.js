import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildCity } from "./city";
import { createGlobe } from "./globe";
import { Panel, MIN_TARGET, INK } from "./panel";
import { createPointers } from "./xr-input";
import { createGame } from "./game";
import { money, project } from "./model";
import { createAudio } from "./audio";
import { fetchLiveClimate, fetchVRBootstrap } from "../utils/api";

const clamp = THREE.MathUtils.clamp;

const SPACE = "#04101a";
const FOVEATION_MIN = 0.25;
const FOVEATION_MAX = 1;

// Where the globe floats, at arm's length in front of a standing player.
const GLOBE_POSITION = new THREE.Vector3(0, 1.35, -0.85);
const GLOBE_SCALE = 1;

/**
 * The room the hologram stands in.
 *
 * Dark open space: a vertex-coloured gradient dome, a starfield, and a ground
 * plate that dissolves into the dark via a baked alpha falloff, plus an
 * additive pool of light that tracks whichever object — the globe, then the
 * city — is currently the thing to look at. Everything here is unlit
 * BasicMaterial on a handful of draw calls.
 */
function buildEnvironment() {
  const group = new THREE.Group();
  const disposables = [];

  const domeGeometry = new THREE.SphereGeometry(90, 24, 16);
  const colors = [];
  const horizon = new THREE.Color("#0d2a38");
  const zenith = new THREE.Color("#030a12");
  const position = domeGeometry.attributes.position;
  const mix = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const t = clamp(position.getY(i) / 90, -1, 1);
    mix.copy(horizon).lerp(zenith, Math.pow(Math.max(0, t), 0.55));
    colors.push(mix.r, mix.g, mix.b);
  }
  domeGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const dome = new THREE.Mesh(
    domeGeometry,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  dome.renderOrder = -3;
  group.add(dome);
  disposables.push(domeGeometry, dome.material);

  const starCount = 1400;
  const stars = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const y = Math.random() * 2 - 1;
    const r = Math.sqrt(1 - y * y);
    stars.set([Math.cos(theta) * r * 78, y * 78, Math.sin(theta) * r * 78], i * 3);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(stars, 3));
  const starField = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({ color: "#cfe9f2", size: 0.42, sizeAttenuation: true, transparent: true, opacity: 0.7, depthWrite: false, fog: false }),
  );
  starField.renderOrder = -2;
  group.add(starField);
  disposables.push(starGeometry, starField.material);

  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const c = canvas.getContext("2d");
  c.fillStyle = "#08202b";
  c.fillRect(0, 0, size, size);
  c.strokeStyle = "#1d5766";
  c.lineWidth = 2;
  const step = size / 32;
  for (let i = 0; i <= 32; i++) {
    c.globalAlpha = i % 4 === 0 ? 0.85 : 0.35;
    c.beginPath();
    c.moveTo(i * step, 0);
    c.lineTo(i * step, size);
    c.moveTo(0, i * step);
    c.lineTo(size, i * step);
    c.stroke();
  }
  c.globalAlpha = 1;
  const falloff = c.createRadialGradient(size / 2, size / 2, size * 0.06, size / 2, size / 2, size * 0.5);
  falloff.addColorStop(0, "rgba(0,0,0,0)");
  falloff.addColorStop(0.55, "rgba(0,0,0,0.55)");
  falloff.addColorStop(1, "rgba(0,0,0,1)");
  c.globalCompositeOperation = "destination-out";
  c.fillStyle = falloff;
  c.fillRect(0, 0, size, size);

  const groundTexture = new THREE.CanvasTexture(canvas);
  groundTexture.colorSpace = THREE.SRGBColorSpace;
  groundTexture.anisotropy = 4;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 70),
    new THREE.MeshBasicMaterial({ map: groundTexture, transparent: true, depthWrite: false, fog: true }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.012;
  ground.renderOrder = -1;
  group.add(ground);
  disposables.push(ground.geometry, ground.material, groundTexture);

  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = glowCanvas.height = 256;
  const g = glowCanvas.getContext("2d");
  const pool = g.createRadialGradient(128, 128, 6, 128, 128, 126);
  pool.addColorStop(0, "rgba(120,240,222,0.55)");
  pool.addColorStop(0.35, "rgba(64,180,190,0.22)");
  pool.addColorStop(1, "rgba(20,80,110,0)");
  g.fillStyle = pool;
  g.fillRect(0, 0, 256, 256);
  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  const poolMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(6.5, 6.5),
    new THREE.MeshBasicMaterial({ map: glowTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  );
  poolMesh.rotation.x = -Math.PI / 2;
  poolMesh.renderOrder = -1;
  group.add(poolMesh);
  disposables.push(poolMesh.geometry, poolMesh.material, glowTexture);

  return {
    group,
    followCity(cityRoot) {
      poolMesh.position.set(cityRoot.position.x, 0.004, cityRoot.position.z);
      const spread = clamp(cityRoot.scale.x * 42, 2.5, 14);
      poolMesh.scale.setScalar(spread / 6.5);
    },
    followGlobe(globeRoot, radius) {
      poolMesh.position.set(globeRoot.position.x, Math.max(0.01, globeRoot.position.y - radius * globeRoot.scale.x - 0.3), globeRoot.position.z);
      poolMesh.scale.setScalar((radius * globeRoot.scale.x * 2.4) / 6.5);
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}

export async function createExperience(
  container,
  zones,
  { signal, onProgress, onState, onError, onExit },
) {
  // Mobile browser chrome (Quest's included) can report a 0x0 or stale
  // container size for the first paint or two — the UI hasn't finished its
  // layout pass yet. A camera built with a 0 or NaN aspect ratio renders
  // nothing at all, silently, with no error: exactly a black screen that
  // "fixes itself" the moment anything later forces a relayout. Falling back
  // to the window's own size when the container isn't ready yet avoids ever
  // creating that broken first frame.
  const size = () => ({
    w: container.clientWidth || window.innerWidth || 1,
    h: container.clientHeight || window.innerHeight || 1,
  });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SPACE);
  scene.fog = new THREE.FogExp2(SPACE, 0.011);
  const camera = new THREE.PerspectiveCamera(52, size().w / size().h, 0.015, 160);
  camera.position.set(0, 1.5, 0.3);
  const rig = new THREE.Group();
  rig.add(camera);
  scene.add(rig);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.setSize(size().w, size().h);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.xr.enabled = true;
  renderer.xr.setFramebufferScaleFactor(1);
  renderer.xr.setFoveation(FOVEATION_MIN);
  container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(GLOBE_POSITION);
  controls.minDistance = 0.4;
  controls.maxDistance = 12;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.enableDamping = true;
  controls.update();
  scene.add(new THREE.HemisphereLight("#bff0ff", "#123039", 2.0));
  const sun = new THREE.DirectionalLight("#ffe3bf", 2.6);
  sun.position.set(-5, 12, 4);
  scene.add(sun);
  const rim = new THREE.DirectionalLight("#7fe6ff", 1.1);
  rim.position.set(6, 5, -9);
  scene.add(rim);
  const environment = buildEnvironment();
  scene.add(environment.group);
  const audio = createAudio();

  // --- The globe: title screen and first interaction -----------------------
  const globe = createGlobe();
  globe.root.position.copy(GLOBE_POSITION);
  globe.root.scale.setScalar(GLOBE_SCALE);
  scene.add(globe.root);

  let disposed = false, city, weatherTimer, resize, sessionStart = () => {}, sessionEnd = () => {};
  try {
    city = await buildCity(zones, onProgress, signal);
  } catch (e) {
    renderer.dispose();
    renderer.domElement.remove();
    controls.dispose();
    throw e;
  }
  if (signal.aborted) {
    city.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    controls.dispose();
    throw new DOMException("Aborted", "AbortError");
  }
  city.root.position.set(-0.18, 0.85, -1.7);
  city.root.scale.setScalar(0.073);
  city.root.visible = false;
  scene.add(city.root);

  // One small panel strapped to the back of the left hand — the only flat
  // control surface. Everything else is an object in the world: the globe you
  // hold, the cards that hang over a zone, the measure carried in a hand.
  const wrist = new Panel(560, 460, 0.15);
  wrist.mesh.rotation.set(-0.5, 0.32, 0.12);
  wrist.mesh.position.set(0.008, 0.045, -0.055);
  wrist.mesh.visible = false;

  // Two floating windows flanking the city — the in-world equivalent of the
  // flat build's zone-list and zone-detail sidebars, since a headset player
  // never sees flat HTML at all. Left picks a zone; right shows everything
  // about the one that's selected: temperature, live weather, land capacity,
  // and every cost involved. World-anchored beside the tabletop rather than
  // hand-attached, so both hands stay free for actually placing measures.
  const leftPanel = new Panel(760, 1080, 0.46);
  const rightPanel = new Panel(760, 1080, 0.46);
  leftPanel.mesh.visible = false;
  rightPanel.mesh.visible = false;
  let leftPage = 0;
  const ZONES_PER_PAGE = 6;

  const panels = [wrist, leftPanel, rightPanel];
  const worldPanels = [leftPanel, rightPanel];

  const hoverQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: INK.accent, transparent: true, opacity: 0.22, depthTest: false, depthWrite: false }),
  );
  hoverQuad.renderOrder = 51;
  hoverQuad.visible = false;
  scene.add(hoverQuad);

  const handles = [];
  const handleMaterial = new THREE.MeshBasicMaterial({ color: "#54f4da" });
  const whole = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.12, 8, 40), handleMaterial);
  whole.rotation.x = -Math.PI / 2;
  whole.position.set(0, 0.2, 13);
  whole.userData.grab = "city";
  city.root.add(whole);
  handles.push(whole);
  ["#ff9757", "#64eda0", "#87ddf5"].forEach((color, i) => {
    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.48, 16, 12), new THREE.MeshBasicMaterial({ color }));
    handle.position.set(-12, 0.55, 8 - i * 4);
    handle.userData.grab = i;
    city.layers[i].add(handle);
    handles.push(handle);
  });

  const state = {
    mode: "globe", // 'globe' | 'diving' | 'city'
    zone: zones.find((z) => z.id === "mount_road") || zones[0],
    split: false,
    sound: false,
    flight: false,
    before: false,
    chosen: {},
    details: {},
    weather: {},
    score: 0,
    source: "Loading profiles",
    geometry: city.geo ? `${city.geo.features.filter((f) => f.kind === "building").length.toLocaleString()} OSM footprints` : "Footprints unavailable",
    loading: true,
  };

  let weatherPending = false, weatherAttemptedAt = 0, weatherError = false,
    grabs = new Map(), pair = null, globeSpin = { active: false, last: null },
    lastTime = 0, frameCount = 0, frameTime = 0, frameStart = 0, foveation = FOVEATION_MIN,
    diveT = -1;

  const raycaster = new THREE.Raycaster(), cursor = new THREE.Vector2();
  let game = null;
  const panelMeshes = panels.map((p) => p.mesh);
  const worldPanelMeshes = worldPanels.map((p) => p.mesh);
  const hitTargets = () => {
    if (state.mode === "globe") {
      return [...(renderer.xr.isPresenting ? panelMeshes : []), ...globe.grabTargets, ...globe.enterTargets, ...globe.thermalTargets];
    }
    return [
      ...(renderer.xr.isPresenting ? [wrist.mesh] : []),
      ...worldPanelMeshes,
      ...(game ? game.targets() : []),
      ...handles,
      ...city.markers,
      city.grabSurface,
    ];
  };
  const pokeTargets = () =>
    renderer.xr.isPresenting
      ? [...panelMeshes, ...(state.mode === "city" && game ? game.pokeTargets() : []), ...(state.mode === "globe" ? [...globe.enterTargets, ...globe.thermalTargets].filter((t) => t.userData.halfSize) : [])]
      : [];

  const chosen = () => (game ? game.chosenFor(state.zone.id) : []);
  const result = () => (game ? game.resultFor(state.zone.id) : { drop: 0, total: 0, count: 0 });

  function publish() {
    onState({
      ...state,
      chosenIds: chosen(),
      carrying: game?.isCarrying() ? game.state.carrying.item.id : null,
      result: result(),
      available: game ? game.ceilingFor(state.zone.id).drop : 0,
      capacity: game ? game.capacityFor(state.zone.id) : null,
      detail: state.details[state.zone.id],
      reading: state.weather[state.zone.id],
      thermalOn: globe.isThermalOn(),
    });
  }

  function draw() {
    const zoneId = state.zone.id;
    const r = state.before ? { drop: 0, total: 0 } : result();
    if (state.mode === "globe") {
      wrist.begin("Spin the world with your hands", "CHENNAI ORBIT");
      wrist.text("Pinch the marker over India, or the", 24, 190, 24, INK.body);
      wrist.text('"ENTER CHENNAI" card, to descend.', 24, 220, 24, INK.body);
      wrist.button("Sound " + (state.sound ? "on" : "off"), 24, 272, 256, MIN_TARGET, () => sound());
      wrist.button("Exit VR", 288, 272, 256, MIN_TARGET, () => exit());
      wrist.finish();
      return;
    }
    wrist.begin(`−${r.drop.toFixed(2)}°C · ${money(r.total)}`, "CHENNAI ORBIT / " + state.zone.name.toUpperCase().slice(0, 20));
    const controls_ = [
      [state.before ? "After" : "Before", () => before()],
      ["Clear zone", () => resetMeasures()],
      ["Expand", () => scale(1.35)],
      ["Shrink", () => scale(1 / 1.35)],
      ["Home", () => home()],
      ["🌍 Orbit", () => ascend()],
      ["Exit VR", () => exit()],
    ];
    controls_.forEach(([labelText, fn], i) =>
      wrist.button(labelText, 16 + (i % 2) * 272, 168 + Math.floor(i / 2) * 98, 256, MIN_TARGET, fn, i === 0 && state.before),
    );
    wrist.finish();
    state.chosenIds = game ? game.chosenFor(zoneId) : [];
    drawLeftPanel();
    drawRightPanel();
  }

  /** Left floating window: pick a zone. The in-world equivalent of the flat sidebar's zone list. */
  function drawLeftPanel() {
    if (state.mode !== "city") return;
    leftPanel.mesh.visible = true;
    const pageCount = Math.ceil(zones.length / ZONES_PER_PAGE);
    leftPage = Math.min(leftPage, pageCount - 1);
    const y0 = leftPanel.begin(`Page ${leftPage + 1} of ${pageCount}`, "18 HOTSPOTS · PICK A ZONE");
    const start = leftPage * ZONES_PER_PAGE;
    const rowH = 118;
    zones.slice(start, start + ZONES_PER_PAGE).forEach((zone, i) => {
      const y = y0 + 16 + i * rowH;
      const active = zone.id === state.zone.id;
      leftPanel.button(
        `${String(start + i + 1).padStart(2, "0")}  ${zone.name}`,
        24,
        y,
        712,
        rowH - 12,
        () => select(zone.id),
        active,
      );
      leftPanel.text(
        Number.isFinite(zone.lst_celsius) ? `${zone.risk_level} risk · ${zone.lst_celsius}°C modelled` : "Heat data unavailable",
        44,
        y + rowH - 24,
        20,
        INK.muted,
      );
    });
    const navY = y0 + 16 + ZONES_PER_PAGE * rowH + 8;
    leftPanel.button("◀ Prev", 24, navY, 340, MIN_TARGET, () => {
      leftPage = (leftPage - 1 + pageCount) % pageCount;
      drawLeftPanel();
    });
    leftPanel.button("Next ▶", 396, navY, 340, MIN_TARGET, () => {
      leftPage = (leftPage + 1) % pageCount;
      drawLeftPanel();
    });
    leftPanel.finish();
  }

  /** Right floating window: everything about the selected zone — temperature, weather, land capacity, and every cost involved. */
  function drawRightPanel() {
    if (state.mode !== "city" || !game) return;
    rightPanel.mesh.visible = true;
    const zone = state.zone;
    const r = state.before ? { drop: 0, total: 0, count: 0 } : game.resultFor(zone.id);
    const ceiling = game.ceilingFor(zone.id);
    const cap = game.capacityFor(zone.id);
    const reading = state.weather[zone.id];

    let y = rightPanel.begin(zone.name, "ZONE DETAIL & CAPACITY");
    y += 20;
    rightPanel.stat(`${(zone.lst_celsius - r.drop).toFixed(2)}°C`, "Modelled surface temperature now", 24, y, 66, INK.warm);
    y += 60;
    rightPanel.row("Baseline zone temperature", `${zone.lst_celsius.toFixed(2)}°C`, 24, y, 712, 24);
    y += 36;
    rightPanel.row("Cooling achieved", `−${r.drop.toFixed(2)}°C of ${ceiling.drop.toFixed(2)}°C ceiling`, 24, y, 712, 24);
    y += 36;
    const liveTemp = Number.isFinite(reading?.air_temp_c) ? `${reading.air_temp_c}°C air (live)` : "Live weather unavailable";
    rightPanel.row("Open-Meteo reading", liveTemp, 24, y, 712, 24);
    y += 48;

    rightPanel.text("LAND CAPACITY", 24, y, 22, INK.accent, 700, 0.12);
    y += 20;
    rightPanel.row("Buildable land (this zone)", `${Math.round(cap.buildableSqm).toLocaleString()} m²`, 24, y, 712, 24);
    y += 32;
    rightPanel.row("Used by placed measures", `${Math.round(cap.usedSqm).toLocaleString()} m² (${(cap.pct * 100).toFixed(0)}%)`, 24, y, 712, 24);
    y += 32;
    const bars = 42, filled = Math.round(cap.pct * bars);
    rightPanel.text("█".repeat(filled) + "░".repeat(bars - filled), 24, y, 22, cap.pct > 0.9 ? INK.caution : INK.accent);
    y += 44;

    rightPanel.text("COST", 24, y, 22, INK.accent, 700, 0.12);
    y += 20;
    rightPanel.row("Measures placed", `${r.count}`, 24, y, 712, 24);
    y += 32;
    rightPanel.row("Material cost", money(r.material || 0), 24, y, 712, 24);
    y += 32;
    rightPanel.row("Total incl. install + contingency", money(r.total), 24, y, 712, 24);
    y += 44;

    rightPanel.wrap(
      "Costs are catalogue assumptions, not contractor quotes. Cooling keeps 75% of its sum once more than one measure category is placed, and can never model a zone cooler than the study's own rural baseline.",
      24,
      y,
      712,
      19,
      INK.muted,
      26,
      4,
    );
    rightPanel.finish();
  }

  function select(id) {
    const z = zones.find((z) => z.id === id);
    if (!z) return;
    state.before = false;
    if (game) game.select(id);
    else state.zone = z;
  }
  function apply() {
    const r = result();
    const selected = (r.byCategory || []).map((category) => ({ category }));
    city.apply(state.zone.id, state.before ? [] : selected, state.before ? 0 : r.drop);
  }
  function toggle(id) {
    if (!state.details[state.zone.id]?.interventions.some((i) => i.id === id)) return;
    game?.toggleAtCentre(id);
  }
  function before() {
    state.before = !state.before;
    game?.setBefore(state.before);
    apply();
    draw();
    publish();
  }
  function resetMeasures() {
    game?.reset(state.zone.id);
  }
  function lift(id) {
    game?.liftById(id);
    publish();
  }
  function scale(factor) {
    city.root.scale.setScalar(clamp(city.root.scale.x * factor, 0.035, 0.45));
    audio.ping();
  }
  function split() {
    state.split = true;
    city.layers.forEach((l, i) => (l.userData.targetY = 2.4 * (3 - i)));
    draw();
    publish();
    audio.ping();
  }
  function reassemble() {
    state.split = false;
    city.layers.forEach((l) => (l.userData.targetY = 0));
    draw();
    publish();
  }
  function home() {
    rig.position.set(0, 0, 0);
    rig.rotation.set(0, 0, 0);
    city.root.position.set(-0.18, 0.85, -1.7);
    city.root.rotation.set(0, 0, 0);
    city.root.scale.setScalar(0.073);
    state.flight = false;
    grabs.clear();
    pair = null;
    if (!renderer.xr.isPresenting) {
      camera.position.set(0, 2.6, 1.2);
      controls.target.set(0, 0.95, -1.5);
      controls.update();
    }
    draw();
    publish();
  }
  function focusZone() {
    const [x, z] = project(state.zone.center);
    const dest = city.root.localToWorld(new THREE.Vector3(x, 0, z));
    if (renderer.xr.isPresenting) {
      rig.position.set(dest.x, Math.max(0, dest.y - 0.8), dest.z + 0.65);
      state.flight = true;
    } else {
      controls.target.copy(dest);
      camera.position.copy(dest).add(new THREE.Vector3(0, 0.65, 1.1));
      controls.update();
    }
    draw();
    publish();
  }
  function flight() {
    state.flight = !state.flight;
    draw();
    publish();
  }
  function sound() {
    state.sound = audio.toggle();
    draw();
    publish();
  }
  function exit() {
    const session = renderer.xr.getSession();
    if (session) session.end().catch((e) => onError(e.message));
    else onExit();
  }

  /**
   * Fall from orbit into the tabletop city.
   *
   * A tween, not a cut: the globe shrinks and fades while the city fades in
   * and grows to its tabletop size at the same spot the player is already
   * looking. `update()` below drives the actual interpolation each frame;
   * this just starts the clock and flips state once it would be complete.
   */
  function dive() {
    if (state.mode !== "globe") return;
    state.mode = "diving";
    diveT = 0;
    audio.ping();
    draw();
    publish();
  }
  function ascend() {
    if (state.mode !== "city") return;
    state.mode = "globe";
    city.root.visible = false;
    leftPanel.mesh.visible = false;
    rightPanel.mesh.visible = false;
    globe.root.visible = true;
    globe.root.scale.setScalar(GLOBE_SCALE);
    globe.root.position.copy(GLOBE_POSITION);
    globe.root.rotation.set(0, 0, 0);
    if (!renderer.xr.isPresenting) {
      controls.target.copy(GLOBE_POSITION);
      camera.position.set(0, 1.5, 0.3);
      controls.update();
    }
    audio.ping();
    draw();
    publish();
  }

  async function refreshWeather() {
    if (weatherPending || disposed || Date.now() - weatherAttemptedAt < 60000) return;
    weatherAttemptedAt = Date.now();
    weatherPending = true;
    try {
      const response = await fetchLiveClimate();
      if (disposed) return;
      for (const reading of response.readings || [])
        if (Number.isFinite(reading.air_temp_c)) state.weather[reading.zone_id] = reading;
      weatherError = !response.readings?.length;
      if (!weatherError)
        try { localStorage.setItem("chennai-orbit-weather", JSON.stringify(state.weather)); } catch {}
    } catch {
      weatherError = true;
    } finally {
      weatherPending = false;
      if (!disposed) {
        state.weatherError = weatherError;
        draw();
        publish();
      }
    }
  }
  try {
    state.weather = JSON.parse(localStorage.getItem("chennai-orbit-weather") || "{}");
  } catch {}
  draw();
  city.select(state.zone.id);
  publish();

  let data;
  try {
    data = await fetchVRBootstrap(signal);
    state.source = "API profiles";
  } catch (e) {
    if (signal.aborted) {
      dispose();
      throw e;
    }
    try {
      const res = await fetch("/vr/profiles.json", { signal });
      if (!res.ok) throw Error();
      data = await res.json();
      state.source = `Bundled model snapshot · ${data.generated_at?.slice(0, 10)}`;
    } catch {
      state.source = "Profiles unavailable";
    }
  }
  if (disposed || signal.aborted) {
    dispose();
    throw new DOMException("Aborted", "AbortError");
  }
  if (data?.profiles) state.details = data.profiles;

  game = createGame({
    scene,
    city,
    zones,
    audio,
    baseline: data?.baseline,
    onChange: (zoneId) => {
      const zone = zones.find((z) => z.id === zoneId);
      if (zone) state.zone = zone;
      apply();
      draw();
      publish();
      refreshWeather();
    },
    onRefused: () => {
      draw();
      publish();
    },
  });
  game.setDetails(state.details);
  game.select(state.zone.id);
  state.loading = false;
  draw();
  publish();
  refreshWeather();
  weatherTimer = setInterval(refreshWeather, 5 * 60 * 1000);

  // --- Input -----------------------------------------------------------------
  function inputPosition(pointer) {
    return pointers.tipPosition(pointer, new THREE.Vector3());
  }
  function beginGrab(pointer, kind) {
    const point = inputPosition(pointer);
    const root = kind === "globe" ? globe.root : city.root;
    grabs.set(pointer, {
      kind,
      start: point,
      root: root.position.clone(),
      rotation: root.rotation.clone(),
      layer: typeof kind === "number" ? city.layers[kind].position.y : 0,
    });
    pair = null;
  }
  function release(pointer) {
    grabs.delete(pointer);
    pair = null;
    for (const [p, g] of grabs) {
      const root = g.kind === "globe" ? globe.root : city.root;
      g.start = inputPosition(p);
      g.root = root.position.clone();
      g.rotation = root.rotation.clone();
      g.layer = typeof g.kind === "number" ? city.layers[g.kind].position.y : 0;
    }
  }
  function activate(hit, pointer) {
    if (state.mode === "globe") {
      if (hit?.object.userData.enterTarget) {
        dive();
        if (pointer) pointers.pulse(pointer, 0.5, 22);
        return;
      }
      if (hit?.object.userData.thermalToggle) {
        globe.toggleThermal().then(publish);
        if (pointer) pointers.pulse(pointer, 0.4, 18);
        audio.ping();
        return;
      }
      if (hit?.object.userData.panel) {
        const action = hit.object.userData.panel.hit(hit.uv);
        if (action) {
          action();
          audio.ping();
        }
        return;
      }
      if (pointer && hit?.object.userData.grab !== undefined) beginGrab(pointer, hit.object.userData.grab);
      return;
    }
    if (game?.press(hit, pointer)) return;
    if (!hit) return;
    const data = hit.object.userData;
    if (data.panel) {
      const action = data.panel.hit(hit.uv);
      if (action) {
        action();
        audio.ping();
        if (pointer) pointers.pulse(pointer, 0.5, 22);
      }
    } else if (data.zoneId) {
      select(data.zoneId);
      if (pointer) pointers.pulse(pointer, 0.4, 18);
    } else if (pointer && data.grab !== undefined) {
      beginGrab(pointer, data.grab);
    }
  }

  const handlePoint = new THREE.Vector3();
  function nearestHandle(pointer) {
    if (!pointer.isHand) return null;
    const tip = inputPosition(pointer);
    let best = null, bestDistance = 0.16;
    for (const handle of handles) {
      const distance = handle.getWorldPosition(handlePoint).distanceTo(tip);
      if (distance < bestDistance) {
        best = handle;
        bestDistance = distance;
      }
    }
    return best;
  }
  /** Reach out and grab the globe itself, without having to aim a ray at it. */
  function nearestGlobeGrab(pointer) {
    if (!pointer.isHand || state.mode !== "globe") return null;
    const tip = inputPosition(pointer);
    const distance = globe.root.getWorldPosition(handlePoint).distanceTo(tip);
    const reach = globe.radius * globe.root.scale.x + 0.1;
    return distance < reach ? globe.sphere : null;
  }

  let wristHost = null;
  const pointers = createPointers(renderer, rig, scene, {
    onSelect: (pointer, hit) => {
      if (state.mode === "globe") {
        const grabbed = nearestGlobeGrab(pointer);
        if (grabbed) {
          beginGrab(pointer, "globe");
          return;
        }
      }
      const near = nearestHandle(pointer);
      if (near) {
        beginGrab(pointer, near.userData.grab);
        return;
      }
      activate(hit, pointer);
    },
    onSqueeze: (pointer) => beginGrab(pointer, state.mode === "globe" ? "globe" : "city"),
    onRelease: (pointer) => {
      if (game?.isCarrying()) game.release();
      release(pointer);
    },
  });

  function gestures() {
    for (const pointer of pointers.pointers)
      if (grabs.has(pointer) && pointer.isHand && !pointer.hand.visible) release(pointer);

    const globeGrabs = [...grabs].filter(([, g]) => g.kind === "globe");
    if (globeGrabs.length === 2) {
      const a = inputPosition(globeGrabs[0][0]), b = inputPosition(globeGrabs[1][0]);
      const distance = Math.max(0.04, a.distanceTo(b));
      if (!pair) pair = { distance, scale: globe.root.scale.x };
      globe.root.scale.setScalar(clamp((pair.scale * distance) / pair.distance, 0.5, 2.2));
    } else if (globeGrabs.length === 1) {
      const [pointer, g] = globeGrabs[0];
      const p = inputPosition(pointer);
      const dx = p.x - g.start.x, dy = p.y - g.start.y;
      // A trackball feel: horizontal hand motion yaws the planet, vertical
      // motion tips it, both scaled down because a fist-sized globe should
      // not need a large hand movement to spin fully around.
      globe.root.rotation.y = g.rotation.y + dx * 3.4;
      globe.root.rotation.x = clamp(g.rotation.x + dy * 3.4, -1.1, 1.1);
      globe.setSpin(0);
    } else {
      globe.setSpin(0.06);
    }

    const cityGrabs = [...grabs].filter(([, g]) => g.kind === "city");
    if (cityGrabs.length === 2) {
      const a = inputPosition(cityGrabs[0][0]), b = inputPosition(cityGrabs[1][0]);
      const middle = a.clone().add(b).multiplyScalar(0.5),
        distance = Math.max(0.04, a.distanceTo(b)),
        angle = Math.atan2(b.z - a.z, b.x - a.x);
      if (!pair)
        pair = { middle: middle.clone(), distance, angle, scale: city.root.scale.x, rotation: city.root.rotation.y, position: city.root.position.clone() };
      const next = clamp((pair.scale * distance) / pair.distance, 0.035, 0.45), ratio = next / pair.scale, delta = angle - pair.angle;
      city.root.scale.setScalar(next);
      city.root.rotation.y = pair.rotation - delta;
      const offset = pair.position.clone().sub(pair.middle).multiplyScalar(ratio).applyAxisAngle(new THREE.Vector3(0, 1, 0), -delta);
      city.root.position.copy(middle).add(offset);
    } else
      for (const [pointer, g] of grabs) {
        if (g.kind === "globe") continue;
        const p = inputPosition(pointer);
        if (g.kind === "city") city.root.position.copy(g.root).add(p.sub(g.start));
        else {
          const layer = city.layers[g.kind];
          layer.userData.targetY = clamp(g.layer + (p.y - g.start.y) / city.root.scale.x, 0, 14);
          state.split = true;
        }
      }
    city.root.position.y = clamp(city.root.position.y, 0.3, 3);
    city.root.position.x = clamp(city.root.position.x, -20, 20);
    city.root.position.z = clamp(city.root.position.z, -25, 10);
  }

  function fly(dt) {
    if (!state.flight) return;
    for (const input of pointers.pointers) {
      const gp = input.source?.gamepad;
      if (!gp) continue;
      const axes = gp.axes, dx = Math.abs(axes[2] || 0) > 0.15 ? axes[2] : 0, dy = Math.abs(axes[3] || 0) > 0.15 ? axes[3] : 0;
      if (input.source.handedness === "left") {
        const q = renderer.xr.getCamera().getWorldQuaternion(new THREE.Quaternion());
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        forward.y = 0;
        forward.normalize();
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
        right.y = 0;
        right.normalize();
        rig.position.addScaledVector(forward, -dy * dt * 1.2).addScaledVector(right, dx * dt * 1.2);
      } else if (input.source.handedness === "right") {
        rig.rotation.y -= dx * dt * 0.8;
        rig.position.y = clamp(rig.position.y - dy * dt * 0.8, -0.5, 12);
      }
      rig.position.x = clamp(rig.position.x, -18, 18);
      rig.position.z = clamp(rig.position.z, -22, 18);
    }
  }

  function attachWrist() {
    const left = pointers.pointers.find((p) => p.source?.handedness === "left") || pointers.pointers.find((p) => p.source);
    if (!left) {
      wrist.mesh.visible = false;
      return;
    }
    if (wristHost !== left.grip) {
      left.grip.add(wrist.mesh);
      wristHost = left.grip;
    }
    wrist.mesh.visible = !left.isHand || left.hand.visible;
  }

  function carryGroundHit() {
    if (!game?.isCarrying()) return null;
    const pointer = game.state.carrying?.pointer;
    if (!pointer) return desktopGround;
    pointer.controller.getWorldPosition(carryOrigin);
    pointer.controller.getWorldQuaternion(carryQuaternion);
    raycaster.set(carryOrigin, carryDirection.set(0, 0, -1).applyQuaternion(carryQuaternion));
    return raycaster.intersectObject(city.grabSurface, false)[0] || null;
  }
  const carryOrigin = new THREE.Vector3(), carryDirection = new THREE.Vector3(), carryQuaternion = new THREE.Quaternion();
  const panelCam = new THREE.Vector3(), panelAnchor = new THREE.Vector3();

  let hoverRegion = null;
  function updateHover() {
    let found = null;
    for (const pointer of pointers.pointers) {
      const hit = pointer.hover;
      const panel = hit?.object.userData.panel;
      if (!panel) continue;
      const region = panel.regionAt(hit.uv);
      if (region) {
        found = { panel, region };
        break;
      }
    }
    if (!found) {
      hoverQuad.visible = false;
      hoverRegion = null;
      return;
    }
    if (found.region !== hoverRegion) {
      hoverRegion = found.region;
      const box = found.panel.toLocal(found.region.x, found.region.y, found.region.w, found.region.h);
      if (hoverQuad.parent !== found.panel.mesh) found.panel.mesh.add(hoverQuad);
      hoverQuad.position.set(box.x, box.y, 0.002);
      hoverQuad.scale.set(box.w, box.h, 1);
    }
    hoverQuad.visible = true;
  }

  function governQuality(averageFrameSeconds) {
    const ms = averageFrameSeconds * 1000;
    const before = foveation;
    if (ms > 13.8) foveation = Math.min(FOVEATION_MAX, foveation + 0.2);
    else if (ms < 11.2) foveation = Math.max(FOVEATION_MIN, foveation - 0.1);
    if (foveation !== before) renderer.xr.setFoveation(foveation);
    state.foveation = Math.round(foveation * 100) / 100;
  }

  let pointerStart = null, desktopGround = null;
  function down(e) {
    pointerStart = { x: e.clientX, y: e.clientY };
  }
  function move(e) {
    if (renderer.xr.isPresenting || !game?.isCarrying()) {
      desktopGround = null;
      return;
    }
    const r = renderer.domElement.getBoundingClientRect();
    cursor.set(((e.clientX - r.left) / r.width) * 2 - 1, (-(e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(cursor, camera);
    desktopGround = raycaster.intersectObject(city.grabSurface, false)[0] || null;
  }
  function up(e) {
    if (renderer.xr.isPresenting || !pointerStart || Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    cursor.set(((e.clientX - r.left) / r.width) * 2 - 1, (-(e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(cursor, camera);
    activate(raycaster.intersectObjects(hitTargets(), false)[0]);
    pointerStart = null;
  }
  renderer.domElement.addEventListener("pointerdown", down);
  renderer.domElement.addEventListener("pointerup", up);
  renderer.domElement.addEventListener("pointermove", move);
  function resync() {
    if (renderer.xr.isPresenting) return;
    const { w, h } = size();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  resize = new ResizeObserver(resync);
  resize.observe(container);
  // Belt and braces for the mobile-browser-chrome case above: re-measure a
  // couple of times just after mount, since a layout that settles late would
  // otherwise never trigger the observer at all (nothing "resized" from its
  // point of view — it was simply wrong from frame one).
  requestAnimationFrame(resync);
  setTimeout(resync, 250);
  setTimeout(resync, 1000);
  sessionStart = () => {
    controls.enabled = false;
    wrist.mesh.visible = true;
    if (state.mode === "city") home();
    state.sound = true;
    audio.enable();
    state.immersive = true;
    draw();
    publish();
  };
  sessionEnd = () => {
    controls.enabled = true;
    wrist.mesh.visible = false;
    state.immersive = false;
    if (state.mode === "city") home();
    publish();
  };
  renderer.xr.addEventListener("sessionstart", sessionStart);
  renderer.xr.addEventListener("sessionend", sessionEnd);

  renderer.setAnimationLoop((time) => {
    if (disposed) return;
    const dt = Math.min(0.05, (time - lastTime) / 1000 || 0.016);
    lastTime = time;

    // Dive transition: the globe shrinks toward its Chennai point and fades
    // while the city fades in and grows to tabletop scale in front of the
    // player. Purely a tween — the underlying interaction state (which
    // measures are placed, etc.) never changes during it.
    if (state.mode === "diving") {
      diveT = Math.min(1, diveT + dt / 1.1);
      // Scale-only tween: the globe shrinks away, the city grows in from
      // nothing at the same time. No material opacity is touched, so nothing
      // needs restoring afterwards — the next `ascend()` shows the globe at
      // full scale and full opacity exactly as it started.
      const eased = 1 - Math.pow(1 - diveT, 3);
      globe.root.scale.setScalar(Math.max(0.0001, GLOBE_SCALE * (1 - eased)));
      if (!city.root.visible) city.root.visible = true;
      const cityTargetScale = 0.073;
      city.root.scale.setScalar(Math.max(0.0001, cityTargetScale * eased));
      if (diveT >= 1) {
        state.mode = "city";
        globe.root.visible = false;
        city.root.position.set(-0.18, 0.85, -1.7);
        city.root.scale.setScalar(cityTargetScale);
        if (!renderer.xr.isPresenting) {
          controls.target.set(0, 0.95, -1.5);
          camera.position.set(0, 2.6, 1.2);
          controls.update();
        }
        draw();
        publish();
      }
    }

    city.layers.forEach((l) => (l.position.y = THREE.MathUtils.damp(l.position.y, l.userData.targetY || 0, 6, dt)));
    city.ring.rotation.z += dt * 0.5;
    if (state.mode === "city") environment.followCity(city.root);
    else if (state.mode === "globe") environment.followGlobe(globe.root, globe.radius);
    if (state.mode !== "diving") globe.update(dt, time / 1000);

    const active = renderer.xr.isPresenting;
    if (active) {
      pointers.update(hitTargets(), pokeTargets(), time);
      updateHover();
      attachWrist();
      gestures();
      fly(dt);
    } else controls.update();
    const viewer = active ? renderer.xr.getCamera() : camera;
    if (state.mode === "city" && game) game.update(dt, time / 1000, viewer, carryGroundHit());
    if (state.mode === "city") city.updateLOD(viewer);
    if (state.mode === "city") {
      // The two floating windows track the city's own position (so dragging
      // the tabletop carries them along) and always face whoever is looking,
      // the same billboarding the solution cards use.
      viewer.getWorldPosition(panelCam);
      city.root.getWorldPosition(panelAnchor);
      leftPanel.mesh.position.copy(panelAnchor).add(new THREE.Vector3(-1.05, 0.34, 0.15));
      rightPanel.mesh.position.copy(panelAnchor).add(new THREE.Vector3(1.05, 0.34, 0.15));
      leftPanel.mesh.lookAt(panelCam);
      rightPanel.mesh.lookAt(panelCam);
    }
    renderer.render(scene, camera);
    frameCount++;
    frameTime += dt;
    if (time - frameStart > 1000) {
      const fps = Math.round((frameCount * 1000) / (time - frameStart));
      state.fps = fps;
      state.drawCalls = renderer.info.render.calls;
      state.triangles = renderer.info.render.triangles;
      if (active) governQuality(frameTime / frameCount);
      publish();
      frameCount = 0;
      frameTime = 0;
      frameStart = time;
    }
  });

  async function enterVR() {
    if (disposed) return;
    const pending = navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"] });
    audio.enable();
    const session = await pending;
    try {
      if (disposed) {
        await session.end();
        return;
      }
      await renderer.xr.setSession(session);
    } catch (e) {
      await session.end();
      throw e;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    if (typeof weatherTimer !== "undefined") clearInterval(weatherTimer);
    resize?.disconnect();
    controls.dispose();
    audio.dispose();
    pointers.dispose();
    game?.dispose();
    globe.dispose();
    environment.dispose();
    const session = renderer.xr.getSession();
    session?.end().catch(() => {});
    renderer.xr.removeEventListener("sessionstart", sessionStart);
    renderer.xr.removeEventListener("sessionend", sessionEnd);
    renderer.domElement.removeEventListener("pointerdown", down);
    renderer.domElement.removeEventListener("pointerup", up);
    renderer.domElement.removeEventListener("pointermove", move);
    panels.forEach((p) => p.dispose());
    city.dispose();
    scene.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [o.material].flat().filter(Boolean)) {
        m.map?.dispose();
        m.dispose();
      }
    });
    renderer.dispose();
    renderer.domElement.remove();
  }

  return {
    enterVR, dispose, select, toggle, lift, before, resetMeasures, scale, split, reassemble,
    home, focusZone, flight, sound, dive, ascend,
    toggleThermal: () => globe.toggleThermal().then(publish),
    isThermalOn: () => globe.isThermalOn(),
  };
}
