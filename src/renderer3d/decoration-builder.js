// src/renderer3d/decoration-builder.js
// Renders decorations (trees, shrubs, etc.) as 3D geometry.
// THREE is a CDN global — do NOT import it.

import { DECORATIONS_RAW } from '../data/decorations.raw.js';

const SUB = 0.5; // 1 sub-tile = 0.5 world units

// --- Procedural bark + foliage textures ---------------------------------
// Shared module-level singletons. Materials clone color tint but reuse the
// same CanvasTexture map, so memory cost is one canvas per pattern.

function _mkCanvasTex(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return canvas;
}

function _finalizeTex(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  return tex;
}

function gen_bark(size = 64) {
  const canvas = _mkCanvasTex(size);
  const ctx = canvas.getContext('2d');
  // Mid-brown base
  ctx.fillStyle = '#8b5a2b';
  ctx.fillRect(0, 0, size, size);
  // Vertical grooves of darker brown
  for (let i = 0; i < 55; i++) {
    const x = Math.floor(Math.random() * size);
    const y1 = Math.random() * size;
    const len = 6 + Math.random() * 20;
    ctx.fillStyle = `rgba(50, 32, 18, ${0.4 + Math.random() * 0.4})`;
    ctx.fillRect(x, y1, 1, len);
  }
  // Tan highlights
  for (let i = 0; i < 18; i++) {
    const x = Math.floor(Math.random() * size);
    const y1 = Math.random() * size;
    const len = 4 + Math.random() * 14;
    ctx.fillStyle = 'rgba(185, 130, 80, 0.55)';
    ctx.fillRect(x, y1, 1, len);
  }
  return _finalizeTex(canvas);
}

function gen_barkBirch(size = 64) {
  const canvas = _mkCanvasTex(size);
  const ctx = canvas.getContext('2d');
  // Near-white base
  ctx.fillStyle = '#e3dccb';
  ctx.fillRect(0, 0, size, size);
  // Horizontal black tick marks
  for (let i = 0; i < 30; i++) {
    const y = Math.floor(Math.random() * size);
    const x = Math.floor(Math.random() * size);
    const len = 3 + Math.floor(Math.random() * 10);
    ctx.fillStyle = 'rgba(25, 18, 12, 0.85)';
    ctx.fillRect(x, y, len, 1);
  }
  // Gray softeners
  for (let i = 0; i < 18; i++) {
    const y = Math.floor(Math.random() * size);
    const x = Math.floor(Math.random() * size);
    const len = 2 + Math.floor(Math.random() * 5);
    ctx.fillStyle = 'rgba(125, 115, 95, 0.5)';
    ctx.fillRect(x, y, len, 1);
  }
  return _finalizeTex(canvas);
}

// Foliage textures use near-neutral luminosity so the material's `color`
// tint fully controls hue (green for most trees, red/orange for maple).
// Only variance in lightness is baked into the map.

// Foliage textures are near-white with darker dapples; color tint on the
// material controls hue so a single map serves green oaks AND red maples.

function gen_foliageLeafy(size = 64) {
  const canvas = _mkCanvasTex(size);
  const ctx = canvas.getContext('2d');
  // White base preserves material color at full intensity in highlight areas
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, size, size);
  // Soft dapples read as leaf shadows regardless of tint — kept light so the
  // green doesn't pick up muddy black specks at distance.
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 1 + Math.random() * 2;
    ctx.fillStyle = Math.random() < 0.5
      ? 'rgba(150, 150, 150, 0.4)'
      : 'rgba(200, 200, 200, 0.3)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return _finalizeTex(canvas);
}

function gen_stone(size = 64) {
  const canvas = _mkCanvasTex(size);
  const ctx = canvas.getContext('2d');
  // Warm cream stone with a 2-course running-bond hint. Each wall face
  // stretches one copy of this texture (no UV repeat), so baking exactly
  // 2 courses at size/2 makes the planter rim read as "two bricks tall".
  ctx.fillStyle = '#d4bf9c';
  ctx.fillRect(0, 0, size, size);
  // Soft mottled patches first — drawn before the mortar so the lines
  // stay crisp and readable on top.
  const patchCols = [
    'rgba(200, 180, 148, 0.55)',
    'rgba(224, 208, 180, 0.50)',
    'rgba(188, 168, 136, 0.45)',
    'rgba(216, 196, 164, 0.40)',
  ];
  for (let i = 0; i < 22; i++) {
    const cx = Math.random() * size;
    const cy = Math.random() * size;
    const r = 3 + Math.random() * 5;
    ctx.fillStyle = patchCols[Math.floor(Math.random() * patchCols.length)];
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Running-bond mortar lines. One horizontal seam between the two
  // courses; vertical seams every BW=16 px with a half-brick offset on
  // the bottom course.
  const courseH = size / 2;
  const BW = 16;
  ctx.fillStyle = 'rgba(120, 100, 78, 0.65)';
  // Horizontal mortar between courses.
  ctx.fillRect(0, courseH - 1, size, 1);
  // Top course: verticals at x = 0, 16, 32, 48.
  for (let x = 0; x < size; x += BW) {
    ctx.fillRect(x, 0, 1, courseH);
  }
  // Bottom course: offset by BW/2 so joints don't line up.
  for (let x = BW / 2; x < size + BW / 2; x += BW) {
    const xi = x % size;
    ctx.fillRect(xi, courseH, 1, courseH);
  }
  // Fine grain.
  for (let i = 0; i < 120; i++) {
    const x = Math.floor(Math.random() * size);
    const y = Math.floor(Math.random() * size);
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(x, y, 1, 1);
  }
  return _finalizeTex(canvas);
}

function gen_soil(size = 64) {
  const canvas = _mkCanvasTex(size);
  const ctx = canvas.getContext('2d');
  // Warm dark-brown base
  ctx.fillStyle = '#4a331e';
  ctx.fillRect(0, 0, size, size);
  // Freckles of lighter and darker dirt
  for (let i = 0; i < 180; i++) {
    const x = Math.floor(Math.random() * size);
    const y = Math.floor(Math.random() * size);
    const c = Math.random();
    ctx.fillStyle = c < 0.5 ? '#6b4a2c' : (c < 0.85 ? '#2e1f12' : '#8a6538');
    ctx.fillRect(x, y, 1, 1);
  }
  // Occasional pebbles
  for (let i = 0; i < 12; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = 'rgba(150, 130, 105, 0.75)';
    ctx.beginPath();
    ctx.arc(x, y, 0.8 + Math.random() * 1.0, 0, Math.PI * 2);
    ctx.fill();
  }
  return _finalizeTex(canvas);
}

function gen_foliageNeedle(size = 64) {
  const canvas = _mkCanvasTex(size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e0e0e0';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const a = Math.random() * Math.PI * 2;
    const len = 1.5 + Math.random() * 2.8;
    ctx.strokeStyle = Math.random() < 0.5
      ? 'rgba(130, 130, 130, 0.45)'
      : 'rgba(180, 180, 180, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  return _finalizeTex(canvas);
}

// Lazy singletons — only instantiated in a browser with canvas + THREE.
let _texBark = null, _texBarkBirch = null, _texFoliageLeafy = null, _texFoliageNeedle = null, _texSoil = null, _texStone = null;
function _getTex(which) {
  if (typeof document === 'undefined' || typeof THREE === 'undefined') return null;
  switch (which) {
    case 'bark':           return (_texBark           ??= gen_bark());
    case 'barkBirch':      return (_texBarkBirch      ??= gen_barkBirch());
    case 'foliageLeafy':   return (_texFoliageLeafy   ??= gen_foliageLeafy());
    case 'foliageNeedle':  return (_texFoliageNeedle  ??= gen_foliageNeedle());
    case 'soil':           return (_texSoil           ??= gen_soil());
    case 'stone':          return (_texStone          ??= gen_stone());
  }
  return null;
}

// Small deterministic PRNG so flower placement is stable across renders —
// without determinism, every thumbnail rebuild reshuffles blooms and the
// preview looks different from the live ghost.
function _prng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash a decoration's grid position into a stable seed so each placed
// instance gets consistent but unique variation — same tile always produces
// the same tree shape. Seed 0 means "no variation" (used for ghosts and
// thumbnails so they show the nominal designed form).
function _hashDecorationPos(col, row, subCol, subRow) {
  let h = ((col | 0) * 73856093)
    ^ ((row | 0) * 19349663)
    ^ ((subCol | 0) * 83492791)
    ^ ((subRow | 0) * -1640531535);
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) || 1;
}

// Shift a hex color's green channel by `delta` (clamped). Used for per-tree
// foliage hue variation — keeps R/B anchored so species palette (red maple,
// green oak) stays recognizable.
function _jitterGreen(hex, delta) {
  const r = (hex >> 16) & 0xff;
  const g = Math.max(0, Math.min(255, ((hex >> 8) & 0xff) + (delta | 0)));
  const b = hex & 0xff;
  return (r << 16) | (g << 8) | b;
}

// --- Face-texture loader (sign boards, bin labels, flag) ---------------
// PNGs live under assets/textures/decorations/ and are generated by
// tools/asset-gen/gen-decoration-faces.cjs. Clamp-wrapped, nearest-filtered
// for crisp pixel-art look consistent with bark/foliage.
let _faceLoader = null;
const _faceCache = {};
function loadFaceTex(name) {
  if (typeof THREE === 'undefined') return null;
  if (_faceCache[name]) return _faceCache[name];
  _faceLoader ??= new THREE.TextureLoader();
  const tex = _faceLoader.load(`assets/textures/decorations/${name}.png`);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  _faceCache[name] = tex;
  return tex;
}

// --- Helpers -------------------------------------------------------------

// Scale a geometry's UV attribute in place so a texture tiles more times
// across the surface. Used so bark/foliage maps have the right pixel
// density on cylinders and spheres regardless of mesh size.
function _scaleUVs(geo, uRepeat, vRepeat) {
  const uv = geo.attributes.uv;
  if (!uv) return;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * uRepeat, uv.getY(i) * vRepeat);
  }
  uv.needsUpdate = true;
}

