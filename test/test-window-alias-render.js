// test/test-window-alias-render.js — regression coverage for the window
// edge-alias bug in wall-builder.js.
//
// Edges have two equivalent representations — (5,3,'s') and (5,4,'n') name
// the same physical tile edge. Game.placeWindow accepts a wall found under
// EITHER representation and stores the window under whichever triple the
// caller passed, so a wall recorded at (5,3,'s') can carry a window recorded
// at (5,4,'n'). WallBuilder.build() used to key its opening skip-set
// (openingEdgeSet) and its wallTypeByEdge lookup on the exact "col,row,edge"
// triple only, so a crossed pair like that used to:
//   1. NOT skip the wall from the main render loop (the exact key wasn't in
//      openingEdgeSet) -> a full-height slab rendered straight across the
//      glass.
//   2. Fail the wallTypeByEdge lookup in _buildWindows -> the opening
//      surround fell back to DEFAULT_WALL_HEIGHT/DEFAULT_WALL_THICKNESS in
//      the untextured grey `__default` material, z-fighting the real wall.
//
// The fix (wall-builder.js:39-44, ~149-156, ~587-588) added _edgeAliasKey(),
// put BOTH representations of a window edge into openingEdgeSet, and gave
// the wallTypeByEdge lookup in _buildWindows a `?? _edgeAliasKey(...)`
// fallback. Doors deliberately stay on the exact key (see build()'s
// comment) so this file only exercises windows.
//
// THREE is a CDN global (see wall-builder.js's header) and its import chain
// (materials/tiled.js, materials/decals.js) constructs a THREE.TextureLoader
// and touches `document` at module scope, so both must be stubbed before the
// dynamic import — same pattern as
// test/test-convergence-regressions-2.js ("Wall merge requires a constant
// slope") but with concrete classes (not a Generic proxy) so we can inspect
// geometry.parameters and material.map/color to tell a real wall's surround
// apart from the untextured __default fallback.

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// --- Minimal THREE stub -----------------------------------------------
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
}

class BufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = array.length / itemSize;
    this.needsUpdate = false;
  }
  getX(i) { return this.array[i * this.itemSize]; }
  setX(i, v) { this.array[i * this.itemSize] = v; }
}

// Real geometry precision doesn't matter for these assertions (nothing here
// checks baked vertex positions) — only .parameters (width/height/depth,
// exactly like real THREE.BoxGeometry exposes) and having position/uv
// attributes so wall-builder's vertex-baking loop and applyTiledBoxUVs run
// without throwing.
class BoxGeometry {
  constructor(width = 1, height = 1, depth = 1) {
    this.parameters = { width, height, depth };
    const w = width / 2, h = height / 2, d = depth / 2;
    const faces = [
      [[w, h, -d], [w, h, d], [w, -h, -d], [w, -h, d]],
      [[-w, h, d], [-w, h, -d], [-w, -h, d], [-w, -h, -d]],
      [[-w, h, -d], [w, h, -d], [-w, h, d], [w, h, d]],
      [[-w, -h, d], [w, -h, d], [-w, -h, -d], [w, -h, -d]],
      [[-w, h, d], [w, h, d], [-w, -h, d], [w, -h, d]],
      [[w, h, -d], [-w, h, -d], [w, -h, -d], [-w, -h, -d]],
    ];
    const posArr = new Float32Array(24 * 3);
    let idx = 0;
    for (const face of faces) for (const v of face) {
      posArr[idx * 3] = v[0]; posArr[idx * 3 + 1] = v[1]; posArr[idx * 3 + 2] = v[2];
      idx++;
    }
    this.attributes = {
      position: new BufferAttribute(posArr, 3),
      uv: new BufferAttribute(new Float32Array(24 * 2), 2),
    };
  }
  computeVertexNormals() {}
  computeBoundingBox() {}
  computeBoundingSphere() {}
  dispose() {}
  clone() {
    const c = new BoxGeometry(this.parameters.width, this.parameters.height, this.parameters.depth);
    return c;
  }
}

class MeshStandardMaterial {
  constructor(opts = {}) { Object.assign(this, opts); this.isMeshStandardMaterial = true; }
  dispose() { this.disposed = true; }
}

class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.position = new Vector3();
    this.castShadow = false;
    this.receiveShadow = false;
    this.renderOrder = 0;
    this.matrixAutoUpdate = true;
    this.layers = { enabled: new Set([0]), enable(layer) { this.enabled.add(layer); } };
  }
  updateMatrix() {}
}

class TextureLoader {
  load(path) {
    return { path, wrapS: null, wrapT: null, magFilter: null, minFilter: null, colorSpace: null, generateMipmaps: null };
  }
}

