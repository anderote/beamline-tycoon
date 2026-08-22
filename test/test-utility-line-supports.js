// test/test-utility-line-supports.js — periodic ground supports for elevated
// RF waveguide, cryogenic transfer lines, rigid water headers, and vacuum pipe.

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

console.log('\n--- 1. Every rigid service receives the common periodic supports ---');
for (const utilityType of ['rfWaveguide', 'cryoTransfer', 'waterSupplyPipe', 'vacuumPipe']) {
  const { builder, parent } = build(utilityType);
  const supports = collect(parent, object => object.userData?.isUtilitySupport);
  assert(UTILITY_TYPES[utilityType].supportSpacingMeters === 1,
    `${utilityType} uses the one-metre support pitch`);
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
  assert(new Set(heights).size === services.length,
    'cryo, cold water, hot water, RF, and vacuum keep distinct vertical datums');
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
  assert(racks.every(rack => rack.userData.stackedServiceCount === services.length
      && new Set(rack.userData.centerlineHeights).size === services.length
      && collect(rack, object => object.userData?.utilitySupportPart === 'saddle').length
        === services.length),
  'each shared rack has one shelf at every independent service datum');
  builder.dispose(parent);
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