function _trunk(group, radius, height, color, texKey = 'bark') {
  const geo = new THREE.CylinderGeometry(radius * 0.7, radius, height, 8);
  // Bark tiles twice vertically; once around — so grooves read as vertical.
  _scaleUVs(geo, 1, Math.max(1, Math.round(height * 1.2)));
  const mat = new THREE.MeshStandardMaterial({
    color,
    map: _getTex(texKey),
    roughness: 0.95,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = height / 2;
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

function _sphere(group, radius, y, color, scaleY, texKey = 'foliageLeafy') {
  const geo = new THREE.SphereGeometry(radius, 8, 6);
  _scaleUVs(geo, 2, 1);
  const mat = new THREE.MeshStandardMaterial({
    color,
    map: _getTex(texKey),
    roughness: 0.85,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = y;
  if (scaleY != null) mesh.scale.y = scaleY;
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

function _cone(group, radius, height, y, color, texKey = 'foliageNeedle') {
  const geo = new THREE.ConeGeometry(radius, height, 8);
  _scaleUVs(geo, 2, Math.max(1, Math.round(height * 0.8)));
  const mat = new THREE.MeshStandardMaterial({
    color,
    map: _getTex(texKey),
    roughness: 0.85,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = y;
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

// --- Per-species tree builders -------------------------------------------

// Oak: broad irregular canopy with root flare and spreading lateral branches.
// Flared root base + tapered trunk + overlapping 7-sphere crown tinted
// dark→mid→bright bottom-to-top so the dome reads as lumpy rather than a
// smooth ball. Two lower side puffs evoke the horizontal branching of a
// mature oak.
function _oakTree(footW, footL, totalH, seed = 0) {
  const group = new THREE.Group();
  const s = Math.min(footW, footL);
  const rng = seed ? _prng(seed) : null;
  const trunkMul  = rng ? (0.75 + rng() * 0.5) : 1;
  const canopyMul = rng ? (0.75 + rng() * 0.5) : 1;
  const greenShift = rng ? Math.floor((rng() - 0.5) * 24) : 0;
  const jitter = (amp) => (rng ? (rng() - 0.5) * amp : 0);

  const trunkH = totalH * 0.4 * trunkMul;
  const barkMat = new THREE.MeshStandardMaterial({
    color: 0x7a4a24, map: _getTex('bark'), roughness: 0.95,
  });

  // Flared root base
  const flareH = trunkH * 0.22;
  const flareGeo = new THREE.CylinderGeometry(s * 0.15, s * 0.23, flareH, 10);
  _scaleUVs(flareGeo, 1, 1);
  const flare = new THREE.Mesh(flareGeo, barkMat);
  flare.position.y = flareH / 2;
  flare.castShadow = true;
  group.add(flare);

  // Tapered main trunk
  const mainH = trunkH - flareH;
  const trunkGeo = new THREE.CylinderGeometry(s * 0.10, s * 0.15, mainH, 10);
  _scaleUVs(trunkGeo, 1, Math.max(1, Math.round(mainH * 1.2)));
  const trunk = new THREE.Mesh(trunkGeo, barkMat);
  trunk.position.y = flareH + mainH / 2;
  trunk.castShadow = true;
  group.add(trunk);

  const r = s * 0.48 * canopyMul;
  const cy = trunkH + r * 0.35;
  const dark   = _jitterGreen(0x246b22, greenShift);
  const mid    = _jitterGreen(0x2f8b2d, greenShift);
  const bright = _jitterGreen(0x4aa63d, greenShift);

  // Wide flattened dark base
  _sphere(group, r, cy, dark, 0.65);

  // Ring of 4 mid-tone puffs for lumpy silhouette — per-puff jitter
  const ringR = r * 0.58;
  const ringY = cy + r * 0.25;
  const ringOffset = rng ? rng() * Math.PI * 2 : 0.4;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + ringOffset + jitter(0.2);
    const rr = ringR + jitter(r * 0.1);
    const puff = _sphere(group, r * (0.55 + jitter(0.1)), ringY, mid, 0.78);
    puff.position.x = Math.cos(a) * rr;
    puff.position.z = Math.sin(a) * rr;
    puff.position.y = ringY + Math.sin(a * 2) * r * 0.06 + jitter(r * 0.08);
  }

  // Bright top highlights
  _sphere(group, r * 0.5, cy + r * 0.6, bright, 0.85);
  const topSide = _sphere(group, r * 0.38, cy + r * 0.5, bright, 0.75);
  topSide.position.x = r * 0.25 + jitter(r * 0.1);
  topSide.position.z = -r * 0.15 + jitter(r * 0.1);

  // Lower lateral branch puffs — horizontal-spread character
  const branchY = trunkH + r * 0.05;
  const lp1 = _sphere(group, r * 0.38, branchY, dark, 0.7);
  lp1.position.x = r * (0.75 + jitter(0.1));
  lp1.position.z = r * (0.1 + jitter(0.2));
  const lp2 = _sphere(group, r * 0.34, branchY, dark, 0.7);
  lp2.position.x = -r * (0.7 + jitter(0.1));
  lp2.position.z = -r * (0.2 + jitter(0.2));

  // Optional 5th canopy lump — adds ~50% silhouette variety between trees
  if (rng && rng() > 0.5) {
    const extra = _sphere(group, r * 0.42, cy + r * 0.4, mid, 0.75);
    const ea = rng() * Math.PI * 2;
    extra.position.x = Math.cos(ea) * r * 0.45;
    extra.position.z = Math.sin(ea) * r * 0.45;
  }

  if (rng) group.rotation.y = rng() * Math.PI * 2;
  return group;
}

// Maple: fiery autumn crown with strong per-tree variation. Seed drives
// season-tint bias (each maple leans red, orange, or yellow), canopy aspect
// (flat-wide vs tall-narrow), puff count (4–7), per-puff color picked from
// the palette so mixed-foliage trees emerge, and a subtle trunk lean so
// stands don't look like cloned soldiers.
function _mapleTree(footW, footL, totalH, seed = 0) {
  const group = new THREE.Group();
  const s = Math.min(footW, footL);
  const rng = seed ? _prng(seed) : null;
  const pick = (...opts) => (rng ? opts[Math.floor(rng() * opts.length)] : opts[0]);
  const jitter = (amp) => (rng ? (rng() - 0.5) * amp : 0);

  // Season bias — each tree leans toward one of 3 autumn palettes. Without a
  // bias, per-puff random tint averages out and every tree looks the same.
  const palettes = [
    // Crimson-red maple
    { deep: 0x7a2212, body: 0xb8371a, bright: 0xd85a28, extra: 0xe87a35 },
    // Orange-amber maple
    { deep: 0x8a3a14, body: 0xcc5522, bright: 0xe8832c, extra: 0xf0a83a },
    // Yellow-gold maple
    { deep: 0x966218, body: 0xd69a2a, bright: 0xe8c44a, extra: 0xd86a2a },
  ];
  const pal = rng ? palettes[Math.floor(rng() * palettes.length)] : palettes[1];
  const tints = [pal.deep, pal.body, pal.bright, pal.extra];

  const trunkMul  = rng ? (0.75 + rng() * 0.5) : 1;
  const canopyMul = rng ? (0.75 + rng() * 0.5) : 1;
  const aspectY   = rng ? (0.65 + rng() * 0.55) : 0.85; // flat → tall-narrow

  const trunkH = totalH * 0.42 * trunkMul;
  const trunkLean = rng ? (rng() - 0.5) * 0.18 : 0;
  const trunkYaw  = rng ? rng() * Math.PI * 2 : 0;

  // Trunk under a tiny pivot so it can lean without moving base
  const trunkPivot = new THREE.Group();
  trunkPivot.rotation.y = trunkYaw;
  trunkPivot.rotation.z = trunkLean;
  _trunk(trunkPivot, s * 0.11, trunkH, 0x7a4a28);
  group.add(trunkPivot);

  // Canopy offset follows the trunk tip (so crown sits atop the leaning trunk)
  const canopyOffX = Math.sin(trunkLean) * trunkH * Math.cos(trunkYaw);
  const canopyOffZ = Math.sin(trunkLean) * trunkH * Math.sin(trunkYaw);

  const r = s * 0.4 * canopyMul;
  const cy = trunkH * Math.cos(trunkLean) + r * 0.5;

  // Dark core base — always present, flattened per aspectY
  const core = _sphere(group, r, cy, pal.deep, aspectY * 0.8);
  core.position.x = canopyOffX;
  core.position.z = canopyOffZ;

  // Variable-count ring of puffs with per-puff random color
  const puffN = rng ? 4 + Math.floor(rng() * 4) : 5; // 4–7
  const ringOffset = rng ? rng() * Math.PI * 2 : 0;
  for (let i = 0; i < puffN; i++) {
    const a = (i / puffN) * Math.PI * 2 + ringOffset + jitter(0.35);
    const rr = r * (0.5 + jitter(0.25));
    const puffR = r * (0.45 + jitter(0.2));
    const puffY = cy + r * (0.2 + jitter(0.3)) * aspectY;
    const color = pick(...tints);
    const puff = _sphere(group, puffR, puffY, color, aspectY * (0.8 + jitter(0.2)));
    puff.position.x = canopyOffX + Math.cos(a) * rr;
    puff.position.z = canopyOffZ + Math.sin(a) * rr;
  }

  // 1-3 bright top highlights — count varies for silhouette differentiation
  const topN = rng ? 1 + Math.floor(rng() * 3) : 2;
  for (let i = 0; i < topN; i++) {
    const a = rng ? rng() * Math.PI * 2 : 0;
    const hi = _sphere(group, r * (0.3 + jitter(0.1)), cy + r * (0.5 + jitter(0.2)) * aspectY,
      pick(pal.bright, pal.extra), aspectY * 0.8);
    hi.position.x = canopyOffX + Math.cos(a) * r * 0.25;
    hi.position.z = canopyOffZ + Math.sin(a) * r * 0.25;
  }

  // ~30% of trees get a low asymmetric branch puff for a distinctive profile
  if (rng && rng() > 0.7) {
    const a = rng() * Math.PI * 2;
    const lp = _sphere(group, r * 0.38, trunkH + r * 0.1, pal.body, 0.7);
    lp.position.x = canopyOffX + Math.cos(a) * r * 0.8;
    lp.position.z = canopyOffZ + Math.sin(a) * r * 0.8;
  }

  if (rng) group.rotation.y = rng() * Math.PI * 2;
  return group;
}

// Elm: American-elm vase/fountain silhouette. A slender lower trunk splits
// into 3 sub-trunks leaning outward (the characteristic elm fork), topped
// with a spreading canopy — tall central mass + 5 outer puffs pulled down
// to suggest the drooping tips of the crown. Each sub-trunk is parented to
// a pivot group so Y-yaw spaces them radially while Z-lean tilts them out.
function _elmTree(footW, footL, totalH, seed = 0) {
  const group = new THREE.Group();
  const s = Math.min(footW, footL);
  const rng = seed ? _prng(seed) : null;
  const trunkMul  = rng ? (0.75 + rng() * 0.5) : 1;
  const canopyMul = rng ? (0.75 + rng() * 0.5) : 1;
  const greenShift = rng ? Math.floor((rng() - 0.5) * 24) : 0;
  const jitter = (amp) => (rng ? (rng() - 0.5) * amp : 0);

  const trunkH = totalH * 0.55 * trunkMul;
  const barkMat = new THREE.MeshStandardMaterial({
    color: 0x6b3a1a, map: _getTex('bark'), roughness: 0.95,
  });

  // Lower trunk — slender base of the vase
  const lowerH = trunkH * 0.55;
  const lowerGeo = new THREE.CylinderGeometry(s * 0.09, s * 0.12, lowerH, 10);
  _scaleUVs(lowerGeo, 1, Math.max(1, Math.round(lowerH * 1.2)));
  const lower = new THREE.Mesh(lowerGeo, barkMat);
  lower.position.y = lowerH / 2;
  lower.castShadow = true;
  group.add(lower);

  // Three sub-trunks diverging outward from the fork (jittered lean + yaw)
  const subH = trunkH - lowerH;
  const subR = s * 0.065;
  const baseLean = 0.32;
  const forkY = lowerH - s * 0.03;
  const yawOffset = rng ? rng() * Math.PI * 2 : 0;
  for (let i = 0; i < 3; i++) {
    const yaw = (i / 3) * Math.PI * 2 + yawOffset + jitter(0.25);
    const lean = baseLean + jitter(0.1);
    const pivot = new THREE.Group();
    pivot.position.y = forkY;
    pivot.rotation.y = yaw;
    pivot.rotation.z = lean;
    const geo = new THREE.CylinderGeometry(subR * 0.65, subR, subH, 8);
    _scaleUVs(geo, 1, Math.max(1, Math.round(subH * 1.2)));
    const mesh = new THREE.Mesh(geo, barkMat);
    mesh.position.y = subH / 2;
    mesh.castShadow = true;
    pivot.add(mesh);
    group.add(pivot);
  }

  // Canopy — spreading fan, drooping outer tips
  const canopyY = trunkH + s * 0.05;
  const fanR = s * 0.55 * canopyMul;
  const dark   = _jitterGreen(0x2a6e2a, greenShift);
  const mid    = _jitterGreen(0x3e9a3a, greenShift);
  const bright = _jitterGreen(0x5bba4d, greenShift);

  // Tall central mass
  _sphere(group, s * 0.32 * canopyMul, canopyY + s * 0.2, mid, 1.15);

  // Outer fan of 5 drooping puffs
  const fanOffset = rng ? rng() * Math.PI * 2 : 0.3;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + fanOffset + jitter(0.15);
    const rr = fanR + jitter(s * 0.1);
    const puff = _sphere(group, s * (0.28 + jitter(0.08)), canopyY, dark, 0.85);
    puff.position.x = Math.cos(a) * rr;
    puff.position.z = Math.sin(a) * rr;
    puff.position.y = canopyY - s * (0.18 + jitter(0.08));
  }

  // Inner bright highlights on top
  const hi1 = _sphere(group, s * 0.24, canopyY + s * 0.4, bright, 0.9);
  hi1.position.x = s * (0.12 + jitter(0.15));
  hi1.position.z = jitter(s * 0.15);
  const hi2 = _sphere(group, s * 0.2, canopyY + s * 0.45, bright, 0.85);
  hi2.position.z = -s * (0.18 + jitter(0.15));
  hi2.position.x = jitter(s * 0.15);

  if (rng) group.rotation.y = rng() * Math.PI * 2;
  return group;
}

// Birch: clumping 2-3 slender white trunks (birches often grow in small
// clusters) with horizontal bark ticks; small oval canopy at the top of
// each trunk.
function _birchTree(footW, footL, totalH, seed = 0) {
  const group = new THREE.Group();
  const s = Math.min(footW, footL);
  const rng = seed ? _prng(seed) : null;
  const trunkMul  = rng ? (0.75 + rng() * 0.5) : 1;
  const canopyMul = rng ? (0.75 + rng() * 0.5) : 1;
  const greenShift = rng ? Math.floor((rng() - 0.5) * 20) : 0;
  const jitter = (amp) => (rng ? (rng() - 0.5) * amp : 0);

  const barkMat = new THREE.MeshStandardMaterial({
    color: 0xeae3d2, map: _getTex('barkBirch'), roughness: 0.9,
  });
  const foliageLight = _jitterGreen(0x66bb55, greenShift);
  const foliageDark  = _jitterGreen(0x55aa44, greenShift);

  // 2 or 3 trunks in a tight clump — deterministic-chaotic lean
  const clumpN = rng && rng() > 0.4 ? 3 : 2;
  const baseTrunkH = totalH * 0.55 * trunkMul;
  for (let i = 0; i < clumpN; i++) {
    const lean = jitter(0.12);
    const yaw  = (i / clumpN) * Math.PI * 2 + jitter(0.4);
    const offR = s * 0.12 * (i === 0 ? 0 : 1);
    const trunkH = baseTrunkH * (0.9 + (rng ? rng() * 0.2 : 0));
    const r = s * (0.065 + jitter(0.02));

    const pivot = new THREE.Group();
    pivot.position.x = Math.cos(yaw) * offR;
    pivot.position.z = Math.sin(yaw) * offR;
    pivot.rotation.y = yaw;
    pivot.rotation.z = lean;

    const geo = new THREE.CylinderGeometry(r * 0.7, r, trunkH, 8);
    _scaleUVs(geo, 1, Math.max(1, Math.round(trunkH * 1.2)));
    const trunk = new THREE.Mesh(geo, barkMat);
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    pivot.add(trunk);
    group.add(pivot);

    // Small canopy at top of each trunk — position in world via pivot math
    // simplified: place the sphere directly in parent group at the tipped tip
    const tipY = Math.cos(lean) * trunkH;
    const tipX = pivot.position.x + Math.sin(lean) * trunkH * Math.cos(yaw);
    const tipZ = pivot.position.z + Math.sin(lean) * trunkH * Math.sin(yaw);
    const cr = s * (0.24 + jitter(0.04)) * canopyMul;
    const low = _sphere(group, cr, tipY - cr * 0.2, foliageDark, 1.1);
    low.position.x = tipX;
    low.position.z = tipZ;
    const high = _sphere(group, cr * 0.65, tipY + cr * 0.4, foliageLight, 1.0);
    high.position.x = tipX + jitter(cr * 0.3);
    high.position.z = tipZ + jitter(cr * 0.3);
  }

  if (rng) group.rotation.y = rng() * Math.PI * 2;
  return group;
}

// Willow: thick trunk + drooping fountain canopy. Crown built from several
// overlapping spheres with a wide skirt hanging below, plus a handful of
// vertical "strand" planes for drooping-leaf character.
function _willowTree(footW, footL, totalH, seed = 0) {
  const group = new THREE.Group();
  const s = Math.min(footW, footL);
  const rng = seed ? _prng(seed) : null;
  const trunkMul  = rng ? (0.75 + rng() * 0.5) : 1;
  const canopyMul = rng ? (0.75 + rng() * 0.5) : 1;
  const greenShift = rng ? Math.floor((rng() - 0.5) * 20) : 0;
  const jitter = (amp) => (rng ? (rng() - 0.5) * amp : 0);

  const trunkH = totalH * 0.35 * trunkMul;
  _trunk(group, s * 0.12, trunkH, 0x8b5a2b);

  const r = s * 0.35 * canopyMul;
  const cy = trunkH + r * 0.7;
  const light = _jitterGreen(0x75c04a, greenShift);
  const dark  = _jitterGreen(0x55aa33, greenShift);

  // Multi-sphere crown for bumpy top
  _sphere(group, r, cy, light, 0.8);
  const puffs = 4;
  const ringOffset = rng ? rng() * Math.PI * 2 : 0;
  for (let i = 0; i < puffs; i++) {
    const a = (i / puffs) * Math.PI * 2 + ringOffset + jitter(0.15);
    const rr = r * (0.55 + jitter(0.1));
    const puff = _sphere(group, r * (0.5 + jitter(0.08)), cy + jitter(r * 0.1), light, 0.85);
    puff.position.x = Math.cos(a) * rr;
    puff.position.z = Math.sin(a) * rr;
  }

  // Drooping skirt — inverted cone
  const skirtR = s * 0.48 * canopyMul;
  const skirtH = totalH * (0.45 + jitter(0.08));
  const skirtGeo = new THREE.CylinderGeometry(r * 0.6, skirtR, skirtH, 10, 1, true);
  _scaleUVs(skirtGeo, 2, Math.max(1, Math.round(skirtH * 1.2)));
  const skirtMat = new THREE.MeshStandardMaterial({
    color: dark, roughness: 0.85, side: THREE.DoubleSide,
    map: _getTex('foliageLeafy'),
  });
  const skirt = new THREE.Mesh(skirtGeo, skirtMat);
  skirt.position.y = trunkH + r * 0.3 - skirtH * 0.15;
  skirt.castShadow = true;
  group.add(skirt);

  // Hanging "strands" — narrow vertical planes at skirt edge, randomly placed
  if (rng) {
    const strandN = 5 + Math.floor(rng() * 4);
    const strandMat = new THREE.MeshStandardMaterial({
      color: dark, roughness: 0.9, side: THREE.DoubleSide,
      map: _getTex('foliageLeafy'), transparent: false,
    });
    for (let i = 0; i < strandN; i++) {
      const a = rng() * Math.PI * 2;
      const rr = skirtR * (0.85 + rng() * 0.2);
      const h = skirtH * (0.4 + rng() * 0.3);
      const w = s * 0.1;
      const strandGeo = new THREE.PlaneGeometry(w, h);
      const strand = new THREE.Mesh(strandGeo, strandMat);
      strand.position.x = Math.cos(a) * rr;
      strand.position.z = Math.sin(a) * rr;
      strand.position.y = skirt.position.y - skirtH * 0.4;
      strand.rotation.y = a + Math.PI / 2;
      strand.castShadow = true;
      group.add(strand);
    }
  }

  if (rng) group.rotation.y = rng() * Math.PI * 2;
  return group;
}

// Small tree: compact round canopy made of 3-4 overlapping puffs so the
// silhouette isn't a perfect sphere; thin trunk.
function _smallTree(footW, footL, totalH, seed = 0) {
  const group = new THREE.Group();
  const s = Math.min(footW, footL);
  const rng = seed ? _prng(seed) : null;
  const trunkMul  = rng ? (0.75 + rng() * 0.5) : 1;
  const canopyMul = rng ? (0.75 + rng() * 0.5) : 1;
  const greenShift = rng ? Math.floor((rng() - 0.5) * 24) : 0;
  const jitter = (amp) => (rng ? (rng() - 0.5) * amp : 0);

  const trunkH = totalH * 0.45 * trunkMul;
  _trunk(group, s * 0.1, trunkH, 0x8b6530);

  const r = s * 0.38 * canopyMul;
  const cy = trunkH + r * 0.6;
  const body = _jitterGreen(0x33aa33, greenShift);
  const hi   = _jitterGreen(0x48bf44, greenShift);

  _sphere(group, r, cy, body, 0.95);
  const n = rng && rng() > 0.5 ? 4 : 3;
  const ringOffset = rng ? rng() * Math.PI * 2 : 0;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + ringOffset + jitter(0.2);
    const rr = r * (0.4 + jitter(0.1));
    const puff = _sphere(group, r * (0.55 + jitter(0.08)), cy + r * 0.15 + jitter(r * 0.15), hi, 0.9);
    puff.position.x = Math.cos(a) * rr;
    puff.position.z = Math.sin(a) * rr;
  }

  if (rng) group.rotation.y = rng() * Math.PI * 2;
  return group;
}

// Pine: tall narrow conical silhouette, short trunk
function _pineTree(footW, footL, totalH, seed = 0) {
  const group = new THREE.Group();
  const s = Math.min(footW, footL);
  const rng = seed ? _prng(seed) : null;
  const heightMul = rng ? (0.75 + rng() * 0.5) : 1;
  const canopyMul = rng ? (0.75 + rng() * 0.5) : 1;
  const greenShift = rng ? Math.floor((rng() - 0.5) * 20) : 0;

  const trunkH = totalH * 0.15 * heightMul;
  _trunk(group, s * 0.08, trunkH, 0x8b5a2b);
  const coneR = s * 0.38 * canopyMul;
  const coneH = totalH * 0.55 * heightMul;
  _cone(group, coneR, coneH, trunkH + coneH * 0.5, _jitterGreen(0x1a5c1a, greenShift));
  _cone(group, coneR * 0.65, coneH * 0.6, trunkH + coneH * 0.75, _jitterGreen(0x1f6b1f, greenShift));
  if (rng) group.rotation.y = rng() * Math.PI * 2;
  return group;
}

// Cedar: broad spreading shape — wide, shorter layered cones
function _cedarTree(footW, footL, totalH, seed = 0) {
  const group = new THREE.Group();
  const s = Math.min(footW, footL);
  const rng = seed ? _prng(seed) : null;
  const heightMul = rng ? (0.75 + rng() * 0.5) : 1;
  const canopyMul = rng ? (0.75 + rng() * 0.5) : 1;
  const greenShift = rng ? Math.floor((rng() - 0.5) * 20) : 0;

  const trunkH = totalH * 0.25 * heightMul;
  _trunk(group, s * 0.1, trunkH, 0x9b5533);
  const r = s * 0.46 * canopyMul;
  const lh = totalH * 0.3 * heightMul;
  _cone(group, r, lh, trunkH + lh * 0.5, _jitterGreen(0x1e6b2e, greenShift));
  _cone(group, r * 0.75, lh * 0.8, trunkH + lh * 0.95, _jitterGreen(0x237a33, greenShift));
  _cone(group, r * 0.45, lh * 0.55, trunkH + lh * 1.3, _jitterGreen(0x28853a, greenShift));
  if (rng) group.rotation.y = rng() * Math.PI * 2;
  return group;
}

// Lookup table — maps typeId → per-species builder
const TREE_BUILDERS = {
  oakTree:    _oakTree,
  mapleTree:  _mapleTree,
  elmTree:    _elmTree,
  birchTree:  _birchTree,
  willowTree: _willowTree,
  smallTree:  _smallTree,
  pineTree:   _pineTree,
  cedarTree:  _cedarTree,
};

function _shrub(footW, footL, totalH, seed = 0) {
  const group = new THREE.Group();
  const rBase = Math.min(footW, footL, totalH) * 0.42;
  const rng = seed ? _prng(seed) : null;
  const greenShift = rng ? Math.floor((rng() - 0.5) * 24) : 0;
  const jitter = (amp) => (rng ? (rng() - 0.5) * amp : 0);

  const dark = _jitterGreen(0x2f6b2e, greenShift);
  const mid  = _jitterGreen(0x3a7a3a, greenShift);
  const hi   = _jitterGreen(0x4c9c4a, greenShift);

  // Central blob
  _sphere(group, rBase, rBase * 0.85, mid, 0.85);

  // 3-5 side lumps for irregular bush silhouette
  const n = rng ? 3 + Math.floor(rng() * 3) : 4;
  const ringOffset = rng ? rng() * Math.PI * 2 : 0;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + ringOffset + jitter(0.25);
    const rr = rBase * (0.5 + jitter(0.15));
    const lumpR = rBase * (0.55 + jitter(0.1));
    const lump = _sphere(group, lumpR, rBase * (0.6 + jitter(0.3)), i % 2 ? dark : hi, 0.85);
    lump.position.x = Math.cos(a) * rr;
    lump.position.z = Math.sin(a) * rr;
  }

  if (rng) group.rotation.y = rng() * Math.PI * 2;
  return group;
}

// Build a single flower: green stem + a colored bloom on top + one leaf.
// Size scales with `h` (bloom height in world units).
function _buildBloom(color, h) {
  const group = new THREE.Group();
  const stemH = h * 0.7;
  const stemR = Math.max(0.015, h * 0.06);
  const stemGeo = new THREE.CylinderGeometry(stemR, stemR, stemH, 5);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x2d6b2d, roughness: 0.85 });
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.position.y = stemH / 2;
  group.add(stem);

  const bloomR = Math.max(0.05, h * 0.28);
  const bloomGeo = new THREE.SphereGeometry(bloomR, 7, 5);
  const bloomMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
  const bloom = new THREE.Mesh(bloomGeo, bloomMat);
  bloom.position.y = stemH + bloomR * 0.85;
  bloom.castShadow = true;
  group.add(bloom);

  const leafR = bloomR * 0.55;
  const leafGeo = new THREE.SphereGeometry(leafR, 5, 4);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3e7a3e, roughness: 0.85 });
  const leaf = new THREE.Mesh(leafGeo, leafMat);
  leaf.position.set(stemR * 2, stemH * 0.35, 0);
  leaf.scale.set(1.6, 0.5, 1.2);
  group.add(leaf);

  return group;
}

// Build four stone walls arranged around the bed perimeter + one soil slab
// inside them — the whole thing reads as a raised planter box.
function _buildPlanter(footW, footL, soilH, stoneH, stoneW) {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: _getTex('stone'),
    roughness: 0.95,
  });
  const soilMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: _getTex('soil'),
    roughness: 0.95,
  });

  // Four stone walls (one per side)
  const addWall = (w, d, x, z) => {
    const geo = new THREE.BoxGeometry(w, stoneH, d);
    const mesh = new THREE.Mesh(geo, stoneMat);
    mesh.position.set(x, stoneH / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  const halfW = footW / 2;
  const halfL = footL / 2;
  addWall(footW, stoneW, 0, -halfL + stoneW / 2);        // north
  addWall(footW, stoneW, 0,  halfL - stoneW / 2);        // south
  addWall(stoneW, footL - 2 * stoneW, -halfW + stoneW / 2, 0); // west
  addWall(stoneW, footL - 2 * stoneW,  halfW - stoneW / 2, 0); // east

  // Soil slab inside the walls
  const soilGeo = new THREE.BoxGeometry(footW - 2 * stoneW, soilH, footL - 2 * stoneW);
  const soil = new THREE.Mesh(soilGeo, soilMat);
  soil.position.y = soilH / 2;
  soil.receiveShadow = true;
  group.add(soil);

  return { group, soilTop: soilH, innerW: footW - 2 * stoneW, innerL: footL - 2 * stoneW };
}

/**
 * Shared bed builder: stone-walled planter + jittered grid of 3D blooms.
 * Deterministic (hash-seeded PRNG) so the palette thumbnail matches the
 * placement ghost and the in-world decoration.
 *
 * `colors` + `randomColors` drive flower hues:
 *   - randomColors=true  -> each bloom picks freely across a wide spectrum
 *   - randomColors=false -> bloom color cycles through `colors` deterministically
 */
function _buildFlowerBed(footW, footL, totalH, {
  seed,
  bloomHeight,
  bloomScale = 1,
  colors,
  randomColors = false,
  density,       // blooms per square meter (approx)
}) {
  const group = new THREE.Group();
  const stoneH = 0.18;
  const soilH = 0.12;
  const stoneW = 0.1;

  const { group: planter, soilTop, innerW, innerL } =
    _buildPlanter(footW, footL, soilH, stoneH, stoneW);
  group.add(planter);

  // Lay out blooms on a jittered grid inside the soil area.
  const area = innerW * innerL;
  const target = Math.max(4, Math.round(area * density));
  const ratio = innerW / innerL;
  const cols = Math.max(2, Math.round(Math.sqrt(target * ratio)));
  const rows = Math.max(2, Math.round(target / cols));
  const cellW = (innerW * 0.9) / cols;
  const cellL = (innerL * 0.9) / rows;
  const originX = -innerW * 0.45 + cellW * 0.5;
  const originZ = -innerL * 0.45 + cellL * 0.5;

  const rand = _prng(seed);
  let colorIdx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const jx = (rand() - 0.5) * cellW * 0.5;
      const jz = (rand() - 0.5) * cellL * 0.5;
      const x = originX + c * cellW + jx;
      const z = originZ + r * cellL + jz;
      const color = randomColors
        ? colors[Math.floor(rand() * colors.length)]
        : colors[(colorIdx++) % colors.length];
      const h = bloomHeight * (0.85 + rand() * 0.35) * bloomScale;
      const bloom = _buildBloom(color, h);
      bloom.position.set(x, soilTop, z);
      bloom.rotation.y = rand() * Math.PI * 2;
      group.add(bloom);
    }
  }

  return group;
}

