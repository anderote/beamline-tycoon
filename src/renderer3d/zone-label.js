// src/renderer3d/zone-label.js — zone names painted onto the zone's floor.
//
// Zone labels used to be camera-facing THREE.Sprites: white text with a heavy
// black outline on a dark rounded plate, held at a constant world height above
// the floor. They read as UI chrome stencilled onto the frame rather than
// anything belonging to the world, they were the loudest thing on screen, and
// they hid the hardware behind them.
//
// These are floor paint instead: a textured quad lying in the ground plane,
// tinted with the zone's OWN palette color (the same ZONES[type].color the
// tint tiles use), sized in world units from the zone's footprint. It zooms
// with the camera exactly like the floor tiles it sits on, because it IS on
// the floor — no counter-scaling, no constant screen size, no DOM overlay.
//
// WHY A STYLE CONFIG (the staff-builder.js STYLE idiom): how loud the paint
// should be, whether the tile count stays, whether it needs an outline over a
// busy floor, and how the text turns as the camera orbits are all judgement
// calls best made from renders, not from prose. Every number that defines the
// look lives in a ZONE_LABEL_STYLES entry; picking a variant is repointing
// DEFAULT_ZONE_LABEL_STYLE (or, at runtime, renderer.setZoneLabelStyle(id) —
// which is how the comparison screenshots were taken).
//
// ORBIT READABILITY. The camera free-orbits, so text lying flat on the ground
// can end up upside down. The scheme here ("axis-locked, direction-flipped"):
//
//   * The text AXIS is locked to the zone's own footprint — it runs along the
//     long side of the largest solid rectangle of tiles in the cluster, and
//     never leaves it. That axis is a property of the room, so the paint keeps
//     looking painted: it skews with the projection and turns with the world.
//   * Only the DIRECTION along that axis (+ or -, a 180 deg flip) tracks the
//     camera, and only to keep the text from reading right-to-left.
//
// An axis always has exactly one readable direction (of the two opposite ones,
// exactly one has a positive screen-space x component), so this never has to
// choose between "readable" and "on the long side". It costs one 180 deg flip
// per half turn of the camera instead of the four flips a full snap-to-nearest
// scheme costs, and the flip happens at the yaw where the text is edge-on
// square to the viewer, i.e. where it is least noticeable.
//
// Everything above the buildZoneFloorLabel section is pure: no THREE, no DOM,
// unit-tested in test/test-zone-label.js. THREE is a CDN global — do NOT
// import it.

/** Shared defaults; each variant overrides only what it is testing. */
const BASE_LABEL_STYLE = {
  // ── Presence ───────────────────────────────────────────────────────
  opacity: 0.55,          // material opacity — the main "quiet" dial
  lightness: 0.62,        // zone color pushed to this HSL lightness for text
  saturation: 1.35,       // ...and its saturation scaled by this (paint, not chalk)
  outlinePx: 0,           // dark stroke width in canvas px (0 = none)
  outlineAlpha: 0.55,

  // ── Content ────────────────────────────────────────────────────────
  showCount: false,       // append " [12]" (the tile count)
  uppercase: true,
  letterSpacing: 0.18,    // em, drawn into the canvas — stencil airiness

  // ── Size, all in world units (a tile is 2 units) ───────────────────
  widthFrac: 0.80,        // fraction of the run-axis extent the text may use
  crossFrac: 0.45,        // fraction of the cross-axis extent for cap height
  maxHeight: 1.6,         // cap so a 30-tile hall does not get billboard text
  abbrevBelow: 0.50,      // below this cap height, fall back to initials
  hideBelow: 0.28,        // below this even the initials are dropped
  minTiles: 1,            // clusters smaller than this get no label at all

  // ── Behaviour ──────────────────────────────────────────────────────
  rotation: 'flip',       // 'flip' = direction tracks camera, 'fixed' = never
};

function defineLabelStyle(id, name, note, over) {
  return Object.freeze({ ...BASE_LABEL_STYLE, id, name, note, ...over });
}

/**
 * The variants built for comparison. They differ on the things actually in
 * question — loudness, whether the count survives, outline vs none, text
 * scale, and whether the direction tracks the camera.
 */
