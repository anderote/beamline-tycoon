// test/test-utility-line-supports.js — periodic ground supports for elevated
// RF waveguide, cryogenic transfer lines, rigid water headers, and vacuum pipe.

import * as THREE_NS from 'three';

globalThis.THREE = THREE_NS;

const { UTILITY_TYPES, utilityLineHeight } = await import('../src/utility/registry.js');
const {
  UtilityLineBuilderV2,
  WATER_TWIN_CENTER_SPACING_METERS,
  buildWorldPoints,
  twinWaterPresentationPoints,
} =
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

function build(utilityType, lengthTiles = 4, routeHeightMeters = null, waterCircuit = null) {
  const line = {
    id: `supported-${utilityType}`,
    utilityType,
    start: null,
    end: null,
    path: [{ col: 0, row: 0 }, { col: lengthTiles, row: 0 }],
    ...(Number.isFinite(routeHeightMeters) ? { routeHeightMeters } : {}),
    ...(waterCircuit ? { waterCircuit } : {}),
  };
  const builder = new UtilityLineBuilderV2();
  const parent = new THREE_NS.Group();
  builder.build(new Map([[line.id, line]]), new Map(), parent);
  return { builder, parent };
}

function rigidLine(id, utilityType, startCol, endCol, extra = {}) {
  return {
    id,
    utilityType,
    start: null,
    end: null,
    path: [{ col: startCol, row: 0 }, { col: endCol, row: 0 }],
    ...extra,
  };
}

function rackSignature(parent) {
  return collect(parent, object => object.userData?.isUtilitySupport)
    .map(support => ({
      station: `${support.position.x.toFixed(6)},${support.position.z.toFixed(6)}`,
      types: [...(support.userData.utilityTypes || [support.userData.utilityType])].sort(),
      shelves: collect(support,
        object => object.userData?.utilitySupportPart === 'saddle').length,
    }))
    .sort((a, b) => a.station.localeCompare(b.station));
}