// --- Variant builders ----------------------------------------------------

function _wildflowers(footW, footL, totalH) {
  // Full-spectrum meadow palette; randomColors=true so every bloom is a
  // surprise rather than a repeating row pattern.
  return _buildFlowerBed(footW, footL, totalH, {
    seed: 0xb0d0001,
    bloomHeight: 0.22,
    randomColors: true,
    colors: [
      0xff4466, 0xffaa22, 0xff66aa, 0xffdd33,
      0xaa44ff, 0xff6633, 0xffffff, 0x66aaff,
      0xff88cc, 0xddff55, 0xff3355,
    ],
    density: 20,
  });
}

function _roseBed(footW, footL, totalH) {
  return _buildFlowerBed(footW, footL, totalH, {
    seed: 0xb0d0002,
    bloomHeight: 0.24,
    colors: [0xcc2244, 0xff3355, 0xee1133, 0xaa1133, 0xff5577],
    density: 20,
  });
}

function _daisyBed(footW, footL, totalH) {
  return _buildFlowerBed(footW, footL, totalH, {
    seed: 0xb0d0003,
    bloomHeight: 0.2,
    // Whites with an occasional yellow "centered" daisy
    colors: [0xffffff, 0xf8f4e8, 0xffffff, 0xffffff, 0xfff0a0],
    density: 22,
  });
}

