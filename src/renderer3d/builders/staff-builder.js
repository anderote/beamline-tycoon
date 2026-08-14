// src/renderer3d/builders/staff-builder.js
//
// Staff figurines — low-poly people, built from a STYLE config so the design
// itself is data.
//
// The current target is RollerCoaster Tycoon 2 peeps — `rct2Peep`, the default:
// chibi proportions (the head box alone is ~1/3.7 of the figure, and the hair
// on top takes the visual head to nearly a third of total height), a face as
// standard equipment, and the role color worn as a full uniform rather than
// hinted at with a collar sliver. Its palette is SAMPLED from the extracted
// RCT2 sprite sheets rather than guessed — see STAFF_PALETTES.rct2.
//
// The six variants before it explored an old-school RuneScape read (faceted
// low-segment limbs, boxy vs cylindrical, stubby vs lean, flat vs smooth
// shaded). They are kept exactly as they were: they are the record of what was
// considered, and the gallery still renders all seven side by side.
//
// Staff used to be flat camera-facing sprites with a hard black outline,
// reading as a completely different art style from the procedural BoxGeometry
// machines around them. These figurines live in the same 3D scene: the sun
// lights them, they cast the same shadows, and they turn with the
// free-orbiting camera instead of pivoting to face it.
//
// WHY A STYLE CONFIG: the exact point on the design axes (blocky vs faceted,
// stubby vs lean, flat vs smooth shaded, muted vs saturated, face vs no face,
// accent vs full uniform) is under review in the standalone gallery page
// `staff-foundry.html`, which renders every variant in STAFF_STYLES beside a
// real machine under the game's own lighting rig. Approving a variant means
// pointing DEFAULT_STAFF_STYLE at it — no other code changes, because
// StaffPawns only ever consumes the default and reads its colors through
// staffPalette(). Every number that defines the look lives in a style object
// or its palette; nothing visual is hardcoded below.
//
// Deliberately NOT the machine material language:
//   - flat-shaded (by default) solid color at roughness 1.0, metalness 0,
//     against the machines' tiled/textured PBR surfaces,
//   - no material maps, no decals, no per-face material arrays anywhere. A
//     face is a few tiny geometry dabs, not a texture — a dab keeps its
//     silhouette at 30px where a texture would smear,
//   - no outline of any kind.
//
// Conventions:
//   - Origin at the FEET: y = 0 is the sole, +Y up. Callers set the group's
//     position straight to ground level with no half-height fudge.
//   - Front is +Z. A figure with rotation.y = 0 looks down +Z, so a caller
//     aiming at direction (dx, dz) wants rotation.y = atan2(dx, dz)
//     (rotating +Z by θ about Y gives (sin θ, 0, cos θ)).
//   - Total height is style.height world units; a tile is 2 units.
//   - Limb geometries are pre-translated so their origin sits at the
//     shoulder/hip/knee joint; the mesh is then placed AT the joint. Rotating
//     the mesh about X swings the limb from that joint. Hands and feet are
//     CHILDREN of their limb, so they swing with it for free. The leg is two
//     segments: leftLeg/rightLeg is the thigh (pivots at the hip, as before),
//     leftShin/rightShin is a CHILD of it pivoting at the knee, and the foot
//     is a child of the shin. At rotation 0 the knee is a no-op — the thigh
//     and shin together span exactly the old single-piece leg.
//   - Geometries and materials are cached at module level (the _partMatCache
//     idiom from equipment-builder.js) and keyed on their own dimensions and
//     colors, so variants share whatever they have in common and a 25-person
//     crowd shares a handful of geometries. Per-figure teardown must NOT touch
//     them — see disposeStaffFigure.
//
// THREE is a CDN global — do NOT import it.

// ── Style config ─────────────────────────────────────────────────────

