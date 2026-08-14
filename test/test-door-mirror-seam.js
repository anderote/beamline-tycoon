// test/test-door-mirror-seam.js
// The seam between the game-logic side and the renderer side of subtile doors.
//
// Game.js stores every door at the key the *wall* uses, mirroring `off` via
// edge-keys' mirrorDoorOff() when the player drew the door from the far tile.
// wall-builder then reads that `off` against the record's own edge and must
// NOT mirror again. test-door-geometry.js re-derives the mirror rule locally
// rather than importing it, so nothing else pins the two real implementations
// together — that is what this file does.
//
// wall-builder touches THREE and document at module load (procedural
// textures), so both are stubbed before the dynamic import.

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.log(`  FAIL: ${msg}`); }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// --- minimal THREE / document stubs ----------------------------------------
const Generic = class {
  constructor() {}
  set() { return this; } translate() { return this; } scale() { return this; }
  dispose() {} load() { return new Generic(); }
};
globalThis.THREE = new Proxy({}, { get: () => Generic });
const ctx = new Proxy({}, { get: () => () => ctx });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
};

const { doorOpeningLayout } = await import('../src/renderer3d/wall-builder.js');
const { mirrorDoorOff, clampDoorOff, defaultDoorOff, doorSubWidth } =
  await import('../src/game/edge-keys.js');
const { DOOR_TYPES } = await import('../src/data/structure.js');

const SINGLE = { doorWidth: 'single' };
const DOUBLE = { doorWidth: 'double' };

// --- Test 1: a mirrored record lands in the same world position -------------
// 'n' on tile (c,r) and 's' on tile (c,r-1) are the same physical edge. Given
// the game mirrors `off` when it rewrites the record, both spellings must put
// the opening centre at the same signed offset from the edge midpoint.
console.log('\n--- Test 1: mirrored edge spellings agree in world space ---');
for (const [a, b] of [['n', 's'], ['e', 'w'], ['s', 'n'], ['w', 'e']]) {
  for (let off = 0; off <= 2; off++) {
    const mo = mirrorDoorOff(off, SINGLE);
    const la = doorOpeningLayout(a, off, false);
    const lb = doorOpeningLayout(b, mo, false);
    assert(near(la.center, lb.center),
      `single ${a}(off=${off}) and ${b}(off=${mo}) share an opening centre ` +
      `(${la.center.toFixed(3)} vs ${lb.center.toFixed(3)})`);
  }
}
for (const [a, b] of [['n', 's'], ['e', 'w']]) {
  const mo = mirrorDoorOff(0, DOUBLE);
  assert(near(doorOpeningLayout(a, 0, true).center,
              doorOpeningLayout(b, mo, true).center),
    `double ${a}/${b} agree (mirrored off=${mo})`);
}

// --- Test 2: mirroring is an involution ------------------------------------
console.log('\n--- Test 2: mirroring twice is identity ---');
for (let off = 0; off <= 2; off++) {
  assert(mirrorDoorOff(mirrorDoorOff(off, SINGLE), SINGLE) === off,
    `single off=${off} survives a round trip`);
}
assert(mirrorDoorOff(mirrorDoorOff(0, DOUBLE), DOUBLE) === 0,
  'double off=0 survives a round trip');

// --- Test 3: the two sides agree on width and range -------------------------
// edge-keys drives clamping; wall-builder independently re-clamps. They must
// not disagree, or a legal placement would render somewhere else.
console.log('\n--- Test 3: clamp ranges agree across the seam ---');
for (const [name, def] of Object.entries(DOOR_TYPES)) {
  const isDouble = def.doorWidth === 'double';
  const width = doorSubWidth(def);
  assert(width === (isDouble ? 4 : 2),
    `${name}: edge-keys width ${width} matches doorWidth '${def.doorWidth}'`);
  const maxOff = 4 - width;
  for (let off = -2; off <= 6; off++) {
    const gameOff = clampDoorOff(def, off);
    const rendered = doorOpeningLayout('n', gameOff, isDouble);
    assert(rendered.off === gameOff,
      `${name}: renderer accepts clamped off=${gameOff} unchanged (raw ${off})`);
    assert(gameOff >= 0 && gameOff <= maxOff,
      `${name}: clamped off=${gameOff} inside [0,${maxOff}]`);
  }
}

// --- Test 4: defaults reproduce the pre-`off` centred geometry ---------------
console.log('\n--- Test 4: defaults match legacy centred doors ---');
for (const [name, def] of Object.entries(DOOR_TYPES)) {
  const isDouble = def.doorWidth === 'double';
  const l = doorOpeningLayout('n', defaultDoorOff(def), isDouble);
  assert(near(l.center, 0), `${name}: default off centres the opening`);
  assert(near(l.leftWidth, l.rightWidth),
    `${name}: default off leaves symmetric side fills`);
}

// --- Test 5: the opening always covers the tile exactly ---------------------
console.log('\n--- Test 5: fills + opening tile the edge with no gap ---');
for (const edge of ['n', 'e', 's', 'w']) {
  for (let off = 0; off <= 2; off++) {
    const l = doorOpeningLayout(edge, off, false);
    assert(near(l.leftWidth + l.openingWidth + l.rightWidth, 2),
      `${edge} off=${off}: widths sum to the tile (${l.leftWidth}+${l.openingWidth}+${l.rightWidth})`);
    assert(l.leftWidth >= 0 && l.rightWidth >= 0,
      `${edge} off=${off}: no negative side fill`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