function _tulipBed(footW, footL, totalH) {
  return _buildFlowerBed(footW, footL, totalH, {
    seed: 0xb0d0004,
    bloomHeight: 0.26,
    colors: [0xff3344, 0xffcc22, 0xff77aa, 0xff7722, 0xaa44ff, 0xffffff],
    density: 20,
  });
}

function _sunflowerBed(footW, footL, totalH) {
  // Taller stems, bigger blooms, warm golden palette
  return _buildFlowerBed(footW, footL, totalH, {
    seed: 0xb0d0005,
    bloomHeight: 0.34,
    bloomScale: 1.25,
    colors: [0xffcc22, 0xffaa11, 0xffd447, 0xf0a500],
    density: 12,
  });
}

function _lavenderBed(footW, footL, totalH) {
  return _buildFlowerBed(footW, footL, totalH, {
    seed: 0xb0d0006,
    bloomHeight: 0.22,
    colors: [0x9966cc, 0xaa77dd, 0x7744aa, 0xbb88ee, 0x9055bb],
    density: 24,
  });
}

// --- Furniture -----------------------------------------------------------

// Park bench: cast-iron end supports with wooden slat seat and backrest.
function _parkBench(footW, footL /* , totalH */) {
  const group = new THREE.Group();
  // RCT2 golden-ochre wood slats with near-black cast-iron frame.
  const woodMat = new THREE.MeshStandardMaterial({ color: 0xd9a63a, roughness: 0.85 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e1e20, roughness: 0.5, metalness: 0.4 });
  const seatH = 0.45;
  const legGeo = new THREE.BoxGeometry(0.06, seatH, footL * 0.65);
  for (const xs of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, darkMat);
    leg.position.set(xs * footW * 0.4, seatH / 2, 0);
    leg.castShadow = true;
    group.add(leg);
  }
  const slatGeo = new THREE.BoxGeometry(footW * 0.95, 0.04, footL * 0.24);
  for (let i = -1; i <= 1; i++) {
    const slat = new THREE.Mesh(slatGeo, woodMat);
    slat.position.set(0, seatH, i * footL * 0.27);
    slat.castShadow = true;
    group.add(slat);
  }
  const backGeo = new THREE.BoxGeometry(footW * 0.95, 0.32, 0.04);
  const back = new THREE.Mesh(backGeo, woodMat);
  back.position.set(0, seatH + 0.18, -footL * 0.3);
  back.castShadow = true;
  group.add(back);
  const postGeo = new THREE.BoxGeometry(0.04, 0.34, 0.04);
  for (const xs of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, darkMat);
    post.position.set(xs * footW * 0.4, seatH + 0.17, -footL * 0.3);
    post.castShadow = true;
    group.add(post);
  }
  return group;
}