/**
 * @typedef {object} StaffStyle
 * @property {string} id
 * @property {string} name          short label for the gallery
 * @property {string} note          one line: what this variant is testing
 * @property {number} height        total height, world units (tile = 2)
 * @property {number} headRatio     head height / total height (0.24 ≈ 4.2 heads)
 * @property {number} legFrac       legs' share of (body minus head minus feet);
 *                                  lower = stubbier, higher = leaner
 * @property {'cylinder'|'box'} limbGeometry
 * @property {number} radialSegments  facet count for cylinder limbs (6 = OSRS)
 * @property {number} limbTaper     bottom radius / top radius
 * @property {number} limbThickness  multiplier on limb girth
 * @property {'prism'|'box'} torsoShape
 * @property {number} torsoSegments facet count for a prism torso
 * @property {number} torsoTaper    waist radius / shoulder radius
 * @property {number} bulk          multiplier on torso girth
 * @property {number} extremityScale hand/foot size multiplier (OSRS = big)
 * @property {boolean} flatShading
 * @property {number} roughness
 * @property {number} saturation    palette saturation multiplier (1 = as authored)
 * @property {number} swingAmp      walk swing amplitude, radians
 * @property {boolean} face         draw a minimal two-dab face
 * @property {number} faceScale     multiplier on eye/mouth size and spacing
 * @property {boolean} mouth        add a mouth dab below the eyes (needs face)
 * @property {string} [eyeColor]    override the palette's eye color
 * @property {keyof STAFF_PALETTES} palette  which color set the look is drawn from
 * @property {boolean} roleUniform  paint the role color over the whole torso and
 *                                  arms (RCT2-style uniform) instead of using it
 *                                  only as a collar accent
 */

/** Baseline every variant starts from; variants override a few fields. */
const BASE_STYLE = {
  height: 1.35,
  headRatio: 0.237,
  legFrac: 0.435,
  limbGeometry: 'cylinder',
  radialSegments: 6,
  limbTaper: 0.76,
  limbThickness: 1.0,
  torsoShape: 'prism',
  torsoSegments: 6,
  torsoTaper: 0.76,
  bulk: 1.0,
  extremityScale: 1.0,
  flatShading: true,
  roughness: 1.0,
  saturation: 1.0,
  swingAmp: 0.75,
  face: false,
  faceScale: 1,
  mouth: false,
  palette: 'titleScreen',
  roleUniform: false,
};

function defineStyle(id, name, note, over) {
  return Object.freeze({ ...BASE_STYLE, id, name, note, ...over });
}

/**
 * The variant set under review. Six genuinely different answers rather than
 * six near-identical figures, so the comparison is informative.
 */
export const STAFF_STYLES = {
  osrsClassic: defineStyle(
    'osrsClassic', 'OSRS Classic',
    'The reference read: 6-facet tapered limbs, flat-shaded, big head, oversized hands and feet.',
    {},
  ),
  blockyMinifig: defineStyle(
    'blockyMinifig', 'Blocky Minifig',
    'All boxes, zero cylinders — tests whether the facets matter at all, or whether pure boxes read better beside boxy machines.',
    { limbGeometry: 'box', torsoShape: 'box', extremityScale: 1.1 },
  ),
  leanFaceted: defineStyle(
    'leanFaceted', 'Lean Faceted',
    'Same faceted build stretched to ~5 heads with longer legs — tests whether stubbiness or the flat shading is doing the work.',
    { headRatio: 0.20, legFrac: 0.50, limbThickness: 0.85, bulk: 0.92, extremityScale: 0.85 },
  ),
  smoothSoft: defineStyle(
    'smoothSoft', 'Smooth Soft',
    '12-segment smooth-shaded limbs at roughness 0.7 — tests dropping the flat-shading tell while keeping the shape.',
    { radialSegments: 12, torsoSegments: 12, flatShading: false, roughness: 0.7 },
  ),
  boldToon: defineStyle(
    'boldToon', 'Bold Toon',
    'Classic build with a punched-up palette and even bigger extremities — tests whether the muted colors under-read at 30px.',
    { saturation: 1.5, extremityScale: 1.25, bulk: 1.08, swingAmp: 0.9 },
  ),
  facedScout: defineStyle(
    'facedScout', 'Faced Scout',
    'Classic build plus a minimal two-dab face — tests whether any face at all reads as charming or turns creepy at final scale.',
    { face: true },
  ),
  rct2Peep: defineStyle(
    'rct2Peep', 'RCT2 Peep',
    'RollerCoaster Tycoon 2 peeps: chibi 3.7-head proportions, a face as standard, and the role color worn as a full uniform. Palette sampled from the actual RCT2 sprites.',
    {
      headRatio: 0.27,        // chibi: head box is ~1/3.7 of the figure, and the
      legFrac: 0.38,          // hair cap on top pushes the visual head to ~1/3
      bulk: 1.08,
      extremityScale: 1.25,
      // 1.25, not 1.5: the rct2 palette is sampled from RCT2 sprites that are
      // already at RCT2 saturation, so a 1.5x multiplier pushes past the source
      // material. Measured against the rfCavity in the in-context render, 1.5
      // put the figures at mean S 0.64 with 59% of chromatic pixels above 0.6,
      // versus the machine's 0.60 / 43% — same average, far more near-maximum
      // area, which is what read as pasted-on. 1.25 lands at parity (~0.57)
      // while keeping a deliberate pop.
      saturation: 1.25,
      swingAmp: 0.9,
      face: true,
      faceScale: 1.4,         // a chibi head needs chibi features, not pinpricks
      mouth: true,
      palette: 'rct2',
      roleUniform: true,
    },
  ),
};

