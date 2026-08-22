import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { DISTRIBUTION_OUTPUT_LAYOUTS } from '../src/data/distribution-output-layout.js';
import {
  portAnchorOverride,
  POWER_HV_INPUT_MOUNTS,
} from '../src/data/utility-port-anchors.js';

globalThis.THREE = THREE;

const {
  _buildCompactHvDistributorRoles,
  _buildHVTransformerRoles,
  _buildSwitchgearRoles,
  _buildMCCRoles,
  _buildUPSRoles,
  _buildPadMountTransformerRoles,
  _buildCompactDistributionPanelRoles,
  _buildSectionDistributionPanelRoles,
  _buildMainDistributionPanelRoles,
  _buildSpiderBoxRoles,
} = await import('../src/renderer3d/builders/power-builder.js');

function totalParts(buckets) {
  return Object.values(buckets).reduce((sum, parts) => sum + parts.length, 0);
}

function disposeBuckets(buckets) {
  for (const parts of Object.values(buckets)) {
    for (const geometry of parts) geometry.dispose();
  }
}

test('electrical distribution outputs use horizontal rows of four or two', () => {
  const expectedRows = {
    poleMountTransformer: [4],
    compactHvDistributor: [2],
    switchgear: [4],
    powerPanel: [4],
    sectionDistributionPanel: [4, 2],
    mainDistributionPanel: [4, 4],
    mcc: [4, 4],
    ups: [2],
  };

  for (const [type, rowCounts] of Object.entries(expectedRows)) {
    const prefix = type === 'compactHvDistributor' || type === 'switchgear'
      ? 'hv_out' : 'pwr_out';
    const positions = DISTRIBUTION_OUTPUT_LAYOUTS[type];
    const rows = [...new Set(positions.map(({ y }) => y))];
    assert.deepEqual(rows.map(y => positions.filter(pos => pos.y === y).length), rowCounts,
      `${type} uses the expected horizontal output rows`);

    for (const [index, position] of positions.entries()) {
      const anchor = portAnchorOverride(type, `${prefix}_${index + 1}`);
      assert.equal(anchor.along, position.x, `${type} output ${index + 1} has the row's X position`);
      assert.equal(anchor.y, position.y, `${type} output ${index + 1} has the row's height`);
    }

    for (const y of rows) {
      const xs = positions.filter(pos => pos.y === y).map(({ x }) => x);
      assert.deepEqual(xs, [...xs].sort((a, b) => a - b),
        `${type} outputs run left-to-right within each row`);
    }
  }
});

test('HV transformer feeder rack supports all four existing cable anchors', () => {
  const transformer = _buildHVTransformerRoles();
  const terminalCaps = transformer.copper.filter(geometry => {
    geometry.computeBoundingBox();
    return Math.abs(geometry.boundingBox.max.y - 1.45) < 1e-6;
  });

  assert.equal(transformer.accent.length, 19,
    'four feeder terminals each add a ceramic post and three skirts');
  assert.equal(terminalCaps.length, 4, 'the rack exposes four metal terminal caps');
  assert.ok(transformer.iron.length >= 4, 'a crossarm and two brackets support the terminal row');

  const centers = terminalCaps.map(geometry => {
    return geometry.boundingBox.getCenter(new THREE.Vector3());
  });
  assert.deepEqual(centers.map(({ x }) => Number(x.toFixed(2))), [-0.75, -0.25, 0.25, 0.75]);
  assert.ok(centers.every(({ z }) => Math.abs(z - 0.82) < 1e-6),
    'terminal caps stay on the existing front cable plane');
  for (const geometry of terminalCaps) {
    assert.ok(Math.abs(geometry.boundingBox.max.y - 1.45) < 1e-6,
      'each cable lands on the top of its visible terminal cap');
  }

  const sharedTank = _buildHVTransformerRoles(false);
  assert.equal(sharedTank.accent.length, 3,
    'two- and six-outlet transformer tiers do not inherit the four-terminal rack');

  disposeBuckets(transformer);
  disposeBuckets(sharedTank);
});

