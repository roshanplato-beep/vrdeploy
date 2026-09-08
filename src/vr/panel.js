import * as THREE from "three";

/**
 * One texture per in-world panel. Hit regions share the same pixel coordinates
 * as drawing, so hands, controllers, and desktop clicks activate identical UI.
 *
 * Two things changed when this moved to a headset-first layout:
 *
 *   Targets got bigger. The old buttons were 56 px on a 960 px canvas shown
 *   0.82 m wide — about 4.5 cm, under two degrees of arc at arm's length, which
 *   is smaller than the jitter of a tracked hand. Nothing about the drawing was
 *   wrong; they were simply too small to hit. MIN_TARGET keeps them honest.
 *
 *   Hover is exposed rather than drawn. Repainting a 960x1152 canvas every time
 *   the pointer crosses a button would re-upload the texture many times a
 *   second, so the caller highlights the hovered region with a quad in 3D and
 *   the canvas is only repainted when the content itself changes.
 */

/** Smallest button height in canvas pixels; ~4 degrees at reading distance. */
export const MIN_TARGET = 92;

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export const INK = {
  glass: "rgba(6,20,28,0.9)",
  glassTop: "rgba(12,38,48,0.94)",
  edge: "#2a6a75",
  hairline: "#173e47",
  accent: "#58eed0",
  accentDim: "#2f8f86",
  warm: "#ffa766",
  primary: "#eafff7",
  body: "#b6d3da",
  muted: "#7fa4b0",
  caution: "#edc38b",
};

export class Panel {
  constructor(width = 1024, height = 1216, worldWidth = 0.95) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d");
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.anisotropy = 4;

    const worldHeight = (worldWidth * height) / width;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(worldWidth, worldHeight),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        // Single-sided: a panel seen edge-on from behind is a distraction, and
        // culling it halves the fill cost of the UI.
        side: THREE.FrontSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.mesh.renderOrder = 50;
    this.mesh.userData.panel = this;
    // Consumed by the poke test in xr-input.
    this.mesh.userData.halfSize = {
      x: worldWidth / 2,
      y: worldHeight / 2,
    };
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.regions = [];
  }

  /** Canvas pixels to panel-local metres, for placing the hover highlight. */
  toLocal(x, y, w, h) {
    const s = this.worldWidth / this.canvas.width;
    return {
      x: (x + w / 2) * s - this.worldWidth / 2,
      y: this.worldHeight / 2 - (y + h / 2) * s,
      w: w * s,
      h: h * s,
    };
  }

  begin(title, kicker = "CHENNAI ORBIT") {
    const c = this.ctx,
      w = this.canvas.width,
      h = this.canvas.height;
    this.regions = [];
    c.clearRect(0, 0, w, h);

    // Glass slab with a vertical falloff, so a panel floating over the city
    // reads as a lit surface rather than a flat sticker.
    const wash = c.createLinearGradient(0, 0, 0, h);
    wash.addColorStop(0, INK.glassTop);
    wash.addColorStop(1, INK.glass);
    c.fillStyle = wash;
    c.beginPath();
    c.roundRect(2, 2, w - 4, h - 4, 28);
    c.fill();

    c.strokeStyle = INK.edge;
    c.lineWidth = 3;
    c.stroke();

    // A single accent hairline down the left edge — the one graphic element
    // that ties the panels, the beams and the city rings together.
    c.fillStyle = INK.accent;
    c.globalAlpha = 0.75;
    c.fillRect(2, 34, 4, 92);
    c.globalAlpha = 1;

    this.text(kicker, 36, 62, 24, INK.accent, 600, 0.16);
    this.text(title, 36, 124, 44, INK.primary, 650);
    c.fillStyle = INK.hairline;
    c.fillRect(36, 152, w - 72, 2);
    return 152;
  }

  text(text, x, y, size = 27, color = INK.body, weight = 500, spacing = 0) {
    const c = this.ctx;
    c.font = `${weight} ${size}px ${FONT}`;
    c.fillStyle = color;
    c.textAlign = "left";
    c.letterSpacing = `${spacing}em`;
    c.fillText(String(text), x, y);
    c.letterSpacing = "0em";
  }

  wrap(
    text,
    x,
    y,
    maxWidth = 936,
    size = 25,
    color = INK.muted,
    line = 34,
    maxLines = 5,
  ) {
    const c = this.ctx;
    c.font = `500 ${size}px ${FONT}`;
    let row = "",
      n = 0;
    for (const word of String(text).split(/\s+/)) {
      if (c.measureText(row + word).width > maxWidth && row) {
        this.text(row, x, y + n * line, size, color);
        if (++n >= maxLines) return y + n * line;
        row = "";
      }
      row += word + " ";
    }
    if (row) this.text(row, x, y + n++ * line, size, color);
    return y + n * line;
  }

  /** Label left, value right, on a hairline row. */
  row(label, value, x, y, width = 936, size = 27) {
    const c = this.ctx;
    this.text(label, x, y, size, INK.body);
    c.font = `600 ${size}px ${FONT}`;
    c.fillStyle = INK.primary;
    c.textAlign = "right";
    c.fillText(String(value), x + width, y);
    c.textAlign = "left";
    c.fillStyle = INK.hairline;
    c.fillRect(x, y + 15, width, 1);
  }

  /** A large reading with its caption underneath. */
  stat(value, caption, x, y, size = 80, color = INK.warm) {
    this.text(value, x, y, size, color, 650);
    this.text(caption, x, y + 38, 24, INK.muted);
  }

  button(label, x, y, w, h, action, active = false) {
    const c = this.ctx;
    const height = Math.max(h, MIN_TARGET);
    c.fillStyle = active ? "#12675f" : "rgba(19,52,64,0.92)";
    c.strokeStyle = active ? INK.accent : INK.edge;
    c.lineWidth = active ? 3 : 2;
    c.beginPath();
    c.roundRect(x, y, w, height, 14);
    c.fill();
    c.stroke();

    c.font = `600 28px ${FONT}`;
    c.fillStyle = active ? "#c9ffe9" : "#dcf1f5";
    c.textAlign = "center";
    c.fillText(String(label), x + w / 2, y + height / 2 + 10);
    c.textAlign = "left";

    this.regions.push({ x, y, w, h: height, action, label });
    return height;
  }

  finish() {
    this.texture.needsUpdate = true;
  }

  /** The region under a UV, or null. Used for both hover and activation. */
  regionAt(uv) {
    if (!uv) return null;
    const x = uv.x * this.canvas.width,
      y = (1 - uv.y) * this.canvas.height;
    return (
      this.regions.find(
        (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h,
      ) || null
    );
  }

  hit(uv) {
    return this.regionAt(uv)?.action || null;
  }

  dispose() {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
