// test/test-door-geometry.js
// Door geometry: the subtile-offset -> world-space opening mapping, the
// side-fill emission rules, the door-panel leaf, and the data invariant that
// a door plus its lintel always fits inside the wall it hangs on.
//
// wall-builder's import chain touches THREE and document at module load
// (procedural textures), so both are stubbed before the dynamic import. The
// stub is rich enough to record geometry sizes, mesh positions and material
// options, which is all these assertions need.

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.log(`  FAIL: ${msg}`); }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// --- THREE / document stubs -------------------------------------------------
const Generic = class {
  constructor() {}
  set() { return this; } translate() { return this; } scale() { return this; }
  dispose() {} load() { return new Generic(); }
};
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
}
class BufferAttribute {
  constructor(array, itemSize) {
    this.array = array; this.itemSize = itemSize;
    this.count = array.length / itemSize; this.needsUpdate = false;
  }
  getX(i) { return this.array[i * this.itemSize]; }
  setX(i, v) { this.array[i * this.itemSize] = v; }
}
class BufferGeometry {
  constructor() { this.attributes = {}; }
  setAttribute(n, a) { this.attributes[n] = a; return this; }
  getAttribute(n) { return this.attributes[n]; }
  dispose() {} computeVertexNormals() {} computeBoundingBox() {} computeBoundingSphere() {}
}
class BoxGeometry extends BufferGeometry {
  constructor(width = 1, height = 1, depth = 1) {
    super();
    this.parameters = { width, height, depth };
    this.attributes.position = new BufferAttribute(new Float32Array(24 * 3), 3);
    this.attributes.uv = new BufferAttribute(new Float32Array(24 * 2), 2);
  }
  clone() {
    const p = this.parameters;
    return new BoxGeometry(p.width, p.height, p.depth);
  }
}
class StubMaterial {
  constructor(opts = {}) { Object.assign(this, opts); }
  dispose() {}
}
class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry; this.material = material;
    this.position = new Vector3();
    this.rotation = new Vector3();
    this.layers = { enabled: new Set([0]), enable(layer) { this.enabled.add(layer); } };
    this.castShadow = false; this.receiveShadow = false;
    this.matrixAutoUpdate = true;
  }
  updateMatrix() {}
}
class Group {
  constructor() { this.children = []; }
  add(o) { this.children.push(o); }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); }
}
const impl = {
  Vector3, BufferGeometry, BoxGeometry, BufferAttribute, Mesh, Group,
  MeshStandardMaterial: StubMaterial,
  MeshBasicMaterial: StubMaterial,
  TextureLoader: class { load() { return new Generic(); } },
};
globalThis.THREE = new Proxy(impl, { get: (t, k) => (k in t ? t[k] : Generic) });
const ctx = new Proxy({}, { get: () => () => ctx });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
};

const {
  WallBuilder, doorOpeningLayout, HEIGHT_SCALE, LINTEL_HEIGHT,
  SUBTILES_PER_EDGE, SUBTILE_SIZE,
} = await import('../src/renderer3d/wall-builder.js');
const { DOOR_TYPES, WINDOW_TYPES, WALL_TYPES, WALL_PAINTS } = await import('../src/data/structure.js');
const { PLACEABLES } = await import('../src/data/placeables/index.js');

const TILE_SIZE = 2;
const POST_WIDTH = 0.1;
const PANEL_THICKNESS = 0.04;

// ---------------------------------------------------------------------------
console.log('\n=== 1. doorOpeningLayout: off -> world-space opening ===\n');
{
  // 'n' runs NW->NE, i.e. in +X. off counts 0.5-unit subtiles from NW.
  const single1 = doorOpeningLayout('n', 1, false);
  assert(single1.openingWidth === 1.0, 'a single door opening is 2 subtiles (1.0 world units) wide');
  assert(single1.center === 0, 'off=1 keeps the opening on the edge midpoint (the old centred geometry)');
  assert(single1.leftWidth === 0.5 && single1.rightWidth === 0.5,
    'off=1 leaves a 0.5 fill on each side');
  assert(single1.leftCenter === -0.75 && single1.rightCenter === 0.75,
    'off=1 side fills sit at ±0.75 — exactly where the old symmetric fills were');

  const single0 = doorOpeningLayout('n', 0, false);
  assert(single0.leftWidth === 0 && single0.rightWidth === 1.0,
    'off=0 has no left fill and a single 1.0 right fill');
  assert(single0.center === -0.5, 'off=0 shifts the opening a half-tile toward the first corner');

  const single2 = doorOpeningLayout('n', 2, false);
  assert(single2.leftWidth === 1.0 && single2.rightWidth === 0,
    'off=2 has a single 1.0 left fill and no right fill');
  assert(single2.center === 0.5, 'off=2 shifts the opening a half-tile toward the second corner');

  const dbl = doorOpeningLayout('n', 0, true);
  assert(dbl.openingWidth === TILE_SIZE, 'a double fills the whole tile edge');
  assert(dbl.leftWidth === 0 && dbl.rightWidth === 0 && dbl.center === 0,
    'a double has no side fills and stays centred');

  const hangar = doorOpeningLayout('n', 0, true, 6);
  assert(hangar.openingWidth === TILE_SIZE * 6,
    'a 6×1 door creates one continuous six-edge opening');
  assert(hangar.leftWidth === 0 && hangar.rightWidth === 0 && hangar.center === 0,
    'a multi-tile full-width door has no interior wall fills or offset');

  assert(SUBTILES_PER_EDGE === 4 && SUBTILE_SIZE === 0.5,
    'the edge is 4 subtiles of 0.5 world units');
}