console.log('\n--- 1. Every rigid service receives the common periodic supports ---');
for (const utilityType of ['rfWaveguide', 'cryoTransfer', 'waterSupplyPipe', 'vacuumPipe']) {
  const { builder, parent } = build(utilityType, 5);
  const supports = collect(parent, object => object.userData?.isUtilitySupport);
  assert(UTILITY_TYPES[utilityType].supportSpacingMeters === 1.25,
    `${utilityType} uses the 1.25-metre support pitch`);
  const expected = Math.floor(10 / UTILITY_TYPES[utilityType].supportSpacingMeters);
  assert(supports.length === expected,
    `${utilityType} gets ${expected} evenly-spaced supports on a 10 m run (${supports.length})`);
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
  const supportParts = supports.flatMap(support => collect(support,
    object => object.userData?.utilitySupportPart));
  assert(supportParts.every(part => part.material?.color?.getHex() === 0x99aabb
      && part.material.roughness === 0.3
      && part.material.metalness === 0.5),
  `${utilityType} supports use the light-grey beam-pipe metal finish`);
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

console.log('\n--- 2b. Cryogenic supports carry shoes and jacket clamps ---');
{
  const cryo = build('cryoTransfer');
  const water = build('waterSupplyPipe', 4, null, 'cold');
  const cryoSupports = collect(cryo.parent, object => object.userData?.isUtilitySupport);
  const clamps = collect(cryo.parent,
    object => object.userData?.utilitySupportPart === 'cryostat-clamp');
  const shoes = collect(cryo.parent,
    object => object.userData?.utilitySupportPart === 'cryostat-shoe');
  const waterClamps = collect(water.parent,
    object => object.userData?.utilitySupportPart === 'cryostat-clamp');
  assert(clamps.length === cryoSupports.length && shoes.length === cryoSupports.length,
    'every cryogenic H-frame adds one insulated shoe and one wraparound jacket clamp');
  assert(waterClamps.length === 0,
    'the cryostat clamp vocabulary does not leak onto generic jacketed water pipe');
  cryo.builder.dispose(cryo.parent);
  water.builder.dispose(water.parent);
}

console.log('\n--- 3. The live draw preview includes the same support pattern ---');
for (const utilityType of ['rfWaveguide', 'cryoTransfer', 'waterSupplyPipe', 'vacuumPipe']) {
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

console.log('\n--- 4. Co-located independent services form one aligned vertical stack ---');
{
  const coldHeight = UTILITY_TYPES.waterSupplyPipe.runHeightsByWaterCircuit.cold;
  const hotHeight = UTILITY_TYPES.waterSupplyPipe.runHeightsByWaterCircuit.hot;
  const services = [
    ['cryoTransfer', null, null],
    ['waterSupplyPipe', coldHeight, 'cold'],
    ['waterSupplyPipe', hotHeight, 'hot'],
    ['rfWaveguide', null, null],
    ['vacuumPipe', null, null],
  ];
  const built = services.map(([type, height, circuit]) => build(type, 4, height, circuit));
  const supports = built.map(({ parent }) => collect(parent,
    object => object.userData?.isUtilitySupport));
  const stations = supports.map(items => items.map(item =>
    `${item.position.x.toFixed(6)},${item.position.z.toFixed(6)}`).join('|'));
  assert(new Set(stations).size === 1,
    'all rigid services place support frames at identical plan stations');
  const heights = supports.map(items => items[0]?.userData.centerlineHeight);
  assert(new Set(heights).size === services.length - 1
      && coldHeight === hotHeight,
  'cold and hot water share one elevation while other rigid services retain distinct datums');
  for (const entry of built) entry.builder.dispose(entry.parent);

  const builder = new UtilityLineBuilderV2();
  const parent = new THREE_NS.Group();
  const lines = new Map(services.map(([type, height, circuit], index) => {
    const line = {
      id: `stack-${index}`,
      utilityType: type,
      start: null,
      end: null,
      path: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
      ...(Number.isFinite(height) ? { routeHeightMeters: height } : {}),
      ...(circuit ? { waterCircuit: circuit } : {}),
    };
    return [line.id, line];
  }));
  builder.build(lines, new Map(), parent);
  const racks = collect(parent, object => object.userData?.isRigidUtilityRack);
  const expectedStations = Math.floor(8 / UTILITY_TYPES.vacuumPipe.supportSpacingMeters);
  assert(racks.length === expectedStations,
    `five co-located services consolidate into ${expectedStations} shared rack frames`);
  assert(racks.every(rack => rack.userData.stackedServiceCount === services.length - 1
      && new Set(rack.userData.centerlineHeights).size === services.length - 1
      && collect(rack, object => object.userData?.utilitySupportPart === 'saddle').length
        === services.length - 1
      && rack.userData.isTwinWaterSupport
      && collect(rack, object => object.userData?.utilitySupportPart
        === 'water-twin-bracket').length === 2),
  'each shared rack gives cold/hot one integrated shelf with two brackets');
  assert(racks.every(rack => collect(rack,
    object => object.userData?.utilitySupportPart === 'cryostat-clamp').length === 1),
  'each shared multi-service rack retains one clamp around its cryogenic shelf');
  builder.dispose(parent);
}

console.log('\n--- 4b. Partial overlaps reuse the same rack regardless of build order ---');
{
  const water = rigidLine('long-water', 'waterSupplyPipe', 0, 6, {
    waterCircuit: 'cold',
  });
  const vacuum = rigidLine('short-vacuum', 'vacuumPipe', 1, 5);

  const waterFirstBuilder = new UtilityLineBuilderV2();
  const waterFirstParent = new THREE_NS.Group();
  waterFirstBuilder.build(new Map([[water.id, water]]), new Map(), waterFirstParent);
  waterFirstBuilder.build(new Map([
    [water.id, water],
    [vacuum.id, vacuum],
  ]), new Map(), waterFirstParent);
  const waterFirst = rackSignature(waterFirstParent);
  const sharedWaterFirst = waterFirst.filter(item => item.types.includes('waterSupplyPipe')
    && item.types.includes('vacuumPipe'));

  const vacuumFirstBuilder = new UtilityLineBuilderV2();
  const vacuumFirstParent = new THREE_NS.Group();
  vacuumFirstBuilder.build(new Map([[vacuum.id, vacuum]]), new Map(), vacuumFirstParent);
  vacuumFirstBuilder.build(new Map([
    [vacuum.id, vacuum],
    [water.id, water],
  ]), new Map(), vacuumFirstParent);
  const vacuumFirst = rackSignature(vacuumFirstParent);
  const sharedVacuumFirst = vacuumFirst.filter(item => item.types.includes('waterSupplyPipe')
    && item.types.includes('vacuumPipe'));

  const expectedSharedStations = Math.floor(
    8 / UTILITY_TYPES.vacuumPipe.supportSpacingMeters,
  );
  assert(sharedWaterFirst.length === expectedSharedStations
      && sharedWaterFirst.every(item => item.shelves === 2),
  `vacuum built over the middle of a longer water run extends ${expectedSharedStations} existing frames with a second shelf`);
  assert(sharedVacuumFirst.length === expectedSharedStations
      && sharedVacuumFirst.every(item => item.shelves === 2),
  `water built under an existing vacuum run produces the same ${expectedSharedStations} shared frames`);
  assert(JSON.stringify(waterFirst) === JSON.stringify(vacuumFirst),
    'the final support layout is independent of utility creation and map insertion order');

  waterFirstBuilder.dispose(waterFirstParent);
  vacuumFirstBuilder.dispose(vacuumFirstParent);
}

console.log('\n--- 4c. Coincident cold and hot routes render as an independent side-by-side twin ---');
{
  const y = UTILITY_TYPES.waterSupplyPipe.runHeightsByWaterCircuit.cold;
  const centered = [
    new THREE_NS.Vector3(0, y, 0),
    new THREE_NS.Vector3(8, y, 0),
  ];
  const cold = twinWaterPresentationPoints(centered, {
    utilityType: 'waterSupplyPipe', waterCircuit: 'cold', routeHeightMeters: y,
  });
  const hot = twinWaterPresentationPoints(centered.slice().reverse(), {
    utilityType: 'waterSupplyPipe', waterCircuit: 'hot', routeHeightMeters: y,
  });
  assert(cold.every(point => point.y === y) && hot.every(point => point.y === y),
    'both circuits stay on the common elevation');
  assert(Math.abs(Math.abs(cold[0].z - hot[1].z) - WATER_TWIN_CENTER_SPACING_METERS) < 1e-6,
    'opposite draw directions still produce the canonical twin spacing');
}

console.log('\n--- 5. Fixed datums ignore retired per-line lane values ---');
{
  const elevatedHeight = 1.14;
  const { builder, parent } = build('vacuumPipe', 4, elevatedHeight);
  const supports = collect(parent, object => object.userData?.isUtilitySupport);
  assert(supports.length > 0 && supports.every(
    support => support.userData.centerlineHeight === utilityLineHeight('vacuumPipe'),
  ), 'vacuum support struts stay on the canonical service datum');

  const points = buildWorldPoints({
    utilityType: 'vacuumPipe', routeHeightMeters: elevatedHeight,
    start: null, end: null,
    path: [{ col: 0, row: 0 }, { col: 4, row: 0 }],
  }, new Map());
  assert(points.length >= 2
      && points.every(point => point.y === utilityLineHeight('vacuumPipe')),
    'the rigid line centerline ignores its obsolete stored route elevation');
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
    support => support.userData.centerlineHeight === utilityLineHeight('cryoTransfer'),
  ), 'the live cryogenic preview stays on its fixed datum');
  builder.dispose(parent);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
