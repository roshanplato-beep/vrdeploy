import * as THREE from "three";
import { HOLO, glow, wire, label, pulseRing, reticle } from "./holo";
import { project } from "./model";

/**
 * The globe: the game's title screen and its first interaction.
 *
 * Chennai Orbit replaces the tabletop hologram's centre-table framing with a
 * held planet. You spin the world with your own hands, find the marker over
 * South India, and pinch it (or the floating "ENTER CHENNAI" card beside it)
 * to fall toward the surface — which is the transition into the tabletop
 * city the rest of the game already builds.
 *
 * The sphere is drawn, not photographed: a canvas texture painted with
 * stylised continents in the hologram's own palette, so the globe reads as
 * part of the same holographic vocabulary as everything else rather than as
 * a stock-photo Earth dropped into a sci-fi UI.
 */

const EARTH_RADIUS = 0.42; // metres — comfortably held between two hands.

// Very rough continent silhouettes, in equirectangular [lon,lat] degrees.
// Not cartographically exact — this is a hologram, not a GIS export — but
// recognisable at a glance, which is all a spun title-screen globe needs.
const LANDMASSES = [
  // Africa
  [[-17,15],[-10,5],[10,4],[15,-5],[20,-20],[35,-25],[40,-10],[45,10],[38,18],[32,30],[10,32],[-10,32],[-17,20]],
  // Europe
  [[-9,36],[-9,44],[0,50],[15,55],[30,60],[40,45],[28,40],[18,40],[10,36],[-2,37]],
  // Asia (broad)
  [[28,40],[45,45],[60,55],[90,60],[130,60],[140,45],[125,25],[105,10],[95,5],[80,8],[68,20],[60,25],[45,30],[35,35]],
  // India subcontinent
  [[68,24],[80,22],[88,22],[92,18],[85,10],[77,8],[72,15],[68,24]],
  // Australia
  [[113,-22],[125,-15],[142,-11],[153,-27],[145,-38],[130,-32],[115,-33],[113,-22]],
  // North America
  [[-165,65],[-140,68],[-95,70],[-70,60],[-55,50],[-65,42],[-80,25],[-97,20],[-110,25],[-124,40],[-130,55],[-165,65]],
  // South America
  [[-80,10],[-60,10],[-50,0],[-35,-8],[-40,-22],[-58,-35],[-70,-30],[-75,-15],[-80,10]],
];

function drawEarthTexture() {
  const w = 1024, h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d");

  // Ocean: a deep holographic teal gradient rather than photographic blue.
  const ocean = c.createLinearGradient(0, 0, 0, h);
  ocean.addColorStop(0, "#04333d");
  ocean.addColorStop(0.5, "#062733");
  ocean.addColorStop(1, "#02151d");
  c.fillStyle = ocean;
  c.fillRect(0, 0, w, h);

  // Latitude/longitude grid, faint.
  c.strokeStyle = "rgba(88,238,208,0.10)";
  c.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 20) {
    const x = ((lon + 180) / 360) * w;
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
  }
  for (let lat = -80; lat <= 80; lat += 20) {
    const y = ((90 - lat) / 180) * h;
    c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
  }

  const toXY = ([lon, lat]) => [
    ((lon + 180) / 360) * w,
    ((90 - lat) / 180) * h,
  ];

  c.fillStyle = "#0f5a52";
  c.strokeStyle = "#3fd9bd";
  c.lineWidth = 2;
  for (const poly of LANDMASSES) {
    c.beginPath();
    poly.forEach(([lon, lat], i) => {
      const [x, y] = toXY([lon, lat]);
      i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    });
    c.closePath();
    c.fill();
    c.stroke();
  }

  // India gets a brighter fill — the region the game is actually about.
  c.fillStyle = "rgba(255,167,102,0.35)";
  c.beginPath();
  [[68,24],[80,22],[88,22],[92,18],[85,10],[77,8],[72,15],[68,24]].forEach(
    ([lon, lat], i) => {
      const [x, y] = toXY([lon, lat]);
      i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    },
  );
  c.closePath();
  c.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Where Chennai sits on the globe's own surface, in local unit-sphere space. */
function chennaiDirection() {
  const lat = 13.0827, lon = 80.2707;
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon + 180);
  return new THREE.Vector3(
    -Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  );
}