class CanvasTexture {
  constructor(canvas) { this.canvas = canvas; }
}

const THREE_IMPL = {
  Vector3, BoxGeometry, MeshStandardMaterial, Mesh, TextureLoader, CanvasTexture,
  DoubleSide: 'DoubleSide', FrontSide: 'FrontSide',
  RepeatWrapping: 'RepeatWrapping', ClampToEdgeWrapping: 'ClampToEdgeWrapping',
  NearestFilter: 'NearestFilter', LinearFilter: 'LinearFilter',
  SRGBColorSpace: 'SRGBColorSpace',
};
globalThis.THREE = new Proxy(THREE_IMPL, {
  get: (target, prop) => (prop in target ? target[prop] : class Generic {
    constructor() {} set() { return this; } dispose() {}
  }),
});

// document stub for materials/decals.js's gen_radialDot (module-scope canvas
// texture generation) — same pattern as test-convergence-regressions-2.js.
const ctx = new Proxy({}, { get: () => () => ctx });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
};

const {
  WallBuilder, TILE_SIZE, HEIGHT_SCALE, _edgeAliasKey, windowOpeningLayout,
} = await import('../src/renderer3d/wall-builder.js');
const { WALL_TYPES, WINDOW_TYPES } = await import('../src/data/structure.js');

// --- Fake parentGroup ----------------------------------------------------
function makeGroup() {
  return {
    children: [],
    add(m) { this.children.push(m); },
    remove(m) { this.children = this.children.filter(c => c !== m); },
  };
}

// cinderblockWall / officeWindow are real catalogue entries: wallHeight 14,
// one-subtile inset thickness, texture 'wall_cinderblock'; sillHeight 5 + openingHeight 6
// + 1 = 12 fits (same fit-rule arithmetic test/test-windows.js relies on for
// officeWall, which has wallHeight 14 too). cinderblockWall's one-subtile
// thickness (0.5 world units) is deliberately NOT equal to
// DEFAULT_WALL_THICKNESS (0.15) — officeWall's 1.5 -> 0.15 would coincide
// with the default and silently defeat the "used the real wall's thickness,
// not __default's" assertion below.
const WALL_DEF = WALL_TYPES.cinderblockWall;
const WINDOW_DEF = WINDOW_TYPES.officeWindow;
const EXPECTED_HEIGHT = WALL_DEF.wallHeight * (1.5 / 14); // HEIGHT_SCALE, wall-builder.js:24
const EXPECTED_THICKNESS = 2 / 4 * WALL_DEF.insetSubtiles; // quarter-tile strip
// DEFAULT_WALL_HEIGHT / DEFAULT_WALL_THICKNESS from wall-builder.js:22-23
const DEFAULT_HEIGHT = 1.5 * 1; // 1.5 * M, M = 1
const DEFAULT_THICKNESS = 0.15 * 1;

function buildScene({ wallEdge, windowEdge }) {
  const wallData = [{ col: 5, row: 3, edge: wallEdge, type: 'cinderblockWall' }];
  const windowData = [{ col: 5, row: windowEdge === 'n' ? 4 : 3, edge: windowEdge, type: 'officeWindow', variant: 0 }];
  const group = makeGroup();
  const wb = new WallBuilder(null);
  wb.build(wallData, [], windowData, group, 'up', null);
  return { group, wb };
}

// The wall lives at (5,3,'s'); the window is placed at its alias, (5,4,'n').
console.log('\n=== crossed representation: wall at (5,3,s), window at its alias (5,4,n) ===\n');
const crossed = buildScene({ wallEdge: 's', windowEdge: 'n' });

// The aligned control: same physical edge, but wall and window both use the
// exact same triple.
console.log('\n=== aligned control: wall and window both at (5,3,s) ===\n');
const aligned = buildScene({ wallEdge: 's', windowEdge: 's' });

// ---------------------------------------------------------------------------
console.log('\n=== crossed vs aligned produce the same mesh set, mesh-for-mesh ===\n');
{
  assert(crossed.group.children.length === aligned.group.children.length,
    `same mesh count (crossed=${crossed.group.children.length}, aligned=${aligned.group.children.length})`);

  const shape = (m) => JSON.stringify({
    geo: m.geometry.parameters,
    pos: [round(m.position.x), round(m.position.y), round(m.position.z)],
    map: !!m.material.map,
    color: m.material.color,
    transparent: !!m.material.transparent,
  });
  function round(n) { return Math.round(n * 1e6) / 1e6; }

  const crossedShapes = crossed.group.children.map(shape).sort();
  const alignedShapes = aligned.group.children.map(shape).sort();
  assert(JSON.stringify(crossedShapes) === JSON.stringify(alignedShapes),
    'the crossed and aligned mesh sets are identical (geometry dims, position, texture, color)');
}