// Picnic table: square top on 4 legs with benches on two sides.
function _picnicTable(footW, footL /* , totalH */) {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x9a7a4a, roughness: 0.85 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x6a4e2c, roughness: 0.85 });
  const tableH = 0.55;
  const benchH = 0.32;
  const tableW = footW * 0.7;
  const tableL = footL * 0.85;
  const slatGeo = new THREE.BoxGeometry(tableW, 0.03, tableL / 4 - 0.015);
  for (let i = 0; i < 4; i++) {
    const slat = new THREE.Mesh(slatGeo, woodMat);
    slat.position.set(0, tableH, (i - 1.5) * (tableL / 4));
    slat.castShadow = true;
    group.add(slat);
  }
  const legGeo = new THREE.BoxGeometry(0.05, tableH, 0.05);
  for (const xs of [-1, 1]) for (const zs of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, darkMat);
    leg.position.set(xs * tableW * 0.45, tableH / 2, zs * tableL * 0.42);
    leg.castShadow = true;
    group.add(leg);
  }
  const benchGeo = new THREE.BoxGeometry(tableW * 1.05, 0.04, 0.18);
  for (const zs of [-1, 1]) {
    const bench = new THREE.Mesh(benchGeo, woodMat);
    bench.position.set(0, benchH, zs * (tableL * 0.5 + 0.08));
    bench.castShadow = true;
    group.add(bench);
    for (const xs of [-1, 1]) {
      const bLeg = new THREE.Mesh(new THREE.BoxGeometry(0.04, benchH, 0.04), darkMat);
      bLeg.position.set(xs * tableW * 0.4, benchH / 2, zs * (tableL * 0.5 + 0.08));
      bLeg.castShadow = true;
      group.add(bLeg);
    }
  }
  return group;
}