export const ZONE_LABEL_STYLES = {
  stencil: defineLabelStyle(
    'stencil', 'Stencil',
    'The quiet default: zone-color paint at 0.55, no count, no outline, letter-spaced caps, direction flips to stay readable.',
    {},
  ),
  plate: defineLabelStyle(
    'plate', 'Plate',
    'Keeps the [12] tile count and adds a 3px dark stroke — the legibility-over-a-busy-floor end of the range, at lower opacity to compensate.',
    { opacity: 0.45, showCount: true, outlinePx: 3, widthFrac: 0.86, letterSpacing: 0.10 },
  ),
  boldPaint: defineLabelStyle(
    'boldPaint', 'Bold Paint',
    'Tests whether quiet is too quiet: nearly opaque, brighter, wider across the room, larger cap height.',
    { opacity: 0.8, lightness: 0.72, saturation: 1.6, widthFrac: 0.92, crossFrac: 0.55, maxHeight: 2.2 },
  ),
  fixedAxis: defineLabelStyle(
    'fixedAxis', 'Fixed Axis',
    'Identical paint to Stencil but the direction never tracks the camera — the honesty test: real floor paint reads upside down from the far side.',
    { rotation: 'fixed' },
  ),
};

/** Ordered list, for anything that wants to walk the variants. */
export const ZONE_LABEL_STYLE_LIST = Object.values(ZONE_LABEL_STYLES);

/** The variant the game renders. Approving one = repointing this. */
export const DEFAULT_ZONE_LABEL_STYLE = ZONE_LABEL_STYLES.stencil;

export function zoneLabelStyleById(id) {
  return ZONE_LABEL_STYLES[id] || null;
}

// ── Footprint geometry ───────────────────────────────────────────────

/**
 * Largest solid axis-aligned rectangle of tiles inside a cluster.
 *
 * The centroid of an L-shaped or ring-shaped zone can sit on tiles that are
 * not in the zone at all, and its bounding box is far larger than the space
 * the text actually has. The maximal solid rectangle is both a place the paint
 * genuinely fits and a sane pair of extents to size it from.
 *
 * Classic histogram/stack solution, O(tiles). Ties break toward the more
 * square rectangle, which leaves more cap height.
 *
 * @param {{col:number,row:number}[]} tiles
 * @returns {{col0:number,row0:number,w:number,h:number}|null}
 */
export function largestSolidRect(tiles) {
  if (!tiles || tiles.length === 0) return null;
  let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const t of tiles) {
    if (t.col < minC) minC = t.col;
    if (t.col > maxC) maxC = t.col;
    if (t.row < minR) minR = t.row;
    if (t.row > maxR) maxR = t.row;
  }
  const W = maxC - minC + 1;
  const H = maxR - minR + 1;
  const filled = new Uint8Array(W * H);
  for (const t of tiles) filled[(t.row - minR) * W + (t.col - minC)] = 1;

  const heights = new Int32Array(W);
  let best = null;
  const better = (a, b) => {
    if (!b) return true;
    const areaA = a.w * a.h, areaB = b.w * b.h;
    if (areaA !== areaB) return areaA > areaB;
    return Math.min(a.w, a.h) > Math.min(b.w, b.h);
  };

  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) heights[c] = filled[r * W + c] ? heights[c] + 1 : 0;
    // Monotonic stack over the histogram for this row.
    const stack = [];
    for (let c = 0; c <= W; c++) {
      const cur = c === W ? 0 : heights[c];
      while (stack.length && heights[stack[stack.length - 1]] >= cur) {
        const top = stack.pop();
        const height = heights[top];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        if (height > 0) {
          const cand = { col0: minC + left, row0: minR + r - height + 1, w: c - left, h: height };
          if (better(cand, best)) best = cand;
        }
      }
      stack.push(c);
    }
  }
  return best;
}

/** World-space centre (metres) of a tile rectangle. Tile (c,r) centres at c*2+1. */
export function rectCenterWorld(rect) {
  return { x: rect.col0 * 2 + rect.w, z: rect.row0 * 2 + rect.h };
}

/**
 * Which world axis the text runs along: the rectangle's long side. Fixed at
 * build time — it is a property of the room, not of the camera.
 * @returns {'x'|'z'}
 */
export function labelAxisForRect(rect) {
  return rect.w >= rect.h ? 'x' : 'z';
}

/**
 * Ground rotation (mesh.rotation.y) that keeps the text reading left-to-right.
 *
 * A quad built as PlaneGeometry().rotateX(-PI/2) runs its text along local +X,
 * which rotation.y = yaw sends to world (cos yaw, 0, -sin yaw). The camera is
 * orthographic, so screen-space x of a world direction d is exactly
 * dot(d, cameraRight) up to the (positive) zoom scale — no projection needed.
 *
 * @param {'x'|'z'} axis
 * @param {number} camRightX camera matrixWorld column 0, x component
 * @param {number} camRightZ camera matrixWorld column 0, z component
 * @returns {number} 0 / PI for axis 'x', PI/2 / 3PI/2 for axis 'z'
 */
