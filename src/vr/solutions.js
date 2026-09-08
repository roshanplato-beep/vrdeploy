import * as THREE from "three";
import { HOLO, glow, wire, pulseRing } from "./holo";

/**
 * The three cooling measures as objects you can pick up and put down.
 *
 * Every zone in the dataset carries exactly three interventions, one per
 * category, so the categories are the game's vocabulary: greenery, cool
 * surfaces, water. Each is built procedurally — no model files to download,
 * and the geometry can be sized from the intervention's own numbers.
 *
 * Units here are the city's own: 1 unit = 1 km of Chennai. A 500 m effect
 * radius is 0.5 units, and it is drawn at that size rather than inflated to
 * look impressive, because the smallness of a single measure against a 24 km
 * city is the honest and more interesting fact.
 */

export const CATEGORY = {
  green: { color: HOLO.green, label: "GREEN" },
  cool_surface: { color: HOLO.ice, label: "COOL SURFACE" },
  water: { color: HOLO.water, label: "WATER" },
};

const SIZE = 0.42; // Footprint of a placed object, in kilometres.

function trees(color) {
  const group = new THREE.Group();
  const canopy = new THREE.Mesh(
    new THREE.CircleGeometry(SIZE, 28),
    glow(color, 0.32),
  );
  canopy.rotation.x = -Math.PI / 2;
  canopy.position.y = 0.004;
  group.add(canopy);

  const trunkHeight = SIZE * 0.9;
  const geometry = new THREE.ConeGeometry(SIZE * 0.17, trunkHeight, 6);
  const mesh = new THREE.InstancedMesh(geometry, glow(color, 0.85), 14);
  const o = new THREE.Object3D();
  for (let i = 0; i < 14; i++) {
    const a = i * 2.39996,
      r = SIZE * 0.78 * Math.sqrt(i / 14);
    const scale = 0.7 + ((i * 37) % 10) / 22;
    o.position.set(Math.cos(a) * r, (trunkHeight * scale) / 2, Math.sin(a) * r);
    o.scale.setScalar(scale);
    o.updateMatrix();
    o.scale.setScalar(1);
    mesh.setMatrixAt(i, o.matrix);
  }
  group.add(mesh);
  return group;
}

function roofs(color) {
  const group = new THREE.Group();
  const plates = new THREE.InstancedMesh(
    new THREE.BoxGeometry(SIZE * 0.34, SIZE * 0.06, SIZE * 0.34),
    glow(color, 0.7),
    12,
  );
  const o = new THREE.Object3D();
  for (let i = 0; i < 12; i++) {
    const col = i % 4,
      row = Math.floor(i / 4);
    o.position.set(
      (col - 1.5) * SIZE * 0.44,
      SIZE * (0.1 + ((i * 53) % 7) * 0.035),
      (row - 1) * SIZE * 0.46,
    );
    o.rotation.y = ((i * 29) % 8) * 0.09;
    o.updateMatrix();
    plates.setMatrixAt(i, o.matrix);
  }
  group.add(plates);

  // A shimmer plane just above the roofs: reflected sunlight, which is the
  // entire mechanism of a cool roof.
  const shimmer = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE * 1.9, SIZE * 1.5),
    glow(color, 0.16),
  );
  shimmer.rotation.x = -Math.PI / 2;
  shimmer.position.y = SIZE * 0.4;
  group.add(shimmer);
  return group;
}

function basin(color) {
  const group = new THREE.Group();
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(SIZE * 0.92, 32),
    glow(color, 0.5),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.006;
  group.add(water);

  for (let i = 0; i < 3; i++) {
    const ripple = new THREE.Mesh(
      new THREE.RingGeometry(SIZE * (0.3 + i * 0.22), SIZE * (0.34 + i * 0.22), 32),
      glow(color, 0.5 - i * 0.12),
    );
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.y = 0.012 + i * 0.002;
    ripple.userData.phase = i * 0.7;
    group.add(ripple);
  }
  return group;
}

const BUILDERS = { green: trees, cool_surface: roofs, water: basin };

/** The bare object, no effect field — used for the small icon on a card. */
export function buildBody(category, color) {
  return (BUILDERS[category] || trees)(color || CATEGORY[category]?.color || HOLO.green);
}

export const FOOTPRINT = SIZE;

/**
 * One placeable measure.
 *
 * `ghost` mode is the version that rides on your hand before you commit: same
 * silhouette, fainter, with the effect radius drawn on the ground beneath it
 * so you can see what the placement would actually cover before letting go.
 */
export function createSolution(intervention, { ghost = false } = {}) {
  const category = CATEGORY[intervention.category] || CATEGORY.green;
  const color = category.color;
  const root = new THREE.Group();

  const body = (BUILDERS[intervention.category] || trees)(color);
  root.add(body);

  // Effect radius, true to the data: metres to kilometres, drawn as a disc.
  const radius = Math.max(0.12, (intervention.effect_radius_m || 300) / 1000);
  const field = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.985, radius, 56),
    glow(color, ghost ? 0.75 : 0.4),
  );
  field.rotation.x = -Math.PI / 2;
  field.position.y = 0.003;
  root.add(field);

  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 40),
    glow(color, ghost ? 0.1 : 0.05),
  );
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.002;
  root.add(fill);

  const landing = pulseRing(radius * 0.7, color);
  landing.mesh.position.y = 0.01;
  root.add(landing.mesh);

  // Base outline, so the object reads as sitting on the map rather than
  // hovering above it.
  const outlinePoints = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    outlinePoints.push(Math.cos(a) * SIZE, 0.008, Math.sin(a) * SIZE);
  }
  const outlineGeometry = new THREE.BufferGeometry();
  outlineGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(outlinePoints, 3),
  );
  const outline = new THREE.Line(outlineGeometry, wire(color, 0.8));
  root.add(outline);

  if (ghost) {
    root.traverse((o) => {
      if (o.material && "opacity" in o.material) o.material.opacity *= 0.65;
    });
  }

  let born = ghost ? 1 : 0;
  root.scale.setScalar(ghost ? 1 : 0.001);

  return {
    root,
    intervention,
    color,
    radius,
    /** Play the materialise animation; call once when it is committed. */
    land() {
      born = 0;
      landing.fire();
    },
    update(dt, time) {
      if (born < 1) {
        born = Math.min(1, born + dt * 2.4);
        // Overshoot, then settle: the object arrives rather than appears.
        const eased = 1 - Math.pow(1 - born, 3);
        root.scale.setScalar(eased * (1 + 0.18 * Math.sin(born * Math.PI)));
      }
      landing.update(dt);
      field.rotation.z += dt * 0.25;
      for (const child of body.children)
        if (child.userData.phase !== undefined)
          child.scale.setScalar(
            1 + 0.08 * Math.sin(time * 1.6 + child.userData.phase),
          );
    },
    setValid(valid) {
      const target = valid ? color : HOLO.hot;
      field.material.color.set(target);
      outline.material.color.set(target);
    },
    dispose() {
      landing.dispose();
      root.traverse((o) => {
        o.geometry?.dispose();
        for (const m of [o.material].flat().filter(Boolean)) m.dispose();
      });
    },
  };
}