// Fountain: circular basin with central pedestal and upper tier.
function _fountain(footW, footL /* , totalH */) {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x9a9488, roughness: 0.9 });
  const stoneDark = new THREE.MeshStandardMaterial({ color: 0x7a7468, roughness: 0.9 });
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x3a80b8, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.75,
  });
  const r = Math.min(footW, footL) * 0.45;
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.95, 0.3, 20), stoneMat);
  basin.position.y = 0.15;
  basin.castShadow = true;
  group.add(basin);
  const recess = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r * 0.82, 0.08, 20), stoneDark);
  recess.position.y = 0.3;
  group.add(recess);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r * 0.82, 0.02, 20), waterMat);
  water.position.y = 0.3;
  group.add(water);
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.2, r * 0.26, 0.6, 10), stoneMat);
  ped.position.y = 0.6;
  ped.castShadow = true;
  group.add(ped);
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.3, 0.15, 14), stoneMat);
  upper.position.y = 0.95;
  upper.castShadow = true;
  group.add(upper);
  const fin = new THREE.Mesh(new THREE.SphereGeometry(r * 0.11, 10, 8), stoneDark);
  fin.position.y = 1.1;
  group.add(fin);
  return group;
}

// Statue: simple humanoid silhouette on a pedestal.
function _statue(footW, footL /* , totalH */) {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xb0aca2, roughness: 0.95 });
  const stoneDark = new THREE.MeshStandardMaterial({ color: 0x807c72, roughness: 0.95 });
  const pedW = Math.min(footW, footL) * 0.55;
  const pedH = 0.5;
  const ped = new THREE.Mesh(new THREE.BoxGeometry(pedW, pedH, pedW), stoneDark);
  ped.position.y = pedH / 2;
  ped.castShadow = true;
  group.add(ped);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(pedW * 1.15, 0.05, pedW * 1.15), stoneMat);
  cap.position.y = pedH + 0.025;
  group.add(cap);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(pedW * 0.22, pedW * 0.32, 0.7, 10), stoneMat);
  body.position.y = pedH + 0.4;
  body.castShadow = true;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(pedW * 0.22, 12, 10), stoneMat);
  head.position.y = pedH + 0.87;
  head.castShadow = true;
  group.add(head);
  const armGeo = new THREE.CylinderGeometry(pedW * 0.08, pedW * 0.08, 0.4, 6);
  for (const xs of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, stoneMat);
    arm.position.set(xs * pedW * 0.28, pedH + 0.45, 0);
    arm.rotation.z = xs * 0.22;
    arm.castShadow = true;
    group.add(arm);
  }
  return group;
}

// --- Lighting ------------------------------------------------------------