test('Power HV input anchors terminate on visible upper insulator caps', () => {
  const cases = {
    powerPanel: _buildCompactDistributionPanelRoles,
    sectionDistributionPanel: _buildSectionDistributionPanelRoles,
    mainDistributionPanel: _buildMainDistributionPanelRoles,
    compactHvDistributor: _buildCompactHvDistributorRoles,
    switchgear: _buildSwitchgearRoles,
    mcc: _buildMCCRoles,
    ups: _buildUPSRoles,
    padMountTransformer: _buildPadMountTransformerRoles,
    hvTransformer: _buildHVTransformerRoles,
    facilityTransformer: () => _buildHVTransformerRoles(false),
    gridIntertieTransformer: () => _buildHVTransformerRoles(false),
  };

  for (const [type, build] of Object.entries(cases)) {
    const mount = POWER_HV_INPUT_MOUNTS[type];
    const buckets = build();
    const cap = buckets.copper.find((geometry) => {
      geometry.computeBoundingBox();
      const center = geometry.boundingBox.getCenter(new THREE.Vector3());
      if (Math.abs(center.x - mount.localX) > 1e-6) return false;
      if (mount.normal.y > 0.5) {
        return Math.abs(center.z - mount.localZ) < 1e-6
          && Math.abs(geometry.boundingBox.max.y - mount.y) < 1e-6;
      }
      return Math.abs(center.y - mount.y) < 1e-6
        && Math.abs(geometry.boundingBox.min.z - mount.localZ) < 1e-6;
    });
    assert.ok(cap, `${type}.hv_in lands on a visible insulated terminal cap`);
    const minimumCeramicParts = /Transformer$/.test(type) ? 3 : 4;
    assert.ok(buckets.accent.length >= minimumCeramicParts,
      `${type}.hv_in has visible ceramic insulation`);
    disposeBuckets(buckets);
  }
});

test('distribution panel rungs are detailed NEMA enclosures, not plain boxes', () => {
  const compact = _buildCompactDistributionPanelRoles();
  const section = _buildSectionDistributionPanelRoles();
  const main = _buildMainDistributionPanelRoles();

  assert.ok(totalParts(compact) >= 35,
    `compact panel has doors, hinges, breakers, labels and vents (${totalParts(compact)} parts)`);
  assert.ok(totalParts(section) > totalParts(compact),
    'section panel visibly adds a second cabinet/breaker bank');
  assert.ok(totalParts(main) > totalParts(section),
    'main panel visibly carries the largest breaker lineup');

  for (const [name, buckets] of [['compact', compact], ['section', section], ['main', main]]) {
    assert.ok(buckets.accent.length >= 3, `${name} panel has a cabinet, cap and proud door`);
    assert.ok(buckets.detail.length >= 15, `${name} panel has gasket frames and side louvers`);
    assert.equal(buckets.glow.length, 3, `${name} panel has a restrained three-lamp status row`);
    assert.ok(buckets.copper.length >= 1, `${name} panel exposes its grounding bond`);
    disposeBuckets(buckets);
  }
});

test('switchgear and MCC show serviceable electrical compartments', () => {
  const compactHv = _buildCompactHvDistributorRoles();
  const switchgear = _buildSwitchgearRoles();
  const mcc = _buildMCCRoles();

  assert.ok(totalParts(compactHv) >= 20,
    `compact HV distributor has a door, two breaker outlets and rear inlet (${totalParts(compactHv)} parts)`);
  assert.equal(compactHv.glow.length, 1, 'compact HV distributor has one restrained status lamp');
  assert.equal(compactHv.copper.length, 4,
    'compact HV distributor shows one inlet, two outlets and its grounding bond');
  assert.ok(totalParts(compactHv) < totalParts(switchgear),
    'compact 1-to-2 cabinet is visually simpler than the four-way switchgear');

  assert.ok(totalParts(switchgear) >= 35,
    `switchgear has a door, meter, breaker hardware and lifting eyes (${totalParts(switchgear)} parts)`);
  assert.equal(switchgear.glow.length, 3, 'switchgear has three phase/status pilot lamps');
  assert.ok(switchgear.copper.length >= 9, 'switchgear retains terminals plus a grounding strap');

  assert.ok(totalParts(mcc) >= 70,
    `MCC has eight individually legible starter buckets (${totalParts(mcc)} parts)`);
  assert.equal(mcc.glow.length, 8, 'each MCC starter bucket has one pilot lamp');
  assert.ok(mcc.accent.length >= 9, 'MCC enclosure carries eight proud compartment doors');

  disposeBuckets(compactHv);
  disposeBuckets(switchgear);
  disposeBuckets(mcc);
});

test('portable spider box gains a lid, guards, label and carry handle', () => {
  const spider = _buildSpiderBoxRoles();
  assert.ok(totalParts(spider) >= 17,
    `portable field box has believable case hardware (${totalParts(spider)} parts)`);
  assert.ok(spider.stand.length >= 3, 'carry handle has two uprights and a grip');
  assert.ok(spider.iron.length >= 4, 'rubberized corner guards protect the case');
  assert.ok(spider.pipe.length >= 1, 'lid carries a brushed equipment label');
  disposeBuckets(spider);
});