export function createGlobe() {
  const root = new THREE.Group();

  const texture = drawEarthTexture();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS, 64, 48),
    new THREE.MeshLambertMaterial({ map: texture, emissive: "#04211f", emissiveIntensity: 0.35 }),
  );
  sphere.userData.grab = "globe";
  sphere.userData.halfSize = { x: EARTH_RADIUS, y: EARTH_RADIUS }; // rough poke bound, unused for sphere
  root.add(sphere);

  // Atmosphere: a slightly larger additive shell, thin and cool.
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS * 1.035, 48, 32),
    glow(HOLO.cyan, 0.16),
  );
  atmosphere.material.side = THREE.BackSide;
  root.add(atmosphere);

  // A slow-turning holographic ring, like an orrery bezel — mostly ornament,
  // but it also reads as "this is a controllable object", not a picture.
  const bezel = new THREE.Mesh(
    new THREE.RingGeometry(EARTH_RADIUS * 1.18, EARTH_RADIUS * 1.22, 64),
    glow(HOLO.ice, 0.35),
  );
  bezel.rotation.x = Math.PI / 2.6;
  root.add(bezel);
  const bezel2 = bezel.clone();
  bezel2.material = bezel.material.clone();
  bezel2.rotation.set(-Math.PI / 2.4, 0.6, 0);
  root.add(bezel2);

  // Chennai marker: a beacon standing off the surface plus a pulsing ring,
  // exactly the same holographic vocabulary the tabletop city uses for its
  // own zone markers.
  const dir = chennaiDirection();
  const markerGroup = new THREE.Group();
  markerGroup.position.copy(dir).multiplyScalar(EARTH_RADIUS);
  markerGroup.lookAt(dir.clone().multiplyScalar(EARTH_RADIUS * 2));
  root.add(markerGroup);

  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 16, 12),
    glow(HOLO.hot, 0.95),
  );
  markerGroup.add(marker);
  marker.userData.grab = "chennai";
  marker.userData.enterTarget = true;

  const markerRing = pulseRing(0.05, HOLO.hot);
  markerRing.mesh.rotation.x = -Math.PI / 2;
  markerRing.mesh.position.y = 0.001;
  markerGroup.add(markerRing.mesh);

  // A small floating card next to the marker: the one bit of flat UI the
  // globe needs, since "pinch a point on a sphere the size of a fist" is a
  // harder target than "pinch a card floating beside it".
  const card = label(420, 140, 0.05);
  card.write([
    ["CHENNAI", 34, HOLO.amber, 700],
    ["pinch to descend ↓", 22, HOLO.white, 600],
  ]);
  card.sprite.position.copy(dir).multiplyScalar(EARTH_RADIUS * 1.55);
  card.sprite.userData.enterTarget = true;
  card.sprite.userData.halfSize = { x: 0.11, y: 0.037 };
  root.add(card.sprite);

  // A reticle ring for "you're holding a live object" feedback, orbiting
  // loosely around the whole planet.
  const orbitRing = reticle(EARTH_RADIUS * 1.5, HOLO.cyan, 32);
  orbitRing.group.rotation.x = Math.PI / 2.2;
  root.add(orbitRing.group);

  let t = 0;
  let spin = 0.06; // idle ambient rotation, rad/s
  let flash = markerRing;
  flash.fire();

  return {
    root,
    radius: EARTH_RADIUS,
    sphere,
    marker,
    cardSprite: card.sprite,
    /** Objects a pointer may hit to rotate the globe or trigger entry. */
    grabTargets: [sphere],
    enterTargets: [marker, card.sprite],
    setSpin(rate) {
      spin = rate;
    },
    update(dt, time) {
      t = time;
      root.rotation.y += dt * spin;
      bezel.rotation.z += dt * 0.12;
      bezel2.rotation.z -= dt * 0.09;
      orbitRing.spin(dt, 0.18);
      markerRing.update(dt);
      if (markerRing.mesh.material.opacity <= 0.01) flash.fire();
      card.sprite.material.opacity = 0.82 + 0.18 * Math.sin(time * 2.2);
      marker.scale.setScalar(1 + 0.25 * Math.sin(time * 3));
    },
    dispose() {
      texture.dispose();
      card.dispose();
      orbitRing.dispose();
      markerRing.dispose();
      root.traverse((o) => {
        o.geometry?.dispose();
        for (const m of [o.material].flat().filter(Boolean)) m.dispose();
      });
    },
  };
}

export { chennaiDirection };