// ---------------------------------------------------------------------------
console.log('\n=== 2. Corner order per edge (n: NW->NE, e: NE->SE, s: SE->SW, w: SW->NW) ===\n');
{
  // 'n' and 'e' list their first corner at the low world coordinate, so off
  // grows in +X / +Z; 's' and 'w' list theirs at the high coordinate.
  assert(doorOpeningLayout('n', 0, false).dir === 1, "'n' runs +X (NW -> NE)");
  assert(doorOpeningLayout('e', 0, false).dir === 1, "'e' runs +Z (NE -> SE)");
  assert(doorOpeningLayout('s', 0, false).dir === -1, "'s' runs -X (SE -> SW)");
  assert(doorOpeningLayout('w', 0, false).dir === -1, "'w' runs -Z (SW -> NW)");

  assert(doorOpeningLayout('s', 0, false).center === 0.5,
    "off=0 on 's' sits at +X — its first-listed corner is SE");
  assert(doorOpeningLayout('w', 0, false).center === 0.5,
    "off=0 on 'w' sits at +Z — its first-listed corner is SW");

  // The two spellings of one physical edge must land the opening in the same
  // place. edge-keys.mirrorDoorOff is (4 - width) - off; recompute it here so
  // this file stays independent of the game module's export names.
  const mirrorOff = (off, isDouble) => (SUBTILES_PER_EDGE - (isDouble ? 4 : 2)) - off;
  for (const off of [0, 1, 2]) {
    // "(c,r,'n')" and "(c,r-1,'s')" are the same edge; both edge midpoints
    // share the same world X, so the offsets must agree.
    const a = doorOpeningLayout('n', off, false).center;
    const b = doorOpeningLayout('s', mirrorOff(off, false), false).center;
    assert(near(a, b), `off=${off} on 'n' matches its mirrored spelling on 's' (${a} vs ${b})`);
    const c = doorOpeningLayout('e', off, false).center;
    const dd = doorOpeningLayout('w', mirrorOff(off, false), false).center;
    assert(near(c, dd), `off=${off} on 'e' matches its mirrored spelling on 'w' (${c} vs ${dd})`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== 3. Defensive reads: missing / out-of-range off ===\n');
{
  assert(doorOpeningLayout('n', undefined, false).off === 1,
    'a single with no off defaults to the centred slot');
  assert(doorOpeningLayout('n', undefined, true).off === 0,
    'a double with no off defaults to slot 0');
  assert(doorOpeningLayout('n', null, false).off === 1, 'null off falls back too');
  assert(doorOpeningLayout('n', NaN, false).off === 1, 'NaN off falls back too');
  assert(doorOpeningLayout('n', 7, false).off === 2, 'an over-range off clamps to the last slot');
  assert(doorOpeningLayout('n', -3, false).off === 0, 'a negative off clamps to slot 0');
  assert(doorOpeningLayout('n', 3, true).off === 0, 'a double clamps every off to 0');
  assert(doorOpeningLayout('n', 1.4, false).off === 1, 'a fractional off rounds to a slot');
}

// ---------------------------------------------------------------------------
console.log('\n=== 4. build(): side fills follow the offset ===\n');
{
  const classify = (mesh, ctxInfo) => {
    const p = mesh.geometry.parameters;
    if (!p) return 'other';
    if (near(p.height, LINTEL_HEIGHT)) return 'lintel';
    if (near(p.width, POST_WIDTH) && near(p.depth, POST_WIDTH)) return 'post';
    const thin = ctxInfo.isNS ? p.depth : p.width;
    if (near(thin, PANEL_THICKNESS)) return 'panel';
    if (near(p.height, ctxInfo.wallHeight)) return 'side';
    return 'above';
  };

  const buildDoor = (doorType, off, wallType = 'officeWall', variant = 0) => {
    const wb = new WallBuilder(null);
    const group = new Group();
    const seg = { col: 2, row: 3, edge: 'n' };
    wb.build(
      [{ ...seg, type: wallType, variant: 0, baseY: { a: 0, b: 0 } }],
      [{ ...seg, type: doorType, variant, off }],
      [], group, 'up', null
    );
    const wallHeight = WALL_TYPES[wallType].wallHeight * HEIGHT_SCALE;
    const info = { isNS: true, wallHeight };
    const byKind = {};
    for (const m of wb._meshes) {
      const k = classify(m, info);
      (byKind[k] ||= []).push(m);
    }
    return { byKind, wallHeight, edgeCenterX: 2 * TILE_SIZE + TILE_SIZE / 2 };
  };

  const centred = buildDoor('officeDoor', 1);
  assert((centred.byKind.side || []).length === 2, 'off=1 emits two side fills');
  const cxs = (centred.byKind.side || []).map(m => m.position.x - centred.edgeCenterX).sort((a, b) => a - b);
  assert(near(cxs[0], -0.75) && near(cxs[1], 0.75),
    'off=1 side fills land at ±0.75 — identical to the pre-offset geometry');
  assert((centred.byKind.side || []).every(m => near(m.geometry.parameters.width, 0.5)),
    'off=1 side fills are 0.5 wide each');

  const left = buildDoor('officeDoor', 0);
  assert((left.byKind.side || []).length === 1, 'off=0 emits a SINGLE side fill, not a zero-width pair');
  assert(near(left.byKind.side[0].geometry.parameters.width, 1.0),
    'the surviving off=0 fill is 1.0 wide — the whole remainder of the tile');
  assert(near(left.byKind.side[0].position.x - left.edgeCenterX, 0.5),
    'the off=0 fill sits on the +X side of the opening');

  const right = buildDoor('officeDoor', 2);
  assert((right.byKind.side || []).length === 1, 'off=2 emits a SINGLE side fill');
  assert(near(right.byKind.side[0].position.x - right.edgeCenterX, -0.5),
    'the off=2 fill sits on the -X side of the opening');

  const dbl = buildDoor('doubleDoor', 0, 'structuralWall');
  assert((dbl.byKind.side || []).length === 0, 'a double door emits no side fills');

  // Side fills and the above-door band clad themselves like the wall they
  // interrupt, variant included — a door in a brick wall gets brick reveals.
  const brick = (() => {
    const wb = new WallBuilder(null);
    const group = new Group();
    const seg = { col: 4, row: 4, edge: 'n' };
    wb.build(
      [{ ...seg, type: 'structuralWall', variant: 3, baseY: { a: 0, b: 0 } }],
      [{ ...seg, type: 'securityDoor', variant: 0, off: 1 }],
      [], group, 'up', null
    );
    return wb;
  })();
  const cement = (() => {
    const wb = new WallBuilder(null);
    const group = new Group();
    const seg = { col: 4, row: 4, edge: 'n' };
    wb.build(
      [{ ...seg, type: 'structuralWall', variant: 0, baseY: { a: 0, b: 0 } }],
      [{ ...seg, type: 'securityDoor', variant: 0, off: 1 }],
      [], group, 'up', null
    );
    return wb;
  })();
  const wallHeightSW = WALL_TYPES.structuralWall.wallHeight * HEIGHT_SCALE;
  const fillMat = (wb) => wb._meshes.find(m => near(m.geometry.parameters?.height ?? -1, wallHeightSW)).material;
  assert(fillMat(brick).map !== fillMat(cement).map,
    'a door in a brick wall gets brick side fills, not the base cement texture');

  // Posts and lintel ride the shifted opening.
  const shifted = buildDoor('officeDoor', 0);
  const postXs = shifted.byKind.post.map(m => m.position.x - shifted.edgeCenterX).sort((a, b) => a - b);
  assert(near(postXs[0], -1.0) && near(postXs[1], 0.0),
    'off=0 posts flank the shifted opening (-1.0 / 0.0), not the edge centre');
  assert(near(shifted.byKind.lintel[0].position.x - shifted.edgeCenterX, -0.5),
    'the lintel follows the shifted opening centre');
  assert(near(shifted.byKind.above[0].position.x - shifted.edgeCenterX, -0.5),
    'the above-door segment follows the shifted opening centre');
}

// ---------------------------------------------------------------------------
console.log('\n=== 5. build(): the visible door panel ===\n');
{
  const panelsOf = (doorType, variant, wallType = 'officeWall', visibility = 'up') => {
    const wb = new WallBuilder(null);
    const group = new Group();
    const seg = { col: 0, row: 0, edge: 'n' };
    wb.build(
      [{ ...seg, type: wallType, variant: 0, baseY: { a: 0, b: 0 } }],
      [{ ...seg, type: doorType, variant, off: 1 }],
      [], group, visibility, null
    );
    return wb._meshes.filter(m => near(m.geometry.parameters?.depth ?? -1, PANEL_THICKNESS));
  };

  const office = panelsOf('officeDoor', 0);
  assert(office.length === 1, 'a textured door renders exactly one panel leaf');
  assert(office[0].userData?.doorEdge?.col === 0
    && office[0].userData?.doorEdge?.row === 0
    && office[0].userData?.doorEdge?.edge === 'n',
    'the visible panel retains its owning edge for perspective-correct picking');
  assert(office[0].material.map != null, 'the panel is wired to the door texture, not left untextured');
  assert(near(office[0].geometry.parameters.width, 1.0 - 0.04),
    'the panel fills the opening less the frame gap');
  assert(near(office[0].position.x, TILE_SIZE / 2),
    'the panel is centred on the (off=1) opening');

  const paired = panelsOf('doubleDoor', 0, 'structuralWall');
  assert(paired.length === 2, 'a full-tile double door renders two physical panel leaves');
  assert(paired.every(p => p.userData?.doorLeafCount === 2),
    'both double-door meshes identify themselves as members of a two-leaf door');
  assert(new Set(paired.map(p => p.userData?.doorLeafIndex)).size === 2,
    'the two double-door leaves have distinct indices');
  assert(paired[0].position.x !== paired[1].position.x,
    'the two leaves sit on opposite sides of a visible centre seam');
  assert(paired.every(p => near(p.geometry.parameters.width, (2 - 0.04 - 0.025) / 2)),
    'the two leaves together fill the full-tile opening minus frame and meeting gaps');

  const handedPair = panelsOf('doubleOfficeDoor', 0);
  const leftLeaf = handedPair.find(p => p.userData?.doorLeafIndex === 0);
  const rightLeaf = handedPair.find(p => p.userData?.doorLeafIndex === 1);
  assert(leftLeaf.geometry.attributes.uv.getX(0) === 0
      && rightLeaf.geometry.attributes.uv.getX(0) === 1,
    'double-door artwork keeps the left knob on its right edge and mirrors the right knob toward the centre seam');

  const shutter = panelsOf('rollingShutter', 0, 'structuralWall');
  assert(shutter.length === 1 && shutter[0].userData?.doorLeafCount === 1,
    'a rolling shutter remains one full-width moving panel');

  assert(panelsOf('hallwayDoor', 0).length === 0,
    'hallwayDoor is an open passthrough — no panel leaf');

  const v0 = panelsOf('officeDoor', 0)[0];
  const v2 = panelsOf('officeDoor', 2)[0];
  assert(v0.material.color !== v2.material.color,
    'variants no longer render identically — the panel picks up variantTints');
  assert(v2.material.color === DOOR_TYPES.officeDoor.variantTints[2],
    `variant 2 uses its declared tint (got ${v2.material.color?.toString?.(16)})`);
  assert(v0.material.color === 0xffffff,
    'the untinted variant stays white so the texture shows its own colours');

  // Gates keep their alpha cutout; the ghost pass has to scale the threshold
  // or the whole leaf would be discarded at 0.3 opacity.
  const gate = panelsOf('chainLinkGate', 0, 'chainLinkFence')[0];
  assert(gate && gate.material.alphaTest > 0, 'a cutout gate panel keeps its alphaTest');
  const gateGhost = panelsOf('chainLinkGate', 0, 'chainLinkFence', 'transparent')[0];
  assert(gateGhost.material.alphaTest < gateGhost.material.opacity,
    'the transparent pass scales alphaTest below the opacity so the leaf survives');

  const glass = panelsOf('glassDoor', 0, 'glassWall')[0];
  assert(glass?.userData?.glassDoor === true,
    'a glass door emits a visible glazed leaf instead of an open passthrough');
  assert(glass.material.transparent === true && glass.material.depthWrite === false,
    'the glass door uses an order-safe transparent material');
  assert(glass.material.color === DOOR_TYPES.glassDoor.variantGlassColors[0]
      && near(glass.material.opacity, DOOR_TYPES.glassDoor.variantGlassOpacities[0]),
    'the clear glass door leaf uses its authored color and opacity');
  assert(glass.material.roughness > 0 && glass.material.emissive === undefined
      && glass.layers.enabled.size === 1 && glass.layers.enabled.has(0),
    'the glass door keeps a soft rough surface on the normal render layer without an authored glow');
  const smokedGlass = panelsOf('glassDoor', 2, 'glassWall')[0];
  assert(smokedGlass.material.color === DOOR_TYPES.glassDoor.variantGlassColors[2]
      && near(smokedGlass.material.opacity, DOOR_TYPES.glassDoor.variantGlassOpacities[2]),
    'glass door variants produce visibly distinct glazing');

  for (const id of [
    'doubleDoor', 'cleanroomDoor', 'doubleLabDoor', 'panicExit',
    'fireDoor', 'doubleFireDoor', 'labDoor',
  ]) {
    const wb = new WallBuilder(null);
    const seg = { col: 0, row: 0, edge: 'n' };
    wb.build(
      [{ ...seg, type: id === 'doubleDoor' ? 'structuralWall' : 'officeWall',
        variant: 0, baseY: { a: 0, b: 0 } }],
      [{ ...seg, type: id, variant: 0, off: 1 }],
      [], new Group(), 'up', null
    );
    const leaves = wb._meshes.filter(m => m.userData?.doorLeaf);
    const panes = wb._meshes.filter(m => m.userData?.doorWindowGlass);
    assert(leaves.length === (DOOR_TYPES[id].leafCount ?? 1)
        && leaves.every(m => m.material.alphaMap && m.material.alphaTest > 0),
      `${id} cuts its authored observation window through the opaque leaf`);
    assert(panes.length === leaves.length
        && panes.every(m => m.material.transparent === true && m.material.depthWrite === false),
      `${id} fills every observation opening with order-safe transparent glass`);
  }

  for (const id of ['officeDoor', 'securityDoor', 'acousticDoor', 'serviceDoor']) {
    const leaf = panelsOf(id, 0, id === 'serviceDoor' ? 'structuralWall' : 'officeWall')[0];
    assert(!leaf.material.alphaMap,
      `${id} remains solid because its artwork has no window`);
  }

  const framedDoorBuilder = new WallBuilder(null);
  framedDoorBuilder.build(
    [{ col: 0, row: 0, edge: 'n', type: 'glassWall', variant: 0, baseY: { a: 0, b: 0 } }],
    [{ col: 0, row: 0, edge: 'n', type: 'glassDoor', variant: 0, off: 1 }],
    [], new Group(), 'up', null
  );
  assert(framedDoorBuilder._meshes.some(m => m.userData?.glassDoorHandle),
    'the glass door includes a metal pull handle');
  assert(framedDoorBuilder._meshes.filter(m => m.userData?.glassWallFrame).length === 4,
    'a glass-wall doorway retains its two perimeter rails and outside posts');

  const doubleGlassBuilder = new WallBuilder(null);
  doubleGlassBuilder.build(
    [{ col: 0, row: 0, edge: 'n', type: 'glassWall', variant: 0, baseY: { a: 0, b: 0 } }],
    [{ col: 0, row: 0, edge: 'n', type: 'doubleGlassDoor', variant: 0, off: 0 }],
    [], new Group(), 'up', null
  );
  assert(doubleGlassBuilder._meshes.filter(m => m.userData?.glassDoor).length === 2,
    'a double glass door has two distinct glazed leaves');
  assert(doubleGlassBuilder._meshes.filter(m => m.userData?.glassDoorHandle).length === 2,
    'a double glass door has one pull handle on each leaf');

  // Panel offset tracks the opening, not the edge centre.
  const wb = new WallBuilder(null);
  const group = new Group();
  wb.build(
    [{ col: 0, row: 0, edge: 'n', type: 'officeWall', variant: 0, baseY: { a: 0, b: 0 } }],
    [{ col: 0, row: 0, edge: 'n', type: 'officeDoor', variant: 0, off: 2 }],
    [], group, 'up', null
  );
  const offsetPanel = wb._meshes.filter(m => near(m.geometry.parameters?.depth ?? -1, PANEL_THICKNESS))[0];
  assert(near(offsetPanel.position.x, TILE_SIZE / 2 + 0.5),
    'an off=2 panel sits on the shifted opening');
}

// ---------------------------------------------------------------------------
console.log('\n=== 6. Lintel invariant: doorHeight + lintel fits the wall ===\n');
{
  // LINTEL_HEIGHT is 0.15 world units; in data units that is 1.4.
  const lintelData = LINTEL_HEIGHT / HEIGHT_SCALE;
  assert(near(lintelData, 1.4, 1e-9), `the lintel is ${lintelData} data units tall`);

  for (const [id, def] of Object.entries(DOOR_TYPES)) {
    const top = def.doorHeight * HEIGHT_SCALE + LINTEL_HEIGHT;
    const wall = def.wallHeight * HEIGHT_SCALE;
    assert(top <= wall + 1e-9,
      `${id}: opening + lintel (${def.doorHeight}+${lintelData}) fits its declared wall (${def.wallHeight})`);
    if (def.doorWidth === 'double') {
      assert(Number.isInteger(def.leafCount) && def.leafCount >= 0 && def.leafCount <= 2,
        `${id}: full-tile opening declares whether it has zero, one, or two leaves`);
    }
  }

  for (const id of [
    'doubleDoor', 'doubleOfficeDoor', 'doubleGlassDoor', 'doubleLabDoor',
    'doubleFireDoor', 'blastDoor',
  ]) {
    const def = DOOR_TYPES[id];
    assert(def?.doorWidth === 'double' && def.leafCount === 2,
      `${id} is a true full-tile pair rather than one stretched leaf`);
    assert((def.variants?.length || 0) >= 3,
      `${id} offers several finish or glazing variants`);
  }

  // ...and against the walls each door type is actually meant to hang on.
  const HOSTS = {
    hangarDoor3: ['structuralWall'],
    hangarDoor4: ['structuralWall'],
    hangarDoor6: ['structuralWall'],
    doubleDoor: ['structuralWall'],
    doubleOfficeDoor: ['officeWall', 'hallwayWall'],
    doubleGlassDoor: ['officeWall', 'hallwayWall', 'glassWall'],
    doubleLabDoor: ['officeWall', 'hallwayWall'],
    doubleFireDoor: ['officeWall', 'hallwayWall'],
    securityDoor: ['structuralWall'],
    rollingShutter: ['structuralWall'],
    officeDoor: ['officeWall', 'hallwayWall'],
    glassDoor: ['officeWall', 'hallwayWall', 'glassWall'],
    acousticDoor: ['officeWall', 'hallwayWall'],
    cleanroomDoor: ['officeWall', 'hallwayWall'],
    panicExit: ['officeWall', 'hallwayWall'],
    hallwayDoor: ['officeWall', 'hallwayWall'],
    fireDoor: ['officeWall', 'hallwayWall'],
    labDoor: ['officeWall', 'hallwayWall'],
    chainLinkGate: ['chainLinkFence'],
    pedestrianGate: ['chainLinkFence'],
    woodGate: ['woodFence'],
    securityGate: ['barbedWireFence'],
    slidingSecurityGate: ['barbedWireFence'],
    serviceDoor: ['structuralWall'],
    blastDoor: ['structuralWall'],
  };
  for (const [id, hosts] of Object.entries(HOSTS)) {
    const def = DOOR_TYPES[id];
    for (const h of hosts) {
      const wallDef = WALL_TYPES[h];
      assert(!!wallDef, `${h} exists in WALL_TYPES`);
      assert(def.doorHeight + lintelData <= wallDef.wallHeight + 1e-9,
        `${id} (${def.doorHeight}) fits inside ${h} (${wallDef.wallHeight})`);
    }
  }
  assert(Object.keys(HOSTS).length === Object.keys(DOOR_TYPES).length,
    'every door type is covered by the host table');
}

// ---------------------------------------------------------------------------
console.log('\n=== 6b. Multi-tile doors render as one continuous assembly ===\n');
{
  const wb = new WallBuilder(null);
  const group = new Group();
  const walls = Array.from({ length: 6 }, (_, col) => ({
    col, row: 0, edge: 'n', type: 'structuralWall', variant: 0,
    baseY: { a: 0, b: 0 },
  }));
  const segments = walls.map(({ col, row, edge }) => ({ col, row, edge }));
  wb.build(walls, [{
    col: 0, row: 0, edge: 'n', type: 'hangarDoor6', variant: 0, off: 0,
    tileSpan: 6, segments, baseY: { a: 0, b: 0 },
  }], [], group, 'up', null);
  const leaves = wb._meshes.filter(mesh => mesh.userData?.doorLeaf);
  assert(leaves.length === 2,
    'a 6×1 hangar opening has two continuous leaves, not twelve tile leaves');
  const leafXs = leaves.map(mesh => mesh.position.x).sort((a, b) => a - b);
  assert(leafXs[0] > 2.9 && leafXs[0] < 3.1 && leafXs[1] > 8.9 && leafXs[1] < 9.1,
    'the paired leaves occupy the two halves of the complete six-tile opening');
  assert(wb.doorPickMeshes().length >= 5
    && wb.doorPickMeshes().every(mesh => mesh.userData?.doorEdge?.col === 0
      && mesh.userData?.doorEdge?.row === 0 && mesh.userData?.doorEdge?.edge === 'n'),
    'every pickable part of the continuous door resolves to its owning record');
  const lintels = wb._meshes.filter(mesh => near(mesh.geometry.parameters?.height ?? -1, LINTEL_HEIGHT));
  assert(lintels.length === 1 && near(lintels[0].geometry.parameters.width, TILE_SIZE * 6),
    'one lintel spans the complete opening without tile seams');
  const fullWallSlabs = wb._meshes.filter(mesh => {
    const p = mesh.geometry.parameters;
    return p && near(p.height, WALL_TYPES.structuralWall.wallHeight * HEIGHT_SCALE)
      && near(p.depth, WALL_TYPES.structuralWall.thickness * 0.05);
  });
  assert(fullWallSlabs.length === 0,
    'all six host-wall slabs are cut away behind the continuous door');
}

// ---------------------------------------------------------------------------
console.log('\n=== 7. Glass wall material and frame ===\n');
{
  const buildGlassWall = (variant, visibility = 'up') => {
    const wb = new WallBuilder(null);
    wb.build(
      [
        { col: 3, row: 4, edge: 'n', type: 'glassWall', variant,
          baseY: { a: 0, b: 0 } },
        { col: 4, row: 4, edge: 'n', type: 'glassWall', variant,
          baseY: { a: 0, b: 0 } },
      ],
      [], [], new Group(), visibility, null
    );
    return wb;
  };

  // Glass runs merge even while walls are fully up, eliminating duplicate
  // coincident posts while retaining one mullion per two-metre panel.
  const clear = buildGlassWall(0);
  const pane = clear._meshes.find(m => m.userData?.glassWall);
  const frames = clear._meshes.filter(m => m.userData?.glassWallFrame);
  assert(pane?.material?.transparent === true && pane.material.depthWrite === false,
    'the glass wall slab uses an order-safe transparent material');
  assert(pane.material.color === WALL_TYPES.glassWall.variantGlassColors[0]
      && near(pane.material.opacity, WALL_TYPES.glassWall.variantGlassOpacities[0]),
    'the clear glass wall uses its authored color and opacity');
  assert(pane.material.roughness > 0 && pane.material.emissive === undefined,
    'the glass wall keeps a soft rough surface without an authored glow');
  assert(pane.layers.enabled.size === 1 && pane.layers.enabled.has(0),
    'the glass wall stays on the normal render layer instead of a glow layer');
  assert(frames.length === 7,
    'a two-segment glass wall gets two rails, edge posts, and one mullion per segment');
  assert(frames.every(m => m.material.metalness > 0 && m.material.transparent === false),
    'glass wall framing remains opaque and metallic');

  const ghostedFrames = buildGlassWall(0, 'transparent')._meshes
    .filter(m => m.userData?.glassWallFrame);
  assert(ghostedFrames.every(m => m.material.opacity === 0.3),
    'glass wall framing follows transparent-view opacity');

  const smoked = buildGlassWall(2);
  const smokedPane = smoked._meshes.find(m => m.userData?.glassWall);
  assert(smokedPane.material.color === WALL_TYPES.glassWall.variantGlassColors[2]
      && near(smokedPane.material.opacity, WALL_TYPES.glassWall.variantGlassOpacities[2]),
    'the smoked glass wall variant changes both tint and opacity');
}

// ---------------------------------------------------------------------------
console.log('\n=== 8. Wall heights match furnishing and human scale ===\n');
{
  // TILE_SIZE is 2 world units and 2 m real, so one data unit maps to
  // HEIGHT_SCALE metres.
  const metres = (data) => data * HEIGHT_SCALE;
  const deskSurfaceMetres = PLACEABLES.desk.surfaceY * 0.5;
  const cubicleMetres = metres(WALL_TYPES.cubicleWall.wallHeight);
  assert(WALL_TYPES.cubicleWall.wallHeight === 11.75,
    'cubicle dividers use the taller authored height');
  assert(cubicleMetres >= deskSurfaceMetres * 1.5,
    `cubicle dividers provide seated privacy above a desk (${cubicleMetres.toFixed(2)} m wall vs ${deskSurfaceMetres.toFixed(2)} m desk)`);
  assert(WALL_TYPES.cubicleWall.wallHeight < WALL_TYPES.cinderblockWall.wallHeight,
    'cubicle dividers remain lower than full-height shielding walls');
  assert(WALL_TYPES.officeWall.wallHeight === 24, 'officeWall is 24 data units');
  assert(WALL_TYPES.hallwayWall.wallHeight === 24, 'hallwayWall is 24 data units');
  assert(metres(WALL_TYPES.officeWall.wallHeight) > 2.2,
    `office walls clear a standing person (${metres(24).toFixed(2)} m)`);
  assert(WALL_TYPES.structuralWall.wallHeight > WALL_TYPES.officeWall.wallHeight,
    'structural (exterior) walls still overtop the interior partitions');
  for (const id of ['cinderblockWall', 'leadWall', 'copperSheeting']) {
    assert(WALL_TYPES[id].wallHeight === 14, `${id} (shielding) stays at 14`);
  }
  assert(metres(DOOR_TYPES.officeDoor.doorHeight) > 2.0,
    `office doors are person-sized (${metres(DOOR_TYPES.officeDoor.doorHeight).toFixed(2)} m)`);
}

// ---------------------------------------------------------------------------
console.log('\n=== 9. A tall door on a short wall is clamped, not poked through ===\n');
{
  const wb = new WallBuilder(null);
  const group = new Group();
  const seg = { col: 1, row: 1, edge: 'e' };
  // officeDoor (19) would need 20.4 units; cinderblockWall only has 14.
  wb.build(
    [{ ...seg, type: 'cinderblockWall', variant: 0, baseY: { a: 0, b: 0 } }],
    [{ ...seg, type: 'officeDoor', variant: 0, off: 1 }],
    [], group, 'up', null
  );
  const wallHeight = WALL_TYPES.cinderblockWall.wallHeight * HEIGHT_SCALE;
  const posts = wb._meshes.filter(m => {
    const p = m.geometry.parameters;
    return p && near(p.width, POST_WIDTH) && near(p.depth, POST_WIDTH);
  });
  assert(posts.length === 2, 'the frame still has two posts');
  const doorH = posts[0].geometry.parameters.height;
  assert(near(doorH, wallHeight - LINTEL_HEIGHT),
    'the opening is clamped so opening + lintel exactly reaches the wall top');
  const lintel = wb._meshes.find(m => near(m.geometry.parameters?.height ?? -1, LINTEL_HEIGHT));
  assert(lintel.position.y + LINTEL_HEIGHT / 2 <= wallHeight + 1e-9,
    'the lintel top never rises above the wall top');
}

// ---------------------------------------------------------------------------
console.log('\n=== 10. Door parts sit on the terrain, not at y=0 ===\n');
{
  // A gate in a fence on ground raised to y=2. Walls bake their base Y into
  // the geometry; door parts are placed boxes, so they carry theirs in the
  // mesh position. Without it the gate was drawn at the bottom of the hill
  // while the fence around it climbed it.
  const wb = new WallBuilder(null);
  const group = new Group();
  const seg = { col: 1, row: 1, edge: 'n' };
  const baseY = { a: 2, b: 2 };
  wb.build(
    [{ ...seg, type: 'cinderblockWall', variant: 0, baseY }],
    [{ ...seg, type: 'officeDoor', variant: 0, off: 1, baseY }],
    [], group, 'up', null
  );
  assert(wb._meshes.every(m => m.position.y >= 2 - 1e-9),
    'every door part is lifted onto the raised ground');
  const posts = wb._meshes.filter(m => {
    const p = m.geometry.parameters;
    return p && near(p.width, POST_WIDTH) && near(p.depth, POST_WIDTH);
  });
  assert(near(posts[0].position.y, 2 + posts[0].geometry.parameters.height / 2),
    'a post stands on the ground, not buried to its terrain height');

  // A sloped edge: 'n' runs NW -> NE, so a=0 at low X and b=2 at high X. The
  // two posts flank the opening and must follow that ramp.
  const wb2 = new WallBuilder(null);
  const slope = { a: 0, b: 2 };
  wb2.build(
    [{ ...seg, type: 'cinderblockWall', variant: 0, baseY: slope }],
    [{ ...seg, type: 'officeDoor', variant: 0, off: 1, baseY: slope }],
    [], new Group(), 'up', null
  );
  const p2 = wb2._meshes.filter(m => {
    const p = m.geometry.parameters;
    return p && near(p.width, POST_WIDTH) && near(p.depth, POST_WIDTH);
  }).sort((a, b) => a.position.x - b.position.x);
  assert(p2[0].position.y < p2[1].position.y,
    'on a sloped edge the downhill post sits lower than the uphill one');
}

// ---------------------------------------------------------------------------
console.log('\n=== 11. Cutaway ghosts exactly the walls that border the room ===\n');
{
  // Six colinear walls; only cols 0-2 border the opened room. Merging used to
  // ignore that and paint the whole run by whichever tile sorted first —
  // either ghosting the neighbouring building or leaving the room sealed.
  const walls = [];
  for (let c = 0; c < 6; c++) {
    walls.push({ col: c, row: 3, edge: 'n', type: 'structuralWall', variant: 0, baseY: { a: 0, b: 0 } });
  }
  const wb = new WallBuilder(null);
  wb.build(walls, [], [], new Group(), 'cutaway', new Set(['0,3', '1,3', '2,3']));
  const spans = wb._meshes.slice().sort((a, b) => a.position.x - b.position.x);
  assert(spans.length === 2, 'the run splits at the room boundary instead of merging through it');
  assert(spans[0].material.opacity === 0.3 && spans[1].material.opacity === 1.0,
    'only the room-bordering span is ghosted');
  assert(near(spans[0].geometry.parameters.width, 6) && near(spans[1].geometry.parameters.width, 6),
    'each span covers exactly its three tiles');

  // The same run with the room at the FAR end — the previous code read the
  // origin tile and left the room's own walls solid.
  const wb2 = new WallBuilder(null);
  wb2.build(walls, [], [], new Group(), 'cutaway', new Set(['3,3', '4,3', '5,3']));
  const far = wb2._meshes.slice().sort((a, b) => a.position.x - b.position.x);
  assert(far[0].material.opacity === 1.0 && far[1].material.opacity === 0.3,
    'the ghosted span follows the room, not the first tile in the run');
}

// ---------------------------------------------------------------------------
console.log('\n=== 12. Cutaway ghosts the wall around a door too ===\n');
{
  // The door loop keyed its wall material without the cutaway suffix, so the
  // side fills and the band above the opening stayed opaque — a solid plug in
  // an otherwise transparent wall.
  const wb = new WallBuilder(null);
  const seg = { col: 5, row: 5, edge: 'n' };
  wb.build(
    [{ ...seg, type: 'structuralWall', variant: 0, baseY: { a: 0, b: 0 } }],
    [{ ...seg, type: 'officeDoor', variant: 0, off: 1, baseY: { a: 0, b: 0 } }],
    [], new Group(), 'cutaway', new Set(['5,5'])
  );
  assert(wb._meshes.length > 0, 'the door builds meshes');
  assert(wb._meshes.every(m => m.material.opacity === 0.3),
    'every part of the doorway — posts, lintel, side fills, above-door band, panel — is ghosted');
  assert(wb._meshes.every(m => m.castShadow === false),
    'and nothing ghosted still casts a shadow');
}

// ---------------------------------------------------------------------------
console.log('\n=== 13. A wall stored under the mirrored key never seals the door ===\n');
{
  // "5,5,s" and "5,6,n" are the same edge. Game.placeWall now resolves that,
  // but a snapshot carrying both spellings (older save, hand-built fixture)
  // must still render an opening rather than a slab across it.
  const wb = new WallBuilder(null);
  wb.build(
    [
      { col: 5, row: 5, edge: 's', type: 'officeWall', variant: 0, baseY: { a: 0, b: 0 } },
      { col: 5, row: 6, edge: 'n', type: 'officeWall', variant: 0, baseY: { a: 0, b: 0 } },
    ],
    [{ col: 5, row: 5, edge: 's', type: 'officeDoor', variant: 0, off: 1, baseY: { a: 0, b: 0 } }],
    [], new Group(), 'up', null
  );
  const fullTile = wb._meshes.filter(m => {
    const p = m.geometry.parameters;
    return p && (near(p.width, TILE_SIZE) || near(p.depth, TILE_SIZE));
  });
  assert(fullTile.length === 0, 'no full-tile wall slab is drawn across the opening');

  // The mirrored spelling also has to resolve the wall type for the fills, so
  // a door whose wall is only recorded on the far tile is still clad.
  const wb2 = new WallBuilder(null);
  wb2.build(
    [{ col: 5, row: 6, edge: 'n', type: 'structuralWall', variant: 0, baseY: { a: 0, b: 0 } }],
    [{ col: 5, row: 5, edge: 's', type: 'officeDoor', variant: 0, off: 1, baseY: { a: 0, b: 0 } }],
    [], new Group(), 'up', null
  );
  const wallH = WALL_TYPES.structuralWall.wallHeight * HEIGHT_SCALE;
  const fills = wb2._meshes.filter(m => near(m.geometry.parameters?.height ?? -1, wallH));
  assert(fills.length === 2,
    "the door's side fills take their height from the wall recorded on the far tile");
}

// ---------------------------------------------------------------------------
console.log('\n=== 14. Wall paint selects the two physical faces independently ===\n');
{
  const wb = new WallBuilder(null);
  wb.build(
    [{
      col: 2, row: 2, edge: 'n', type: 'officeWall', variant: 0,
      facePaint: { inside: 'labBlue', outside: 'utilityGray' }, baseY: { a: 0, b: 0 },
    }],
    [], [], new Group(), 'up', null,
  );
  const material = wb._meshes[0].material;
  assert(Array.isArray(material), 'a painted wall uses per-face materials');
  // BoxGeometry's front (+Z) face is the inside of a north-edge wall; its
  // back (-Z) face is the adjoining tile's independent outside finish.
  assert(material[4].color === WALL_PAINTS.labBlue.color
    && material[5].color === WALL_PAINTS.utilityGray.color,
  'north-edge inside/outside paint maps to opposite visible wall faces');
}

// ---------------------------------------------------------------------------
console.log('\n=== 15. Painted walls survive the next wall rebuild ===\n');
{
  const wb = new WallBuilder(null);
  const group = new Group();
  const painted = [{
    col: 2, row: 2, edge: 'n', type: 'structuralWall', variant: 0,
    facePaint: { inside: 'labBlue' }, baseY: { a: 0, b: 0 },
  }];

  wb.build(painted, [], [], group, 'up', null);
  let rebuildError = null;
  try {
    wb.build(
      [...painted, {
        col: 3, row: 2, edge: 'n', type: 'structuralWall', variant: 0,
        baseY: { a: 0, b: 0 },
      }],
      [], [], group, 'up', null,
    );
  } catch (error) {
    rebuildError = error;
  }

  assert(!rebuildError,
    `a refresh after painting does not fail while disposing face materials${rebuildError ? ` (${rebuildError.message})` : ''}`);
  assert(group.children.length === 2,
    'the refreshed structural-wall run remains attached to the scene');
}

// ---------------------------------------------------------------------------
console.log('\n=== 16. Door and window surrounds preserve wall paint ===\n');
{
  const paintedWall = {
    col: 2, row: 2, edge: 'n', type: 'officeWall', variant: 0,
    facePaint: { inside: 'labBlue', outside: 'utilityGray' }, baseY: { a: 0, b: 0 },
  };
  const doorBuilder = new WallBuilder(null);
  doorBuilder.build(
    [paintedWall],
    [{ col: 2, row: 2, edge: 'n', type: 'officeDoor', variant: 0, off: 1, baseY: { a: 0, b: 0 } }],
    [], new Group(), 'up', null,
  );
  const doorPainted = doorBuilder._meshes.find(mesh => Array.isArray(mesh.material));
  assert(doorPainted?.material[4].color === WALL_PAINTS.labBlue.color
    && doorPainted.material[5].color === WALL_PAINTS.utilityGray.color,
  'door surround keeps the wall inside/outside finishes');

  const windowBuilder = new WallBuilder(null);
  windowBuilder.build(
    [paintedWall], [],
    [{ col: 2, row: 2, edge: 'n', type: 'officeWindow', variant: 0, off: 1, baseY: { a: 0, b: 0 } }],
    new Group(), 'up', null,
  );
  const windowPainted = windowBuilder._meshes.find(mesh => Array.isArray(mesh.material));
  assert(windowPainted?.material[4].color === WALL_PAINTS.labBlue.color
    && windowPainted.material[5].color === WALL_PAINTS.utilityGray.color,
  'window surround keeps the wall inside/outside finishes');
}

// ---------------------------------------------------------------------------
console.log('\n=== 17. Material face finishes add thickness on the selected side ===\n');
{
  const build = (facePaint = null) => {
    const wb = new WallBuilder(null);
    wb.build([{
      col: 2, row: 2, edge: 'n', type: 'officeWall', variant: 0,
      ...(facePaint ? { facePaint } : {}), baseY: { a: 0, b: 0 },
    }], [], [], new Group(), 'up', null);
    return wb._meshes[0];
  };
  const plain = build();
  const lined = build({ inside: 'leadLining' });
  assert(near(
    lined.geometry.parameters.depth - plain.geometry.parameters.depth,
    WALL_PAINTS.leadLining.thickness,
  ), 'lead lining adds its authored physical thickness to the wall slab');
  assert(near(
    lined.position.z - plain.position.z,
    WALL_PAINTS.leadLining.thickness / 2,
  ), 'a north-wall inside lining builds toward the selected tile-facing side');
  assert(!!lined.material[4].map, 'the thick selected face uses a textured material');
}

// ---------------------------------------------------------------------------
console.log('\n=== 18. Staff door activity animates leaves open and closed ===\n');
{
  const wb = new WallBuilder(null);
  const group = new Group();
  const wall = { col: 2, row: 3, edge: 'n', type: 'officeWall', variant: 0, baseY: { a: 0, b: 0 } };
  wb.build([wall], [{
    col: 2, row: 3, edge: 'n', type: 'officeDoor', variant: 0, off: 1,
    navKey: '2,3,n', baseY: { a: 0, b: 0 },
  }], [], group, 'up', null);
  const leaf = wb._meshes.find(mesh => mesh.userData?.doorLeaf);
  const closedX = leaf.position.x;
  assert(wb.updateDoorAnimations(0.25, new Set(['2,3,n'])),
    'an active staff crossing advances the door animation');
  assert(!near(leaf.position.x, closedX), 'the leaf slides away from its closed position');
  const openX = leaf.position.x;
  for (let i = 0; i < 20; i++) wb.updateDoorAnimations(0.1, new Set());
  assert(Math.abs(leaf.position.x - closedX) < Math.abs(openX - closedX),
    'after activity expires the leaf eases back toward closed');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