// Lamppost: RCT2-style dark-teal cast-iron post with a boxy lantern head.
function _lamppost(footW, footL, totalH) {
  const group = new THREE.Group();
  // Patina teal — dark dusty blue-green for the cast-iron post.
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x3a5e5e, roughness: 0.6, metalness: 0.35 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x24383a, roughness: 0.55, metalness: 0.4 });
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xfff0b0, emissive: 0xffc864, emissiveIntensity: 1.6, roughness: 0.3,
  });
  const poleH = Math.max(totalH * 0.85, 1.5);
  // Stepped base: square plinth + chamfered collar.
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.2), metalMat);
  plinth.position.y = 0.045;
  plinth.castShadow = true;
  group.add(plinth);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.06, 8), metalMat);
  collar.position.y = 0.12;
  group.add(collar);
  // Slender fluted pole.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.038, poleH, 8), metalMat);
  pole.position.y = poleH / 2 + 0.15;
  pole.castShadow = true;
  group.add(pole);
  // Upper collar/finial cap below the lantern.
  const topCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.05, 8), metalMat);
  topCollar.position.y = poleH + 0.15 + 0.025;
  group.add(topCollar);
  // Boxy lantern head — warm glow core inside a dark frame cage.
  const lanternY = poleH + 0.15 + 0.05 + 0.09;
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.14), glowMat);
  glow.position.y = lanternY;
  group.add(glow);
  // Frame caps on top and bottom of the lantern.
  const capTop = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.035, 0.18), frameMat);
  capTop.position.y = lanternY + 0.1;
  capTop.castShadow = true;
  group.add(capTop);
  const capBot = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.03, 0.17), frameMat);
  capBot.position.y = lanternY - 0.095;
  group.add(capBot);
  // Tiny roof finial.
  const finial = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.06, 4), frameMat);
  finial.position.y = lanternY + 0.15;
  finial.rotation.y = Math.PI / 4;
  group.add(finial);
  return group;
}

// Bollard light: short squat cylinder with glowing top cap.
function _bollardLight(/* footW, footL, totalH */) {
  const group = new THREE.Group();
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x48484a, roughness: 0.5, metalness: 0.7 });
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xfff0b0, emissive: 0xffdd88, emissiveIntensity: 1.2, roughness: 0.4,
  });
  const h = 0.9;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, h, 12), metalMat);
  body.position.y = h / 2;
  body.castShadow = true;
  group.add(body);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 12), glowMat);
  cap.position.y = h + 0.06;
  group.add(cap);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 12), metalMat);
  top.position.y = h + 0.135;
  group.add(top);
  return group;
}

// Spot light: angled head on a short post.
function _spotLight(/* footW, footL, totalH */) {
  const group = new THREE.Group();
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.4, metalness: 0.8 });
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xfffff0, emissive: 0xffffbb, emissiveIntensity: 1.8, roughness: 0.3,
  });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.14), metalMat);
  base.position.y = 0.025;
  base.castShadow = true;
  group.add(base);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 6), metalMat);
  post.position.y = 0.16;
  group.add(post);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.22, 12), metalMat);
  head.position.set(0.04, 0.32, 0);
  head.rotation.z = -0.55;
  head.castShadow = true;
  group.add(head);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.02, 12), glowMat);
  lens.position.set(0.14, 0.38, 0);
  lens.rotation.z = -0.55 + Math.PI / 2;
  group.add(lens);
  return group;
}

// --- Bins & signs --------------------------------------------------------

function _binBase(bodyHex, lidHex, hatchHex, hingeHex) {
  const group = new THREE.Group();
  const h = 0.80;
  const topR = 0.19;
  const botR = 0.15;
  const mkMat = (hex) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85, metalness: 0.02 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(topR, botR, h, 16), mkMat(bodyHex));
  body.position.y = h / 2;
  body.castShadow = true;
  group.add(body);

  const lid = new THREE.Mesh(
    new THREE.SphereGeometry(topR * 1.08, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    mkMat(lidHex),
  );
  lid.position.y = h;
  lid.castShadow = true;
  group.add(lid);

  const hinge = new THREE.Mesh(
    new THREE.CylinderGeometry(topR * 1.04, topR * 1.04, 0.025, 16),
    mkMat(hingeHex),
  );
  hinge.position.y = h - 0.015;
  group.add(hinge);

  const hatchW = 0.17;
  const hatchH = 0.22;
  const hatchD = 0.015;
  const hatchY = h * 0.42;
  const rAtHatch = botR + (topR - botR) * (hatchY / h);
  const hatch = new THREE.Mesh(new THREE.BoxGeometry(hatchW, hatchH, hatchD), mkMat(hatchHex));
  hatch.position.set(0, hatchY, rAtHatch + hatchD / 2 - 0.003);
  group.add(hatch);

  return group;
}

function _trashCan(/* footW, footL, totalH */) {
  return _binBase(0x2d7a3e, 0x256433, 0x225c2f, 0x163d1f);
}

function _recyclingBin(/* footW, footL, totalH */) {
  return _binBase(0x2a5d9e, 0x224c82, 0x1f4676, 0x152e4f);
}

function _boardSign(postMat, boardMat, postH, boardW, boardH, boardD, faceTexName) {
  const group = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, postH, 0.06), postMat);
  post.position.y = postH / 2;
  post.castShadow = true;
  group.add(post);
  const board = new THREE.Mesh(new THREE.BoxGeometry(boardW, boardH, boardD), boardMat);
  board.position.y = postH + boardH / 2 - 0.05;
  board.castShadow = true;
  group.add(board);
  const tex = loadFaceTex(faceTexName);
  if (tex) {
    const faceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    const faceGeo = new THREE.PlaneGeometry(boardW * 0.9, boardH * 0.88);
    for (const zs of [1, -1]) {
      const face = new THREE.Mesh(faceGeo, faceMat);
      face.position.set(0, postH + boardH / 2 - 0.05, zs * (boardD / 2 + 0.001));
      if (zs < 0) face.rotation.y = Math.PI;
      group.add(face);
    }
  }
  return group;
}

function _infoSign(/* footW, footL, totalH */) {
  const postMat = new THREE.MeshStandardMaterial({ color: 0x6a4e2c, roughness: 0.85 });
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x28507c, roughness: 0.7 });
  return _boardSign(postMat, boardMat, 1.2, 0.55, 0.4, 0.04, 'info_sign_face');
}

function _directionSign(/* footW, footL, totalH */) {
  const postMat = new THREE.MeshStandardMaterial({ color: 0x4e4e4e, roughness: 0.5, metalness: 0.5 });
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x2e7840, roughness: 0.7 });
  // Thin metal pole swapped in (cylinder feels nicer but using box helper keeps code shared)
  const group = _boardSign(postMat, boardMat, 1.1, 0.55, 0.22, 0.03, 'direction_sign_face');
  return group;
}

function _flagpole(_footW, _footL, totalH) {
  const group = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, roughness: 0.3, metalness: 0.8 });
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.8 });
  const finialMat = new THREE.MeshStandardMaterial({ color: 0xc8a84a, roughness: 0.3, metalness: 0.9 });
  // Honor data-driven height (subH * SUB). Default to 6m if unspecified.
  const poleH = Math.max((totalH ?? 6) - 0.1, 1);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.06, 12), baseMat);
  base.position.y = 0.03;
  base.castShadow = true;
  group.add(base);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, poleH, 8), poleMat);
  pole.position.y = poleH / 2 + 0.06;
  pole.castShadow = true;
  group.add(pole);
  const fin = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), finialMat);
  fin.position.y = poleH + 0.09;
  group.add(fin);
  const flagTex = loadFaceTex('flag');
  if (flagTex) {
    const flagMat = new THREE.MeshStandardMaterial({
      map: flagTex, roughness: 0.8, side: THREE.DoubleSide,
    });
    // Flag scales with pole — ~30% of pole height, 1.7:1 aspect ratio.
    const flagH = Math.max(poleH * 0.3, 0.6);
    const flagW = flagH * 1.7;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(flagW, flagH), flagMat);
    flag.position.set(flagW / 2 + 0.025, poleH - flagH / 2 + 0.04, 0);
    group.add(flag);
  }
  return group;
}