/** Ordered list for the gallery UI. */
export const STAFF_STYLE_LIST = Object.values(STAFF_STYLES);

/**
 * The style StaffPawns renders. Approving a gallery variant = repointing this.
 * @type {StaffStyle}
 */
export const DEFAULT_STAFF_STYLE = STAFF_STYLES.rct2Peep;

/** Total figure height for a style (feet at y=0, top of headwear at this y). */
export function staffFigureHeight(style = DEFAULT_STAFF_STYLE) {
  return style.height;
}

/**
 * World-space Y of the hip joint (feet at y=0), so a caller can drop a
 * sitting figure onto a chair's seat height by raising the whole group —
 * the builder itself never moves parts to fake a seat; see POSES.sit.
 */
export function staffStyleHipHeight(style = DEFAULT_STAFF_STYLE) {
  return _proportions(style).hipY;
}

// ── Palettes ─────────────────────────────────────────────────────────
// A palette is every color a figure can be made of, minus the per-staff random
// choice. Styles name one; the builder and its callers read it through
// staffPalette() so a variant's look stays entirely in this file.
//
// `rct2` is sampled, not eyeballed: every value below was read out of the
// extracted RCT2 sprite sheets in assets/rct2-extracted/ by histogramming the
// opaque pixels of individual sprites, split into head/torso/leg bands so skin
// could be told apart from uniform. Sources are noted per entry. RCT2's ramps
// are the giveaway — near-fully-saturated highlights falling to a cool
// teal-grey shadow rather than to black, which is why the boots and darks here
// are #3f5353 and #172323 instead of neutral browns.

export const STAFF_PALETTES = {
  // The original title-screen palette (TitleScreen._drawPerson). Unchanged —
  // the six pre-RCT2 variants render exactly as they did.
  titleScreen: {
    skins: ['#d8a878', '#b0784f', '#e8c9a2'],
    hairs: ['#3a2e28', '#6e6e78', '#8a5a2e', '#1e1e28'],
    coats: ['#c6c8d4', '#b7bcca', '#c9c5b4'],
    hardHat: '#c9a733',
    boot: '#3a3128',
    eye: '#241f1a',
    roles: {
      operator:   { collar: '#3d7dd8', trouser: '#2c4470', hardHat: false },
      technician: { collar: '#e08a2e', trouser: '#6e4522', hardHat: true },
      scientist:  { collar: '#8a5fd0', trouser: '#463462', hardHat: false },
      engineer:   { collar: '#3aa864', trouser: '#25503a', hardHat: true },
      // Placeholders — Plan 4 replaces this whole block with real outfits.
      // Just needs to read as distinct from the four above.
      machinist:  { collar: '#607d8b', trouser: '#37474f', hardHat: true },
      admin:      { collar: '#c9a733', trouser: '#7a6224', hardHat: false },
    },
  },

  rct2: {
    // Flesh ramp from the head band of peep_handyman_sheet.png.
    skins: ['#d79773', '#cf8363', '#a76343'],
    // Hair / dark ramp shared across mechanic_walk_5x.png and staff_walking.png.
    hairs: ['#4f2b13', '#63371b', '#172323', '#8b573b'],
    // RCT2's "white" is a cool near-white, not a neutral grey
    // (peep_staff_sheet.png leg band, entertainer_5x.png).
    coats: ['#eff3f3', '#d3dbdb', '#b7c3c3'],
    // Hard-hat yellow from the yellow ramp in peep_staff_sheet.png.
    hardHat: '#f3cb1b',
    // RCT2 shadows land on teal-grey, never on brown-black. Trousers and boots
    // both come off this ramp: with the role color worn on the torso, the legs
    // have to drop to a dark neutral or the figure reads as one unbroken
    // colored column from collar to floor.
    boot: '#233333',
    eye: '#172323',
    // Uniform hues harvested from the saturated garment mid-tones across
    // peeps_real_sheet.png and peeps_group4/5/6 (S>0.55, 0.28<L<0.68). Hue
    // assignments keep each role's existing identity color family, so nothing
    // else in the UI has to move.
    // `collar` is the uniform color under roleUniform — the whole torso and
    // both arms. Trousers are deliberately the SAME teal-grey for every role:
    // RCT2 puts the identity in one garment, and a second role-tinted garment
    // just muddies the read at 30px.
    roles: {
      operator:   { collar: '#2b67df', trouser: '#3f5353', hardHat: false }, // blue bucket
      technician: { collar: '#db4f00', trouser: '#3f5353', hardHat: true },  // orange bucket
      scientist:  { collar: '#6b2b9b', trouser: '#3f5353', hardHat: false }, // purple bucket
      engineer:   { collar: '#47af27', trouser: '#3f5353', hardHat: true },  // green bucket
      // Placeholders sampled from the same sheets — Plan 4 replaces this
      // whole block with real outfits. Just needs to read as distinct from
      // the four above (machinist vs. engineer in particular).
      machinist:  { collar: '#5c7a8a', trouser: '#3f5353', hardHat: true },  // steel-grey bucket
      admin:      { collar: '#c9a733', trouser: '#3f5353', hardHat: false }, // gold bucket
    },
  },
};