export function labelYaw(axis, camRightX, camRightZ) {
  if (axis === 'x') return camRightX >= 0 ? 0 : Math.PI;
  // yaw = PI/2 sends local +X to world -Z (screen dx = -camRightZ).
  return -camRightZ >= 0 ? Math.PI / 2 : (3 * Math.PI) / 2;
}

/** The 'fixed' variant's answer: the +X / -Z direction, camera ignored. */
export function fixedLabelYaw(axis) {
  return axis === 'x' ? 0 : Math.PI / 2;
}

/**
 * Fit a text block of the given aspect ratio into a tile rectangle.
 *
 * Everything is world units, so the result is a fixed-size piece of floor: the
 * camera's zoom is what makes it big or small on screen, and a 2-tile closet
 * gets small paint while a 30-tile hall gets large paint with no special case.
 *
 * @returns {{w:number,h:number}} world width/height of the quad
 */
export function fitLabelBox(runTiles, crossTiles, aspect, style) {
  const runWorld = runTiles * 2 * style.widthFrac;
  const crossWorld = crossTiles * 2 * style.crossFrac;
  const h = Math.min(runWorld / aspect, crossWorld, style.maxHeight);
  return { w: h * aspect, h };
}

/** "RF Laboratory" -> "RF"; "Cooling Lab" -> "CL"; "Maintenance" -> "MA". */
export function abbreviateZoneName(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.slice(0, 3).map(w => w[0]).join('').toUpperCase();
}

// ── Color ────────────────────────────────────────────────────────────

/**
 * Push a zone's palette color to a fixed lightness so the paint reads against
 * both the tint tile under it and the floor texture through it. The ZONES
 * colors are mid-dark (0xaa8833 and friends) and vanish at 0.5 opacity if used
 * raw. Pure sRGB HSL, so it is testable without THREE.
 * @returns {{r:number,g:number,b:number}} 0..255 ints
 */
export function brightenHex(hex, targetL, satMul) {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  const L = Math.min(1, Math.max(0, targetL));
  const S = Math.min(1, Math.max(0, s * satMul));
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let R, G, B;
  if (S === 0) { R = G = B = L; }
  else {
    const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
    const p = 2 * L - q;
    R = hue2rgb(p, q, h + 1 / 3);
    G = hue2rgb(p, q, h);
    B = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: Math.round(R * 255), g: Math.round(G * 255), b: Math.round(B * 255) };
}

// ── Overlap ──────────────────────────────────────────────────────────

/**
 * Drop labels that would print over each other. Adjacent zones of different
 * types cluster independently, so two interlocking L-shapes can put their
 * paint in the same place. Bigger rooms win; a label losing more than
 * `maxOverlap` of its own area to an accepted one is dropped rather than
 * shrunk, because shrinking it just makes an unreadable smudge in the overlap.
 *
 * Boxes are the FINAL world AABBs (the axis is fixed at build time and the
 * runtime change is a 180 deg flip, which does not move them), so this runs
 * once at build and never needs revisiting on orbit.
 *
 * @param {{cx:number,cz:number,w:number,h:number}[]} boxes axis-aligned, world
 * @returns {number[]} indices to keep, in input order
 */
export function resolveLabelOverlaps(boxes, maxOverlap = 0.3) {
  const order = boxes.map((b, i) => i).sort((a, b) => (boxes[b].w * boxes[b].h) - (boxes[a].w * boxes[a].h));
  const kept = [];
  for (const i of order) {
    const B = boxes[i];
    let blocked = false;
    for (const j of kept) {
      const A = boxes[j];
      const ox = Math.min(A.cx + A.w / 2, B.cx + B.w / 2) - Math.max(A.cx - A.w / 2, B.cx - B.w / 2);
      const oz = Math.min(A.cz + A.h / 2, B.cz + B.h / 2) - Math.max(A.cz - A.h / 2, B.cz - B.h / 2);
      if (ox > 0 && oz > 0 && (ox * oz) / (B.w * B.h) > maxOverlap) { blocked = true; break; }
    }
    if (!blocked) kept.push(i);
  }
  return kept.sort((a, b) => a - b);
}