const ITEM_BUILDERS = {
  parkBench:     _parkBench,
  picnicTable:   _picnicTable,
  fountain:      _fountain,
  statue:        _statue,
  lamppost:      _lamppost,
  bollardLight:  _bollardLight,
  spotLight:     _spotLight,
  trashCan:      _trashCan,
  recyclingBin:  _recyclingBin,
  infoSign:      _infoSign,
  directionSign: _directionSign,
  flagpole:      _flagpole,
};

function _defaultBox(footW, footL, totalH) {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(footW * 0.6, totalH * 0.6, footL * 0.6);
  const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.7 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = totalH * 0.3;
  mesh.castShadow = true;
  group.add(mesh);
  return group;
}

// --- Module-level dispatch (shared by DecorationBuilder and thumbnail) ---

// Ordered to match the `variants` array in decorations.raw.js entries so
// the variant index from the palette flyout indexes directly into this list.
const FLOWER_BED_VARIANTS = [
  _wildflowers,  // 0 — Wildflowers
  _roseBed,      // 1 — Roses
  _daisyBed,     // 2 — Daisies
  _tulipBed,     // 3 — Tulips
  _sunflowerBed, // 4 — Sunflowers
  _lavenderBed,  // 5 — Lavender
];

function _isFlowerBedType(typeId) {
  return typeId === 'flowerBed' || typeId === 'largeFlowerBed' || typeId === 'longFlowerBed';
}

function buildDecorationGroup(typeId, category, footW, footL, totalH, variant = 0, seed = 0) {
  if (TREE_BUILDERS[typeId]) return TREE_BUILDERS[typeId](footW, footL, totalH, seed);
  if (_isFlowerBedType(typeId)) {
    const builder = FLOWER_BED_VARIANTS[variant ?? 0] || FLOWER_BED_VARIANTS[0];
    return builder(footW, footL, totalH);
  }
  if (ITEM_BUILDERS[typeId]) return ITEM_BUILDERS[typeId](footW, footL, totalH);
  if (category === 'treesPlants') {
    if (totalH > 1.5) return _oakTree(footW, footL, totalH, seed);
  }
  if (typeId === 'shrub')         return _shrub(footW, footL, totalH, seed);
  if (category === 'treesPlants') return _shrub(footW, footL, totalH, seed);
  return _defaultBox(footW, footL, totalH);
}

// --- Public builder class -----------------------------------------------

export class DecorationBuilder {
  constructor() {
    /** @type {THREE.Group[]} */
    this._groups = [];
  }

  /**
   * Build a single decoration group from type + footprint dims (world units).
   */
  _buildOne(typeId, category, footW, footL, totalH, variant = 0, seed = 0) {
    return buildDecorationGroup(typeId, category, footW, footL, totalH, variant, seed);
  }

  /**
   * Create a ghost preview for placement. Looks up footprint from defs.
   * Ghost uses seed=0 so preview shows the nominal (unjittered) form.
   */
  _createGhost(typeId, placeable, variant = 0) {
    const raw = DECORATIONS_RAW[typeId];
    if (!raw) return null;
    const sw = raw.subW ?? 4;
    const sl = raw.subL ?? 4;
    const sh = raw.subH ?? 4;
    return buildDecorationGroup(typeId, raw.category, sw * SUB, sl * SUB, sh * SUB, variant, 0);
  }

  /**
   * Build decoration groups from snapshot data.
   * @param {Array} decorationData - Array of decoration objects from WorldSnapshot
   * @param {THREE.Group} parentGroup
   */
  build(decorationData, parentGroup) {
    this.dispose(parentGroup);
    if (!decorationData) return;

    for (const dec of decorationData) {
      const footW = (dec.subW ?? 4) * SUB;
      const footL = (dec.subL ?? 4) * SUB;
      const totalH = (dec.subH ?? 4) * SUB;
      const seed = _hashDecorationPos(dec.col ?? 0, dec.row ?? 0, dec.subCol ?? 0, dec.subRow ?? 0);

      const group = this._buildOne(dec.type, dec.category, footW, footL, totalH, dec.variant ?? 0, seed);

      const tileX = (dec.col ?? 0) * 2;
      const tileZ = (dec.row ?? 0) * 2;
      const subX = (dec.subCol ?? 0) * SUB;
      const subZ = (dec.subRow ?? 0) * SUB;
      // Center the geometry within the footprint; sit on terrain via dec.y.
      group.position.set(tileX + subX + footW / 2, dec.y ?? 0, tileZ + subZ + footL / 2);

      parentGroup.add(group);
      this._groups.push(group);
    }
  }

  /**
   * Remove all groups and dispose their geometry and materials.
   * @param {THREE.Group} parentGroup
   */
  dispose(parentGroup) {
    for (const group of this._groups) {
      parentGroup.remove(group);
      group.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    this._groups = [];
  }
}

// --- Thumbnail renderer --------------------------------------------------
// Same isometric ortho camera + rig used by component-builder.js for the
// build-menu palette, so decoration previews read identically to component
// previews. Static PNGs under assets/textures/thumbnails/ override the live
// render — bake them via gen-thumbnails.html for zero-cost palette loads.

const _staticDecorationThumbs = import.meta.glob(
  '/assets/textures/thumbnails/*.png',
  { eager: true, query: '?url', import: 'default' }
);
const _staticDecorationThumbMap = {};
for (const [p, v] of Object.entries(_staticDecorationThumbs)) {
  const id = p.split('/').pop().replace('.png', '');
  _staticDecorationThumbMap[id] = typeof v === 'string' ? v : (v && v.default) || v;
}

const _decThumbCache = new Map();
let _decThumbRenderer = null;
let _decThumbScene = null;
let _decThumbCamera = null;

function _getDecThumbRenderer(size) {
  if (!_decThumbRenderer) {
    _decThumbRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    _decThumbScene = new THREE.Scene();
    _decThumbScene.add(new THREE.AmbientLight(0xffffff, 1.05));
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(-5, 8, 4);
    _decThumbScene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.55);
    fill.position.set(6, 3, -4);
    _decThumbScene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.4);
    rim.position.set(0, -4, -2);
    _decThumbScene.add(rim);
    _decThumbCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  }
  _decThumbRenderer.setSize(size * 2, size * 2);
  _decThumbRenderer.setClearColor(0x000000, 0);
  return { renderer: _decThumbRenderer, scene: _decThumbScene, camera: _decThumbCamera };
}

/**
 * Render a decoration's 3D model to a data URL thumbnail. Returns null if
 * the typeId isn't a known decoration or THREE is unavailable.
 *
 * @param {string} typeId   Key in DECORATIONS_RAW (e.g. 'oakTree')
 * @param {number} [size=96]  Output PNG edge length in CSS pixels (rendered at 2x)
 * @param {number} [variant=0]  Variant index (flower bed color palette, etc.)
 * @returns {string|null} data: URL, static asset URL, or null
 */
export function renderDecorationThumbnail(typeId, size = 96, variant = 0) {
  const cacheKey = variant ? `${typeId}:${variant}` : typeId;
  // Static PNG override — only for default (variant 0) since baked thumbnails
  // don't carry variant info.
  if (!variant && _staticDecorationThumbMap[typeId]) return _staticDecorationThumbMap[typeId];
  if (typeof THREE === 'undefined') return null;
  if (_decThumbCache.has(cacheKey)) return _decThumbCache.get(cacheKey);

  const raw = DECORATIONS_RAW[typeId];
  if (!raw) return null;
  const sw = raw.subW ?? 4;
  const sl = raw.subL ?? 4;
  const sh = raw.subH ?? 4;
  const model = buildDecorationGroup(typeId, raw.category, sw * SUB, sl * SUB, sh * SUB, variant);
  if (!model) return null;

  const { renderer, scene, camera } = _getDecThumbRenderer(size);
  scene.add(model);

  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const bSize = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(bSize.x, bSize.y, bSize.z);
  const projW = (bSize.x + bSize.z) / Math.SQRT2;
  const projH = (bSize.x + 2 * bSize.y + bSize.z) / Math.sqrt(6);
  const halfFrame = Math.max(projW, projH) * 0.55;

  camera.left = -halfFrame;
  camera.right = halfFrame;
  camera.top = halfFrame;
  camera.bottom = -halfFrame;
  camera.updateProjectionMatrix();

  const isoDist = maxDim * 4;
  camera.position.set(center.x + isoDist, center.y + isoDist, center.z + isoDist);
  camera.lookAt(center);

  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');
  _decThumbCache.set(cacheKey, dataUrl);

  scene.remove(model);
  model.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  });

  return dataUrl;
}