/**
 * The palette a style draws its colors from.
 * @param {StaffStyle} [style]
 */
export function staffPalette(style = DEFAULT_STAFF_STYLE) {
  return STAFF_PALETTES[style.palette] || STAFF_PALETTES.titleScreen;
}

// ── Derived proportions ──────────────────────────────────────────────
// All linear dimensions are fractions of style.height so a variant can change
// scale without re-tuning every constant. The ratios below are the tuned
// OSRS-ish figure; style fields bend them.

const _propCache = new Map();

// The knee sits at the midpoint of the leg — thigh and shin split the leg's
// length and radius taper evenly. At rotation 0 they are collinear and span
// exactly what the old single-piece leg did, so the knee is a no-op at rest.
const KNEE_FRAC = 0.5;

function _proportions(style) {
  let p = _propCache.get(style);
  if (p) return p;
  const H = style.height;
  const ext = style.extremityScale;
  const fs = style.faceScale ?? 1;

  const headH = H * style.headRatio;
  const capH = H * 0.059;                       // hair cap / hard-hat crown
  const footH = H * 0.059 * ext;
  const rest = H - headH - capH - footH;        // legs + torso
  const legLen = rest * style.legFrac;
  const torsoH = rest - legLen;

  const legRTop = H * 0.063 * style.limbThickness;
  const armRTop = H * 0.046 * style.limbThickness;
  const torsoRTop = H * 0.152 * style.bulk;

  const hipY = footH + legLen;
  const torsoTop = hipY + torsoH;

  p = {
    H,
    headH, headW: headH * 0.94, headD: headH * 0.90,
    capH,
    brimH: H * 0.026, brimPad: H * 0.096,
    footH, footW: H * 0.119 * ext, footD: H * 0.178 * ext, footFwd: H * 0.030 * ext,
    legLen, legRTop, legRBot: legRTop * style.limbTaper, legGap: H * 0.063,
    // Thigh (hip -> knee) and shin (knee -> foot) split the leg at the knee.
    thighLen: legLen * KNEE_FRAC, shinLen: legLen * (1 - KNEE_FRAC),
    kneeR: legRTop + (legRTop * style.limbTaper - legRTop) * KNEE_FRAC,
    torsoH, torsoRTop, torsoRBot: torsoRTop * style.torsoTaper,
    collarH: H * 0.044, collarR: torsoRTop + H * 0.019,
    armLen: legLen * 0.95, armRTop, armRBot: armRTop * style.limbTaper,
    armX: torsoRTop + armRTop - H * 0.015,
    handW: H * 0.074 * ext, handH: H * 0.067 * ext, handD: H * 0.074 * ext,
    hipY, torsoTop,
    shoulderY: torsoTop - H * 0.037,
    headTop: torsoTop + headH,
    // Face features scale with the HEAD, not the figure, so a chibi variant
    // gets proportionally chibi eyes instead of pinpricks. The divisor is the
    // baseline headRatio, which makes these algebraically identical to the
    // old `H * k` form for any style at headRatio 0.237 and faceScale 1 —
    // facedScout is untouched by the change.
    faceW: headH * (0.033 / 0.237) * fs,
    faceH: headH * (0.026 / 0.237) * fs,
    faceD: headH * (0.015 / 0.237),
    faceX: headH * (0.052 / 0.237) * fs,
    mouthW: headH * 0.22 * fs, mouthH: headH * 0.055 * fs,
    mouthY: -headH * 0.20,
  };
  _propCache.set(style, p);
  return p;
}

