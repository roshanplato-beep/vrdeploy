import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { project, clipSegment } from "./model";

// Front faces only. Every surface here is a flat plate lying face-up, and
// DoubleSide doubled the transparent fill cost on a fill-rate-bound headset
// for geometry that is never seen from below.
const basic = (color, opacity = 1, side = THREE.FrontSide) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity === 1,
    side,
  });
const surface = (points, y, color, opacity) => {
  const shape = new THREE.Shape(
    points.map(([x, z]) => new THREE.Vector2(x, -z)),
  );
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return new THREE.Mesh(g, basic(color, opacity));
};
function segments(lines, y, color, parent) {
  const nw = project([13.14, 80.08]),
    se = project([12.88, 80.3]);
  const points = [];
  for (const line of lines)
    for (let i = 1; i < line.length; i++) {
      const cut = clipSegment(line[i - 1], line[i], [
        nw[0],
        nw[1],
        se[0],
        se[1],
      ]);
      if (cut) points.push(cut[0][0], y, cut[0][1], cut[1][0], y, cut[1][1]);
    }
  if (!points.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  parent.add(
    new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }),
    ),
  );
}

export async function buildCity(zones, onProgress, signal) {
  const root = new THREE.Group(),
    base = new THREE.Group(),
    heat = new THREE.Group(),
    green = new THREE.Group(),
    density = new THREE.Group();
  root.add(base, density, green, heat);
  const layers = [heat, green, density];
  const disposables = [];
  const corners = [
    [12.88, 80.08],
    [13.14, 80.3],
  ].map(project);
  const width = corners[1][0] - corners[0][0],
    depth = corners[0][1] - corners[1][1];
  const cx = (corners[0][0] + corners[1][0]) / 2,
    cz = (corners[0][1] + corners[1][1]) / 2;
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.5, 0.2, depth + 0.5),
    new THREE.MeshLambertMaterial({ color: "#09262f", emissive: "#04131a" }),
  );
  slab.position.set(cx, -0.13, cz);
  base.add(slab);
  slab.userData.grab = "city";
  // Satellite imagery as a 2x2 grid of tiles rather than one image.
  //
  // A single 1408x1664 export covered 24 km of city, which is ~17 m per pixel:
  // legible from across the room and a smear as soon as anyone leant in, which
  // is most of what people do in a headset. Four 2048px tiles are 4096px across
  // the same ground, so roughly a 3x sharper picture for four draw calls.
  const IMAGERY_BBOX = { west: 80.08, east: 80.3, south: 12.88, north: 13.14 };
  const TILES = 2;
  const TILE_PX = 2048;
  const tileMeshes = [];
  let disposed = false;
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  for (let row = 0; row < TILES; row++)
    for (let col = 0; col < TILES; col++) {
      const tile = new THREE.Mesh(
        new THREE.PlaneGeometry(width / TILES, depth / TILES),
        basic("#16414a"),
      );
      tile.rotation.x = -Math.PI / 2;
      tile.position.set(
        corners[0][0] + (width * (col + 0.5)) / TILES,
        0,
        corners[1][1] + (depth * (row + 0.5)) / TILES,
      );
      base.add(tile);
      tileMeshes.push(tile);

      const lonSpan = (IMAGERY_BBOX.east - IMAGERY_BBOX.west) / TILES;
      const latSpan = (IMAGERY_BBOX.north - IMAGERY_BBOX.south) / TILES;
      // Row 0 is the northern strip, matching the plane laid out above.
      const bbox = [
        IMAGERY_BBOX.west + lonSpan * col,
        IMAGERY_BBOX.north - latSpan * (row + 1),
        IMAGERY_BBOX.west + lonSpan * (col + 1),
        IMAGERY_BBOX.north - latSpan * row,
      ].join(",");
      // Public Esri imagery: a handful of bounded exports, not thousands of
      // runtime tiles.
      const url =
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/" +
        `MapServer/export?bbox=${bbox}&bboxSR=4326&imageSR=4326` +
        `&size=${TILE_PX},${TILE_PX}&format=jpg&f=image`;
      loader.load(
        url,
        (t) => {
          if (disposed) {
            t.dispose();
            return;
          }
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 8;
          tile.material.map = t;
          tile.material.color.set("#b6cfcc");
          tile.material.needsUpdate = true;
        },
        undefined,
        () => {},
      );
    }
  let geo = null;
  onProgress("Loading Chennai geography…");
  try {
    const res = await fetch("/vr/chennai-osm.json", { signal });
    if (!res.ok) throw Error();
    geo = await res.json();
  } catch (e) {
    if (signal.aborted) throw e;
  }
  const buildingsByZone = new Map(zones.map((z) => [z.id, []]));
  // Area-weighted accumulator for each zone's real building-density hotspot
  // — the sub-point where the mapped footprints actually cluster, which is
  // also where a cooling measure does the most good. Weighted by footprint
  // area (shoelace formula) rather than by count, so one large mall counts
  // for more than a dozen shed-sized outbuildings.
  const hotspotAccum = new Map(zones.map((z) => [z.id, { sx: 0, sz: 0, weight: 0 }]));
  const roads = [],
    water = [],
    coast = [],
    parks = [];
  if (geo) {
    let processed = 0;
    for (const f of geo.features) {
      if (++processed % 1000 === 0) {
        onProgress(
          `Building Chennai · ${Math.round((processed / geo.features.length) * 100)}%`,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (signal.aborted) break;
      }
      const p = f.points.map(([lon, lat]) => project([lat, lon]));
      if (f.kind === "building") {
        if (p.length < 4) continue;
        const x = p.reduce((s, v) => s + v[0], 0) / p.length,
          z = p.reduce((s, v) => s + v[1], 0) / p.length;
        const nearest = zones.reduce((best, zone) => {
          const a = project(zone.center),
            b = project(best.center);
          return Math.hypot(a[0] - x, a[1] - z) < Math.hypot(b[0] - x, b[1] - z)
            ? zone
            : best;
        }, zones[0]);
        const shape = new THREE.Shape(
          p.map(([a, b]) => new THREE.Vector2(a, -b)),
        );
        const g = new THREE.ExtrudeGeometry(shape, {
          depth: Math.min(150, f.height || 9) * 0.004,
          bevelEnabled: false,
          steps: 1,
        });
        g.rotateX(-Math.PI / 2);
        g.translate(0, 0.035, 0);
        buildingsByZone.get(nearest.id).push(g);
        let area = 0;
        for (let i = 0; i < p.length; i++) {
          const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % p.length];
          area += x1 * z2 - x2 * z1;
        }
        area = Math.max(1e-6, Math.abs(area) / 2);
        const acc = hotspotAccum.get(nearest.id);
        acc.sx += x * area;
        acc.sz += z * area;
        acc.weight += area;
      } else if (f.kind === "road") roads.push(p);
      else if (f.kind === "coast") coast.push(p);
      else if (f.kind === "water") water.push(p);
      else parks.push(p);
    }
  }
  segments(roads, 0.032, "#acd4ce", base);
  segments(water, 0.04, "#55ccf5", base);
  segments(coast, 0.04, "#79ecff", base);
  for (const p of parks)
    if (
      p.length > 3 &&
      p.every(
        ([x, z]) =>
          x >= corners[0][0] &&
          x <= corners[1][0] &&
          z >= corners[1][1] &&
          z <= corners[0][1],
      )
    )
      green.add(surface(p, 0.05, "#299d66", 0.48));
  const meshes = new Map(),
    markers = [],
    zoneHeat = new Map(),
    effects = new Map(),
    labels = [],
    hotspots = new Map(),
    hotspotMarkers = new Map();
  zones.forEach((zone, index) => {
    const [x, z] = project(zone.center);
    const box = zone.bounds.map(project);
    const rect = [
      [box[0][0], box[0][1]],
      [box[1][0], box[0][1]],
      [box[1][0], box[1][1]],
      [box[0][0], box[1][1]],
    ];
    const h = surface(rect, 0.06, zone.heat_color, 0.3);
    heat.add(h);
    zoneHeat.set(zone.id, h);
    segments([[...rect, rect[0]]], 0.068, zone.heat_color, heat);
    const gs = buildingsByZone.get(zone.id);
    if (gs.length) {
      const merged = mergeGeometries(gs, false);
      // At a distant overview retain a deterministic subset of real buildings;
      // restore every mapped footprint as the city is expanded or approached.
      const coarse = mergeGeometries(
        gs.filter((_, i) => i % 4 === 0),
        false,
      );
      gs.forEach((g) => g.dispose());
      if (merged) {
        const m = new THREE.Mesh(
          merged,
          new THREE.MeshLambertMaterial({
            color: "#aac6c9",
            emissive: "#0b2b33",
          }),
        );
        merged.computeBoundingSphere();
        m.userData.full = merged;
        m.userData.coarse = coarse || merged;
        disposables.push(merged);
        if (coarse) disposables.push(coarse);
        density.add(m);
        meshes.set(zone.id, m);
      }
    }
    // Where this zone's real building footprints actually cluster — an
    // area-weighted centroid of the mapped geometry, not a guess. A cooling
    // measure does the most good where the built mass (and so the heat
    // retention) is greatest, so this is the point the game marks and
    // rewards placing near.
    const acc = hotspotAccum.get(zone.id);
    const hotspot = acc.weight > 0 ? [acc.sx / acc.weight, acc.sz / acc.weight] : [x, z];
    hotspots.set(zone.id, hotspot);
    const hotMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.2, 28),
      basic("#ffd76a", 0.85),
    );
    hotMarker.rotation.x = -Math.PI / 2;
    hotMarker.position.set(hotspot[0], 0.075, hotspot[1]);
    hotMarker.visible = false;
    base.add(hotMarker);
    hotspotMarkers.set(zone.id, hotMarker);

    const greenDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.2 + zone.green_cover_pct / 55, 24),
      basic("#57df94", 0.24),
    );
    greenDisc.rotation.x = -Math.PI / 2;
    greenDisc.position.set(x, 0.095, z);
    green.add(greenDisc);
    // Markers are map annotations, not buildings or claimed measurements.
    const marker = new THREE.Mesh(
      new THREE.CylinderGeometry(0.19, 0.24, 0.16, 16),
      basic(zone.heat_color),
    );
    marker.position.set(x, 0.23, z);
    marker.userData.zoneId = zone.id;
    heat.add(marker);
    markers.push(marker);
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const c = canvas.getContext("2d");
    c.fillStyle = "#eafff8";
    c.font = "bold 72px sans-serif";
    c.textAlign = "center";
    c.fillText(String(index + 1).padStart(2, "0"), 64, 89);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, depthTest: false }),
    );
    label.position.set(x, 0.8, z);
    label.scale.set(0.65, 0.65, 1);
    label.renderOrder = 4;
    heat.add(label);
    labels.push(label);
    const fx = new THREE.Group();
    fx.position.set(x, 0.08, z);
    base.add(fx);
    effects.set(zone.id, fx);
    const treeG = new THREE.ConeGeometry(0.06, 0.25, 6),
      treeM = new THREE.MeshLambertMaterial({ color: "#69e89c" });
    const trees = new THREE.InstancedMesh(treeG, treeM, 48);
    const o = new THREE.Object3D();
    for (let i = 0; i < 48; i++) {
      const a = i * 2.39996,
        r = 0.5 * Math.sqrt(i / 48);
      o.position.set(Math.cos(a) * r, 0.15, Math.sin(a) * r);
      o.updateMatrix();
      trees.setMatrixAt(i, o.matrix);
    }
    trees.visible = false;
    trees.name = "green";
    fx.add(trees);
    for (const [name, color] of [
      ["cool_surface", "#c6eeef"],
      ["water", "#50c1f0"],
    ]) {
      const patch = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 0.65, 8, 8),
        basic(color, 0.75),
      );
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(name === "water" ? -0.45 : 0.45, 0.025, 0);
      patch.visible = false;
      patch.name = name;
      fx.add(patch);
    }
  });
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.38, 0.46, 40),
    basic("#c9fff2"),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  heat.add(ring);
  onProgress(
    geo
      ? `${geo.features.filter((f) => f.kind === "building").length.toLocaleString()} mapped footprints loaded`
      : "Building footprints unavailable; map annotations remain usable",
  );
  const cameraPoint = new THREE.Vector3(),
    meshPoint = new THREE.Vector3();
  return {
    root,
    base,
    layers,
    markers,
    labels,
    geo,
    ring,
    grabSurface: slab,
    /**
     * Pick each zone's geometry from how large it actually looks, not from a
     * distance in map kilometres.
     *
     * The previous version measured distance in the city's own local units and
     * switched to the coarse mesh past 85 of them. At tabletop scale the
     * camera is only ~15 local units away, so the threshold was never crossed
     * and every one of the ~21,600 footprints stayed at full detail behind a
     * viewer who could not resolve a single building. Apparent size is the
     * quantity that decides whether the detail is visible, and it stays
     * correct when the city is scaled or approached.
     */
    updateLOD(camera) {
      camera.getWorldPosition(cameraPoint);
      const scale = root.scale.x;
      for (const m of meshes.values()) {
        const sphere = m.userData.full.boundingSphere;
        if (!sphere) continue;
        // Through matrixWorld, so a rotated or moved city stays correct.
        meshPoint.copy(sphere.center).applyMatrix4(m.matrixWorld);
        const distance = Math.max(0.05, cameraPoint.distanceTo(meshPoint));
        const apparent = (sphere.radius * scale) / distance;
        // Hysteresis, so a zone on the boundary does not flicker per frame.
        if (apparent < 0.22) m.geometry = m.userData.coarse;
        else if (apparent > 0.3) m.geometry = m.userData.full;
      }
    },
    select(id) {
      const zone = zones.find((z) => z.id === id);
      if (zone) {
        const [x, z] = project(zone.center);
        ring.position.set(x, 0.34, z);
        ring.visible = true;
      }
      for (const [zoneId, marker] of hotspotMarkers) marker.visible = zoneId === id;
    },
    hotspotFor(id) {
      return hotspots.get(id) || null;
    },
    apply(id, selected, drop) {
      const group = effects.get(id);
      if (!group) return;
      group.children.forEach(
        (m) => (m.visible = selected.some((i) => i.category === m.name)),
      );
      const b = meshes.get(id);
      if (b)
        b.material.color.set(
          selected.some((i) => i.category === "cool_surface")
            ? "#e3ffff"
            : "#aac6c9",
        );
      const zone = zones.find((z) => z.id === id);
      zoneHeat
        .get(id)
        .material.color.copy(
          new THREE.Color(zone.heat_color).lerp(
            new THREE.Color("#3b82f6"),
            Math.min(0.9, drop / 4),
          ),
        );
    },
    dispose() {
      disposed = true;
      root.traverse((o) => {
        o.geometry?.dispose();
        for (const m of [o.material].flat().filter(Boolean)) {
          m.map?.dispose();
          m.dispose();
        }
      });
      disposables.forEach((d) => d.dispose());
    },
  };
}
