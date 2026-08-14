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
const { DOOR_TYPES, WALL_TYPES } = await import('../src/data/structure.js');

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
      group, 'up', null
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
      group, 'up', null
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
      group, 'up', null
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
      group, visibility, null
    );
    return wb._meshes.filter(m => near(m.geometry.parameters?.depth ?? -1, PANEL_THICKNESS));
  };

  const office = panelsOf('officeDoor', 0);
  assert(office.length === 1, 'a textured door renders exactly one panel leaf');
  assert(office[0].material.map != null, 'the panel is wired to the door texture, not left untextured');
  assert(near(office[0].geometry.parameters.width, 1.0 - 0.04),
    'the panel fills the opening less the frame gap');
  assert(near(office[0].position.x, TILE_SIZE / 2),
    'the panel is centred on the (off=1) opening');

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

  // Panel offset tracks the opening, not the edge centre.
  const wb = new WallBuilder(null);
  const group = new Group();
  wb.build(
    [{ col: 0, row: 0, edge: 'n', type: 'officeWall', variant: 0, baseY: { a: 0, b: 0 } }],
    [{ col: 0, row: 0, edge: 'n', type: 'officeDoor', variant: 0, off: 2 }],
    group, 'up', null
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
  }

  // ...and against the walls each door type is actually meant to hang on.
  const HOSTS = {
    doubleDoor: ['structuralWall'],
    securityDoor: ['structuralWall'],
    rollingShutter: ['structuralWall'],
    officeDoor: ['officeWall', 'hallwayWall'],
    hallwayDoor: ['officeWall', 'hallwayWall'],
    fireDoor: ['officeWall', 'hallwayWall'],
    labDoor: ['officeWall', 'hallwayWall'],
    chainLinkGate: ['chainLinkFence'],
    woodGate: ['woodFence'],
    securityGate: ['barbedWireFence'],
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
console.log('\n=== 7. Wall heights clear a standing person; exteriors overtop interiors ===\n');
{
  // 1 data unit = HEIGHT_SCALE world units = HEIGHT_SCALE * 2 metres.
  // TILE_SIZE is 2 world units and 2 m real, so 1 world unit = 1 m.
  const metres = (data) => data * HEIGHT_SCALE;
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
console.log('\n=== 8. A tall door on a short wall is clamped, not poked through ===\n');
{
  const wb = new WallBuilder(null);
  const group = new Group();
  const seg = { col: 1, row: 1, edge: 'e' };
  // officeDoor (19) would need 20.4 units; cinderblockWall only has 14.
  wb.build(
    [{ ...seg, type: 'cinderblockWall', variant: 0, baseY: { a: 0, b: 0 } }],
    [{ ...seg, type: 'officeDoor', variant: 0, off: 1 }],
    group, 'up', null
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