// ── Shared geometry / material caches ────────────────────────────────

const _geoCache = new Map();
const _matCache = new Map();

const r3 = (n) => Math.round(n * 1000) / 1000;   // stable cache keys

/**
 * Shared BoxGeometry. `pivot` picks where the geometry's origin sits:
 *   'center' — the BoxGeometry default,
 *   'top'    — origin at the top face, so the box hangs downward from it.
 */
function _boxGeo(w, h, d, pivot = 'center') {
  const key = `b|${r3(w)}|${r3(h)}|${r3(d)}|${pivot}`;
  let g = _geoCache.get(key);
  if (g) return g;
  g = new THREE.BoxGeometry(w, h, d);
  if (pivot === 'top') g.translate(0, -h / 2, 0);
  _geoCache.set(key, g);
  return g;
}

/**
 * Shared low-segment tapered cylinder — a faceted prism at 6 segments, a
 * recognisable tube at 12. `thetaStart = PI/segs` rotates it so a flat facet
 * faces +Z (three puts a vertex at +Z when thetaStart is 0), which keeps the
 * chest and shins reading as flat planes head-on.
 */
function _prismGeo(rTop, rBot, h, segs, pivot = 'center') {
  const thetaStart = Math.PI / segs;
  const key = `c|${r3(rTop)}|${r3(rBot)}|${r3(h)}|${segs}|${pivot}`;
  let g = _geoCache.get(key);
  if (g) return g;
  g = new THREE.CylinderGeometry(rTop, rBot, h, segs, 1, false, thetaStart, Math.PI * 2);
  if (pivot === 'top') g.translate(0, -h / 2, 0);
  _geoCache.set(key, g);
  return g;
}

/**
 * A limb segment honoring style.limbGeometry: a faceted prism, or a box of
 * equivalent girth for the all-box variants. Origin at the top (the joint).
 */
function _limbGeo(style, rTop, rBot, len) {
  if (style.limbGeometry === 'box') {
    return _boxGeo(rTop * 1.85, len, rTop * 1.7, 'top');
  }
  return _prismGeo(rTop, rBot, len, style.radialSegments, 'top');
}

function _torsoGeo(style, p) {
  if (style.torsoShape === 'box') {
    return _boxGeo(p.torsoRTop * 1.85, p.torsoH, p.torsoRTop * 1.35);
  }
  return _prismGeo(p.torsoRTop, p.torsoRBot, p.torsoH, style.torsoSegments);
}

/**
 * Pull a CSS color through the style's saturation multiplier. Returns the
 * input untouched when THREE.Color is unavailable (node test stubs) or the
 * multiplier is 1.
 */
function _tint(color, saturation) {
  if (saturation === 1 || typeof THREE.Color !== 'function') return color;
  try {
    const c = new THREE.Color(color);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(hsl.h, Math.min(1, hsl.s * saturation), hsl.l);
    return `#${c.getHexString()}`;
  } catch {
    return color;
  }
}

/** Shared solid-color material — cloth and skin, never metal. */
function _figureMaterial(color, style) {
  const tinted = _tint(color, style.saturation);
  const key = `${tinted}|${style.flatShading ? 1 : 0}|${r3(style.roughness)}`;
  let m = _matCache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    color: tinted,
    roughness: style.roughness,
    metalness: 0,
    flatShading: style.flatShading,
  });
  _matCache.set(key, m);
  return m;
}

