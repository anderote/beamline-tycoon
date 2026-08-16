// test/test-utility-line-supports.js — periodic ground supports for elevated
// RF waveguide, cryogenic transfer lines, and vacuum service pipe.

import * as THREE_NS from 'three';

globalThis.THREE = THREE_NS;

const { UTILITY_TYPES, utilityLineHeight } = await import('../src/utility/registry.js');
const { UtilityLineBuilderV2, buildWorldPoints } =
  await import('../src/renderer3d/utility-line-builder-v2.js');

let passed = 0, failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.log('  FAIL:', message); }
}

function collect(root, predicate) {
  const out = [];
  root.traverse(object => { if (predicate(object)) out.push(object); });
  return out;
}

function build(utilityType, lengthTiles = 4, routeHeightMeters = null) {
  const line = {
    id: `supported-${utilityType}`,
    utilityType,
    start: null,
    end: null,
    path: [{ col: 0, row: 0 }, { col: lengthTiles, row: 0 }],
    ...(Number.isFinite(routeHeightMeters) ? { routeHeightMeters } : {}),
  };
  const builder = new UtilityLineBuilderV2();
  const parent = new THREE_NS.Group();
  builder.build(new Map([[line.id, line]]), new Map(), parent);
  return { builder, parent };
}

console.log('\n--- 1. All three rigid services receive periodic supports ---');
for (const utilityType of ['rfWaveguide', 'cryoTransfer', 'vacuumPipe']) {
  const { builder, parent } = build(utilityType);
  const supports = collect(parent, object => object.userData?.isUtilitySupport);
  const expected = Math.floor(8 / UTILITY_TYPES[utilityType].supportSpacingMeters);
  assert(supports.length === expected,
    `${utilityType} gets ${expected} evenly-spaced supports on an 8 m run (${supports.length})`);
  assert(supports.every(support => support.userData.utilityType === utilityType
      && support.userData.centerlineHeight === utilityLineHeight(utilityType)
      && support.userData.legHeight > 0
      && support.position.y === 0),
    `${utilityType} support legs derive from its run height and start at ground level`);
  assert(supports.every(support => collect(support,
    object => object.userData?.utilitySupportPart === 'foot').length === 1
      && collect(support,
        object => object.userData?.utilitySupportPart === 'leg').length === 2),
  `${utilityType} supports have one ground foot and two legs`);
  builder.dispose(parent);
}

console.log('\n--- 2. Unsupported cables and short rigid runs stay uncluttered ---');
{
  const power = build('powerCable');
  const shortVacuum = build('vacuumPipe', 1);
  assert(collect(power.parent, object => object.userData?.isUtilitySupport).length === 0,
    'power cable does not inherit rigid pipe supports');
  assert(collect(shortVacuum.parent, object => object.userData?.isUtilitySupport).length === 0,
    'a 2 m vacuum run is shorter than the supported span threshold');
  power.builder.dispose(power.parent);
  shortVacuum.builder.dispose(shortVacuum.parent);
}

console.log('\n--- 3. The live draw preview includes the same support pattern ---');
for (const utilityType of ['rfWaveguide', 'cryoTransfer', 'vacuumPipe']) {
  const builder = new UtilityLineBuilderV2();
  const parent = new THREE_NS.Group();
  builder.setPreview({
    utilityType,
    valid: true,
    endpointTransitions: false,
    path: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
  }, parent);
  const supports = collect(parent, object => object.userData?.isUtilitySupport);
  assert(supports.length > 0,
    `${utilityType} preview shows supports before the run is committed`);
  builder.dispose(parent);
}

console.log('\n--- 4. Elevated route lanes carry their geometry and supports upward ---');
{
  const elevatedHeight = 1.14;
  const { builder, parent } = build('vacuumPipe', 4, elevatedHeight);
  const supports = collect(parent, object => object.userData?.isUtilitySupport);
  assert(supports.length > 0 && supports.every(
    support => support.userData.centerlineHeight === elevatedHeight
      && support.userData.legHeight > elevatedHeight / 2,
  ), 'auto-placed vacuum support struts rise to the selected rack lane');

  const points = buildWorldPoints({
    utilityType: 'vacuumPipe', routeHeightMeters: elevatedHeight,
    start: null, end: null,
    path: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
  }, new Map());
  assert(points.length >= 2 && points.every(point => point.y === elevatedHeight),
    'the rigid line centerline renders at its stored route elevation');
  builder.dispose(parent);
}

{
  const elevatedHeight = 0.84;
  const builder = new UtilityLineBuilderV2();
  const parent = new THREE_NS.Group();
  builder.setPreview({
    utilityType: 'cryoTransfer', routeHeightMeters: elevatedHeight,
    valid: true, endpointTransitions: false,
    path: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
  }, parent);
  const supports = collect(parent, object => object.userData?.isUtilitySupport);
  assert(supports.length > 0 && supports.every(
    support => support.userData.centerlineHeight === elevatedHeight,
  ), 'the live cryogenic preview shows struts at its proposed lane height');
  builder.dispose(parent);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