// ---------------------------------------------------------------------------
console.log('\n=== the pre-fix symptom: no intact full-height wall slab across the window ===\n');
{
  // The intact wall slab (pre-fix, from the un-skipped main wall loop) is a
  // BoxGeometry spanning the WHOLE edge: full TILE_SIZE width AND the full
  // wall height. That combination is unique to it — the opening surround's
  // legitimate side-fill pieces also run the full wallHeight (by design,
  // see _buildOpeningSurround's doc comment), but only sideWidth wide
  // (< TILE_SIZE, since a window narrower than the tile leaves side fill).
  // So "full width AND full height" is the correct fingerprint, not height
  // alone.
  const isFullSlab = (m) => {
    const p = m.geometry.parameters;
    const dims = [p.width, p.depth]; // one is length (TILE_SIZE), one is thickness
    const hasFullWidth = dims.some(d => Math.abs(d - TILE_SIZE) < 1e-9);
    const hasFullHeight = Math.abs(p.height - EXPECTED_HEIGHT) < 1e-9;
    return hasFullWidth && hasFullHeight;
  };

  const fullSlabsCrossed = crossed.group.children.filter(isFullSlab);
  assert(fullSlabsCrossed.length === 0,
    `no mesh in the crossed case is a full-width/full-height intact wall slab ` +
    `(would be the pre-fix "wall slab drawn straight across the glass" symptom); found ${fullSlabsCrossed.length}`);

  // Sanity: the aligned control must ALSO have none (confirms the geometric
  // signature is right and this isn't vacuously true because the window
  // just never renders anything of that shape).
  const fullSlabsAligned = aligned.group.children.filter(isFullSlab);
  assert(fullSlabsAligned.length === 0, 'sanity: the aligned control also has no full-width/full-height slab');
}

// ---------------------------------------------------------------------------
console.log('\n=== the opening surround uses the real wall\'s texture and thickness, not __default ===\n');
{
  // Surround bands (above-lintel, below-sill, side jambs) use `wallThickness`
  // as one geometry dimension. Pre-fix, the wallTypeByEdge lookup missed and
  // fell back to DEFAULT_WALL_THICKNESS in the untextured, mapless
  // `__default` material (color-only, no `.map`).
  const surroundLike = crossed.group.children.filter(m => {
    const p = m.geometry.parameters;
    const dims = [p.width, p.height, p.depth];
    return dims.some(d => Math.abs(d - EXPECTED_THICKNESS) < 1e-9);
  });
  assert(surroundLike.length > 0, 'setup: at least one surround-band mesh uses a thickness dimension');
  for (const m of surroundLike) {
    assert(!!m.material.map, 'surround band material has a real texture map, not the untextured __default fallback');
    assert(m.material.color === 0xffffff,
      `surround band material is tinted white (textured), not cinderblockWall's raw color (got ${m.material.color})`);
  }

  // No mesh anywhere in the crossed build uses the DEFAULT thickness or the
  // grey __default fallback color (0xcccccc) with a null map — that
  // combination is the fingerprint of the pre-fix bug.
  const defaultFallback = crossed.group.children.filter(m => {
    const p = m.geometry.parameters;
    const usesDefaultThickness = [p.width, p.height, p.depth].some(
      d => Math.abs(d - DEFAULT_THICKNESS) < 1e-9
    );
    return usesDefaultThickness && !m.material.map && m.material.color === 0xcccccc;
  });
  assert(defaultFallback.length === 0,
    'no mesh matches the pre-fix fingerprint: default thickness + untextured grey (0xcccccc) __default material');
}

// ---------------------------------------------------------------------------
console.log('\n=== negative control: a genuinely different neighbouring edge is not over-skipped ===\n');
{
  // A second wall on the true neighbour edge (5,3,'n') — NOT an alias of
  // (5,3,'s') or (5,4,'n') — must still render its own full-height slab
  // untouched by the window on the other edge.
  const wallData = [
    { col: 5, row: 3, edge: 's', type: 'cinderblockWall' },
    { col: 5, row: 3, edge: 'n', type: 'cinderblockWall' },
  ];
  const windowData = [{ col: 5, row: 4, edge: 'n', type: 'officeWindow', variant: 0 }];
  const group = makeGroup();
  const wb = new WallBuilder(null);
  wb.build(wallData, [], windowData, group, 'up', null);

  const fullHeightOnNorthEdge = group.children.filter(m =>
    Math.abs(m.geometry.parameters.height - EXPECTED_HEIGHT) < 1e-9 &&
    // Inset shielding is centred half a subtile inside the selected tile.
    Math.abs(m.position.z - (3 * 2 + EXPECTED_THICKNESS / 2)) < 1e-6
  );
  assert(fullHeightOnNorthEdge.length === 1,
    `the untouched neighbour edge (5,3,'n') still renders exactly one intact full-height wall slab ` +
    `(got ${fullHeightOnNorthEdge.length}) — the window's alias-skip must not bleed onto a different edge`);
}