function _mesh(geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;      // receiveShadow stays off: figures are small and
                            // self-shadowing just muddies them at this scale.
  m.position.set(x, y, z);
  return m;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * @typedef {object} StaffLook
 * @property {string} skin        skin tone (CSS color) — head and hands
 * @property {string} hair        hair color (CSS color)
 * @property {boolean} [longHair] adds side panels down the head
 * @property {string} coat        lab-coat / torso + arms color
 * @property {string} collar      role accent — the collar band
 * @property {string} trouser     role trouser tint — the legs
 * @property {boolean} [hardHat]  swap the hair cap for a hard hat (cap + brim)
 * @property {number} [heightScale] uniform scale, e.g. 0.96–1.04 crowd jitter
 */

/**
 * @typedef {object} StaffFigure
 * @property {THREE.Group} group    outer node — position/rotate this. Feet at y=0.
 * @property {THREE.Group} body     inner node — carries the walk bob (y offset).
 * @property {THREE.Mesh} head
 * @property {THREE.Mesh} torso
 * @property {THREE.Mesh} leftArm   rotate .rotation.x to swing from the shoulder
 * @property {THREE.Mesh} rightArm
 * @property {THREE.Mesh} leftLeg   the thigh — rotate .rotation.x to swing from the hip
 * @property {THREE.Mesh} rightLeg
 * @property {THREE.Mesh} leftShin  child of leftLeg — rotate .rotation.x to swing from the knee
 * @property {THREE.Mesh} rightShin child of rightLeg
 * @property {THREE.Mesh[]} parts   every mesh, in build order (hands/feet included)
 * @property {StaffStyle} style     the style it was built from
 */

/**
 * Build one staff figurine.
 * @param {StaffLook} look
 * @param {StaffStyle} [style] defaults to DEFAULT_STAFF_STYLE
 * @returns {StaffFigure}
 */
export function buildStaffFigure(look, style = DEFAULT_STAFF_STYLE) {
  const p = _proportions(style);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const pal = staffPalette(style);

  // RCT2 identifies staff by uniform color across a crowded park; a collar
  // sliver does not survive to 30px. With roleUniform the role color becomes
  // the whole torso and both arms, and the lab coat is demoted to a yoke over
  // the shoulders — still a lab, but the role is legible at a glance.
  const uniform = !!style.roleUniform;
  const bodyColor = uniform ? look.collar : look.coat;

  const skinMat = _figureMaterial(look.skin, style);
  const coatMat = _figureMaterial(look.coat, style);
  const bodyMat = uniform ? _figureMaterial(bodyColor, style) : coatMat;
  const trouserMat = _figureMaterial(look.trouser, style);
  const parts = [];
  const add = (mesh, parent) => { (parent || body).add(mesh); parts.push(mesh); return mesh; };

  // Legs — origin at the hip so rotation.x swings the thigh. The shin is a
  // CHILD of the thigh, its own origin at the knee, so rotating it swings the
  // calf from there; the boot is a child of the shin so it swings with the
  // true foot joint instead of the hip. At rotation 0 the two segments are
  // collinear and span exactly the old single-piece leg — the knee is a
  // geometric no-op at rest.
  const thighGeo = _limbGeo(style, p.legRTop, p.kneeR, p.thighLen);
  const shinGeo = _limbGeo(style, p.kneeR, p.legRBot, p.shinLen);
  const footGeo = _boxGeo(p.footW, p.footH, p.footD);
  const bootMat = _figureMaterial(pal.boot, style);
  const legs = [];
  const shins = [];
  for (const side of [-1, 1]) {
    const leg = add(_mesh(thighGeo, trouserMat, side * p.legGap, p.hipY, 0));
    const shin = add(_mesh(shinGeo, trouserMat, 0, -p.thighLen, 0), leg);
    // Foot in shin-local space: the shin hangs to -shinLen, the boot sits
    // under it, so the sole lands at world y = 0 exactly (hipY - thighLen -
    // shinLen - footH/2 = hipY - legLen - footH/2 = 0, since hipY = footH +
    // legLen).
    add(_mesh(footGeo, bootMat, 0, -(p.shinLen + p.footH / 2), p.footFwd), shin);
    legs.push(leg);
    shins.push(shin);
  }

  // Torso — narrow at the waist, broad at the shoulders.
  const torso = add(_mesh(
    _torsoGeo(style, p), bodyMat,
    0, p.hipY + p.torsoH / 2, 0,
  ));

  // Collar band, slightly proud of the shoulders so it reads from the front
  // AND from either side.
  //
  // Without a uniform this band IS the role tell, so it wears the role color
  // over a neutral coat. With one, the roles are already unmistakable from the
  // torso, so the band flips to the lab-coat color: a thin white collar under
  // the chin that separates head from body and keeps the "lab" read, without
  // spending any of the silhouette on white. An earlier pass put a full white
  // yoke over the shoulders here and it read as a bib, not a coat.
  add(_mesh(
    _prismGeo(p.collarR, p.collarR, p.collarH, style.torsoSegments),
    uniform ? coatMat : _figureMaterial(look.collar, style),
    0, p.torsoTop - p.collarH / 2, 0,
  ));

  // Arms — origin at the shoulder, oversized boxy hand parented to each.
  const armGeo = _limbGeo(style, p.armRTop, p.armRBot, p.armLen);
  const handGeo = _boxGeo(p.handW, p.handH, p.handD);
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = add(_mesh(armGeo, bodyMat, side * p.armX, p.shoulderY, 0));
    add(_mesh(handGeo, skinMat, 0, -(p.armLen + p.handH / 2), 0), arm);
    arms.push(arm);
  }

  // Head — always blocky; RS heads are chunky boxes in a single flat color.
  const headY = p.torsoTop + p.headH / 2;
  const head = add(_mesh(_boxGeo(p.headW, p.headH, p.headD), skinMat, 0, headY, 0));

  // Face: geometry dabs proud of the +Z face. Never a texture — these
  // characters are untextured, and a dab keeps its silhouette when the figure
  // collapses to a handful of pixels, which is exactly when a face texture
  // would turn to mud.
  if (style.face) {
    const dabMat = _figureMaterial(style.eyeColor || pal.eye, style);
    const eyeGeo = _boxGeo(p.faceW, p.faceH, p.faceD);
    for (const side of [-1, 1]) {
      // Head-local space: the dab straddles the +Z face, eyes a little high.
      add(_mesh(eyeGeo, dabMat,
        side * p.faceX, p.headH * 0.10, p.headD / 2), head);
    }
    if (style.mouth) {
      add(_mesh(_boxGeo(p.mouthW, p.mouthH, p.faceD), dabMat,
        0, p.mouthY, p.headD / 2), head);
    }
  }

  // Headwear. Both variants top out at exactly style.height, so role never
  // changes the silhouette height.
  if (look.hardHat) {
    const hatMat = _figureMaterial(pal.hardHat, style);
    add(_mesh(_boxGeo(p.headW - p.H * 0.037, p.capH, p.headD - p.H * 0.037), hatMat,
      0, p.headTop + p.capH / 2, 0));
    add(_mesh(_boxGeo(p.headW + p.brimPad, p.brimH, p.headD + p.brimPad), hatMat,
      0, p.headTop - p.brimH / 2, 0));
  } else {
    const hairMat = _figureMaterial(look.hair, style);
    add(_mesh(_boxGeo(p.headW + 0.01, p.capH, p.headD + 0.01), hairMat,
      0, p.headTop + p.capH / 2, 0));
    if (look.longHair) {
      const sideGeo = _boxGeo(0.03, p.headH * 0.7, p.headD + 0.01);
      const sideY = p.headTop - p.headH * 0.35;
      for (const side of [-1, 1]) {
        add(_mesh(sideGeo, hairMat, side * (p.headW / 2 + 0.005), sideY, 0));
      }
    }
    // Back of the head is hair too — cheap, and stops the back reading
    // identically to the front.
    add(_mesh(_boxGeo(p.headW + 0.01, p.headH * 0.8, 0.03), hairMat,
      0, p.headTop - p.headH * 0.4, -(p.headD / 2 + 0.005)));
  }

  const scale = look.heightScale ?? 1;
  if (scale !== 1) group.scale.setScalar(scale);

  return {
    group, body, head, torso,
    leftArm: arms[0], rightArm: arms[1],
    leftLeg: legs[0], rightLeg: legs[1],
    leftShin: shins[0], rightShin: shins[1],
    parts, style,
  };
}