// ── Mesh construction (THREE + DOM) ──────────────────────────────────

const LABEL_FONT_PX = 56;   // texture resolution only; world size is separate
const LABEL_PAD_PX = 10;

function drawLabelCanvas(text, style, rgb) {
  const font = `${LABEL_FONT_PX}px 'Press Start 2P', monospace`;
  const spacing = `${(style.letterSpacing * LABEL_FONT_PX).toFixed(2)}px`;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  measure.letterSpacing = spacing;      // ignored where unsupported; harmless
  const textW = Math.max(1, measure.measureText(text).width);

  const pad = LABEL_PAD_PX + style.outlinePx;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(textW + pad * 2);
  canvas.height = Math.ceil(LABEL_FONT_PX + pad * 2);
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  ctx.letterSpacing = spacing;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (style.outlinePx > 0) {
    ctx.strokeStyle = `rgba(8,10,16,${style.outlineAlpha})`;
    ctx.lineWidth = style.outlinePx;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  }
  ctx.fillStyle = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  return canvas;
}

/**
 * Build one floor-painted zone label, or null when the cluster is too small to
 * carry even an abbreviation.
 *
 * The mesh is a ground-plane quad at y=0.03 (just over the 0.02 tint tiles),
 * depth-TESTED so machines standing in the room occlude the paint the way they
 * would occlude a painted floor, and depth-write-free + polygon-offset so it
 * never z-fights the terrain.
 *
 * @param {object} o
 * @param {string} o.name     zone display name
 * @param {number} o.color    ZONES[type].color
 * @param {{col:number,row:number}[]} o.tiles cluster tiles
 * @param {object} [o.style]  a ZONE_LABEL_STYLES entry
 * @param {number} [o.anisotropy]
 * @returns {object|null} THREE.Mesh with userData.isZoneLabel
 */
export function buildZoneFloorLabel({ name, color, tiles, style = DEFAULT_ZONE_LABEL_STYLE, anisotropy = 1 }) {
  if (!tiles || tiles.length < style.minTiles) return null;
  const rect = largestSolidRect(tiles);
  if (!rect) return null;

  const axis = labelAxisForRect(rect);
  const runTiles = axis === 'x' ? rect.w : rect.h;
  const crossTiles = axis === 'x' ? rect.h : rect.w;

  const rgb = brightenHex(color, style.lightness, style.saturation);
  const full = style.showCount ? `${name} [${tiles.length}]` : name;

  // Try the full name; if the room cannot carry it at a legible cap height,
  // drop to initials; if it cannot carry those either, paint nothing.
  let text = style.uppercase ? full.toUpperCase() : full;
  let canvas = drawLabelCanvas(text, style, rgb);
  let box = fitLabelBox(runTiles, crossTiles, canvas.width / canvas.height, style);
  if (box.h < style.abbrevBelow) {
    text = abbreviateZoneName(name);
    canvas = drawLabelCanvas(text, style, rgb);
    box = fitLabelBox(runTiles, crossTiles, canvas.width / canvas.height, style);
  }
  if (box.h < style.hideBelow) return null;

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: style.opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const geo = new THREE.PlaneGeometry(box.w, box.h);
  geo.rotateX(-Math.PI / 2);          // text runs along +X, reads toward -Z
  const mesh = new THREE.Mesh(geo, mat);
  const c = rectCenterWorld(rect);
  mesh.position.set(c.x, 0.03, c.z);
  mesh.rotation.y = fixedLabelYaw(axis);
  mesh.renderOrder = 3;               // over the tint tiles (2), under machines
  mesh.userData.isZoneLabel = true;
  mesh.userData.labelAxis = axis;
  // World-axis-aligned box for the overlap pass: `w` is always the x extent.
  mesh.userData.labelBox = axis === 'x'
    ? { cx: c.x, cz: c.z, w: box.w, h: box.h }
    : { cx: c.x, cz: c.z, w: box.h, h: box.w };
  return mesh;
}

/**
 * Point every flip-mode label along the readable direction for the current
 * camera. Cheap enough to call per frame, but the caller gates it on the
 * camera-right vector actually changing.
 */
export function faceZoneLabels(meshes, camRightX, camRightZ, style = DEFAULT_ZONE_LABEL_STYLE) {
  if (style.rotation !== 'flip') return;
  for (const m of meshes) {
    m.rotation.y = labelYaw(m.userData.labelAxis, camRightX, camRightZ);
  }
}