// ---------------------------------------------------------------------------
console.log('\n=== adaptive aperture proportions follow the host wall ===\n');
{
  const group = makeGroup();
  const wb = new WallBuilder(null);
  wb.build(
    [{ col: 8, row: 8, edge: 'n', type: 'structuralWall' }],
    [],
    [{ col: 8, row: 8, edge: 'n', type: 'industrialSash', variant: 0 }],
    group,
    'up',
    null
  );

  const glass = group.children.find(m => m.userData?.windowGlass);
  const expectedGlassHeight = WINDOW_TYPES.industrialSash.maxOpeningHeight * HEIGHT_SCALE - 0.12;
  assert(!!glass && Math.abs(glass.geometry.parameters.height - expectedGlassHeight) < 1e-9,
    'industrial sash glass expands to its 24-unit factory height in a structural wall');
  assert(glass.material.transparent === true && glass.material.depthWrite === false,
    'window glass remains normally transparent with order-safe depth handling');
  assert(glass.material.roughness > 0 && glass.material.emissive === undefined,
    'window glass keeps its slight roughness without an authored emissive glow');
  assert(glass.layers.enabled.size === 1 && glass.layers.enabled.has(0),
    'window glass stays on the normal render layer instead of a glow layer');

  const factoryGridBars = group.children.filter(m => {
    const p = m.geometry.parameters;
    return [p.width, p.height, p.depth].some(d => Math.abs(d - 0.03) < 1e-9);
  });
  assert(factoryGridBars.length === 4,
    `industrial sash has four inner grid bars for a 3x3 factory pattern (got ${factoryGridBars.length})`);
}

// ---------------------------------------------------------------------------
console.log('\n=== compact windows occupy the selected half of a tile edge ===\n');
{
  const def = WINDOW_TYPES.casementWindow;
  const leftLayout = windowOpeningLayout('n', 0, def);
  const rightLayout = windowOpeningLayout('n', 2, def);
  assert(leftLayout.openingWidth === TILE_SIZE / 2 && leftLayout.center === -TILE_SIZE / 4,
    'off=0 resolves to an exact half-tile aperture on the first side');
  assert(rightLayout.openingWidth === TILE_SIZE / 2 && rightLayout.center === TILE_SIZE / 4,
    'off=2 resolves to an exact half-tile aperture on the second side');
  assert(windowOpeningLayout('s', 2, def).center === leftLayout.center,
    'mirrored edge order plus mirrored offset resolves to the same world position');

  const buildCompact = (off) => {
    const group = makeGroup();
    const wb = new WallBuilder(null);
    wb.build(
      [{ col: 8, row: 8, edge: 'n', type: 'officeWall', baseY: { a: 0, b: 0 } }],
      [],
      [{ col: 8, row: 8, edge: 'n', type: 'casementWindow', variant: 0, off,
        baseY: { a: 0, b: 0 } }],
      group,
      'up',
      null,
    );
    return group.children.find(m => m.userData?.windowGlass);
  };
  const leftGlass = buildCompact(0);
  const rightGlass = buildCompact(2);
  const edgeMidX = 8 * TILE_SIZE + TILE_SIZE / 2;
  assert(Math.abs(leftGlass.position.x - (edgeMidX - TILE_SIZE / 4)) < 1e-9,
    'off=0 glass is rendered in the first half, not centered');
  assert(Math.abs(rightGlass.position.x - (edgeMidX + TILE_SIZE / 4)) < 1e-9,
    'off=2 glass is rendered in the second half, not centered');
  assert(Math.abs(leftGlass.geometry.parameters.width - (TILE_SIZE / 2 - 0.12)) < 1e-9,
    'compact glass uses the half-tile aperture width minus its frame');
}