// ── Poses ────────────────────────────────────────────────────────────
// A pose is a plain description of where each joint eases toward — not an
// animation, just a target. StaffPawns (or the foundry) calls applyPose()
// every frame with the elapsed time, and the figure eases toward whatever
// pose is current.
//
// walk's targets are identical to stand's (all zero): the walk swing is
// driven separately (StaffPawns._animate composes amp*sin(phase) onto the
// hip/knee), and it composes cleanly on top of a zero baseline instead of
// fighting it. The same baseline-then-compose approach is what lets a
// walking pawn ease into 'sit' without a discontinuity.

/**
 * @typedef {object} StaffPose
 * @property {number} hip        thigh pivot, radians (+ leans the thigh forward)
 * @property {number} knee       shin pivot, radians, relative to the thigh
 * @property {number} torsoLean  torso pivot, radians
 * @property {number} armL       left shoulder pivot, radians
 * @property {number} armR       right shoulder pivot, radians
 * @property {number} headTilt   head pivot, radians
 */

/** @type {Record<string, StaffPose>} */
export const POSES = {
  stand: { hip: 0, knee: 0, torsoLean: 0, armL: 0, armR: 0, headTilt: 0 },
  // Swing composes on top of this in the walk driver — see note above.
  walk: { hip: 0, knee: 0, torsoLean: 0, armL: 0, armR: 0, headTilt: 0 },
  // Thigh horizontal, shin vertical: hip forward ~90°, knee back ~90°
  // relative to the thigh so the two rotations cancel and the shin hangs
  // straight down again, same as standing.
  sit: { hip: Math.PI / 2, knee: -Math.PI / 2, torsoLean: 0, armL: 0, armR: 0, headTilt: 0 },
  // Seated at a console: same leg fold as sit, leaning in toward the desk
  // with both hands forward on a keyboard/panel.
  deskWork: {
    hip: Math.PI / 2, knee: -Math.PI / 2,
    torsoLean: 0.25, armL: -0.9, armR: -0.9, headTilt: 0.2,
  },
  // Standing at a bench, bent over close work: legs planted, torso and head
  // pitched down, arms in front working with both hands.
  benchWork: { hip: 0, knee: 0.12, torsoLean: 0.5, armL: -1.05, armR: -1.05, headTilt: 0.35 },
  // Carrying a load in both arms, held out and slightly up in front.
  carry: { hip: -0.08, knee: 0.18, torsoLean: 0.12, armL: -1.3, armR: -1.3, headTilt: 0 },
  // Leaning into a cart or panel with both hands, weight forward.
  push: { hip: 0, knee: 0, torsoLean: 0.45, armL: -0.6, armR: -0.6, headTilt: 0 },
};

