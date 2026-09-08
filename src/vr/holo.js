import * as THREE from "three";

/**
 * The holographic vocabulary: glowing edges, rotating reticles, expanding
 * pulses and floating text.
 *
 * Everything here is unlit and additive. That is both the look — light added
 * to light, never a shaded surface — and the cheapest thing a headset can
 * draw, which matters because these elements are all over the city at once.
 */

export const HOLO = {
  cyan: "#58eed0",
  ice: "#9ff4ff",
  amber: "#ffa766",
  hot: "#ff7a59",
  green: "#69e89c",
  water: "#50c1f0",
  white: "#eafff8",
};

/** Additive glow. Never writes depth, so overlapping holograms build up. */
export function glow(color, opacity = 0.7) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
}

export function wire(color, opacity = 0.55) {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
}

/**
 * A flat ring of tick marks that turns slowly — the readable signal that
 * something is selected, live, or waiting for you.
 */
export function reticle(radius, color = HOLO.cyan, ticks = 24) {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.97, radius, 48),
    glow(color, 0.55),
  );
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);

  const points = [];
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * Math.PI * 2;
    const inner = i % 6 === 0 ? radius * 0.84 : radius * 0.92;
    points.push(
      Math.cos(a) * inner, 0, Math.sin(a) * inner,
      Math.cos(a) * radius * 1.06, 0, Math.sin(a) * radius * 1.06,
    );
  }
  const tickGeometry = new THREE.BufferGeometry();
  tickGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points, 3),
  );
  const tickLines = new THREE.LineSegments(tickGeometry, wire(color, 0.5));
  group.add(tickLines);

  return {
    group,
    spin(dt, rate = 0.35) {
      tickLines.rotation.y += dt * rate;
      ring.rotation.z -= dt * rate * 0.4;
    },
    setColor(next) {
      ring.material.color.set(next);
      tickLines.material.color.set(next);
    },
    dispose() {
      ring.geometry.dispose();
      ring.material.dispose();
      tickGeometry.dispose();
      tickLines.material.dispose();
    },
  };
}

/**
 * A ring that expands and fades, then waits to be fired again. Used for the
 * moment a solution lands and for the cooling wave that follows it.
 */
export function pulseRing(radius, color = HOLO.cyan) {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.86, radius, 40),
    glow(color, 0),
  );
  mesh.rotation.x = -Math.PI / 2;
  let t = -1;
  return {
    mesh,
    fire() {
      t = 0;
    },
    update(dt) {
      if (t < 0) return;
      t += dt * 1.25;
      if (t >= 1) {
        t = -1;
        mesh.material.opacity = 0;
        return;
      }
      const eased = 1 - Math.pow(1 - t, 3);
      mesh.scale.setScalar(0.25 + eased * 1.5);
      mesh.material.opacity = 0.85 * (1 - t);
    },
    dispose() {
      mesh.geometry.dispose();
      mesh.material.dispose();
    },
  };
}

/**
 * Floating text as a camera-facing sprite.
 *
 * Sprites rather than in-world planes because a readout that turns away from
 * the reader is a readout nobody reads, and these are scattered over a city
 * that is itself being rotated by hand.
 */
export function label(width = 512, height = 160, worldHeight = 0.09) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
    }),
  );
  sprite.renderOrder = 60;
  sprite.scale.set((worldHeight * width) / height, worldHeight, 1);

  return {
    sprite,
    canvas,
    ctx,
    /** `lines` is [text, size, colour, weight] tuples, drawn top to bottom. */
    write(lines, align = "center") {
      ctx.clearRect(0, 0, width, height);
      let y = 0;
      const x = align === "center" ? width / 2 : 16;
      ctx.textAlign = align;
      for (const [text, size = 44, color = HOLO.white, weight = 600] of lines) {
        y += size * 1.08;
        ctx.font = `${weight} ${size}px system-ui, sans-serif`;
        ctx.fillStyle = color;
        ctx.fillText(String(text), x, y);
        y += size * 0.16;
      }
      texture.needsUpdate = true;
    },
    dispose() {
      texture.dispose();
      sprite.material.dispose();
    },
  };
}

/** Four corner brackets around a rectangle — a selection frame, not a box. */
export function brackets(width, depth, color = HOLO.cyan) {
  const w = width / 2,
    d = depth / 2,
    arm = Math.min(width, depth) * 0.22;
  const points = [];
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]) {
    points.push(
      sx * w, 0, sz * d, sx * (w - arm), 0, sz * d,
      sx * w, 0, sz * d, sx * w, 0, sz * (d - arm),
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  const lines = new THREE.LineSegments(geometry, wire(color, 0.9));
  return {
    lines,
    dispose() {
      geometry.dispose();
      lines.material.dispose();
    },
  };
}

/** A vertical shaft of light, for marking a point on the map from a distance. */
export function beacon(height, radius, color = HOLO.cyan) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 1.6, height, 10, 1, true),
    glow(color, 0.28),
  );
  mesh.position.y = height / 2;
  return mesh;
}