// ---------------------------------------------------------------------------
console.log('\n=== shielded observation panes are no longer letterbox slits ===\n');
{
  const group = makeGroup();
  const wb = new WallBuilder(null);
  wb.build(
    [
      { col: 10, row: 8, edge: 'n', type: 'leadWall' },
      { col: 12, row: 8, edge: 'n', type: 'leadWall' },
    ],
    [],
    [
      { col: 10, row: 8, edge: 'n', type: 'leadedObservation', variant: 0 },
      { col: 12, row: 8, edge: 'n', type: 'hutchViewport', variant: 0 },
    ],
    group,
    'up',
    null
  );

  const glass = group.children.filter(m => m.userData?.windowGlass);
  const leaded = glass.find(m => m.geometry.parameters.width > 1.5);
  const viewport = glass.find(m => m.geometry.parameters.width < 1.5);
  assert(!!leaded && leaded.geometry.parameters.height > 0.95,
    'leaded observation glass fills most of the shielding wall height');
  assert(!!viewport && viewport.geometry.parameters.width > 0.95 &&
      viewport.geometry.parameters.height > 0.74,
    'hutch viewport is both wider and taller than the former narrow slit');
}

// ---------------------------------------------------------------------------
console.log('\n=== shielding geometry is inset; copper is a separate skin ===\n');
{
  const group = makeGroup();
  const wb = new WallBuilder(null);
  wb.build([
    { col: 1, row: 2, edge: 'n', type: 'cinderblockWall' },
    { col: 3, row: 2, edge: 'n', type: 'officeWall' },
    {
      col: 3, row: 2, edge: 'n', type: 'copperSheeting', overlay: true,
      host: { col: 3, row: 2, edge: 'n', type: 'officeWall' },
    },
  ], [], [], group, 'up', null);

  const cinder = group.children.find(m =>
    Math.abs(m.geometry.parameters.depth - 0.5) < 1e-9 &&
    Math.abs(m.position.x - 3) < 1e-9
  );
  assert(!!cinder && Math.abs(cinder.position.z - 4.25) < 1e-9,
    'cinderblock occupies a 0.5-world-unit strip centred 0.25 inside the selected tile');

  const copper = group.children.find(m =>
    Math.abs(m.geometry.parameters.depth - 0.1) < 1e-9 &&
    Math.abs(m.position.x - 7) < 1e-9
  );
  assert(!!copper && Math.abs(copper.position.z - 4.125) < 1e-9,
    'copper renders as a thin skin on the inward face of its host wall');
  const host = group.children.find(m =>
    Math.abs(m.geometry.parameters.depth - 0.15) < 1e-9 &&
    Math.abs(m.position.x - 7) < 1e-9
  );
  assert(!!host && Math.abs(host.position.z - 4) < 1e-9,
    'the structural host still renders independently beneath copper');
}

// ---------------------------------------------------------------------------
console.log('\n=== _edgeAliasKey matches Game._edgeAlias and InputHandler._edgeAlias ===\n');
{
  // The three implementations are exercised directly — Game._edgeAlias and
  // InputHandler._edgeAlias off their prototypes, wall-builder's
  // _edgeAliasKey off its module export. Local re-implementations would keep
  // agreeing with each other no matter how far the real ones drifted, so
  // there is nothing here that a divergence could not break.
  const { Game } = await import('../src/game/Game.js');
  const { InputHandler } = await import('../src/input/InputHandler.js');

  const gameEdgeAlias = (col, row, edge) =>
    Game.prototype._edgeAlias.call(null, col, row, edge);
  const inputHandlerEdgeAlias = (pt) =>
    InputHandler.prototype._edgeAlias.call(null, pt);

  const col = 5, row = 3;
  for (const edge of ['n', 's', 'e', 'w']) {
    const g = gameEdgeAlias(col, row, edge);
    const ih = inputHandlerEdgeAlias({ col, row, edge });
    const gKey = `${g.col},${g.row},${g.edge}`;
    const ihKey = `${ih.col},${ih.row},${ih.edge}`;
    const wbKey = _edgeAliasKey(col, row, edge);
    assert(gKey === ihKey && ihKey === wbKey,
      `edge '${edge}': Game._edgeAlias (${gKey}), InputHandler._edgeAlias (${ihKey}), ` +
      `and wall-builder's _edgeAliasKey (${wbKey}) all agree`);
  }

  // Aliasing twice must return to the original edge (an involution) — a
  // property of the real Game._edgeAlias, not of a copy of it.
  for (const edge of ['n', 's', 'e', 'w']) {
    const once = gameEdgeAlias(col, row, edge);
    const twice = gameEdgeAlias(once.col, once.row, once.edge);
    assert(twice.col === col && twice.row === row && twice.edge === edge,
      `edge '${edge}': aliasing twice returns to the original triple (involution)`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