const POSE_JOINTS = ['hip', 'knee', 'torsoLean', 'armL', 'armR', 'headTilt'];

// Seconds to ease ~63% of the way to a pose target — the same time-constant
// idiom as StaffPawns' TURN_TAU/SWING_TAU.
const POSE_TAU = 0.15;

/**
 * Ease a figure's joints toward a named pose's targets and apply the result.
 * `t` is the frame's elapsed seconds (dt); the ease uses the same
 * `1 - Math.exp(-dt / TAU)` idiom StaffPawns._animate already uses for
 * turn/swing damping. Per-figure state persists on `figure._pose` between
 * calls (starting at 'stand', i.e. rest) so repeated calls pick up where the
 * last one left off instead of snapping.
 * @param {StaffFigure} figure
 * @param {keyof typeof POSES} poseId
 * @param {number} t elapsed seconds this frame
 * @returns {StaffPose} the eased state actually applied
 */
export function applyPose(figure, poseId, t) {
  const target = POSES[poseId] || POSES.stand;
  const state = figure._pose || (figure._pose = { ...POSES.stand });
  const k = 1 - Math.exp(-t / POSE_TAU);
  for (const joint of POSE_JOINTS) state[joint] += (target[joint] - state[joint]) * k;

  figure.leftLeg.rotation.x = state.hip;
  figure.rightLeg.rotation.x = state.hip;
  figure.leftShin.rotation.x = state.knee;
  figure.rightShin.rotation.x = state.knee;
  figure.leftArm.rotation.x = state.armL;
  figure.rightArm.rotation.x = state.armR;
  figure.torso.rotation.x = state.torsoLean;
  figure.head.rotation.x = state.headTilt;
  return state;
}

/**
 * Per-figure teardown. Geometries and materials are module-level shared
 * caches — a figure owns NOTHING disposable of its own, so this only detaches
 * it and drops the part references. Kept as a named entry point so callers
 * never reach for geometry.dispose() and quietly blank out every other pawn
 * on screen.
 * @param {StaffFigure} figure
 */
export function disposeStaffFigure(figure) {
  if (!figure) return;
  const { group } = figure;
  if (group && group.parent) group.parent.remove(group);
  if (Array.isArray(figure.parts)) figure.parts.length = 0;
}
